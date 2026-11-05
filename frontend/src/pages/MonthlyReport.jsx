import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { api } from "../api";
import { PageHead, Figure, TypeTag, Icon } from "../components/ui.jsx";
import { fmt, thisMonthStr, niceMonth, niceDate } from "../format.js";
import { pdfHeader, pdfSectionTitle, pdfFooter, tableStyle } from "../pdfBrand.js";

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
    return [{ content: row.label.toUpperCase(), colSpan: 3, styles: { fontStyle: "bold", fontSize: 8, textColor: [134, 101, 58], fillColor: [250, 247, 240] } }];
  }
  const bold = row.kind === "subtotal" || row.kind === "net" || row.kind === "revenue";
  const styles = bold ? { fontStyle: "bold" } : {};
  const label = (row.indent ? "    " : "") + row.label;
  return [
    { content: label, styles },
    { content: fmt(row.amount), styles: { ...styles, halign: "right" } },
    { content: pct(row.amount, revenue), styles: { ...styles, halign: "right" } },
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
    let y = pdfHeader(doc, `${business.name} — Monthly Report`, niceMonth(data.month));
    const right = (...cols) => Object.fromEntries(cols.map((c) => [c, { halign: "right" }]));

    const t = data.totals;
    doc.autoTable({
      ...tableStyle({ columnStyles: right(1), tableWidth: 110 }),
      startY: y,
      head: [["Summary", `Amount (${currency})`]],
      body: [
        ["Sales — Cash", fmt(t.salesCash)],
        ["Sales — Card", fmt(t.salesCard)],
        ["Total Sales", fmt(t.sales)],
        ["Expenses", fmt(t.expense)],
        ["Fixed Costs", fmt(t.fixedCost)],
        ["Salaries", fmt(t.salary)],
        ["Total Outflow", fmt(t.outflow)],
        [{ content: "Net", styles: { fontStyle: "bold" } }, { content: fmt(t.net), styles: { fontStyle: "bold" } }],
      ],
    });

    const pnl = buildPnl(t);
    y = pdfSectionTitle(doc, "Profit & Loss Statement", doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      ...tableStyle({ alternateRowStyles: {} }),
      startY: y + 2,
      head: [["Line item", { content: `Amount (${currency})`, styles: { halign: "right" } }, { content: "% of revenue", styles: { halign: "right" } }]],
      body: pnl.rows.map((r) => pnlPdfRow(r, pnl.revenue)),
    });

    const dailyBody = data.dailyBreakdown.map((d) => [
      niceDate(d.date),
      fmt(d.salesCash),
      fmt(d.salesCard),
      fmt(d.expense),
      fmt(d.fixedCost),
      fmt(d.salary),
      fmt(d.net),
    ]);
    y = pdfSectionTitle(doc, "Daily Breakdown", doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      ...tableStyle({ columnStyles: right(1, 2, 3, 4, 5, 6) }),
      startY: y + 2,
      head: [["Date", "Cash Sale", "Card Sale", "Expenses", "Fixed", "Salary", "Net"]],
      body: dailyBody.length ? dailyBody : [["No entries this month.", "", "", "", "", "", ""]],
    });

    const detail = fixedSalaryDetail(data.entries);
    y = pdfSectionTitle(doc, "Fixed Cost, Salary & Maintenance Detail", doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      ...tableStyle({ columnStyles: right(3) }),
      startY: y + 2,
      head: [["Date", "Type", "Detail", `Amount (${currency})`, "Description", "Entered by"]],
      body: detail.length
        ? detail.map((d) => [niceDate(d.date), d.type, d.detail, fmt(d.amount), d.description, d.enteredBy])
        : [["No fixed cost or salary entries this month.", "", "", "", "", ""]],
    });

    pdfFooter(doc);
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

  const t = data?.totals;
  const currency = business.currency || "SAR";

  return (
    <>
      <PageHead eyebrow={business.name} title="Monthly report" sub={niceMonth(month)}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="month">Month</label>
          <input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button className="btn secondary" type="button" onClick={load} disabled={loading} aria-label="Refresh">
          <Icon name="refresh" />
        </button>
        <button className="btn secondary" type="button" onClick={exportExcel} disabled={!data}>
          Excel
        </button>
        <button className="btn" type="button" onClick={exportPdf} disabled={!data}>
          <Icon name="download" /> PDF
        </button>
      </PageHead>
      {error && <div className="error-msg">{error}</div>}

      {data && (
        <>
          <div className="figures">
            <Figure label="Sales" dot="sales" currency={currency} value={t.sales} sub={`Cash ${fmt(t.salesCash)} · Card ${fmt(t.salesCard)}`} />
            <Figure label="Expenses" dot="expense" currency={currency} value={t.expense} sub={`${pct(t.expense, t.sales)} of sales`} />
            <Figure label="Fixed + salary" dot="fixed" currency={currency} value={t.fixedCost + t.salary} sub={`Fixed ${fmt(t.fixedCost)} · Salary ${fmt(t.salary)}`} />
            <Figure label="Net profit" currency={currency} value={t.net} keyFigure sub={t.sales ? `${pct(t.net, t.sales)} margin` : "No sales yet"} />
          </div>

          <div className="report-grid">
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Profit &amp; loss</h2>
                <span className="section-note">{niceMonth(data.month)}</span>
              </div>
              <div className="card flush">
                <div className="table-wrap">
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
                              r.kind === "net"
                                ? `pnl-net ${r.amount >= 0 ? "positive" : "negative"}`
                                : r.kind === "subtotal"
                                ? "pnl-subtotal"
                                : r.kind === "revenue"
                                ? "pnl-revenue"
                                : ""
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
            </section>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Where the money went</h2>
              </div>
              <div className="card">
                <Breakdown totals={t} />
              </div>
            </section>
          </div>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Daily breakdown</h2>
              <span className="section-note">
                {data.dailyBreakdown.length} {data.dailyBreakdown.length === 1 ? "day" : "days"} with entries
              </span>
            </div>
            <div className="card flush">
              {data.dailyBreakdown.length === 0 ? (
                <div className="empty">No entries this month yet.</div>
              ) : (
                <div className="table-scroll table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="num">Cash sale</th>
                        <th className="num">Card sale</th>
                        <th className="num">Expenses</th>
                        <th className="num">Fixed</th>
                        <th className="num">Salary</th>
                        <th className="num">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dailyBreakdown.map((d) => (
                        <tr key={d.date}>
                          <td data-label="Date" className="nowrap">{niceDate(d.date)}</td>
                          <td className="num" data-label="Cash sale">{fmt(d.salesCash)}</td>
                          <td className="num" data-label="Card sale">{fmt(d.salesCard)}</td>
                          <td className="num" data-label="Expenses">{fmt(d.expense)}</td>
                          <td className="num" data-label="Fixed">{fmt(d.fixedCost)}</td>
                          <td className="num" data-label="Salary">{fmt(d.salary)}</td>
                          <td className={`num strong${d.net < 0 ? " neg" : ""}`} data-label="Net">{fmt(d.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Month total</td>
                        <td className="num" data-label="Cash sale">{fmt(t.salesCash)}</td>
                        <td className="num" data-label="Card sale">{fmt(t.salesCard)}</td>
                        <td className="num" data-label="Expenses">{fmt(t.expense)}</td>
                        <td className="num" data-label="Fixed">{fmt(t.fixedCost)}</td>
                        <td className="num" data-label="Salary">{fmt(t.salary)}</td>
                        <td className={`num${t.net < 0 ? " neg" : ""}`} data-label="Net">{fmt(t.net)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Fixed cost, salary &amp; maintenance detail</h2>
            </div>
            <div className="card flush">
              {detailRows.length === 0 ? (
                <div className="empty">No fixed cost or salary entries this month.</div>
              ) : (
                <div className="table-scroll table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Detail</th>
                        <th className="num">Amount</th>
                        <th>Note</th>
                        <th>Entered by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((d, i) => (
                        <tr key={`${d.date}-${i}`}>
                          <td data-label="Date" className="nowrap">{niceDate(d.date)}</td>
                          <td data-label="Type">
                            <TypeTag type={d.type === "Salary" ? "salary" : "fixed_cost"} label={d.type} />
                          </td>
                          <td data-label="Detail" style={{ textTransform: "capitalize" }}>{d.detail}</td>
                          <td className="num" data-label="Amount">{fmt(d.amount)}</td>
                          <td className="desc" data-label="Note">{d.description}</td>
                          <td data-label="Entered by">{d.enteredBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

// Horizontal bars showing how each cost line compares to revenue.
function Breakdown({ totals }) {
  const rows = [
    { key: "expense", label: "Expenses", value: totals.expense },
    { key: "fixed", label: "Fixed costs", value: totals.fixedCost },
    { key: "salary", label: "Salaries", value: totals.salary },
  ];
  const max = Math.max(totals.sales, totals.outflow, 1);
  return (
    <div className="bars">
      <div className="bar-row">
        <div className="bar-label">
          <span>
            <span className="dot sales" /> Sales
          </span>
          <span className="num">{fmt(totals.sales)}</span>
        </div>
        <div className="bar-track">
          <div className="bar-fill sales" style={{ width: `${(totals.sales / max) * 100}%` }} />
        </div>
      </div>
      {rows.map((r) => (
        <div className="bar-row" key={r.key}>
          <div className="bar-label">
            <span>
              <span className={`dot ${r.key}`} /> {r.label}
            </span>
            <span className="num">
              {fmt(r.value)} <span className="muted">· {pct(r.value, totals.sales)}</span>
            </span>
          </div>
          <div className="bar-track">
            <div className={`bar-fill ${r.key}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className={`day-total${totals.net < 0 ? " neg" : ""}`} style={{ marginTop: 18 }}>
        <span>Net profit</span>
        <span>{fmt(totals.net)}</span>
      </div>
    </div>
  );
}
