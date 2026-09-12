/**
 * One-time setup script: creates the two businesses and the three initial accounts
 * (1 Super Admin + 1 Business Admin per business), matching the "you + 2 managers" setup.
 *
 * Run with:  npm run seed
 *
 * Safe to re-run — it skips anything that already exists rather than erroring or duplicating.
 * Prints the generated temporary passwords ONCE at the end and also writes them to
 * ./CREDENTIALS_DO_NOT_COMMIT.txt — hand these to the real people, then delete that file.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool } = require("../src/db");

function tempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

async function ensureBusiness(name, slug) {
  const { rows } = await pool.query("SELECT * FROM businesses WHERE slug = $1", [slug]);
  if (rows[0]) return rows[0];
  const inserted = await pool.query(
    "INSERT INTO businesses (name, slug) VALUES ($1, $2) RETURNING *",
    [name, slug]
  );
  return inserted.rows[0];
}

async function ensureUser(username, fullName) {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (rows[0]) return { user: rows[0], created: false, tempPassword: null };
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  const inserted = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, must_change_password)
     VALUES ($1, $2, $3, true) RETURNING *`,
    [username, fullName, hash]
  );
  return { user: inserted.rows[0], created: true, tempPassword: pw };
}

async function ensureGrant(userId, businessId, role, isSuperAdmin) {
  if (isSuperAdmin) return; // super admins don't need a per-business grant row
  await pool.query(
    `INSERT INTO user_business_roles (user_id, business_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [userId, businessId, role]
  );
}

async function ensureSuperAdmin(username, fullName) {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (rows[0]) return { user: rows[0], created: false, tempPassword: null };
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  const inserted = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, is_super_admin, must_change_password)
     VALUES ($1, $2, $3, true, true) RETURNING *`,
    [username, fullName, hash]
  );
  return { user: inserted.rows[0], created: true, tempPassword: pw };
}

async function main() {
  const khurais = await ensureBusiness("Bofuyih Khurais Camp", "khurais-camp");
  const hofuf = await ensureBusiness("Mattam Altayaba Hofuf", "hofuf");

  const owner = await ensureSuperAdmin("owner_admin", "Ikram (Owner)");
  const khuraisManager = await ensureUser("khurais_manager", "Khurais Camp Manager");
  const hofufManager = await ensureUser("hofuf_manager", "Hofuf Manager");

  await ensureGrant(khuraisManager.user.id, khurais.id, "business_admin", false);
  await ensureGrant(hofufManager.user.id, hofuf.id, "business_admin", false);

  const lines = [
    "=== Unified Accounts Platform — initial login credentials ===",
    "Generated: " + new Date().toISOString(),
    "",
    "Change every password on first login (the app will force this automatically).",
    "",
  ];

  for (const [label, result] of [
    ["Super Admin (you) — sees both businesses", owner],
    ["Business Admin — Bofuyih Khurais Camp only", khuraisManager],
    ["Business Admin — Mattam Altayaba Hofuf only", hofufManager],
  ]) {
    lines.push(`${label}`);
    lines.push(`  username: ${result.user.username}`);
    lines.push(`  password: ${result.created ? result.tempPassword : "(already existed — not changed)"}`);
    lines.push("");
  }

  const out = lines.join("\n");
  console.log(out);
  const outPath = path.join(__dirname, "..", "CREDENTIALS_DO_NOT_COMMIT.txt");
  fs.writeFileSync(outPath, out, "utf8");
  console.log(`Also written to ${outPath} — read it, distribute the passwords, then delete this file.`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
