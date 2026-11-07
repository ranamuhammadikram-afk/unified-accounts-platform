import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";
import { TopBar, TopLink, PageHead, Figure, Icon, BizIcon } from "../components/ui.jsx";
import { fmt, firstOfMonthStr, todayStr, niceDate, niceDateTime, greeting, humanize } from "../format.js";
import { pdfHeader, pdfFooter, tableStyle, GREEN } from "../pdfBrand.js";

const NUM_COLS = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {} };
Object.keys(NUM_COLS).forEach((k) => (NUM_COLS[k] = { halign: "right" }));

// The API's grand total has no cash/card split, so add it up from the per-business rows.
function withCashCard(aggregate) {
  const sum = (key) => aggregate.perBusiness.reduce((s, b) => s + Number(b[key] || 0), 0);
  return { ...aggregate.grandTotal, salesCash: sum("salesCash"), salesCard: sum("salesCard") };
}

export default function SuperAdminDashboard() {
  const { user, businesses, refreshBusinesses } = useAuth();

  const [bizError, setBizError] = useState("");
  const [newBiz, setNewBiz] = useState({ name: "", slug: "", currency: "SAR", timezone: "Asia/Riyadh" });
  const [creatingBiz, setCreatingBiz] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [range, setRange] = useState({ from: firstOfMonthStr(), to: todayStr() });
  const [aggregate, setAggregate] = useState(null);
  const [aggError, setAggError] = useState("");
  const [aggLoading, setAggLoading] = useState(false);

  const [auditEntries, setAuditEntries] = useState([]);
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditShown, setAuditShown] = useState(10);

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
      setShowAdd(false);
      refreshBusinesses();
    } catch (err) {
      setBizError(err.message || "Could not create business.");
    } finally {
      setCreatingBiz(false);
    }
  }

  async function renameBusiness(biz) {
    const input = window.prompt(`New name for ${biz.name}:`, biz.name);
    if (input === null) return;
    const name = input.trim().replace(/\s+/g, " ");
    if (!name || name === biz.name) return;
    setBizError("");
    try {
      await api.patch(`/api/businesses/${biz.id}`, { name });
      refreshBusinesses();
      loadAggregate();
    } catch (err) {
      setBizError(err.message || "Could not rename business.");
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

  const currencies = [...new Set(businesses.map((b) => b.currency || "SAR"))];
  const currency = currencies.length === 1 ? currencies[0] : "";
  const rangeLabel = `${niceDate(range.from)} – ${niceDate(range.to)}`;

  function exportAggregatePdf() {
    if (!aggregate) return;
    const doc = new jsPDF();
    const y = pdfHeader(doc, "Aggregate Report — All Businesses", `${niceDate(aggregate.from)} to ${niceDate(aggregate.to)}`);

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
    const g = withCashCard(aggregate);
    doc.autoTable({
      ...tableStyle({ columnStyles: NUM_COLS }),
      startY: y,
      head: [["Business", "Cash", "Card", "Sales", "Expense", "Fixed", "Salary", "Outflow", "Net"]],
      body: body.length ? body : [["No data in this range.", "", "", "", "", "", "", "", ""]],
      foot: [["Total", fmt(g.salesCash), fmt(g.salesCard), fmt(g.sales), fmt(g.expense), fmt(g.fixedCost), fmt(g.salary), fmt(g.outflow), fmt(g.net)]],
      footStyles: { fillColor: [244, 236, 221], textColor: GREEN, fontStyle: "bold" },
    });
    pdfFooter(doc);
    doc.save(`aggregate-${aggregate.from}-to-${aggregate.to}.pdf`);
  }

  const firstName = String(user.full_name || user.username).split(/\s+/)[0];
  const g = aggregate ? withCashCard(aggregate) : null;

  return (
    <>
      <TopBar context="Owner overview">
        <TopLink to="/admin">Overview</TopLink>
      </TopBar>

      <main>
        {!user.totp_enabled && (
          <div className="notice">
            <Icon name="shield" />
            <div>
              <strong>Protect the owner account.</strong> Two-factor authentication is off. Turn it on with Google
              Authenticator on the <Link to="/security">Security page</Link>.
            </div>
          </div>
        )}

        <PageHead
          eyebrow={rangeLabel}
          title={`${greeting()}, ${firstName}`}
          sub={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"} · combined results for the period`}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="from">From</label>
            <input id="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="to">To</label>
            <input id="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
          <button className="btn secondary" type="button" onClick={loadAggregate} disabled={aggLoading} aria-label="Refresh">
            <Icon name="refresh" />
          </button>
          <button className="btn" type="button" onClick={exportAggregatePdf} disabled={!aggregate}>
            <Icon name="download" /> Export PDF
          </button>
        </PageHead>

        {aggError && <div className="error-msg">{aggError}</div>}

        <div className="figures">
          <Figure label="Sales" dot="sales" currency={currency} value={g?.sales} sub={g ? `Cash ${fmt(g.salesCash)} · Card ${fmt(g.salesCard)}` : " "} />
          <Figure label="Expenses" dot="expense" currency={currency} value={g?.expense} sub="Consumables & running costs" />
          <Figure label="Fixed + salary" dot="fixed" currency={currency} value={g ? g.fixedCost + g.salary : 0} sub={g ? `Fixed ${fmt(g.fixedCost)} · Salary ${fmt(g.salary)}` : " "} />
          <Figure label="Net" currency={currency} value={g?.net} keyFigure sub={g && g.sales ? `${((g.net / g.sales) * 100).toFixed(1)}% of sales` : "—"} />
        </div>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">By business</h2>
            <span className="section-note">{aggLoading ? "Updating…" : rangeLabel}</span>
          </div>
          <div className="card flush">
            <div className="table-scroll table-wrap">
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
                  {!aggregate || aggregate.perBusiness.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty">
                        {aggregate ? "No transactions in this range." : "Loading…"}
                      </td>
                    </tr>
                  ) : (
                    aggregate.perBusiness.map((b) => (
                      <tr key={b.businessId}>
                        <td data-label="Business" className="strong">{b.businessName}</td>
                        <td className="num" data-label="Cash">{fmt(b.salesCash)}</td>
                        <td className="num" data-label="Card">{fmt(b.salesCard)}</td>
                        <td className="num" data-label="Sales">{fmt(b.sales)}</td>
                        <td className="num" data-label="Expense">{fmt(b.expense)}</td>
                        <td className="num" data-label="Fixed">{fmt(b.fixedCost)}</td>
                        <td className="num" data-label="Salary">{fmt(b.salary)}</td>
                        <td className={`num strong${b.net < 0 ? " neg" : ""}`} data-label="Net">{fmt(b.net)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {aggregate && aggregate.perBusiness.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num" data-label="Cash">{fmt(g.salesCash)}</td>
                      <td className="num" data-label="Card">{fmt(g.salesCard)}</td>
                      <td className="num" data-label="Sales">{fmt(g.sales)}</td>
                      <td className="num" data-label="Expense">{fmt(g.expense)}</td>
                      <td className="num" data-label="Fixed">{fmt(g.fixedCost)}</td>
                      <td className="num" data-label="Salary">{fmt(g.salary)}</td>
                      <td className={`num${g.net < 0 ? " neg" : ""}`} data-label="Net">{fmt(g.net)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Businesses</h2>
            <button className="btn secondary small" type="button" onClick={() => setShowAdd(!showAdd)}>
              <Icon name="plus" /> {showAdd ? "Close" : "Add a business"}
            </button>
          </div>
          {bizError && <div className="error-msg">{bizError}</div>}

          {showAdd && (
            <form className="card" onSubmit={handleCreateBusiness}>
              <h3>New business</h3>
              <div className="grid">
                <div className="field">
                  <label htmlFor="biz-name">Name</label>
                  <input id="biz-name" value={newBiz.name} onChange={(e) => setNewBiz({ ...newBiz, name: e.target.value })} required />
                </div>
                <div className="field">
                  <label htmlFor="biz-slug">Short link name</label>
                  <input id="biz-slug" value={newBiz.slug} placeholder="e.g. sultan-restaurant" onChange={(e) => setNewBiz({ ...newBiz, slug: e.target.value })} required />
                  <div className="hint">Used in the web address — lowercase, no spaces.</div>
                </div>
                <div className="field">
                  <label htmlFor="biz-cur">Currency</label>
                  <input id="biz-cur" value={newBiz.currency} onChange={(e) => setNewBiz({ ...newBiz, currency: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="biz-tz">Timezone</label>
                  <input id="biz-tz" value={newBiz.timezone} onChange={(e) => setNewBiz({ ...newBiz, timezone: e.target.value })} />
                </div>
              </div>
              <div className="row-actions">
                <button className="btn" type="submit" disabled={creatingBiz}>
                  {creatingBiz ? "Creating…" : "Create business"}
                </button>
                <button className="btn ghost" type="button" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="card flush">
            {businesses.length === 0 ? (
              <div className="empty">No businesses yet. Add your first one above.</div>
            ) : (
              <div className="list">
                {businesses.map((b) => (
                  <div className={`list-row${b.is_active ? "" : " inactive"}`} key={b.id}>
                    <div className="list-main">
                      <BizIcon slug={b.slug} size={40} />
                      <div>
                        <div className="list-title">
                          {b.name} {!b.is_active && <span className="tag plain muted">Inactive</span>}
                        </div>
                        <div className="list-meta">
                          /{b.slug} · {b.currency || "SAR"} · {b.timezone || "Asia/Riyadh"}
                        </div>
                      </div>
                    </div>
                    <div className="list-actions">
                      <Link className="btn small" to={`/b/${b.slug}/entry`}>
                        Open
                      </Link>
                      <Link className="btn small secondary" to={`/b/${b.slug}/users`}>
                        Users
                      </Link>
                      <Link className="btn small secondary" to={`/b/${b.slug}/audit`}>
                        Audit
                      </Link>
                      <button className="btn small ghost" type="button" onClick={() => renameBusiness(b)}>
                        Rename
                      </button>
                      <button className="btn small ghost" type="button" onClick={() => toggleActive(b)}>
                        {b.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Recent activity</h2>
            <span className="section-note">All businesses</span>
          </div>
          {auditError && <div className="error-msg">{auditError}</div>}
          <div className="card flush">
            {auditLoading ? (
              <div className="empty">Loading…</div>
            ) : auditEntries.length === 0 ? (
              <div className="empty">No activity recorded yet.</div>
            ) : (
              <>
                <ul className="activity">
                  {auditEntries.slice(0, auditShown).map((e) => (
                    <li key={e.id}>
                      <span className={`bullet ${e.action}`} />
                      <span className="what">
                        <strong>{humanize(e.action)}</strong> {humanize(e.entity_type)} #{e.entity_id} by{" "}
                        {e.performed_by || "system"}
                        {e.business_name ? ` · ${e.business_name}` : ""}
                      </span>
                      <span className="when">{niceDateTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
                {auditEntries.length > auditShown && (
                  <div className="card-pad" style={{ borderTop: "1px solid var(--line)", textAlign: "center" }}>
                    <button className="link" type="button" onClick={() => setAuditShown(auditShown + 20)}>
                      Show more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
