const express = require("express");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess, ROLE_RANK } = require("../middleware/auth");
const { recordAudit } = require("../audit");
const storage = require("../storage");

// Purchase invoices (photos or PDFs) attached to expense and fixed-cost entries, kept in Oracle
// Object Storage. Mounted at /api/businesses/:businessId/attachments.
const router = express.Router({ mergeParams: true });

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_ENTRY = 5;
const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};
const ATTACHABLE_TYPES = ["expense", "fixed_cost"];

function canOverride(role) {
  return ROLE_RANK[role] >= ROLE_RANK.business_admin || role === "super_admin";
}

function safeFileName(name, ext) {
  const base = String(name || "invoice")
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "invoice"}.${ext}`;
}

// Upload an invoice for an entry. The file is the raw request body; its name is in ?name=.
router.post(
  "/entry/:transactionId",
  requireAuth,
  requireBusinessAccess("staff", (req) => req.params.businessId),
  express.raw({ type: Object.keys(ALLOWED_TYPES), limit: MAX_BYTES }),
  async (req, res, next) => {
    try {
      if (!storage.isConfigured()) {
        return res.status(503).json({ error: "Invoice storage isn't set up yet on the server." });
      }
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const ext = ALLOWED_TYPES[contentType];
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF, up to 10 MB." });
      }

      const { rows } = await pool.query(
        "SELECT * FROM transactions WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL",
        [req.params.transactionId, req.businessId]
      );
      const tx = rows[0];
      if (!tx) return res.status(404).json({ error: "Entry not found." });
      if (!ATTACHABLE_TYPES.includes(tx.type)) {
        return res.status(400).json({ error: "Invoices can be attached to expenses and fixed costs only." });
      }
      if (tx.user_id !== req.user.id && !canOverride(req.businessRole)) {
        return res.status(403).json({ error: "You can only add invoices to your own entries." });
      }
      const count = await pool.query(
        "SELECT count(*)::int AS n FROM transaction_attachments WHERE transaction_id = $1 AND deleted_at IS NULL",
        [tx.id]
      );
      if (count.rows[0].n >= MAX_PER_ENTRY) {
        return res.status(400).json({ error: `An entry can have up to ${MAX_PER_ENTRY} invoices.` });
      }

      const fileName = safeFileName(req.query.name, ext);
      const day = new Date(tx.occurred_on).toISOString().slice(0, 10);
      const objectKey =
        `${storage.invoicePrefix()}business-${req.businessId}/${day.slice(0, 4)}/${day.slice(5, 7)}/` +
        `${day}-entry${tx.id}-${crypto.randomBytes(6).toString("hex")}-${fileName}`;

      await storage.putFile(objectKey, req.body, contentType);

      const inserted = await pool.query(
        `INSERT INTO transaction_attachments (transaction_id, business_id, object_key, file_name, content_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, transaction_id, file_name, content_type, size_bytes, created_at`,
        [tx.id, req.businessId, objectKey, fileName, contentType, req.body.length, req.user.id]
      );
      await recordAudit({
        businessId: req.businessId,
        userId: req.user.id,
        action: "create",
        entityType: "invoice",
        entityId: inserted.rows[0].id,
        changes: { transaction_id: tx.id, file_name: fileName, size_bytes: req.body.length },
      });
      res.status(201).json({ attachment: inserted.rows[0] });
    } catch (e) {
      if (e.type === "entity.too.large") return res.status(413).json({ error: "The file is larger than 10 MB." });
      next(e);
    }
  }
);

async function loadAttachment(req, res) {
  const { rows } = await pool.query(
    `SELECT a.*, t.user_id AS entry_user_id FROM transaction_attachments a
     JOIN transactions t ON t.id = a.transaction_id
     WHERE a.id = $1 AND a.business_id = $2 AND a.deleted_at IS NULL`,
    [req.params.attachmentId, req.businessId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Invoice not found." });
    return null;
  }
  return rows[0];
}

// View / download an invoice. Anyone who can see the business's entries can see its invoices.
router.get(
  "/:attachmentId",
  requireAuth,
  requireBusinessAccess("viewer", (req) => req.params.businessId),
  async (req, res, next) => {
    try {
      const att = await loadAttachment(req, res);
      if (!att) return;
      if (!storage.isConfigured()) return res.status(503).json({ error: "Invoice storage isn't set up on the server." });
      const stream = await storage.getFile(att.object_key);
      res.setHeader("Content-Type", att.content_type);
      res.setHeader("Content-Disposition", `inline; filename="${att.file_name.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      if (stream.headers["content-length"]) res.setHeader("Content-Length", stream.headers["content-length"]);
      stream.pipe(res);
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: "The invoice file could not be found in storage." });
      next(e);
    }
  }
);

// Remove an invoice from the entry. The record (and the stored file) are kept for the audit trail.
router.delete(
  "/:attachmentId",
  requireAuth,
  requireBusinessAccess("staff", (req) => req.params.businessId),
  async (req, res, next) => {
    try {
      const att = await loadAttachment(req, res);
      if (!att) return;
      if (att.entry_user_id !== req.user.id && !canOverride(req.businessRole)) {
        return res.status(403).json({ error: "You can only remove invoices from your own entries." });
      }
      await pool.query("UPDATE transaction_attachments SET deleted_at = now() WHERE id = $1", [att.id]);
      await recordAudit({
        businessId: req.businessId,
        userId: req.user.id,
        action: "delete",
        entityType: "invoice",
        entityId: att.id,
        changes: { transaction_id: att.transaction_id, file_name: att.file_name },
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
