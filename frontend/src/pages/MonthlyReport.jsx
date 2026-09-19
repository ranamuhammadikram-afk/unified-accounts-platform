import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { api } from "../api";

const TYPE_LABEL = { fixed_cost: "Fixed cost", salary: "Salary" };

const EXPENSE_CATEGORY_LABEL = {
  supplies: "Supplies",
  utilities: "Utilities",
  maintenance: "Maintenance",
  transport: "Transport",
  marketing: "Marketing",
  other: "Other",
};
const EXPENSE_CATEGORY_ORDER = ["supplies", "utilities", "maintenance", "transport", "marketing", "other"];

function thisMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function entryDate(e) {
  const raw = e.occurred_on;
  return typeof raw === "string" ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
}

// Fixed cost / Salary entries, oldest first, each carrying its own free-text description
// (and, for Fixed cost, the maintenance/rent/utilities/other sub-type) so the monthly
// report can show what the money actually went to, not just the daily totals.
function fixedSalaryDetail(entries) {
  return (entries || [])
    .filter((e) => e.type === "fixed_cost" || e.type === "salary")
    .map((e) => ({
      date: entryDate(e),
      type: TYPE_LABEL[e.type] || e.type,
      detail: e.fixed_cost_type || "—",
      amount: Number(e.amount),
      description: e.description || "—",
      enteredBy: e.entered_by || "—",
    }));
}

function pct(amount, revenue) {
  if (!revenue) return "—";
  return `${((amount / revenue) * 100).toFixed(1)}%`;
}

// Builds a proper Profit & Loss statement from the report totals: revenue, an expense-by-category
// breakdown (only categories actually used that month are shown), fixed costs, salaries, and the
// resulting net profit. Shared by the on-screen table, the PDF export, and the Excel export so all
// three always agree.
function buildPnl(totals) {
  const revenue = totals.sales;
  const categoryRows = EXPENSE_CATEGORY_ORDER.filter((key) => (totals.expenseByCategory?.[key] || 0) > 0).map(
    (key) => ({
      label: EXPENSE_CATEGORY_LABEL[key],
      amount: totals.expenseByCategory[key],
      indent: true,
    })
  );
  return {
    revenue,
    rows: [
      { label: "Revenue (Total Sales)", amount: revenue, kind: "revenue" },
      { label: "Operating Expenses", kind: "section" },
      ...categoryRows,
      { label: "Total Expenses", amount: totals.expense, kind: "subtotal" },
      { label: "Fixed Costs", amount: totals.fixedCost },
      { label: "Salaries", amount: totals.salary },
      { label: "Total Operating Expenses", amount: totals.outflow, kind: "subtotal" },
      { label: "Net Profit", amount: totals.net, kind: "net" },
    ],
  };
}

// Renders one P&L row as a jspdf-autotable body row, bolding subtotal/net/revenue lines and
// shading the section header.
function pnlPdfRow(row, revenue) {
  if (row.kind === "section") {
    return [{ content: row.label, colSpan: 3, styles: { fontStyle: "bold", fillColor: [230, 242, 236] } }];
  }
  const bold = row.kind === "subtotal" || row.kind === "net" || row.kind === "revenue";
  const styles = bold ? { fontStyle: "bold" } : {};
  const label = (row.indent ? "    " : "") + row.label;
  return [
    { content: label, styles },
    { content: fmt(row.amount), styles },
    { content: pct(row.amount, revenue), styles },
  ];
}

export default function MonthlyReport() {
  const { business } = useOutletContext();
  const [month, setMonth] = useState(thisMonthStr());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/businesses/${business.id}/reports/monthly?month=${month}`);
      setData(res);
    } catch (err) {
      setError(err.message || "Could not load report.");
    } finally {
      setLoading(false);
    }
  }, [business.id, month]);

  useEffect(() => {
    load();
  }, [load]);

  function exportPdf() {
    if (!data) return;
    const doc = new jsPDF();
    const currency = business.currency || "SAR";
    doc.setFontSize(14);
    doc.text(`${business.name} — Monthly Report`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Month: ${data.month}`, 14, 23);

    const t = data.totals;
    doc.autoTable({
      startY: 28,
      head: [["Metric", `Amount (${currency})`]],
      body: [
        ["Sales — Cash", fmt(t.salesCash)],
        ["Sales — Card", fmt(t.salesCard)],
        ["Total Sales", fmt(t.sales)],
        ["Expenses", fmt(t.expense)],
        ["Fixed Costs", fmt(t.fixedCost)],
        ["Salaries", fmt(t.salary)],
        ["Total Outflow", fmt(t.outflow)],
        ["Net", fmt(t.net)],
      ],
      theme: "grid",
      headStyles: { fillColor: [29, 111, 82] },
    });

    const pnl = buildPnl(t);
    const pnlHeadingY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.text("Profit & Loss Statement", 14, pnlHeadingY);
    doc.autoTable({
      startY: pnlHeadingY + 4,
      head: [["Line item", `Amount (${currency})`, "% of revenue"]],
      body: pnl.rows.map((r) => pnlPdfRow(r, pnl.revenue)),
      theme: "grid",
      headStyles: { fillColor: [29, 111, 82] },
    });

    const dailyBody = data.dailyBreakdown.map((d) => [
      d.date,
      fmt(d.salesCash),
      fmt(d.salesCard),
      fmt(d.expense),
      fmt(d.fixedCost),
      fmt(d.salary),
      fmt(d.net),
    ]);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Date", "Cash Sale", "Card Sale", "Expenses", "Fixed", "Salary", "Net"]],
      body: dailyBody.length ? dailyBody : [["No entries this month.", "", "", "", "", "", ""]],
      theme: "striped",
      headStyles: { fillColor: [29, 111, 82] },
    });

    const detail = fixedSalaryDetail(data.entries);
    const detailHeadingY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.text("Fixed Cost, Salary & Maintenance Detail", 14, detailHeadingY);
    doc.autoTable({
      startY: detailHeadingY + 4,
      head: [["Date", "Type", "Detail", `Amount (${currency})`, "Description", "Entered by"]],
      body: detail.length
        ? detail.map((d) => [d.date, d.type, d.detail, fmt(d.amount), d.description, d.enteredBy])
        : [["No fixed cost or salary entries this month.", "", "", "", "", ""]],
      theme: "grid",
      headStyles: { fillColor: [29, 111, 82] },
    });

    doc.save(`${business.slug}-monthly-${data.month}.pdf`);
  }

  function exportExcel() {
    if (!data) return;
    const currency = business.currency || "SAR";
    const t = data.totals;

    const summarySheet = XLSX.utils.aoa_to_sheet([
      [`${business.name} — Monthly Report`],
      [`Month: ${data.month}`],
      [],
      ["Metric", `Amount (${currency})`],
      ["Sales — Cash", t.salesCash],
      ["Sales — Card", t.salesCard],
      ["Total Sales", t.sales],
      ["Expenses", t.expense],
      ["Fixed Costs", t.fixedCost],
      ["Salaries", t.salary],
      ["Total Outflow", t.outflow],
      ["Net", t.net],
    ]);
    summarySheet["!cols"] = [{ wch: 20 }, { wch: 18 }];

    const pnl = buildPnl(t);
    const pnlHeader = ["Line item", `Amount (${currency})`, "% of revenue"];
    const pnlRows = pnl.rows.map((r) =>
      r.kind === "section" ? [r.label, "", ""] : [(r.indent ? "  " : "") + r.label, r.amount, pct(r.amount, pnl.revenue)]
    );
    const pnlSheet = XLSX.utils.aoa_to_sheet([
      [`${business.name} — Profit & Loss Statement`],
      [`Month: ${data.month}`],
      [],
      pnlHeader,
      ...pnlRows,
    ]);
    pnlSheet["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 14 }];

    const dailyHeader = ["Date", "Cash Sale", "Card Sale", "Expenses", "Fixed", "Salary", "Net"];
    const dailyRows = data.dailyBreakdown.map((d) => [
      d.date,
      d.salesCash,
      d.salesCard,
      d.expense,
      d.fixedCost,
      d.salary,
      d.net,
    ]);
    const dailySheet = XLSX.utils.aoa_to_sheet([dailyHeader, ...dailyRows]);
    dailySheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

    const detail = fixedSalaryDetail(data.entries);
    const detailHeader = ["Date", "Type", "Detail", `Amount (${currency})`, "Description", "Entered by"];
    const detailRows = detail.map((d) => [d.date, d.type, d.detail, d.amount, d.description, d.enteredBy]);
    const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
    detailSheet["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, pnlSheet, "Profit & Loss");
    XLSX.utils.book_append_sheet(wb, dailySheet, "Daily Breakdown");
    XLSX.utils.book_append_sheet(wb, detailSheet, "Fixed Cost & Salary Detail");
    XLSX.writeFile(wb, `${business.slug}-monthly-${data.month}.xlsx`);
  }

  const detailRows = data ? fixedSalaryDetail(data.entries) : [];
  const pnl = data ? buildPnl(data.totals) : null;

  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <div className="field">
            <label htmlFor="month">Month</label>
            <input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button className="btn secondary" type="button" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button className="btn" type="button" onClick={exportPdf} disabled={!data}>
            Export PDF
          </button>
          <button className="btn secondary" type="button" onClick={exportExcel} disabled={!data}>
            Export Excel
          </button>
        </div>
        {error && <div className="error-msg">{error}</div>}
      </div>

      {data && (
        <>
          <div className="card">
            <h3>Summary</h3>
            <div className="summary-grid">
              <div className="stat sales">
                <div className="label">Sales cash</div>
                <div className="value">{fmt(data.totals.salesCash)}</div>
              </div>
              <div className="stat sales">
                <div className="label">Sales card</div>
                <div className="value">{fmt(data.totals.salesCard)}</div>
              </div>
              <div className="stat sales">
                <div className="label">Total sales</div>
                <div className="value">{fmt(data.totals.sales)}</div>
              </div>
              <div className="stat expense">
                <div className="label">Expenses</div>
                <div className="value">{fmt(data.totals.expense)}</div>
              </div>
              <div className="stat fixed">
                <div className="label">Fixed costs</div>
                <div className="value">{fmt(data.totals.fixedCost)}</div>
              </div>
              <div className="stat salary">
                <div className="label">Salaries</div>
                <div className="value">{fmt(data.totals.salary)}</div>
              </div>
              <div className="stat">
                <div className="label">Total outflow</div>
                <div className="value">{fmt(data.totals.outflow)}</div>
              </div>
              <div className="stat net">
                <div className="label">Net</div>
                <div className="value">{fmt(data.totals.net)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Profit &amp; Loss Statement</h3>
            <div className="table-scroll">
              <table className="pnl-table">
                <thead>
                  <tr>
                    <th>Line item</th>
                    <th className="num">Amount</th>
                    <th className="num">% of revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {pnl.rows.map((r, i) =>
                    r.kind === "section" ? (
                      <tr key={i} className="pnl-section">
                        <td colSpan={3}>{r.label}</td>
                      </tr>
                    ) : (
                      <tr
                        key={i}
                        className={
                          r.kind === "net" ? `pnl-net ${r.amount >= 0 ? "positive" : "negative"}` : r.kind === "subtotal" ? "pnl-subtotal" : r.kind === "revenue" ? "pnl-revenue" : ""
                        }
                      >
                        <td className={r.indent ? "pnl-indent" : ""}>{r.label}</td>
                        <td className="num">{fmt(r.amount)}</td>
                        <td className="num">{pct(r.amount, pnl.revenue)}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Daily breakdown</h3>
            {data.dailyBreakdown.length === 0 ? (
              <div className="empty">No entries this month yet.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Cash Sale</th>
                      <th className="num">Card Sale</th>
                      <th className="num">Expenses</th>
                      <th className="num">Fixed</th>
                      <th className="num">Salary</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyBreakdown.map((d) => (
                      <tr key={d.date}>
                        <td data-label="Date">{d.date}</td>
                        <td className="num" data-label="Cash Sale">
                          {fmt(d.salesCash)}
                        </td>
                        <td className="num" data-label="Card Sale">
                          {fmt(d.salesCard)}
                        </td>
                        <td className="num" data-label="Expenses">
                          {fmt(d.expense)}
                        </td>
                        <td className="num" data-label="Fixed">
                          {fmt(d.fixedCost)}
                        </td>
                        <td className="num" data-label="Salary">
                          {fmt(d.salary)}
                        </td>
                        <td className="num" data-label="Net">
                          {fmt(d.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Fixed Cost, Salary &amp; Maintenance Detail</h3>
            {detailRows.length === 0 ? (
              <div className="empty">No fixed cost or salary entries this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Detail</th>
                      <th className="num">Amount</th>
                      <th>Description</th>
                      <th>Entered by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((d, i) => (
                      <tr key={`${d.date}-${i}`}>
                        <td data-label="Date">{d.date}</td>
                        <td data-label="Type">
                          <span className={`badge ${d.type === "Salary" ? "salary" : "fixed_cost"}`}>{d.type}</span>
                        </td>
                        <td data-label="Detail">{d.detail}</td>
                        <td className="num" data-label="Amount">
                          {fmt(d.amount)}
                        </td>
                        <td data-label="Description">{d.description}</td>
                        <td data-label="Entered by">{d.enteredBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
