import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { api } from "../api";

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

const TYPE_LABEL = { sales: "Sales", expense: "Expense", fixed_cost: "Fixed cost", salary: "Salary" };

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DailyReport() {
  const { business } = useOutletContext();
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/businesses/${business.id}/reports/daily?date=${date}`);
      setData(res);
    } catch (err) {
      setError(err.message || "Could not load report.");
    } finally {
      setLoading(false);
    }
  }, [business.id, date]);

  useEffect(() => {
    load();
  }, [load]);

  function exportPdf() {
    if (!data) return;
    const doc = new jsPDF();
    const currency = business.currency || "SAR";
    doc.setFontSize(14);
    doc.text(`${business.name} — Daily Report`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Date: ${data.date}`, 14, 23);

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

    const entriesBody = data.entries.map((e) => [
      TYPE_LABEL[e.type] || e.type,
      e.payment_method || (e.fixed_cost_type ? e.fixed_cost_type : "—"),
      fmt(e.amount),
      e.description || "",
      e.entered_by,
    ]);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Type", "Detail", `Amount (${currency})`, "Description", "Entered by"]],
      body: entriesBody.length ? entriesBody : [["No entries for this date.", "", "", "", ""]],
      theme: "striped",
      headStyles: { fillColor: [29, 111, 82] },
    });

    doc.save(`${business.slug}-daily-${data.date}.pdf`);
  }

  function exportExcel() {
    if (!data) return;
    const currency = business.currency || "SAR";
    const t = data.totals;

    const summarySheet = XLSX.utils.aoa_to_sheet([
      [`${business.name} — Daily Report`],
      [`Date: ${data.date}`],
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

    const entriesHeader = ["Type", "Detail", `Amount (${currency})`, "Description", "Entered by"];
    const entriesRows = data.entries.map((e) => [
      TYPE_LABEL[e.type] || e.type,
      e.payment_method || e.fixed_cost_type || "",
      Number(e.amount),
      e.description || "",
      e.entered_by,
    ]);
    const entriesSheet = XLSX.utils.aoa_to_sheet([entriesHeader, ...entriesRows]);
    entriesSheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, entriesSheet, "Entries");
    XLSX.writeFile(wb, `${business.slug}-daily-${data.date}.xlsx`);
  }

  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <h3>Entries</h3>
            {data.entries.length === 0 ? (
              <div className="empty">No entries for this date yet.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Detail</th>
                      <th className="num">Amount</th>
                      <th>Description</th>
                      <th>Entered by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}>
                        <td data-label="Type">
                          <span className={`badge ${e.type}`}>{TYPE_LABEL[e.type] || e.type}</span>
                        </td>
                        <td data-label="Detail">{e.payment_method || e.fixed_cost_type || "—"}</td>
                        <td className="num" data-label="Amount">
                          {fmt(e.amount)}
                        </td>
                        <td data-label="Description">{e.description || <span className="muted">—</span>}</td>
                        <td data-label="Entered by">{e.entered_by}</td>
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
