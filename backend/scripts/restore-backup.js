/**
 * Restores the Unified Accounts Platform from a backup into an EMPTY database.
 *
 * Works with either:
 *   - the owner's "Download complete backup" .zip (data + invoice photos/PDFs), or
 *   - a nightly Oracle backup .json (data only; invoice files stay in Oracle).
 *
 * Usage (from the backend folder):
 *   node scripts/restore-backup.js --file=unified-accounts-complete-backup-2026-11-08.zip --check
 *       Reads the backup and prints what is inside. Changes nothing.
 *   DATABASE_URL=postgres://... node scripts/restore-backup.js --file=<backup.zip or .json>
 *       Creates the tables if needed and loads every record, keeping the original ids.
 *   ... add --invoices to also upload the invoice files in the .zip to invoice storage
 *       (needs OCI_INVOICE_PAR_URL). Use it when the files in Oracle were lost.
 *   OCI_INVOICE_PAR_URL=... node scripts/restore-backup.js --file=<backup.zip> --invoices-only
 *       Only puts the invoice files back into (new) invoice storage; the database is not touched.
 *       Use it when Oracle storage was lost but the database is fine.
 *
 * Safety: the target database must be empty. If it already has businesses, users or entries the
 * script stops without changing anything, so it can never overwrite live data. Everything is
 * loaded in one database transaction: either the whole backup goes in, or nothing does.
 *
 * After a restore, two-factor sign-in is switched off for every user (the download has no 2FA
 * secrets and no backup has the one-time backup codes); passwords still work, and each user sets
 * up Google Authenticator again on the Security page. A nightly .json restored onto a server with
 * the same MFA_ENCRYPTION_KEY / JWT_SECRET can keep 2FA with --keep-2fa.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------- reading a .zip (no extra packages) ----------

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a valid .zip file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The .zip file is damaged (central directory).");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported compression in ${name}.`);
    files.set(name, data);
  }
  return files;
}

// ---------- helpers ----------

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
}

function mimeFromName(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" }[
      ext
    ] || "application/octet-stream"
  );
}

// Parent tables first, so every reference already exists when a row is inserted.
const TABLES = ["businesses", "users", "user_business_roles", "transactions", "transaction_attachments", "audit_log"];

function loadBackup(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) === 0x04034b50) {
    const files = readZip(buf);
    const dataName = [...files.keys()].find((n) => /^data\/.+\.json$/.test(n));
    if (!dataName) throw new Error("The .zip has no data/…json file — is this a complete backup download?");
    const data = JSON.parse(files.get(dataName).toString("utf8"));
    const invoices = new Map(); // attachment id -> file bytes
    for (const [name, bytes] of files) {
      const m = /^invoices\/.+-entry\d+-(\d+)-[^/]+$/.exec(name);
      if (m) invoices.set(Number(m[1]), bytes);
    }
    return { data, invoices, kind: "zip" };
  }
  return { data: JSON.parse(buf.toString("utf8")), invoices: new Map(), kind: "json" };
}

function summary(data, invoices) {
  console.log(`Backup made: ${data.exported_at || "unknown"}`);
  for (const t of TABLES) console.log(`  ${t.padEnd(24)} ${(data[t] || []).length}`);
  const active = (data.transaction_attachments || []).filter((a) => !a.deleted_at).length;
  console.log(`  invoice files in backup   ${invoices.size} (of ${active} invoice records)`);
  for (const b of data.businesses || []) console.log(`  - business #${b.id}: ${b.name}`);
}

// ---------- restore ----------

async function main() {
  const file = arg("file");
  if (!file || file === true) {
    console.log("Usage: node scripts/restore-backup.js --file=<backup.zip|backup.json> [--check] [--invoices] [--invoices-only]");
    process.exit(1);
  }
  const { data, invoices, kind } = loadBackup(path.resolve(file));
  for (const t of ["businesses", "users", "transactions"]) {
    if (!Array.isArray(data[t])) throw new Error(`The backup has no "${t}" list — this does not look like a platform backup.`);
  }
  summary(data, invoices);
  if (arg("check")) {
    console.log("\nCheck only — nothing was changed.");
    return;
  }
  if (arg("invoices-only")) {
    await uploadInvoices(data, invoices, kind);
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the NEW, empty database first.");
  const { pool } = require("../src/db");
  const client = await pool.connect();
  try {
    // 1. Tables (safe to run on an existing database: every statement is "IF NOT EXISTS").
    await client.query(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));

    // 2. Refuse to touch a database that already holds data.
    const { rows: counts } = await client.query(
      `SELECT (SELECT count(*) FROM businesses)::int AS b, (SELECT count(*) FROM users)::int AS u,
              (SELECT count(*) FROM transactions)::int AS t`
    );
    if (counts[0].b || counts[0].u || counts[0].t) {
      throw new Error(
        `This database is not empty (${counts[0].b} businesses, ${counts[0].u} users, ${counts[0].t} entries). ` +
          "Restore only into a new, empty database. Nothing was changed."
      );
    }

    // Switch 2FA off so everyone can sign in with their password: the downloaded .zip has no 2FA
    // secrets, and those in a nightly .json only work with the same MFA_ENCRYPTION_KEY/JWT_SECRET
    // (and the one-time backup codes are not in any backup). --keep-2fa keeps them (nightly .json only).
    const keep2fa = arg("keep-2fa") && data.users.some((u) => u.totp_secret);
    if (!keep2fa) {
      data.users = data.users.map((u) => ({ ...u, totp_enabled: false, totp_secret: null, totp_pending_secret: null }));
    }

    // 3. Load every table inside one transaction, keeping the original ids.
    await client.query("BEGIN");
    for (const table of TABLES) {
      const rows = data[table] || [];
      if (!rows.length) continue;
      const { rows: cols } = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
        [table]
      );
      const types = new Map(cols.map((c) => [c.column_name, c.data_type]));
      const unknown = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !types.has(k));
      if (unknown.length) {
        throw new Error(`Table ${table} has no column(s) ${unknown.join(", ")} — update schema.sql before restoring.`);
      }
      for (const row of rows) {
        const keys = Object.keys(row);
        const values = keys.map((k) => {
          const v = row[k];
          if (v !== null && (types.get(k) === "jsonb" || types.get(k) === "json")) return JSON.stringify(v);
          return v;
        });
        const sql = `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys
          .map((_, i) => `$${i + 1}`)
          .join(", ")})`;
        await client.query(sql, values);
      }
      // Make new records continue after the highest restored id.
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`
      );
      console.log(`Restored ${rows.length} ${table}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // 4. Optionally put the invoice files back into invoice storage.
  if (arg("invoices")) await uploadInvoices(data, invoices, kind);

  console.log("\nRestore complete. Start the app against this database and sign in as the owner.");
  if (!arg("keep-2fa")) console.log("Two-factor sign-in is off for all users; set it up again on the Security page.");
  await pool.end();
}

async function uploadInvoices(data, invoices, kind) {
  if (kind !== "zip") {
    console.log("Invoice files can only come from the complete backup .zip (a .json backup has no files). Skipped.");
    return;
  }
  const storage = require("../src/storage");
  if (!storage.isConfigured()) throw new Error("Set OCI_INVOICE_PAR_URL (read/write invoice link) to upload the invoice files.");
  let done = 0;
  let failed = 0;
  for (const a of data.transaction_attachments || []) {
    const bytes = invoices.get(Number(a.id));
    if (!bytes || a.deleted_at) continue;
    try {
      await storage.putFile(a.object_key, bytes, a.content_type || mimeFromName(a.file_name));
      done += 1;
    } catch (e) {
      failed += 1;
      console.log(`  invoice #${a.id} (${a.file_name}) failed: ${e.message}`);
    }
  }
  console.log(`Uploaded ${done} invoice files${failed ? `, ${failed} failed` : ""}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nRestore stopped: ${err.message}`);
  process.exit(1);
});
