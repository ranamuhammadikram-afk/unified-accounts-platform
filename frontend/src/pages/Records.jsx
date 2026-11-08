import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";
import { PageHead, TypeTag, Toast } from "../components/ui.jsx";
import { EntryDetail, InvoiceLinks, InvoiceManager } from "../components/invoices.jsx";
import { fmt, isoDate as fmtDate, niceDate } from "../format.js";

const TYPE_LABEL = { sales: "Sales", expense: "Expense", fixed_cost: "Fixed cost", salary: "Salary" };

const EXPENSE_CATEGORY_LABEL = {
  supplies: "Supplies",
  utilities: "Utilities",
  maintenance: "Maintenance",
  transport: "Transport",
  marketing: "Marketing",
  other: "Other",
};


export default function Records() {
  const { business, canManage } = useOutletContext();
  const { user } = useAuth();
  const [filters, setFilters] = useState({ from: "", to: "", type: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [editing, setEditing] = useState(null); // the transaction being edited, or null

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.type) params.set("type", filters.type);
      const qs = params.toString();
      const res = await api.get(`/api/businesses/${business.id}/transactions${qs ? `?${qs}` : ""}`);
      setRows(res.transactions);
      return res.transactions;
    } catch (err) {
      setError(err.message || "Could not load records.");
    } finally {
      setLoading(false);
    }
  }, [business.id, filters]);

  useEffect(() => {
    load();
  }, [load]);

  function canTouch(row) {
    return canManage || row.entered_by === user.username;
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete this ${TYPE_LABEL[row.type] || row.type} entry of ${fmt(row.amount)}?`)) return;
    try {
      await api.del(`/api/businesses/${business.id}/transactions/${row.id}`);
      setToast("Entry deleted.");
      setTimeout(() => setToast(""), 2500);
      load();
    } catch (err) {
      setError(err.message || "Could not delete entry.");
    }
  }

  function startEdit(row) {
    setEditing({
      id: row.id,
      type: row.type,
      occurred_on: fmtDate(row.occurred_on),
      amount: row.amount,
      payment_method: row.payment_method || "cash",
      fixed_cost_type: row.fixed_cost_type || "rent",
      expense_category: row.expense_category || "supplies",
      description: row.description || "",
      paid_by: row.type === "sales" ? "cash" : row.payment_method || "cash",
      supplier_name: row.supplier_name || "",
      invoice_number: row.invoice_number || "",
      attachments: row.attachments || [],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const purchaseEdit = editing && (editing.type === "expense" || editing.type === "fixed_cost");

  // After invoices change in the edit form, refresh the list and the form's invoice list.
  async function refreshAttachments() {
    const list = await load();
    const row = (list || []).find((t) => t.id === editing.id);
    if (row) setEditing((ed) => ed && { ...ed, attachments: row.attachments || [] });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError("");
    const payload = {
      type: editing.type,
      occurred_on: editing.occurred_on,
      amount: Number(editing.amount),
      description: editing.description || null,
      payment_method:
        editing.type === "sales"
          ? editing.payment_method
          : editing.type === "expense" || editing.type === "fixed_cost"
          ? editing.paid_by
          : null,
      fixed_cost_type: editing.type === "fixed_cost" ? editing.fixed_cost_type : null,
      expense_category: editing.type === "expense" ? editing.expense_category : null,
      supplier_name: purchaseEdit ? editing.supplier_name : null,
      invoice_number: purchaseEdit ? editing.invoice_number : null,
    };
    try {
      await api.patch(`/api/businesses/${business.id}/transactions/${editing.id}`, payload);
      setEditing(null);
      setToast("Entry updated.");
      setTimeout(() => setToast(""), 2500);
      load();
    } catch (err) {
      setError(err.message || "Could not update entry.");
    }
  }

  const inflow = rows.filter((r) => r.type === "sales").reduce((s, r) => s + Number(r.amount), 0);
  const outflow = rows.filter((r) => r.type !== "sales").reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <PageHead eyebrow={business.name} title="Records" sub="Every entry, newest first. Filter, correct or remove entries here." />

      <div className="card">
        <div className="filter-bar">
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-type">Type</label>
            <select id="f-type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">All types</option>
              <option value="sales">Sales</option>
              <option value="expense">Expense</option>
              <option value="fixed_cost">Fixed cost</option>
              <option value="salary">Salary</option>
            </select>
          </div>
          <button className="btn secondary" type="button" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </button>
          {(filters.from || filters.to || filters.type) && (
            <button className="btn ghost" type="button" onClick={() => setFilters({ from: "", to: "", type: "" })}>
              Clear
            </button>
          )}
        </div>
        {error && <div className="error-msg" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
      </div>

      {editing && (
        <form className="card edit-card" onSubmit={saveEdit}>
          <h3>Editing entry #{editing.id}</h3>
          <div className="grid three">
            <div className="field">
              <label>Type</label>
              <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                <option value="sales">Sales</option>
                <option value="expense">Expense</option>
                <option value="fixed_cost">Fixed cost</option>
                <option value="salary">Salary</option>
              </select>
            </div>
            <div className="field">
              <label>Date</label>
              <input
                type="date"
                value={editing.occurred_on}
                onChange={(e) => setEditing({ ...editing, occurred_on: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Amount ({business.currency || "SAR"})</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={editing.amount}
                onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                required
              />
            </div>
            {editing.type === "sales" && (
              <div className="field">
                <label>Payment method</label>
                <select
                  value={editing.payment_method}
                  onChange={(e) => setEditing({ ...editing, payment_method: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>
            )}
            {editing.type === "fixed_cost" && (
              <div className="field">
                <label>Fixed cost type</label>
                <select
                  value={editing.fixed_cost_type}
                  onChange={(e) => setEditing({ ...editing, fixed_cost_type: e.target.value })}
                >
                  <option value="rent">Rent</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="utilities">Utilities</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
            {editing.type === "expense" && (
              <div className="field">
                <label>Expense category</label>
                <select
                  value={editing.expense_category}
                  onChange={(e) => setEditing({ ...editing, expense_category: e.target.value })}
                >
                  {Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {purchaseEdit && (
            <div className="grid three">
              <div className="field">
                <label>Paid by</label>
                <select value={editing.paid_by} onChange={(e) => setEditing({ ...editing, paid_by: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank transfer</option>
                </select>
              </div>
              <div className="field">
                <label>Supplier</label>
                <input
                  maxLength={120}
                  value={editing.supplier_name}
                  onChange={(e) => setEditing({ ...editing, supplier_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Invoice no.</label>
                <input
                  maxLength={60}
                  value={editing.invoice_number}
                  onChange={(e) => setEditing({ ...editing, invoice_number: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="field">
            <label>{editing.type === "expense" ? "Description" : "Note"}</label>
            <textarea
              rows={2}
              maxLength={500}
              required={editing.type === "expense"}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
          {purchaseEdit && (
            <InvoiceManager
              businessId={business.id}
              transactionId={editing.id}
              attachments={editing.attachments}
              onChanged={refreshAttachments}
            />
          )}
          <div className="row-actions">
            <button className="btn" type="submit">
              Save changes
            </button>
            <button className="btn ghost" type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </h2>
          {rows.length > 0 && (
            <span className="section-note">
              In {fmt(inflow)} · Out {fmt(outflow)}
            </span>
          )}
        </div>
        <div className="card flush">
          {rows.length === 0 ? (
            <div className="empty">{loading ? "Loading…" : "No records match these filters."}</div>
          ) : (
            <div className="table-scroll table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Detail</th>
                    <th className="num">Amount</th>
                    <th>Description</th>
                    <th>Invoice</th>
                    <th>Entered by</th>
                    <th className="num">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Date" className="nowrap">{niceDate(row.occurred_on)}</td>
                      <td data-label="Type">
                        <TypeTag type={row.type} />
                      </td>
                      <td data-label="Detail">
                        <EntryDetail entry={row} />
                      </td>
                      <td className="num strong" data-label="Amount">
                        {fmt(row.amount)}
                      </td>
                      <td className="desc" data-label="Description">{row.description || <span className="muted">—</span>}</td>
                      <td data-label="Invoice">
                        <InvoiceLinks businessId={business.id} attachments={row.attachments} />
                      </td>
                      <td data-label="Entered by">{row.entered_by}</td>
                      <td className="actions-col">
                        {canTouch(row) ? (
                          <>
                            <button className="btn small secondary" type="button" onClick={() => startEdit(row)}>
                              Edit
                            </button>
                            <button className="btn small danger" type="button" onClick={() => handleDelete(row)}>
                              Delete
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Toast message={toast} />
    </>
  );
}
