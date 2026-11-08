const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { runBackup, isConfigured, buildBackup } = require("../jobs/nightlyBackup");
const { recordAudit } = require("../audit");
const storage = require("../storage");
const { ZipWriter } = require("../zipStream");

const router = express.Router();

const MAX_INVOICE_BYTES = 12 * 1024 * 1024;

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dateOnly(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function zipSafe(name) {
  return (
    String(name || "file")
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "file"
  );
}

async function readAll(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      stream.destroy();
      throw new Error("file is unexpectedly large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Owner only: one .zip with all data (every business, entry, user, role and the audit trail)
// plus every purchase invoice file, for keeping a second copy on the owner's own computer.
// Sign-in secrets for two-factor authentication are left out of this downloadable copy.
router.get("/full", requireAuth, requireSuperAdmin, async (req, res) => {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  let started = false;
  try {
    const data = await buildBackup();
    data.users = data.users.map(({ totp_secret, totp_pending_secret, ...rest }) => rest);
    data.note =
      "Downloaded complete backup. Two-factor secrets are not included; after a restore, each user sets up Google Authenticator again.";

    const { rows: files } = await pool
      .query(
        `SELECT a.id, a.object_key, a.file_name, a.content_type, a.size_bytes, a.created_at,
                t.id AS entry_id, t.occurred_on, t.type, t.amount, t.supplier_name, t.invoice_number,
                b.slug, b.name AS business_name
           FROM transaction_attachments a
           JOIN transactions t ON t.id = a.transaction_id
           JOIN businesses b ON b.id = a.business_id
          WHERE a.deleted_at IS NULL
          ORDER BY b.id, t.occurred_on, a.id`
      )
      .catch(() => ({ rows: [] }));

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="unified-accounts-complete-backup-${stamp}.zip"`);
    res.setHeader("Cache-Control", "no-store");
    started = true;

    const zip = new ZipWriter(res);
    await zip.addFile(`data/unified-accounts-backup-${stamp}.json`, JSON.stringify(data, null, 2), {
      date: now,
      compress: true,
    });

    const storageOn = storage.isConfigured();
    const index = [
      ["Business", "Entry date", "Entry no.", "Type", "Amount", "Supplier", "Invoice no.", "File in this backup", "Status"],
    ];
    let saved = 0;
    let missing = 0;
    for (const f of files) {
      const occurred = dateOnly(f.occurred_on);
      const path = `invoices/${zipSafe(f.slug)}/${occurred.slice(0, 7) || "undated"}/${occurred}-entry${f.entry_id}-${f.id}-${zipSafe(f.file_name)}`;
      let status = "Included";
      if (!storageOn) {
        status = "Not included: invoice storage is not set up on the server";
      } else {
        try {
          const stream = await storage.getFile(f.object_key);
          const buf = await readAll(stream, MAX_INVOICE_BYTES);
          await zip.addFile(path, buf, { date: f.created_at });
          saved += 1;
        } catch (e) {
          if (res.destroyed) throw e;
          status = `Not included: ${e.message}`;
        }
      }
      if (status !== "Included") missing += 1;
      index.push([
        f.business_name,
        occurred,
        f.entry_id,
        f.type === "fixed_cost" ? "Fixed cost" : "Expense",
        f.amount,
        f.supplier_name,
        f.invoice_number,
        status === "Included" ? path : "",
        status,
      ]);
    }
    await zip.addFile("invoices/invoice-list.csv", "﻿" + index.map((r) => r.map(csvCell).join(",")).join("\r\n"), {
      date: now,
      compress: true,
    });

    const readme = [
      "UNIFIED ACCOUNTS PLATFORM - COMPLETE BACKUP",
      `Created: ${now.toISOString().replace("T", " ").slice(0, 19)} UTC`,
      `Created by: ${req.user.username}`,
      "",
      "Contents",
      `- data/unified-accounts-backup-${stamp}.json: all businesses, entries, users, roles,`,
      "  invoice records and the full audit trail (same format as the nightly Oracle backups).",
      `- invoices/: the purchase invoice photos and PDFs (${saved} included${missing ? `, ${missing} could not be included` : ""}),`,
      "  arranged by business and month.",
      "- invoices/invoice-list.csv: every invoice with its business, date, amount, supplier",
      "  and invoice number. Opens in Excel.",
      "",
      "Two-factor sign-in secrets are not included in this copy for safety.",
      "Keep this file somewhere private: it contains all of your business records.",
      "",
    ].join("\r\n");
    await zip.addFile("README.txt", readme, { date: now, compress: true });
    await zip.finish();
    res.end();

    recordAudit({
      userId: req.user.id,
      action: "download",
      entityType: "complete_backup",
      changes: { invoices_included: saved, invoices_missing: missing },
    });
    // eslint-disable-next-line no-console
    console.log(`[backup] Complete backup downloaded by ${req.user.username} (${saved} invoices, ${missing} missing)`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[backup] Complete backup download failed:", err.message);
    if (!started) return res.status(500).json({ error: "Could not prepare the backup. Please try again." });
    // Part of the file was already sent: break the download so a half-written file isn't kept.
    res.destroy(err);
  }
});

// Lets a super admin trigger a backup on demand (e.g. to verify configuration)
// instead of waiting for the nightly schedule.
router.post("/run", requireAuth, requireSuperAdmin, async (req, res, next) => {
  if (!isConfigured()) {
    return res.status(400).json({
      error: "Oracle backup is not configured (OCI_BACKUP_PAR_URL missing).",
    });
  }
  try {
    const result = await runBackup();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Lets an external scheduler (e.g. a GitHub Actions cron workflow) trigger the nightly
// backup without a logged-in session. This exists because Render's free tier spins the
// service down after ~15 minutes of inactivity, which kills any in-process setTimeout-based
// schedule — an external cron hit both wakes the service up and runs the backup reliably.
// Authenticated with a shared secret (BACKUP_CRON_SECRET) instead of a user JWT.
router.post("/cron", async (req, res, next) => {
  const provided = req.headers["x-cron-secret"];
  const expected = process.env.BACKUP_CRON_SECRET;
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "Invalid or missing cron secret." });
  }
  if (!isConfigured()) {
    return res.status(400).json({
      error: "Oracle backup is not configured (OCI_BACKUP_PAR_URL missing).",
    });
  }
  try {
    const result = await runBackup();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
