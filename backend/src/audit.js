const { pool } = require("./db");

/**
 * Records an immutable audit trail entry. Never throws into the caller's request handling —
 * a failed audit write should be logged, not allowed to break the actual business operation.
 */
async function recordAudit({ businessId = null, userId, action, entityType, entityId = null, changes = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (business_id, user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [businessId, userId, action, entityType, entityId, changes ? JSON.stringify(changes) : null]
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Failed to write audit log entry:", e.message);
  }
}

module.exports = { recordAudit };
