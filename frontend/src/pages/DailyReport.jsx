import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { api } from "../api";
import { PageHead, Figure, TypeTag, Icon, TYPE_LABEL } from "../components/ui.jsx";
import { fmt, todayStr, niceDate } from "../format.js";
import { pdfHeader, pdfSectionTitle, pdfFooter, tableStyle } from "../pdfBrand.js";

const EXPENSE_CATEGORY_LABEL = {
  supplies: "Supplies",
  utilities: "Utilities",
  maintenance: "Maintenance",
  transport: "Transport",
  marketing: "Marketing",
  other: "Other",
};

function detailOf(e) {
  return e.payment_method || e.fixed_cost_type || (e.expense_category && EXPENSE_CATEGORY_LABEL[e.expense_category]) || "";
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
    let y = pdfHeader(doc, `${business.name} — Daily Report`, niceDate(data.date));

    const t = data.totals;
    doc.autoTable({
      ...tableStyle({ columnStyles: { 1: { halign: "right" } }, tableWidth: 110 }),
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

    const entriesBody = data.entries.map((e) => [
      TYPE_LABEL[e.type] || e.type,
      detailOf(e) || "—",
      e.type === "sales" && e.payment_method === "cash" ? fmt(e.amount) : "",
      e.type === "sales" && e.payment_method === "card" ? fmt(e.amount) : "",
      e.type !== "sales" ? fmt(e.amount) : "",
      e.description || "",
      e.entered_by,
    ]);
    y = pdfSectionTitle(doc, "Entries", doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      ...tableStyle({ columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } }),
      startY: y + 2,
      head: [["Type", "Detail", "Cash Sale", "Card Sale", `Amount (${currency})`, "Description", "Entered by"]],
      body: entriesBody.length ? entriesBody : [["No entries for this date.", "", "", "", "", "", ""]],
    });

    pdfFooter(doc);
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

    const entriesHeader = [
      "Type",
      "Detail",
      `Cash Sale (${currency})`,
      `Card Sale (${currency})`,
      `Amount (${currency})`,
      "Description",
      "Entered by",
    ];
    const entriesRows = data.entries.map((e) => [
      TYPE_LABEL[e.type] || e.type,
      detailOf(e),
      e.type === "sales" && e.payment_method === "cash" ? Number(e.amount) : "",
      e.type === "sales" && e.payment_method === "card" ? Number(e.amount) : "",
      e.type !== "sales" ? Number(e.amount) : "",
      e.description || "",
      e.entered_by,
    ]);
    const entriesSheet = XLSX.utils.aoa_to_sheet([entriesHeader, ...entriesRows]);
    entriesSheet["!cols"] = [
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 30 },
      { wch: 16 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(wb, entriesSheet, "Entries");
    XLSX.writeFile(wb, `${business.slug}-daily-${data.date}.xlsx`);
  }

  const t = data?.totals;
  const currency = business.currency || "SAR";
  const isToday = date === todayStr();

  return (
    <>
      <PageHead eyebrow={business.name} title="Daily report" sub={isToday ? `Today · ${niceDate(date)}` : niceDate(date)}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <Figure label="Expenses" dot="expense" currency={currency} value={t.expense} sub="Consumables" />
            <Figure label="Fixed + salary" dot="fixed" currency={currency} value={t.fixedCost + t.salary} sub={`Fixed ${fmt(t.fixedCost)} · Salary ${fmt(t.salary)}`} />
            <Figure label="Net" currency={currency} value={t.net} keyFigure sub={`Total outflow ${fmt(t.outflow)}`} />
          </div>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Entries</h2>
              <span className="section-note">
                {data.entries.length} {data.entries.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <div className="card flush">
              {data.entries.length === 0 ? (
                <div className="empty">No entries for this date yet.</div>
              ) : (
                <div className="table-scroll table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Detail</th>
                        <th className="num">Cash sale</th>
                        <th className="num">Card sale</th>
                        <th className="num">Amount</th>
                        <th>Note</th>
                        <th>Entered by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((e) => (
                        <tr key={e.id}>
                          <td data-label="Type">
                            <TypeTag type={e.type} />
                          </td>
                          <td data-label="Detail" style={{ textTransform: "capitalize" }}>
                            {detailOf(e) || <span className="muted">—</span>}
                          </td>
                          <td className="num" data-label="Cash sale">
                            {e.type === "sales" && e.payment_method === "cash" ? fmt(e.amount) : ""}
                          </td>
                          <td className="num" data-label="Card sale">
                            {e.type === "sales" && e.payment_method === "card" ? fmt(e.amount) : ""}
                          </td>
                          <td className="num" data-label="Amount">
                            {e.type !== "sales" ? fmt(e.amount) : ""}
                          </td>
                          <td className="desc" data-label="Note">
                            {e.description || <span className="muted">—</span>}
                          </td>
                          <td data-label="Entered by">{e.entered_by}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td className="num" data-label="Cash sale">{fmt(t.salesCash)}</td>
                        <td className="num" data-label="Card sale">{fmt(t.salesCard)}</td>
                        <td className="num" data-label="Outflow">{fmt(t.outflow)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
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
