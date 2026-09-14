const https = require("https");
const { pool } = require("../db");

/**
 * Performs a simple HTTPS JSON/form request and resolves with the parsed (or raw) response body.
 * Shared helper for both the OAuth token refresh call and the file upload call.
 */
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = { raw: data };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Dropbox request failed (HTTP ${res.statusCode}): ${data}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Dropbox access tokens are short-lived (a few hours). We store a long-lived refresh token
 * instead (DROPBOX_REFRESH_TOKEN) and exchange it for a fresh access token before every
 * backup run, using the app's key + secret (DROPBOX_APP_KEY / DROPBOX_APP_SECRET).
 */
function getAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(
    appKey
  )}&client_secret=${encodeURIComponent(appSecret)}`;
  return httpsRequest(
    {
      hostname: "api.dropboxapi.com",
      path: "/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  ).then((res) => res.access_token);
}

/**
 * Uploads `content` (a UTF-8 string) to Dropbox at `dropboxPath` using a raw HTTPS call
 * to Dropbox's content-upload endpoint. No Dropbox SDK dependency required.
 * Dropbox creates any missing parent folders automatically on upload.
 */
function dropboxUpload(accessToken, dropboxPath, content) {
  const body = Buffer.from(content, "utf8");
  const apiArg = JSON.stringify({
    path: dropboxPath,
    mode: "overwrite",
    autorename: false,
    mute: true,
  });
  return httpsRequest(
    {
      hostname: "content.dropboxapi.com",
      path: "/2/files/upload",
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArg,
        "Content-Length": body.length,
      },
    },
    body
  );
}

/**
 * Reads every row of every business table and returns a single JSON-serializable object.
 * Mirrors the manual full-database export used for the one-off backup, so the shape of
 * automated backups matches what was already validated.
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

function isConfigured() {
  return Boolean(
    process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN
  );
}

/**
 * Builds a full backup and uploads it to Dropbox as a dated JSON file.
 * Throws if Dropbox isn't configured (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN).
 */
async function runBackup() {
  if (!isConfigured()) {
    throw new Error("Dropbox backup is not configured.");
  }
  const accessToken = await getAccessToken();
  const data = await buildBackup();
  const json = JSON.stringify(data, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const folder = process.env.DROPBOX_BACKUP_FOLDER || "/Unified Accounts Platform Backups";
  const dropboxPath = `${folder}/unified-accounts-backup-${dateStr}.json`;
  await dropboxUpload(accessToken, dropboxPath, json);
  // eslint-disable-next-line no-console
  console.log(`[backup] Uploaded backup to Dropbox: ${dropboxPath} (${json.length} bytes)`);
  return { path: dropboxPath, bytes: json.length };
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
 * Schedules `runBackup` to fire once daily at ~02:00 Asia/Riyadh (= 23:00 UTC, no DST in
 * Saudi Arabia), using a self-rescheduling setTimeout chain rather than a cron dependency.
 * A no-op if Dropbox isn't configured yet, so this is always safe to call.
 */
function scheduleNightlyBackup() {
  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log("[backup] Dropbox is not configured — nightly Dropbox backup is disabled.");
    return;
  }
  const HOUR_UTC = 23; // 02:00 Asia/Riyadh
  const MINUTE_UTC = 0;

  function scheduleNext() {
    const delay = msUntilNextRunUTC(HOUR_UTC, MINUTE_UTC);
    setTimeout(async () => {
      try {
        await runBackup();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[backup] Nightly backup failed:", err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  // eslint-disable-next-line no-console
  console.log("[backup] Nightly Dropbox backup scheduled for ~02:00 Asia/Riyadh (23:00 UTC) daily.");
}

module.exports = { runBackup, scheduleNightlyBackup, buildBackup, isConfigured };
