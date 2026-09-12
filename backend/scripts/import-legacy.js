/**
 * Imports a JSON backup exported from one of the old offline HTML apps
 * ("Export Backup (JSON)" button in each app's Backup & Settings tab) into the
 * new unified database.
 *
 * Usage:
 *   node scripts/import-legacy.js --business=khurais-camp --file=./bkc_backup_2026-09-10.json
 *   node scripts/import-legacy.js --business=hofuf        --file=./mah_backup_2026-09-10.json
 *
 * - "khurais-camp" had one shared login, so every imported entry is attributed to that
 *   business's business_admin account (created by scripts/seed.js) unless you pass
 *   --defaultUser=<username> to attribute it to someone else.
 * - "hofuf" had per-staff logins (the "enteredBy" field on each entry). Any username that
 *   doesn't already have access to this business is created automatically as a new "staff"
 *   user with a temporary password (printed at the end, once).
 *
 * Anything that can't be mapped cleanly is written to ./import-review.json instead of being
 * silently dropped or guessed at.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool } = require("../src/db");

const TYPE_MAP = { sales: "sales", expense: "expense", fixed: "fixed_cost", salary: "salary" };
const METHOD_MAP = { Cash: "cash", Card: "card" };
const SUBTYPE_MAP = { Rent: "rent", Maintenance: "maintenance", Utilities: "utilities", Other: "other" };

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function tempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

async function getOrCreateStaffUser(username, businessId, cache, createdPasswords) {
  if (cache.has(username)) return cache.get(username);

  let { rows } = await pool.query("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
  let user = rows[0];

  if (!user) {
    const pw = tempPassword();
    const hash = await bcrypt.hash(pw, 12);
    const inserted = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, must_change_password)
       VALUES ($1, $2, $3, true) RETURNING *`,
      [username, username, hash]
    );
    user = inserted.rows[0];
    createdPasswords.push({ username, password: pw });
  }

  await pool.query(
    `INSERT INTO user_business_roles (user_id, business_id, role) VALUES ($1, $2, 'staff')
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [user.id, businessId]
  );

  cache.set(username, user);
  return user;
}

async function main() {
  const args = parseArgs();
  if (!args.business || !args.file) {
    console.error("Usage: node scripts/import-legacy.js --business=<slug> --file=<path-to-backup.json> [--defaultUser=<username>]");
    process.exit(1);
  }

  const { rows: bizRows } = await pool.query("SELECT * FROM businesses WHERE slug = $1", [args.business]);
  const business = bizRows[0];
  if (!business) {
    console.error(`No business found with slug "${args.business}". Run scripts/seed.js first, or create it via the API.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(args.file, "utf8"));
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!Array.isArray(entries)) {
    console.error("That file doesn't look like a valid backup (no entries[] array found).");
    process.exit(1);
  }

  let defaultUser = null;
  if (args.defaultUser) {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [args.defaultUser]);
    defaultUser = rows[0];
    if (!defaultUser) {
      console.error(`--defaultUser="${args.defaultUser}" does not exist.`);
      process.exit(1);
    }
  } else {
    const { rows } = await pool.query(
      `SELECT u.* FROM users u JOIN user_business_roles ubr ON ubr.user_id = u.id
       WHERE ubr.business_id = $1 AND ubr.role = 'business_admin' LIMIT 1`,
      [business.id]
    );
    defaultUser = rows[0] || null;
  }

  const userCache = new Map();
  const createdPasswords = [];
  const reviewNeeded = [];
  let imported = 0;

  for (const entry of entries) {
    try {
      const type = TYPE_MAP[entry.category];
      if (!type) throw new Error(`Unknown category "${entry.category}"`);
      if (!entry.date || Number.isNaN(Date.parse(entry.date))) throw new Error(`Invalid date "${entry.date}"`);
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid amount "${entry.amount}"`);

      const paymentMethod = type === "sales" ? METHOD_MAP[entry.method] || "cash" : null;
      const fixedCostType = type === "fixed_cost" ? SUBTYPE_MAP[entry.subtype] || "other" : null;

      let user;
      if (entry.enteredBy) {
        user = await getOrCreateStaffUser(entry.enteredBy, business.id, userCache, createdPasswords);
      } else if (defaultUser) {
        user = defaultUser;
      } else {
        throw new Error("No enteredBy on entry, and no default user available to attribute it to.");
      }

      const createdAt = entry.createdAt ? new Date(Number(entry.createdAt)) : new Date();

      await pool.query(
        `INSERT INTO transactions (business_id, user_id, type, occurred_on, amount, payment_method, fixed_cost_type, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [business.id, user.id, type, entry.date, amount, paymentMethod, fixedCostType, entry.description || null, createdAt]
      );
      imported++;
    } catch (e) {
      reviewNeeded.push({ entry, reason: e.message });
    }
  }

  console.log(`Imported ${imported} of ${entries.length} entries into "${business.name}".`);

  if (createdPasswords.length) {
    console.log("\nNew staff accounts were created from the 'enteredBy' names in this backup:");
    for (const { username, password } of createdPasswords) {
      console.log(`  ${username}  →  temporary password: ${password}`);
    }
    console.log("Hand these out and have each person change their password on first login.");
  }

  if (reviewNeeded.length) {
    const reviewPath = path.join(__dirname, "..", "import-review.json");
    fs.writeFileSync(reviewPath, JSON.stringify(reviewNeeded, null, 2));
    console.log(`\n${reviewNeeded.length} entries could not be imported automatically — see ${reviewPath}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
