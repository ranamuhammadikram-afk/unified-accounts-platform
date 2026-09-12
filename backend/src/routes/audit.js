const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess, requireSuperAdmin } = require("../middleware/auth");

const router = express.Router({ mergeParams: true });

// Audit trail for one business — business_admin+ only.
router.get("/", requireAuth, requireBusinessAccess("business_admin", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.changes, a.created_at, u.username AS performed_by
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.business_id = $1
       ORDER BY a.created_at DESC LIMIT $2`,
      [req.businessId, limit]
    );
    res.json({ entries: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

// Separate router for the global (cross-business) audit log, super admin only.
const globalRouter = express.Router();
globalRouter.get("/audit", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const { rows } = await pool.query(
      `SELECT a.id, a.business_id, b.name AS business_name, a.action, a.entity_type, a.entity_id,
              a.changes, a.created_at, u.username AS performed_by
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN businesses b ON b.id = a.business_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ entries: rows });
  } catch (e) {
    next(e);
  }
});
module.exports.globalRouter = globalRouter;
