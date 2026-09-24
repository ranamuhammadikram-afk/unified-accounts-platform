const http = require("http");
const https = require("https");
const { pool } = require("../db");

/**
 * Nightly full-database backup to Oracle Cloud Infrastructure (OCI) Object Storage.
 *
 * Backups are written to a shared bucket (e.g. "erp-backups") that can hold backups for
 * several applications, each in its own folder (object-name prefix):
 *
 *   erp-backups/
 *     unified-accounts-platform/2026/unified-accounts-backup-2026-09-24.json
 *     <another-erp>/...
 *
 * Authentication uses a write-only Pre-Authenticated Request (PAR) created on that bucket
 * and limited to this app's folder, so no OCI SDK, API keys or request signing are needed —
 * the backup is a single HTTPS PUT. The PAR URL is a secret: keep it only in the
 * OCI_BACKUP_PAR_URL environment variable and never log it.
 */

const DEFAULT_PREFIX = "unified-accounts-platform/";

/** Reads an env var, stripping whitespace/newlines and wrapping quotes picked up by copy-paste. */
function cleanEnv(name) {
  const raw = process.env[name];
  if (!raw) return raw;
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

function backupPrefix() {
  let prefix = cleanEnv("OCI_BACKUP_PREFIX") || DEFAULT_PREFIX;
  prefix = prefix.replace(/^\/+/, "");
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function isConfigured() {
  return Boolean(cleanEnv("OCI_BACKUP_PAR_URL"));
}

/**
 * Builds the full upload URL for `objectName` (which already starts with the app prefix).
 * Works whether the PAR URL was copied as ".../b/<bucket>/o/" or already ends with the
 * app's prefix (".../o/unified-accounts-platform/"), which OCI shows for prefix-limited PARs.
 */
function buildUploadUrl(parUrl, objectName) {
  const base = parUrl.endsWith("/") ? parUrl : `${parUrl}/`;
  const prefix = backupPrefix();
  const encodedPrefix = prefix.split("/").map(encodeURIComponent).join("/");
  let rest = objectName;
  if (base.endsWith(`/o/${prefix}`) || base.endsWith(`/o/${encodedPrefix}`)) {
    rest = objectName.slice(prefix.length);
  }
  return base + rest.split("/").map(encodeURIComponent).join("/");
}

function describeParProblem(parUrl) {
  if (!/^https:\/\/objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/p\//.test(parUrl)) {
    return 'OCI_BACKUP_PAR_URL does not look like an Object Storage pre-authenticated request URL (expected "https://objectstorage.<region>.oraclecloud.com/p/...").';
  }
  if (!/\/b\/[^/]+\/o\//.test(parUrl)) {
    return 'OCI_BACKUP_PAR_URL should be a bucket-level PAR ending in "/o/" — create it for "Objects with prefix" with "Permit object writes".';
  }
  return null;
}

/** PUTs `content` (UTF-8 JSON string) to the upload URL. Rejects on any non-2xx response. */
function putObject(uploadUrl, content) {
  const url = new URL(uploadUrl);
  const client = url.protocol === "http:" ? http : https;
  const body = Buffer.from(content, "utf8");
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, etag: res.headers.etag });
          } else {
            // The response body is OCI's error JSON; it never contains the PAR token.
            reject(new Error(`Oracle Object Storage upload failed (HTTP ${res.statusCode}): ${data.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", (err) => reject(new Error(`Oracle Object Storage upload failed: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

/**
 * Reads every row of every business table and returns a single JSON-serializable object.
 * Same shape as the earlier Dropbox backups, so old and new backup files are interchangeable.
 */
async function buildBackup() {
  const [businesses, users, roles, transactions, auditLog] = await Promise.all([
    pool.query("SELECT * FROM businesses ORDER BY id"),
    pool.query("SELECT * FROM users ORDER BY id"),
    pool.query("SELECT * FROM user_business_roles ORDER BY id"),
    pool.query("SELECT * FROM transactions ORDER BY id"),
    pool.query("SELECT * FROM audit_log ORDER BY id"),
  ]);
  return {
    exported_at: new Date().toISOString(),
    businesses: businesses.rows,
    users: users.rows,
    user_business_roles: roles.rows,
    transactions: transactions.rows,
    audit_log: auditLog.rows,
  };
}

/**
 * Builds a full backup and uploads it as a dated JSON object, grouped into yearly folders:
 *   <prefix><YYYY>/unified-accounts-backup-<YYYY-MM-DD>.json
 * Re-running on the same day replaces that day's file (enable bucket versioning to keep
 * every earlier copy as well).
 */
async function runBackup() {
  const parUrl = cleanEnv("OCI_BACKUP_PAR_URL");
  if (!parUrl) throw new Error("Oracle backup is not configured (OCI_BACKUP_PAR_URL missing).");

  const data = await buildBackup();
  const json = JSON.stringify(data, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const objectName = `${backupPrefix()}${dateStr.slice(0, 4)}/unified-accounts-backup-${dateStr}.json`;

  try {
    await putObject(buildUploadUrl(parUrl, objectName), json);
  } catch (err) {
    const hint = describeParProblem(parUrl);
    if (hint) err.message = `${err.message} — Hint: ${hint}`;
    throw err;
  }
  // eslint-disable-next-line no-console
  console.log(`[backup] Uploaded backup to Oracle Object Storage: ${objectName} (${json.length} bytes)`);
  return { destination: "oracle-object-storage", object: objectName, bytes: json.length };
}

function msUntilNextRunUTC(hourUTC, minuteUTC) {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, minuteUTC, 0, 0)
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * In-process fallback schedule: ~02:00 Asia/Riyadh (= 23:00 UTC, no DST in Saudi Arabia).
 * The primary trigger is the GitHub Actions workflow (.github/workflows/nightly-backup.yml),
 * because Render's free tier sleeps and kills in-process timers. No-op when not configured.
 */
function scheduleNightlyBackup() {
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log("[backup] Oracle Object Storage is not configured — nightly backup is disabled.");
    return;
  }
  const HOUR_UTC = 23;
  const MINUTE_UTC = 0;

  function scheduleNext() {
    setTimeout(async () => {
      try {
        await runBackup();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[backup] Nightly backup failed:", err);
      }
      scheduleNext();
    }, msUntilNextRunUTC(HOUR_UTC, MINUTE_UTC));
  }

  scheduleNext();
  // eslint-disable-next-line no-console
  console.log("[backup] Nightly Oracle Object Storage backup scheduled for ~02:00 Asia/Riyadh (23:00 UTC) daily.");
}

module.exports = { runBackup, scheduleNightlyBackup, buildBackup, isConfigured, buildUploadUrl };
