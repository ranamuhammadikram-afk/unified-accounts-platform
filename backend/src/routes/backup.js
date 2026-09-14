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

module.exports = router;
