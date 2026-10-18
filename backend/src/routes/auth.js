const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { recordAudit } = require("../audit");
const { sendMail, isMailConfigured } = require("../mailer");
const sec = require("../security");

const router = express.Router();

// Basic in-memory rate limiting. Fine for a single small instance; swap for a Redis-backed limiter
// if this ever runs as several instances behind a load balancer.
const failedAttempts = new Map(); // key -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function lockedMessage(key) {
  const entry = failedAttempts.get(key);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return `Too many failed attempts. Try again in ${minutes} minute(s).`;
  }
  return null;
}
function recordFailure(key) {
  const entry = failedAttempts.get(key);
  const next = entry && !entry.lockedUntil ? { count: entry.count + 1 } : { count: 1 };
  if (next.count >= MAX_ATTEMPTS) {
    next.lockedUntil = Date.now() + LOCK_MS;
    next.count = 0;
  }
  failedAttempts.set(key, next);
}

const forgotThrottle = new Map(); // username -> last request time
const FORGOT_INTERVAL_MS = 60 * 1000;

const RESET_TTL_MIN = 30;
const VERIFY_TTL_MIN = 15;

function signSession(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
  });
}

async function userGrants(userId) {
  const { rows } = await pool.query(
    `SELECT ubr.business_id, ubr.role, b.name, b.slug
     FROM user_business_roles ubr JOIN businesses b ON b.id = ubr.business_id
     WHERE ubr.user_id = $1`,
    [userId]
  );
  return rows;
}

async function completeLogin(res, user, extra = {}) {
  const token = signSession(user.id);
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
      totp_enabled: Boolean(user.totp_enabled),
      businesses: await userGrants(user.id),
    },
    ...extra,
  });
}

async function checkPassword(userId, password) {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  return rows[0] ? bcrypt.compare(password || "", rows[0].password_hash) : false;
}

/** Marks one unused backup code as used if it matches. Returns true when a code was consumed. */
async function useBackupCode(userId, code) {
  const normalized = sec.normalizeBackupCode(code);
  if (normalized.length !== 8) return false;
  const { rowCount } = await pool.query(
    `UPDATE user_backup_codes SET used_at = now()
     WHERE id = (SELECT id FROM user_backup_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)`,
    [userId, sec.sha256(normalized)]
  );
  return rowCount === 1;
}

async function backupCodesRemaining(userId) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId]
  );
  return rows[0].n;
}

async function replaceBackupCodes(userId) {
  const { codes, hashes } = sec.generateBackupCodes();
  await pool.query("DELETE FROM user_backup_codes WHERE user_id = $1", [userId]);
  await pool.query(
    "INSERT INTO user_backup_codes (user_id, code_hash) SELECT $1, unnest($2::text[])",
    [userId, hashes]
  );
  return codes;
}

/** Checks an authenticator code, or (when allowBackup) a backup code, for a user with 2FA on. */
async function checkSecondFactor(user, code, { allowBackup = true } = {}) {
  if (user.totp_secret) {
    let secret = null;
    try {
      secret = sec.decryptSecret(user.totp_secret);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[2fa] Could not decrypt the stored 2FA secret:", e.message);
    }
    if (secret && sec.checkTotp(code, secret)) return { ok: true, usedBackupCode: false };
  }
  if (allowBackup && (await useBackupCode(user.id, code))) return { ok: true, usedBackupCode: true };
  return { ok: false };
}

/** Best-effort security alert to the verified recovery email. Never fails the request. */
async function sendSecurityAlert(userId, subject, line) {
  try {
    if (!isMailConfigured()) return;
    const { rows } = await pool.query(
      "SELECT username, recovery_email, recovery_email_verified FROM users WHERE id = $1",
      [userId]
    );
    const u = rows[0];
    if (!u || !u.recovery_email || !u.recovery_email_verified) return;
    await sendMail({
      to: u.recovery_email,
      subject: `Security alert: ${subject}`,
      text:
        `${line}\n\nAccount: ${u.username}\nTime: ${new Date().toISOString()}\n\n` +
        "If this wasn't you, sign in and change your password straight away, or reset it using " +
        '"Forgot password?" on the sign-in page.',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[security] Could not send security alert:", e.message);
  }
}

function appBaseUrl() {
  const explicit = (process.env.APP_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const firstOrigin = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).find(Boolean);
  return firstOrigin ? firstOrigin.replace(/\/+$/, "") : null;
}

// ---------------------------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------------------------

// Public: tells the sign-in page whether "Forgot password?" (reset by email) is available.
router.get("/options", (req, res) => {
  res.json({ password_reset_by_email: isMailConfigured() });
});

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required." });
    }
    const key = String(username).toLowerCase();
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    const { rows } = await pool.query(
      `SELECT id, username, password_hash, full_name, is_super_admin, is_active, must_change_password, totp_enabled
       FROM users WHERE lower(username) = lower($1)`,
      [username]
    );
    const user = rows[0];
    const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));

    if (!ok) {
      recordFailure(key);
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    failedAttempts.delete(key);

    if (user.totp_enabled) {
      // Password was right, but a second step is required. This short-lived token only proves the
      // password step; requireAuth rejects it, so it can't be used to call the API.
      const mfaToken = jwt.sign({ sub: user.id, purpose: "mfa" }, process.env.JWT_SECRET, { expiresIn: "5m" });
      return res.json({ mfa_required: true, mfa_token: mfaToken });
    }

    await completeLogin(res, user);
  } catch (e) {
    next(e);
  }
});

router.post("/login/2fa", async (req, res, next) => {
  try {
    const { mfa_token: mfaToken, code } = req.body || {};
    let payload;
    try {
      payload = jwt.verify(mfaToken || "", process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: "Your sign-in session expired. Please enter your password again." });
    }
    if (payload.purpose !== "mfa") return res.status(401).json({ error: "Invalid sign-in session." });

    const key = `mfa:${payload.sub}`;
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    const { rows } = await pool.query(
      `SELECT id, username, full_name, is_super_admin, is_active, must_change_password, totp_enabled, totp_secret
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active || !user.totp_enabled) {
      return res.status(401).json({ error: "Invalid sign-in session." });
    }

    const result = await checkSecondFactor(user, code);
    if (!result.ok) {
      recordFailure(key);
      return res.status(401).json({ error: "That code isn't right. Check the code in your authenticator app and try again." });
    }
    failedAttempts.delete(key);

    const extra = {};
    if (result.usedBackupCode) {
      extra.used_backup_code = true;
      extra.backup_codes_remaining = await backupCodesRemaining(user.id);
      await recordAudit({ userId: user.id, action: "use", entityType: "user_backup_code", entityId: user.id });
      sendSecurityAlert(user.id, "a backup code was used to sign in", "One of your 2FA backup codes was just used to sign in.");
    }
    await completeLogin(res, user, extra);
  } catch (e) {
    next(e);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json({ user: { ...req.user, businesses: await userGrants(req.user.id) } });
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
    if (!(await checkPassword(req.user.id, currentPassword))) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now() WHERE id = $2",
      [hash, req.user.id]
    );
    await recordAudit({ userId: req.user.id, action: "update", entityType: "user_password", entityId: req.user.id });
    sendSecurityAlert(req.user.id, "password changed", "The password for your account was just changed.");
    // Changing the password signs out every other session; give this one a fresh token.
    res.json({ ok: true, token: signSession(req.user.id) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------------------------
// Forgot / reset password (via the verified recovery email)
// ---------------------------------------------------------------------------------------------

router.post("/forgot-password", async (req, res, next) => {
  // Always the same answer, so this can't be used to find out which usernames exist.
  const generic = {
    ok: true,
    message:
      "If that account has a confirmed recovery email, a password reset link has been sent to it. The link works for 30 minutes.",
  };
  try {
    const username = String((req.body || {}).username || "").trim();
    if (!username) return res.status(400).json({ error: "Enter your username." });
    if (!isMailConfigured()) {
      return res.status(503).json({ error: "Password reset by email isn't available yet. Ask the system owner for help." });
    }

    const key = username.toLowerCase();
    const last = forgotThrottle.get(key);
    if (last && Date.now() - last < FORGOT_INTERVAL_MS) return res.json(generic);
    forgotThrottle.set(key, Date.now());

    const { rows } = await pool.query(
      `SELECT id, username, recovery_email, recovery_email_verified, is_active
       FROM users WHERE lower(username) = lower($1)`,
      [username]
    );
    const user = rows[0];
    if (!user || !user.is_active || !user.recovery_email || !user.recovery_email_verified) return res.json(generic);

    const token = sec.randomToken();
    await pool.query(
      "UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL",
      [user.id]
    );
    await pool.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'password_reset', $2, now() + ($3 || ' minutes')::interval)`,
      [user.id, sec.sha256(token), String(RESET_TTL_MIN)]
    );

    const base = appBaseUrl();
    const link = base ? `${base}/reset-password?token=${token}` : null;
    await sendMail({
      to: user.recovery_email,
      subject: "Reset your Unified Accounts Platform password",
      text:
        `A password reset was requested for the account "${user.username}".\n\n` +
        (link
          ? `Open this link to choose a new password (valid for ${RESET_TTL_MIN} minutes):\n${link}\n\n`
          : `On the "Reset password" page, enter this reset code (valid for ${RESET_TTL_MIN} minutes):\n${token}\n\n`) +
        "If two-factor authentication is on, you'll still need your authenticator app or a backup code to sign in.\n\n" +
        "If you didn't ask for this, you can ignore this email — your password stays the same.",
    });
    await recordAudit({ userId: user.id, action: "request", entityType: "password_reset", entityId: user.id });
    res.json(generic);
  } catch (e) {
    next(e);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token) return res.status(400).json({ error: "The reset link is missing its code. Use the link from the email." });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.user_id, u.username FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.purpose = 'password_reset' AND t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
         AND u.is_active`,
      [sec.sha256(String(token).trim())]
    );
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now() WHERE id = $2",
      [hash, row.user_id]
    );
    await pool.query("UPDATE auth_tokens SET used_at = now() WHERE id = $1", [row.id]);
    failedAttempts.delete(String(row.username).toLowerCase());
    await recordAudit({ userId: row.user_id, action: "reset", entityType: "user_password", entityId: row.user_id });
    sendSecurityAlert(row.user_id, "password reset", "The password for your account was just reset using the recovery email.");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------------------------
// Security settings for the signed-in user: two-factor authentication + recovery email
// ---------------------------------------------------------------------------------------------

router.get("/security", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT totp_enabled, recovery_email, recovery_email_verified, recovery_email_pending FROM users WHERE id = $1",
      [req.user.id]
    );
    const u = rows[0];
    res.json({
      totp_enabled: Boolean(u.totp_enabled),
      backup_codes_remaining: u.totp_enabled ? await backupCodesRemaining(req.user.id) : 0,
      recovery_email: u.recovery_email,
      recovery_email_verified: Boolean(u.recovery_email_verified),
      recovery_email_pending: u.recovery_email_pending,
      email_sending_configured: isMailConfigured(),
    });
  } catch (e) {
    next(e);
  }
});

async function loadSecurityRow(userId) {
  const { rows } = await pool.query(
    "SELECT id, username, totp_enabled, totp_secret, totp_pending_secret FROM users WHERE id = $1",
    [userId]
  );
  return rows[0];
}

router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    if (!(await checkPassword(req.user.id, (req.body || {}).password))) {
      return res.status(400).json({ error: "Password is incorrect." });
    }
    const row = await loadSecurityRow(req.user.id);
    if (row.totp_enabled) return res.status(400).json({ error: "Two-factor authentication is already on." });

    const secret = sec.newTotpSecret();
    await pool.query("UPDATE users SET totp_pending_secret = $1 WHERE id = $2", [sec.encryptSecret(secret), req.user.id]);
    const uri = sec.totpUri(row.username, secret);
    res.json({
      secret,
      otpauth_url: uri,
      qr_data_url: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
    });
  } catch (e) {
    next(e);
  }
});

router.post("/2fa/enable", requireAuth, async (req, res, next) => {
  try {
    const key = `2fa-setup:${req.user.id}`;
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    const row = await loadSecurityRow(req.user.id);
    if (row.totp_enabled) return res.status(400).json({ error: "Two-factor authentication is already on." });
    if (!row.totp_pending_secret) return res.status(400).json({ error: "Start the set-up again." });

    const secret = sec.decryptSecret(row.totp_pending_secret);
    if (!sec.checkTotp((req.body || {}).code, secret)) {
      recordFailure(key);
      return res.status(400).json({
        error: "That code isn't right. Make sure your phone's time is set automatically, then enter the current code.",
      });
    }
    failedAttempts.delete(key);

    await pool.query(
      "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = true WHERE id = $1",
      [req.user.id]
    );
    const codes = await replaceBackupCodes(req.user.id);
    await recordAudit({ userId: req.user.id, action: "enable", entityType: "user_2fa", entityId: req.user.id });
    sendSecurityAlert(req.user.id, "two-factor authentication turned on", "Two-factor authentication was just turned on for your account.");
    res.json({ ok: true, backup_codes: codes });
  } catch (e) {
    next(e);
  }
});

router.post("/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    const { password, code } = req.body || {};
    const key = `2fa-change:${req.user.id}`;
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    if (!(await checkPassword(req.user.id, password))) {
      recordFailure(key);
      return res.status(400).json({ error: "Password is incorrect." });
    }
    const row = await loadSecurityRow(req.user.id);
    if (!row.totp_enabled) return res.status(400).json({ error: "Two-factor authentication is already off." });
    if (!(await checkSecondFactor(row, code)).ok) {
      recordFailure(key);
      return res.status(400).json({ error: "The authenticator or backup code isn't right." });
    }
    failedAttempts.delete(key);

    await pool.query(
      "UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_pending_secret = NULL WHERE id = $1",
      [req.user.id]
    );
    await pool.query("DELETE FROM user_backup_codes WHERE user_id = $1", [req.user.id]);
    await recordAudit({ userId: req.user.id, action: "disable", entityType: "user_2fa", entityId: req.user.id });
    sendSecurityAlert(req.user.id, "two-factor authentication turned off", "Two-factor authentication was just turned OFF for your account.");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/2fa/backup-codes", requireAuth, async (req, res, next) => {
  try {
    const { password, code } = req.body || {};
    const key = `2fa-change:${req.user.id}`;
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    if (!(await checkPassword(req.user.id, password))) {
      recordFailure(key);
      return res.status(400).json({ error: "Password is incorrect." });
    }
    const row = await loadSecurityRow(req.user.id);
    if (!row.totp_enabled) return res.status(400).json({ error: "Turn on two-factor authentication first." });
    if (!(await checkSecondFactor(row, code, { allowBackup: false })).ok) {
      recordFailure(key);
      return res.status(400).json({ error: "Enter the current code from your authenticator app." });
    }
    failedAttempts.delete(key);

    const codes = await replaceBackupCodes(req.user.id);
    await recordAudit({ userId: req.user.id, action: "regenerate", entityType: "user_backup_code", entityId: req.user.id });
    res.json({ ok: true, backup_codes: codes });
  } catch (e) {
    next(e);
  }
});

async function sendVerificationCode(userId, email) {
  const code = sec.randomSixDigits();
  await pool.query(
    "UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL",
    [userId]
  );
  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, 'verify_email', $2, now() + ($3 || ' minutes')::interval)`,
    [userId, sec.sha256(`${userId}:${code}`), String(VERIFY_TTL_MIN)]
  );
  await sendMail({
    to: email,
    subject: "Confirm your recovery email",
    text:
      `Your confirmation code is: ${code}\n\n` +
      `Enter it on the Security page of the Unified Accounts Platform within ${VERIFY_TTL_MIN} minutes.\n` +
      "Once confirmed, this address can be used to reset the password if it's ever forgotten.",
  });
}

router.post("/recovery-email", requireAuth, async (req, res, next) => {
  try {
    const { password, email } = req.body || {};
    if (!isMailConfigured()) {
      return res.status(503).json({ error: "Email sending isn't set up on the server yet, so a recovery email can't be confirmed." });
    }
    if (!(await checkPassword(req.user.id, password))) return res.status(400).json({ error: "Password is incorrect." });
    const clean = String(email || "").trim().toLowerCase();
    if (!sec.isValidEmail(clean)) return res.status(400).json({ error: "Enter a valid email address." });

    const throttleKey = `verify-send:${req.user.id}`;
    const last = forgotThrottle.get(throttleKey);
    if (last && Date.now() - last < FORGOT_INTERVAL_MS) {
      return res.status(429).json({ error: "Please wait a minute before requesting another code." });
    }
    forgotThrottle.set(throttleKey, Date.now());

    const { rows } = await pool.query(
      "SELECT recovery_email, recovery_email_verified FROM users WHERE id = $1",
      [req.user.id]
    );
    const previous = rows[0];
    // Keep a previously confirmed address working until the new one is confirmed.
    await pool.query("UPDATE users SET recovery_email_pending = $1 WHERE id = $2", [clean, req.user.id]);
    try {
      await sendVerificationCode(req.user.id, clean);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[security] Could not send verification email:", err.message);
      return res.status(502).json({ error: "The confirmation email couldn't be sent. Check the address, or try again later." });
    }
    if (previous.recovery_email_verified && previous.recovery_email !== clean) {
      sendSecurityAlert(req.user.id, "recovery email change requested", `A request was made to change your recovery email to ${sec.maskEmail(clean)}.`);
    }
    res.json({ ok: true, pending_email: clean });
  } catch (e) {
    next(e);
  }
});

router.post("/recovery-email/verify", requireAuth, async (req, res, next) => {
  try {
    const key = `verify:${req.user.id}`;
    const locked = lockedMessage(key);
    if (locked) return res.status(429).json({ error: locked });

    const code = String((req.body || {}).code || "").replace(/\s+/g, "");
    const { rows } = await pool.query(
      `SELECT t.id, u.recovery_email_pending FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 AND t.purpose = 'verify_email' AND t.token_hash = $2
         AND t.used_at IS NULL AND t.expires_at > now()`,
      [req.user.id, sec.sha256(`${req.user.id}:${code}`)]
    );
    const row = rows[0];
    if (!row || !row.recovery_email_pending) {
      recordFailure(key);
      return res.status(400).json({ error: "That code is wrong or has expired. You can send a new one." });
    }
    failedAttempts.delete(key);

    await pool.query("UPDATE auth_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await pool.query(
      `UPDATE users SET recovery_email = recovery_email_pending, recovery_email_pending = NULL,
         recovery_email_verified = true WHERE id = $1`,
      [req.user.id]
    );
    await recordAudit({
      userId: req.user.id,
      action: "verify",
      entityType: "user_recovery_email",
      entityId: req.user.id,
      changes: { recovery_email: sec.maskEmail(row.recovery_email_pending) },
    });
    res.json({ ok: true, recovery_email: row.recovery_email_pending });
  } catch (e) {
    next(e);
  }
});

router.post("/recovery-email/remove", requireAuth, async (req, res, next) => {
  try {
    if (!(await checkPassword(req.user.id, (req.body || {}).password))) {
      return res.status(400).json({ error: "Password is incorrect." });
    }
    await sendSecurityAlert(req.user.id, "recovery email removed", "The recovery email was just removed from your account.");
    await pool.query(
      `UPDATE users SET recovery_email = NULL, recovery_email_pending = NULL, recovery_email_verified = false
       WHERE id = $1`,
      [req.user.id]
    );
    await recordAudit({ userId: req.user.id, action: "remove", entityType: "user_recovery_email", entityId: req.user.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
