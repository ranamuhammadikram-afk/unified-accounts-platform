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
const { scheduleNightlyBackup } = require("./jobs/dropboxBackup");

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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[schema] Could not ensure expense_category column:", err);
  }
}

const port = process.env.PORT || 4000;
ensureSchema().finally(() => {
  app.listen(port, () => {
    console.log(`Unified Accounts Platform API listening on port ${port}`);
    scheduleNightlyBackup();
  });
});
