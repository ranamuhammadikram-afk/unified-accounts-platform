const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireBusinessAccess } = require("../middleware/auth");

const router = express.Router({ mergeParams: true });

const EXPENSE_CATEGORIES = ["supplies", "utilities", "maintenance", "transport", "marketing", "other"];

function emptyExpenseByCategory() {
  return EXPENSE_CATEGORIES.reduce((acc, key) => ((acc[key] = 0), acc), {});
}

function emptyTotals() {
  return {
    salesCash: 0,
    salesCard: 0,
    sales: 0,
    expense: 0,
    expenseByCategory: emptyExpenseByCategory(),
    fixedCost: 0,
    salary: 0,
    outflow: 0,
    net: 0,
  };
}

function accumulate(totals, row) {
  const amt = Number(row.amount);
  if (row.type === "sales") {
    totals.sales += amt;
    if (row.payment_method === "card") totals.salesCard += amt;
    else totals.salesCash += amt;
  } else if (row.type === "expense") {
    totals.expense += amt;
    const category = EXPENSE_CATEGORIES.includes(row.expense_category) ? row.expense_category : "other";
    totals.expenseByCategory[category] += amt;
  } else if (row.type === "fixed_cost") {
    totals.fixedCost += amt;
  } else if (row.type === "salary") {
    totals.salary += amt;
  }
}

function finalize(totals) {
  totals.outflow = totals.expense + totals.fixedCost + totals.salary;
  totals.net = totals.sales - totals.outflow;
  return totals;
}

// GET /api/businesses/:businessId/reports/daily?date=YYYY-MM-DD
router.get("/daily", requireAuth, requireBusinessAccess("viewer", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)." });
    const { rows } = await pool.query(
      `SELECT t.*, u.username AS entered_by FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.business_id = $1 AND t.occurred_on = $2 AND t.deleted_at IS NULL
       ORDER BY t.created_at`,
      [req.businessId, date]
    );
    const totals = finalize(rows.reduce((t, r) => (accumulate(t, r), t), emptyTotals()));
    res.json({ date, totals, entries: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/businesses/:businessId/reports/monthly?month=YYYY-MM
router.get("/monthly", requireAuth, requireBusinessAccess("viewer", (req) => req.params.businessId), async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month is required (YYYY-MM)." });
    const { rows } = await pool.query(
      `SELECT t.*, u.username AS entered_by FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.business_id = $1 AND to_char(t.occurred_on, 'YYYY-MM') = $2 AND t.deleted_at IS NULL
       ORDER BY t.occurred_on, t.created_at`,
      [req.businessId, month]
    );
    const totals = finalize(rows.reduce((t, r) => (accumulate(t, r), t), emptyTotals()));

    const byDay = {};
    for (const r of rows) {
      const day = r.occurred_on.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = emptyTotals();
      accumulate(byDay[day], r);
    }
    const dailyBreakdown = Object.keys(byDay)
      .sort()
      .map((day) => ({ date: day, ...finalize(byDay[day]) }));

    res.json({ month, totals, dailyBreakdown, entries: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
