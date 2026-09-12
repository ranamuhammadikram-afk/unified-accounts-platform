const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess, ROLE_RANK } = require("../middleware/auth");
const { recordAudit } = require("../audit");

const router = express.Router({ mergeParams: true });

const VALID_TYPES = ["sales", "expense", "fixed_cost", "salary"];
const VALID_METHODS = ["cash", "card"];
const VALID_FIXED_TYPES = ["rent", "maintenance", "utilities", "other"];

function validatePayload(body) {
  const { type, occurred_on, amount, payment_method, fixed_cost_type, description } = body || {};
  if (!VALID_TYPES.includes(type)) return "type must be one of: " + VALID_TYPES.join(", ");
  if (!occurred_on || Number.isNaN(Date.parse(occurred_on))) return "occurred_on must be a valid date (YYYY-MM-DD).";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "amount must be a positive number.";
  if (type === "sales" && !VALID_METHODS.includes(payment_method)) return "sales entries require payment_method: cash or card.";
  if (type !== "sales" && payment_method) return "payment_method only applies to sales entries.";
  if (type === "fixed_cost" && !VALID_FIXED_TYPES.includes(fixed_cost_type)) {
    return "fixed_cost entries require fixed_cost_type: " + VALID_FIXED_TYPES.join(", ");
  }
  if (type !== "fixed_cost" && fixed_cost_type) return "fixed_cost_type only applies to fixed_cost entries.";
  if (description && description.length > 500) return "description is too long (max 500 characters).";
  return null;
}

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
              t.description, t.created_at, t.updated_at, u.username AS entered_by
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE ${clauses.join(" AND ")}
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
    const err = validatePayload(req.body);
    if (err) return res.status(400).json({ error: err });
    const { type, occurred_on, amount, payment_method, fixed_cost_type, description } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO transactions (business_id, user_id, type, occurred_on, amount, payment_method, fixed_cost_type, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.businessId, req.user.id, type, occurred_on, amount, payment_method || null, fixed_cost_type || null, description || null]
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
    const err = validatePayload({ ...existing, ...req.body });
    if (err) return res.status(400).json({ error: err });
    const { type, occurred_on, amount, payment_method, fixed_cost_type, description } = { ...existing, ...req.body };

    const { rows } = await pool.query(
      `UPDATE transactions SET type=$1, occurred_on=$2, amount=$3, payment_method=$4, fixed_cost_type=$5,
              description=$6, updated_at=now()
       WHERE id = $7 RETURNING *`,
      [type, occurred_on, amount, payment_method || null, fixed_cost_type || null, description || null, existing.id]
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
