import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { api } from "../api";

function thisMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, dailySheet, "Daily Breakdown");
    XLSX.writeFile(wb, `${business.slug}-monthly-${data.month}.xlsx`);
  }

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
        </>
      )}
    </div>
  );
}
