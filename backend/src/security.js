const crypto = require("crypto");
const { authenticator } = require("otplib");

// Accept the current 30-second code plus one step either side, to allow for small clock drift
// between the server and the phone running the authenticator app.
authenticator.options = { window: 1 };

const ISSUER = process.env.MFA_ISSUER || "Unified Accounts Platform";
const BACKUP_CODE_COUNT = 10;
// Unambiguous characters only (no 0/O, 1/I/L) so printed codes are easy to type back in.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Two-factor secrets are encrypted at rest (AES-256-GCM). The nightly backup exports the users
 * table, so a plain-text secret in a backup file would let anyone holding that file generate valid
 * codes. The key is derived from MFA_ENCRYPTION_KEY, or JWT_SECRET when that isn't set — note that
 * changing whichever one is used will make existing 2FA set-ups unreadable (users would need to
 * sign in with a backup code and set 2FA up again).
 */
function encryptionKey() {
  const base = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET (or MFA_ENCRYPTION_KEY) must be set to use two-factor authentication.");
  return crypto.createHash("sha256").update(`uap-mfa:${base}`).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(stored) {
  const [version, ivB64, tagB64, encB64] = String(stored).split(":");
  if (version !== "v1") throw new Error("Unknown 2FA secret format.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}

function newTotpSecret() {
  return authenticator.generateSecret(20);
}

function totpUri(accountName, secret) {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

/** True when `code` is a valid current authenticator code for the (plain) secret. */
function checkTotp(code, secret) {
  const clean = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return authenticator.check(clean, secret);
  } catch (e) {
    return false;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeBackupCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Returns { codes, hashes }: codes are shown to the user once; only the hashes are stored. */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let raw = "";
    for (let j = 0; j < 8; j++) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return { codes, hashes: codes.map((c) => sha256(normalizeBackupCode(c))) };
}

/** A long random token for password-reset links (only its hash is stored). */
function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** A 6-digit code for confirming a recovery email address. */
function randomSixDigits() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function maskEmail(email) {
  if (!email) return null;
  const [name, domain] = String(email).split("@");
  if (!domain) return email;
  const shown = name.length <= 2 ? name[0] : name.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, name.length - shown.length))}@${domain}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")) && String(email).length <= 254;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  newTotpSecret,
  totpUri,
  checkTotp,
  sha256,
  normalizeBackupCode,
  generateBackupCodes,
  randomToken,
  randomSixDigits,
  maskEmail,
  isValidEmail,
};
