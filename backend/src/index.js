require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { pool } = require("./db");
const authRoutes = require("./routes/auth");
const businessRoutes = require("./routes/businesses");
const transactionRoutes = require("./routes/transactions");
const reportRoutes = require("./routes/reports");
const aggregateRoutes = require("./routes/aggregate");
const userRoutes = require("./routes/users");
const auditRoutes = require("./routes/audit");
const backupRoutes = require("./routes/backup");
const { scheduleNightlyBackup } = require("./jobs/nightlyBackup");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/businesses/:businessId/transactions", transactionRoutes);
app.use("/api/businesses/:businessId/reports", reportRoutes);
app.use("/api/businesses/:businessId/users", userRoutes);
app.use("/api/businesses/:businessId/audit", auditRoutes);
app.use("/api/reports", aggregateRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api", auditRoutes.globalRouter);

// Central error handler — keeps stack traces out of API responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

// Lightweight, idempotent schema patch applied on every boot. This repo has no migration
// runner (schema.sql is only ever applied by hand), so new columns are added this way —
// safe to run on every deploy since each statement is a no-op once already applied.
async function ensureSchema() {
  try {
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expense_category TEXT`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'transactions_expense_category_check'
        ) THEN
          ALTER TABLE transactions ADD CONSTRAINT transactions_expense_category_check
            CHECK (expense_category IN ('supplies', 'utilities', 'maintenance', 'transport', 'marketing', 'other') OR expense_category IS NULL);
        END IF;
      END $$;
    `);
    // eslint-disable-next-line no-console
    console.log("[schema] expense_category column ready.");

    // Account security: two-factor authentication, backup codes and a recovery email.
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS totp_secret TEXT,
        ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT,
        ADD COLUMN IF NOT EXISTS recovery_email TEXT,
        ADD COLUMN IF NOT EXISTS recovery_email_verified BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS recovery_email_pending TEXT,
        ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_backup_codes (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes (user_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'verify_email')),
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens (purpose, token_hash)`);
    // eslint-disable-next-line no-console
    console.log("[schema] account security tables ready.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[schema] Could not apply schema updates:", err);
  }
}

const port = process.env.PORT || 4000;
ensureSchema().finally(() => {
  app.listen(port, () => {
    console.log(`Unified Accounts Platform API listening on port ${port}`);
    scheduleNightlyBackup();
  });
});
