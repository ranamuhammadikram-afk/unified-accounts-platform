const express = require("express");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { runBackup, isConfigured } = require("../jobs/dropboxBackup");

const router = express.Router();

// Lets a super admin trigger a Dropbox backup on demand (e.g. to verify configuration)
// instead of waiting for the nightly schedule.
router.post("/run", requireAuth, requireSuperAdmin, async (req, res, next) => {
  if (!isConfigured()) {
    return res.status(400).json({
      error: "Dropbox backup is not configured (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN missing).",
    });
  }
  try {
    const result = await runBackup();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Lets an external scheduler (e.g. a GitHub Actions cron workflow) trigger the nightly
// backup without a logged-in session. This exists because Render's free tier spins the
// service down after ~15 minutes of inactivity, which kills any in-process setTimeout-based
// schedule — an external cron hit both wakes the service up and runs the backup reliably.
// Authenticated with a shared secret (BACKUP_CRON_SECRET) instead of a user JWT.
router.post("/cron", async (req, res, next) => {
  const provided = req.headers["x-cron-secret"];
  const expected = process.env.BACKUP_CRON_SECRET;
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "Invalid or missing cron secret." });
  }
  if (!isConfigured()) {
    return res.status(400).json({
      error: "Dropbox backup is not configured (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN missing).",
    });
  }
  try {
    const result = await runBackup();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
