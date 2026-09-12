import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

export default function SuperAdminDashboard() {
  const { user, businesses, refreshBusinesses, logout } = useAuth();

  const [bizError, setBizError] = useState("");
  const [newBiz, setNewBiz] = useState({ name: "", slug: "", currency: "SAR", timezone: "Asia/Riyadh" });
  const [creatingBiz, setCreatingBiz] = useState(false);

  const [range, setRange] = useState({ from: firstOfMonthStr(), to: todayStr() });
  const [aggregate, setAggregate] = useState(null);
  const [aggError, setAggError] = useState("");
  const [aggLoading, setAggLoading] = useState(false);

  const [auditEntries, setAuditEntries] = useState([]);
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAggregate = useCallback(async () => {
    setAggLoading(true);
    setAggError("");
    try {
      const res = await api.get(`/api/reports/aggregate?from=${range.from}&to=${range.to}`);
      setAggregate(res);
    } catch (err) {
      setAggError(err.message || "Could not load aggregate report.");
    } finally {
      setAggLoading(false);
    }
  }, [range]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const res = await api.get("/api/audit?limit=100");
      setAuditEntries(res.entries);
    } catch (err) {
      setAuditError(err.message || "Could not load audit trail.");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAggregate();
    loadAudit();
  }, [loadAggregate, loadAudit]);

  async function handleCreateBusiness(e) {
    e.preventDefault();
    setBizError("");
    setCreatingBiz(true);
    try {
      await api.post("/api/businesses", newBiz);
      setNewBiz({ name: "", slug: "", currency: "SAR", timezone: "Asia/Riyadh" });
      refreshBusinesses();
    } catch (err) {
      setBizError(err.message || "Could not create business.");
    } finally {
      setCreatingBiz(false);
    }
  }

  async function toggleActive(biz) {
    try {
      await api.patch(`/api/businesses/${biz.id}`, { is_active: !biz.is_active });
      refreshBusinesses();
    } catch (err) {
      setBizError(err.message || "Could not update business.");
    }
  }

  function exportAggregatePdf() {
    if (!aggregate) return;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Unified Accounts Platform — Aggregate Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`Range: ${aggregate.from} to ${aggregate.to}`, 14, 23);

    const body = aggregate.perBusiness.map((b) => [
      b.businessName,
      fmt(b.salesCash),
      fmt(b.salesCard),
      fmt(b.sales),
      fmt(b.expense),
      fmt(b.fixedCost),
      fmt(b.salary),
      fmt(b.outflow),
      fmt(b.net),
    ]);
    doc.autoTable({
      startY: 28,
      head: [["Business", "Cash", "Card", "Sales", "Expense", "Fixed", "Salary", "Outflow", "Net"]],
      body: body.length ? body : [["No data in this range.", "", "", "", "", "", "", "", ""]],
      theme: "grid",
      headStyles: { fillColor: [29, 111, 82] },
      styles: { fontSize: 9 },
    });

    const g = aggregate.grandTotal;
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 10,
      head: [["Grand total", "Sales", "Expense", "Fixed", "Salary", "Outflow", "Net"]],
      body: [["All businesses", fmt(g.sales), fmt(g.expense), fmt(g.fixedCost), fmt(g.salary), fmt(g.outflow), fmt(g.net)]],
      theme: "grid",
      headStyles: { fillColor: [21, 79, 59] },
    });

    doc.save(`aggregate-${aggregate.from}-to-${aggregate.to}.pdf`);
  }

  return (
    <>
      <header className="appbar">
        <div>
          <h1>Unified Accounts Platform</h1>
          <div className="sub">Super admin dashboard</div>
        </div>
        <div className="right">
          <span className="who">{user.full_name || user.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main>
        <div className="card">
          <h2>Businesses</h2>
          {bizError && <div className="error-msg">{bizError}</div>}
          <div className="stack">
            {businesses.map((b) => (
              <div className="userRow" key={b.id}>
                <div>
                  <div className="uname">
                    {b.name} <span className="muted">({b.slug})</span>{" "}
                    {!b.is_active && <span className="badge" style={{ background: "#94a3b8" }}>inactive</span>}
                  </div>
                  <div className="hint">{b.currency || "SAR"} · {b.timezone || "Asia/Riyadh"}</div>
                </div>
                <div className="row-actions">
                  <Link className="btn small secondary" to={`/b/${b.slug}/entry`}>
                    Open
                  </Link>
                  <Link className="btn small secondary" to={`/b/${b.slug}/users`}>
                    Users
                  </Link>
                  <Link className="btn small secondary" to={`/b/${b.slug}/audit`}>
                    Audit
                  </Link>
                  <button className="btn small ghost" type="button" onClick={() => toggleActive(b)}>
                    {b.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 18 }}>Add a business</h3>
          <form onSubmit={handleCreateBusiness}>
            <div className="grid">
              <div className="field">
                <label>Name</label>
                <input value={newBiz.name} onChange={(e) => setNewBiz({ ...newBiz, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Slug (used in the URL, lowercase, no spaces)</label>
                <input value={newBiz.slug} onChange={(e) => setNewBiz({ ...newBiz, slug: e.target.value })} required />
              </div>
            </div>
            <div className="grid">
              <div className="field">
                <label>Currency</label>
                <input value={newBiz.currency} onChange={(e) => setNewBiz({ ...newBiz, currency: e.target.value })} />
              </div>
              <div className="field">
                <label>Timezone</label>
                <input value={newBiz.timezone} onChange={(e) => setNewBiz({ ...newBiz, timezone: e.target.value })} />
              </div>
            </div>
            <button className="btn" type="submit" disabled={creatingBiz}>
              {creatingBiz ? "Creating…" : "Create business"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Aggregate report — all businesses</h2>
          <div className="toolbar">
            <div className="field">
              <label>From</label>
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
            <button className="btn secondary" type="button" onClick={loadAggregate} disabled={aggLoading}>
              {aggLoading ? "Loading…" : "Refresh"}
            </button>
            <button className="btn" type="button" onClick={exportAggregatePdf} disabled={!aggregate}>
              Export PDF
            </button>
          </div>
          {aggError && <div className="error-msg">{aggError}</div>}

          {aggregate && (
            <>
              <div className="summary-grid" style={{ marginBottom: 14 }}>
                <div className="stat sales">
                  <div className="label">Total sales</div>
                  <div className="value">{fmt(aggregate.grandTotal.sales)}</div>
                </div>
                <div className="stat expense">
                  <div className="label">Expenses</div>
                  <div className="value">{fmt(aggregate.grandTotal.expense)}</div>
                </div>
                <div className="stat fixed">
                  <div className="label">Fixed + salary</div>
                  <div className="value">{fmt(aggregate.grandTotal.fixedCost + aggregate.grandTotal.salary)}</div>
                </div>
                <div className="stat net">
                  <div className="label">Net</div>
                  <div className="value">{fmt(aggregate.grandTotal.net)}</div>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th className="num">Cash</th>
                      <th className="num">Card</th>
                      <th className="num">Sales</th>
                      <th className="num">Expense</th>
                      <th className="num">Fixed</th>
                      <th className="num">Salary</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregate.perBusiness.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          No transactions in this range.
                        </td>
                      </tr>
                    ) : (
                      aggregate.perBusiness.map((b) => (
                        <tr key={b.businessId}>
                          <td data-label="Business">{b.businessName}</td>
                          <td className="num" data-label="Cash">{fmt(b.salesCash)}</td>
                          <td className="num" data-label="Card">{fmt(b.salesCard)}</td>
                          <td className="num" data-label="Sales">{fmt(b.sales)}</td>
                          <td className="num" data-label="Expense">{fmt(b.expense)}</td>
                          <td className="num" data-label="Fixed">{fmt(b.fixedCost)}</td>
                          <td className="num" data-label="Salary">{fmt(b.salary)}</td>
                          <td className="num" data-label="Net">{fmt(b.net)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Global audit trail</h2>
          {auditError && <div className="error-msg">{auditError}</div>}
          {auditLoading ? (
            <div className="empty">Loading…</div>
          ) : auditEntries.length === 0 ? (
            <div className="empty">No activity recorded yet.</div>
          ) : (
            <div className="stack">
              {auditEntries.slice(0, 30).map((e) => (
                <div className="userRow" key={e.id}>
                  <div>
                    <div className="uname">
                      {e.action.replace("_", " ")} {e.entity_type.replace(/_/g, " ")} #{e.entity_id}{" "}
                      <span className="muted">
                        by {e.performed_by || "system"} in {e.business_name || "—"}
                      </span>
                    </div>
                    <div className="hint">{new Date(e.created_at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
