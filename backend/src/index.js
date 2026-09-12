require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const businessRoutes = require("./routes/businesses");
const transactionRoutes = require("./routes/transactions");
const reportRoutes = require("./routes/reports");
const aggregateRoutes = require("./routes/aggregate");
const userRoutes = require("./routes/users");
const auditRoutes = require("./routes/audit");

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
app.use("/api", auditRoutes.globalRouter);

// Central error handler — keeps stack traces out of API responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Unified Accounts Platform API listening on port ${port}`);
});
