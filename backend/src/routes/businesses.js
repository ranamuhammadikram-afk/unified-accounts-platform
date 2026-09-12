const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireSuperAdmin, requireBusinessAccess } = require("../middleware/auth");
const { recordAudit } = require("../audit");

const router = express.Router();

// List businesses this user can see. Super admin: everything. Everyone else: only what they're granted.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    if (req.user.is_super_admin) {
      const { rows } = await pool.query(
        "SELECT id, name, slug, currency, timezone, is_active, created_at FROM businesses ORDER BY name"
      );
      return res.json({ businesses: rows });
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.name, b.slug, b.currency, b.timezone, b.is_active, ubr.role
       FROM businesses b
       JOIN user_business_roles ubr ON ubr.business_id = b.id
       WHERE ubr.user_id = $1
       ORDER BY b.name`,
      [req.user.id]
    );
    res.json({ businesses: rows });
  } catch (e) {
    next(e);
  }
});

// Create a new business — super admin only (this is the "add another branch" action).
router.post("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, slug, currency, timezone } = req.body || {};
    if (!name || !slug) {
      return res.status(400).json({ error: "name and slug are required." });
    }
    const { rows } = await pool.query(
      `INSERT INTO businesses (name, slug, currency, timezone)
       VALUES ($1, $2, COALESCE($3, 'SAR'), COALESCE($4, 'Asia/Riyadh'))
       RETURNING id, name, slug, currency, timezone, is_active, created_at`,
      [name, slug, currency, timezone]
    );
    await recordAudit({
      businessId: rows[0].id,
      userId: req.user.id,
      action: "create",
      entityType: "business",
      entityId: rows[0].id,
      changes: { name, slug },
    });
    res.status(201).json({ business: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A business with that slug already exists." });
    next(e);
  }
});

// Update business settings — super admin, or that business's own business_admin.
router.patch(
  "/:businessId",
  requireAuth,
  requireBusinessAccess("business_admin", (req) => req.params.businessId),
  async (req, res, next) => {
    try {
      const { name, currency, timezone, is_active } = req.body || {};
      // is_active can only be toggled by a super admin — a business_admin can't deactivate their own business.
      if (is_active !== undefined && req.businessRole !== "super_admin") {
        return res.status(403).json({ error: "Only a super admin can activate/deactivate a business." });
      }
      const { rows } = await pool.query(
        `UPDATE businesses
         SET name = COALESCE($1, name),
             currency = COALESCE($2, currency),
             timezone = COALESCE($3, timezone),
             is_active = COALESCE($4, is_active)
         WHERE id = $5
         RETURNING id, name, slug, currency, timezone, is_active, created_at`,
        [name, currency, timezone, is_active, req.businessId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Business not found." });
      await recordAudit({
        businessId: req.businessId,
        userId: req.user.id,
        action: "update",
        entityType: "business",
        entityId: req.businessId,
        changes: req.body,
      });
      res.json({ business: rows[0] });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
