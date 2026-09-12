const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const ROLE_RANK = { viewer: 1, staff: 2, business_admin: 3 };

/**
 * Verifies the JWT on every request and attaches req.user = { id, username, full_name, is_super_admin }.
 * Does NOT check business-level permissions — that's requireBusinessAccess below.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing bearer token." });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, username, full_name, is_super_admin, is_active FROM users WHERE id = $1",
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Account not found or disabled." });
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Looks up (or short-circuits for super admins) the caller's role at a specific business.
 * Attaches req.businessRole ("super_admin" | "business_admin" | "staff" | "viewer").
 * `getBusinessId(req)` extracts the target business id from the request (param, query, or body).
 */
function requireBusinessAccess(minRole, getBusinessId) {
  return async function (req, res, next) {
    try {
      const businessId = Number(getBusinessId(req));
      if (!businessId) {
        return res.status(400).json({ error: "business_id is required." });
      }
      if (req.user.is_super_admin) {
        req.businessRole = "super_admin";
        req.businessId = businessId;
        return next();
      }
      const { rows } = await pool.query(
        "SELECT role FROM user_business_roles WHERE user_id = $1 AND business_id = $2",
        [req.user.id, businessId]
      );
      const grant = rows[0];
      if (!grant) {
        return res.status(403).json({ error: "You do not have access to this business." });
      }
      if (minRole && ROLE_RANK[grant.role] < ROLE_RANK[minRole]) {
        return res.status(403).json({ error: `This action requires the '${minRole}' role or higher.` });
      }
      req.businessRole = grant.role;
      req.businessId = businessId;
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user.is_super_admin) {
    return res.status(403).json({ error: "Super admin access required." });
  }
  next();
}

module.exports = { requireAuth, requireBusinessAccess, requireSuperAdmin, ROLE_RANK };
