const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess } = require("../middleware/auth");
const { recordAudit } = require("../audit");

const router = express.Router({ mergeParams: true });

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url"); // ~12 chars, URL-safe
}

// List everyone with access to this business — business_admin+ only.
router.get("/", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at, ubr.role
       FROM user_business_roles ubr JOIN users u ON u.id = ubr.user_id
       WHERE ubr.business_id = $1
       ORDER BY ubr.role, u.username`,
      [req.businessId]
    );
    res.json({ users: rows });
  } catch (e) {
    next(e);
  }
});

// Create a brand-new user and immediately grant them a role at this business.
// A business_admin (not super admin) may only grant staff/viewer, never business_admin.
router.post("/", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { username, full_name, email, role } = req.body || {};
    if (!username || !full_name || !role) {
      return res.status(400).json({ error: "username, full_name, and role are required." });
    }
    if (!["business_admin", "staff", "viewer"].includes(role)) {
      return res.status(400).json({ error: "role must be business_admin, staff, or viewer." });
    }
    if (role === "business_admin" && req.businessRole !== "super_admin") {
      return res.status(403).json({ error: "Only a super admin can grant the business_admin role." });
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    await client.query("BEGIN");
    const { rows: userRows } = await client.query(
      `INSERT INTO users (username, full_name, email, password_hash, must_change_password)
       VALUES ($1,$2,$3,$4,true) RETURNING id, username, full_name, email, is_active`,
      [username, full_name, email || null, hash]
    );
    const newUser = userRows[0];
    await client.query(
      `INSERT INTO user_business_roles (user_id, business_id, role) VALUES ($1,$2,$3)`,
      [newUser.id, req.businessId, role]
    );
    await client.query("COMMIT");

    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "create",
      entityType: "user",
      entityId: newUser.id,
      changes: { username, role },
    });

    // The temporary password is returned ONCE, here, so the admin can hand it to the new user.
    // It is never retrievable again — only a fresh reset can produce a new one.
    res.status(201).json({ user: { ...newUser, role }, temporaryPassword: tempPassword });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: "That username is already taken." });
    next(e);
  } finally {
    client.release();
  }
});

// Grant an existing user access to this business (e.g. someone who already works at another branch).
router.post("/grants", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { user_id, role } = req.body || {};
    if (!user_id || !role) return res.status(400).json({ error: "user_id and role are required." });
    if (role === "business_admin" && req.businessRole !== "super_admin") {
      return res.status(403).json({ error: "Only a super admin can grant the business_admin role." });
    }
    const { rows } = await pool.query(
      `INSERT INTO user_business_roles (user_id, business_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [user_id, req.businessId, role]
    );
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "role_change",
      entityType: "user_business_role",
      entityId: rows[0].id,
      changes: { user_id, role },
    });
    res.status(201).json({ grant: rows[0] });
  } catch (e) {
    next(e);
  }
});

// Revoke a user's access to this business (does not delete their global account).
router.delete("/:userId/grant", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT role FROM user_business_roles WHERE user_id = $1 AND business_id = $2",
      [req.params.userId, req.businessId]
    );
    if (rows[0] && rows[0].role === "business_admin" && req.businessRole !== "super_admin") {
      return res.status(403).json({ error: "Only a super admin can remove a business_admin." });
    }
    await pool.query("DELETE FROM user_business_roles WHERE user_id = $1 AND business_id = $2", [
      req.params.userId,
      req.businessId,
    ]);
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "delete",
      entityType: "user_business_role",
      entityId: Number(req.params.userId),
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Reset a user's password and issue a new temporary one — business_admin+ for their own business's users.
router.post("/:userId/reset-password", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { rows: grantRows } = await pool.query(
      "SELECT role FROM user_business_roles WHERE user_id = $1 AND business_id = $2",
      [req.params.userId, req.businessId]
    );
    if (!grantRows[0]) return res.status(404).json({ error: "That user does not have access to this business." });
    if (grantRows[0].role === "business_admin" && req.businessRole !== "super_admin") {
      return res.status(403).json({ error: "Only a super admin can reset a business_admin's password." });
    }
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2", [
      hash,
      req.params.userId,
    ]);
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "update",
      entityType: "user_password_reset",
      entityId: Number(req.params.userId),
    });
    res.json({ ok: true, temporaryPassword: tempPassword });
  } catch (e) {
    next(e);
  }
});

// Activate/deactivate a user's global account — business_admin+ for their own business's users.
router.patch("/:userId", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const { rows: grantRows } = await pool.query(
      "SELECT role FROM user_business_roles WHERE user_id = $1 AND business_id = $2",
      [req.params.userId, req.businessId]
    );
    if (!grantRows[0]) return res.status(404).json({ error: "That user does not have access to this business." });
    if (grantRows[0].role === "business_admin" && req.businessRole !== "super_admin") {
      return res.status(403).json({ error: "Only a super admin can modify a business_admin account." });
    }
    const { is_active, full_name, email } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE users SET is_active = COALESCE($1, is_active), full_name = COALESCE($2, full_name), email = COALESCE($3, email)
       WHERE id = $4 RETURNING id, username, full_name, email, is_active`,
      [is_active, full_name, email, req.params.userId]
    );
    await recordAudit({
      businessId: req.businessId,
      userId: req.user.id,
      action: "update",
      entityType: "user",
      entityId: Number(req.params.userId),
      changes: req.body,
    });
    res.json({ user: rows[0] });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
