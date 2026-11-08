const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess, ROLE_RANK } = require("../middleware/auth");
const { recordAudit } = require("../audit");

const router = express.Router({ mergeParams: true });

const VALID_TYPES = ["sales", "expense", "fixed_cost", "salary"];
const VALID_METHODS = ["cash", "card"];
// How an expense or fixed cost was paid.
const VALID_PAID_BY = ["cash", "card", "bank"];
const PURCHASE_TYPES = ["expense", "fixed_cost"];
const VALID_FIXED_TYPES = ["rent", "maintenance", "utilities", "other"];
const VALID_EXPENSE_CATEGORIES = ["supplies", "utilities", "maintenance", "transport", "marketing", "other"];

function validatePayload(body, { requireDescription = false } = {}) {
  const { type, occurred_on, amount, payment_method, fixed_cost_type, expense_category, description, supplier_name, invoice_number } =
    body || {};
  if (!VALID_TYPES.includes(type)) return "type must be one of: " + VALID_TYPES.join(", ");
  if (!occurred_on || Number.isNaN(Date.parse(occurred_on))) return "occurred_on must be a valid date (YYYY-MM-DD).";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "amount must be a positive number.";
  if (type === "sales" && !VALID_METHODS.includes(payment_method)) return "sales entries require payment_method: cash or card.";
  if (PURCHASE_TYPES.includes(type) && payment_method && !VALID_PAID_BY.includes(payment_method)) {
    return "paid by must be cash, card or bank.";
  }
  if (!["sales", ...PURCHASE_TYPES].includes(type) && payment_method) {
    return "payment_method only applies to sales, expenses and fixed costs.";
  }
  if (!PURCHASE_TYPES.includes(type) && (supplier_name || invoice_number)) {
    return "supplier and invoice number only apply to expenses and fixed costs.";
  }
  if (supplier_name && String(supplier_name).length > 120) return "supplier name is too long (max 120 characters).";
  if (invoice_number && String(invoice_number).length > 60) return "invoice number is too long (max 60 characters).";
  if (type === "expense" && requireDescription && !String(description || "").trim()) {
    return "Please describe the expense (what was bought).";
  }
  if (type === "fixed_cost" && !VALID_FIXED_TYPES.includes(fixed_cost_type)) {
    return "fixed_cost entries require fixed_cost_type: " + VALID_FIXED_TYPES.join(", ");
  }
  if (type !== "fixed_cost" && fixed_cost_type) return "fixed_cost_type only applies to fixed_cost entries.";
  if (type === "expense" && !VALID_EXPENSE_CATEGORIES.includes(expense_category)) {
    return "expense entries require expense_category: " + VALID_EXPENSE_CATEGORIES.join(", ");
  }
  if (type !== "expense" && expense_category) return "expense_category only applies to expense entries.";
  if (description && description.length > 500) return "description is too long (max 500 characters).";
  return null;
}

// JSON list of an entry's (non-removed) invoices, for list and report queries.
const ATTACHMENTS_SQL = `COALESCE((SELECT json_agg(json_build_object('id', a.id, 'file_name', a.file_name,
     'content_type', a.content_type, 'size_bytes', a.size_bytes) ORDER BY a.id)
   FROM transaction_attachments a WHERE a.transaction_id = t.id AND a.deleted_at IS NULL), '[]'::json)`;

function clean(v) {
  const s = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  return s || null;
}

// Supplier names used before in this business, most used first (for the entry form's suggestions).
router.get("/suppliers", requireAuth, requireBusinessAccess("viewer", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT supplier_name AS name, count(*)::int AS uses FROM transactions
       WHERE business_id = $1 AND deleted_at IS NULL AND supplier_name IS NOT NULL
       GROUP BY supplier_name ORDER BY uses DESC, supplier_name LIMIT 200`,
      [req.businessId]
    );
    res.json({ suppliers: rows.map((r) => r.name) });
  } catch (e) {
    next(e);
  }
});

// List transactions for a business, with optional filters. Any granted role (viewer+) can read.
router.get("/", requireAuth, requireBusinessAccess("viewer", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { from, to, type, user_id } = req.query;
    const clauses = ["business_id = $1", "deleted_at IS NULL"];
    const params = [req.businessId];
    if (from) { params.push(from); clauses.push(`occurred_on >= $${params.length}`); }
    if (to) { params.push(to); clauses.push(`occurred_on <= $${params.length}`); }
    if (type) { params.push(type); clauses.push(`type = $${params.length}`); }
    if (user_id) { params.push(user_id); clauses.push(`user_id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT t.id, t.business_id, t.type, t.occurred_on, t.amount, t.payment_method, t.fixed_cost_type,
              t.expense_category, t.description, t.supplier_name, t.invoice_number, t.created_at, t.updated_at,
              t.user_id, u.username AS entered_by, ${ATTACHMENTS_SQL} AS attachments
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE ${clauses.map((c) => "t." + c).join(" AND ")}
       ORDER BY t.occurred_on DESC, t.created_at DESC`,
      params
    );
    res.json({ transactions: rows });
  } catch (e) {
    next(e);
  }
});

// Create a transaction. Requires at least "staff" role.
router.post("/", requireAuth, requireBusinessAccess("staff", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const err = validatePayload(req.body, { requireDescription: true });
    if (err) return res.status(400).json({ error: err });
    const { type, occurred_on, amount, payment_method, fixed_cost_type, expense_category, description } = req.body;
    const purchase = PURCHASE_TYPES.includes(type);

    const { rows } = await pool.query(
      `INSERT INTO transactions (business_id, user_id, type, occurred_on, amount, payment_method, fixed_cost_type, expense_category,
                                 description, supplier_name, invoice_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.businessId,
        req.user.id,
        type,
        occurred_on,
        amount,
        payment_method || null,
        fixed_cost_type || null,
        expense_category || null,
        clean(description),
        purchase ? clean(req.body.supplier_name) : null,
        purchase ? clean(req.body.invoice_number) : null,
      ]
    );
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "create",
      entityType: "transaction",
      entityId: rows[0].id,
      changes: rows[0],
    });
    res.status(201).json({ transaction: rows[0] });
  } catch (e) {
    next(e);
  }
});

async function loadOwnedTransaction(req, res) {
  const { rows } = await pool.query(
    "SELECT * FROM transactions WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL",
    [req.params.id, req.businessId]
  );
  const tx = rows[0];
  if (!tx) {
    res.status(404).json({ error: "Transaction not found." });
    return null;
  }
  // Staff can only touch their own entries; business_admin/super_admin can touch anyone's.
  const isOwner = tx.user_id === req.user.id;
  const canOverride = ROLE_RANK[req.businessRole] >= ROLE_RANK.business_admin || req.businessRole === "super_admin";
  if (!isOwner && !canOverride) {
    res.status(403).json({ error: "You can only edit or delete your own entries." });
    return null;
  }
  return tx;
}

router.patch("/:id", requireAuth, requireBusinessAccess("staff", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const existing = await loadOwnedTransaction(req, res);
    if (!existing) return;
    const merged = { ...existing, ...req.body };
    // Old entries may have no description; only insist on one when the user clears it.
    const err = validatePayload(merged, { requireDescription: "description" in (req.body || {}) });
    if (err) return res.status(400).json({ error: err });
    const { type, occurred_on, amount, payment_method, fixed_cost_type, expense_category, description } = merged;
    const purchase = PURCHASE_TYPES.includes(type);

    const { rows } = await pool.query(
      `UPDATE transactions SET type=$1, occurred_on=$2, amount=$3, payment_method=$4, fixed_cost_type=$5,
              expense_category=$6, description=$7, supplier_name=$8, invoice_number=$9, updated_at=now()
       WHERE id = $10 RETURNING *`,
      [
        type,
        occurred_on,
        amount,
        payment_method || null,
        fixed_cost_type || null,
        expense_category || null,
        clean(description),
        purchase ? clean(merged.supplier_name) : null,
        purchase ? clean(merged.invoice_number) : null,
        existing.id,
      ]
    );
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "update",
      entityType: "transaction",
      entityId: existing.id,
      changes: { before: existing, after: rows[0] },
    });
    res.json({ transaction: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAuth, requireBusinessAccess("staff", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const existing = await loadOwnedTransaction(req, res);
    if (!existing) return;
    await pool.query("UPDATE transactions SET deleted_at = now() WHERE id = $1", [existing.id]);
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "delete",
      entityType: "transaction",
      entityId: existing.id,
      changes: existing,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
