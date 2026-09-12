const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../audit");

const router = express.Router();

// Basic in-memory login rate limiting (per username). Fine for a small LAN/self-hosted deployment;
// swap for a Redis-backed limiter if this ever runs behind a public load balancer.
const failedAttempts = new Map(); // username -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required." });
    }
    const key = String(username).toLowerCase();
    const entry = failedAttempts.get(key);
    if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` });
    }

    const { rows } = await pool.query(
      "SELECT id, username, password_hash, full_name, is_super_admin, is_active, must_change_password FROM users WHERE lower(username) = lower($1)",
      [username]
    );
    const user = rows[0];
    const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));

    if (!ok) {
      const next = entry ? { count: entry.count + 1 } : { count: 1 };
      if (next.count >= MAX_ATTEMPTS) {
        next.lockedUntil = Date.now() + LOCK_MS;
        next.count = 0;
      }
      failedAttempts.set(key, next);
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    failedAttempts.delete(key);

    const { rows: grants } = await pool.query(
      `SELECT ubr.business_id, ubr.role, b.name, b.slug
       FROM user_business_roles ubr JOIN businesses b ON b.id = ubr.business_id
       WHERE ubr.user_id = $1`,
      [user.id]
    );

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "12h",
    });

    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    await recordAudit({ userId: user.id, action: "login", entityType: "user", entityId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        is_super_admin: user.is_super_admin,
        must_change_password: user.must_change_password,
        businesses: grants,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows: grants } = await pool.query(
      `SELECT ubr.business_id, ubr.role, b.name, b.slug
       FROM user_business_roles ubr JOIN businesses b ON b.id = ubr.business_id
       WHERE ubr.user_id = $1`,
      [req.user.id]
    );
    res.json({ user: { ...req.user, businesses: grants } });
  } catch (e) {
    next(e);
  }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    const ok = await bcrypt.compare(currentPassword || "", rows[0].password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2",
      [hash, req.user.id]
    );
    await recordAudit({ userId: req.user.id, action: "update", entityType: "user_password", entityId: req.user.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
