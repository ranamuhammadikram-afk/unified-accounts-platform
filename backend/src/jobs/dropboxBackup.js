const https = require("https");
const { pool } = require("../db");

/**
 * Uploads `content` (a UTF-8 string) to Dropbox at `dropboxPath` using a raw HTTPS call
 * to Dropbox's content-upload endpoint. No Dropbox SDK dependency required.
 * Dropbox creates any missing parent folders automatically on upload.
 */
function dropboxUpload(token, dropboxPath, content) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(content, "utf8");
    const apiArg = JSON.stringify({
      path: dropboxPath,
      mode: "overwrite",
      autorename: false,
      mute: true,
    });
    const req = https.request(
      {
        hostname: "content.dropboxapi.com",
        path: "/2/files/upload",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": apiArg,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve({ raw: data });
            }
          } else {
            reject(new Error(`Dropbox upload failed (HTTP ${res.statusCode}): ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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

/**
 * Builds a full backup and uploads it to Dropbox as a dated JSON file.
 * Requires DROPBOX_ACCESS_TOKEN to be set; throws if it's missing.
 */
async function runBackup() {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    throw new Error("DROPBOX_ACCESS_TOKEN is not set.");
  }
  const data = await buildBackup();
  const json = JSON.stringify(data, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const folder = process.env.DROPBOX_BACKUP_FOLDER || "/Unified Accounts Platform Backups";
  const dropboxPath = `${folder}/unified-accounts-backup-${dateStr}.json`;
  await dropboxUpload(token, dropboxPath, json);
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
 * A no-op if DROPBOX_ACCESS_TOKEN isn't configured yet, so this is always safe to call.
 */
function scheduleNightlyBackup() {
  if (!process.env.DROPBOX_ACCESS_TOKEN) {
    // eslint-disable-next-line no-console
    console.log("[backup] DROPBOX_ACCESS_TOKEN not set — nightly Dropbox backup is disabled.");
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

module.exports = { runBackup, scheduleNightlyBackup, buildBackup };
