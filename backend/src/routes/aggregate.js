const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");

const router = express.Router();

// Cross-business totals for a date range — super admin only (this is the "aggregated reports" requirement).
// GET /api/reports/aggregate?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/aggregate", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to dates are required." });

    const { rows } = await pool.query(
      `SELECT b.id AS business_id, b.name AS business_name,
              t.type,
              t.payment_method,
              SUM(t.amount)::numeric(14,2) AS total
       FROM transactions t
       JOIN businesses b ON b.id = t.business_id
       WHERE t.occurred_on BETWEEN $1 AND $2 AND t.deleted_at IS NULL
       GROUP BY b.id, b.name, t.type, t.payment_method
       ORDER BY b.name`,
      [from, to]
    );

    const byBusiness = {};
    for (const r of rows) {
      const key = r.business_id;
      if (!byBusiness[key]) {
        byBusiness[key] = {
          businessId: key,
          businessName: r.business_name,
          salesCash: 0,
          salesCard: 0,
          sales: 0,
          expense: 0,
          fixedCost: 0,
          salary: 0,
        };
      }
      const b = byBusiness[key];
      const amt = Number(r.total);
      if (r.type === "sales") {
        b.sales += amt;
        if (r.payment_method === "card") b.salesCard += amt;
        else b.salesCash += amt;
      } else if (r.type === "expense") b.expense += amt;
      else if (r.type === "fixed_cost") b.fixedCost += amt;
      else if (r.type === "salary") b.salary += amt;
    }
    const perBusiness = Object.values(byBusiness).map((b) => ({
      ...b,
      outflow: b.expense + b.fixedCost + b.salary,
      net: b.sales - (b.expense + b.fixedCost + b.salary),
    }));

    const grandTotal = perBusiness.reduce(
      (acc, b) => {
        acc.sales += b.sales;
        acc.expense += b.expense;
        acc.fixedCost += b.fixedCost;
        acc.salary += b.salary;
        return acc;
      },
      { sales: 0, expense: 0, fixedCost: 0, salary: 0 }
    );
    grandTotal.outflow = grandTotal.expense + grandTotal.fixedCost + grandTotal.salary;
    grandTotal.net = grandTotal.sales - grandTotal.outflow;

    res.json({ from, to, perBusiness, grandTotal });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
