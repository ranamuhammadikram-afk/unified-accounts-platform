import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";

const TYPE_LABEL = { sales: "Sales", expense: "Expense", fixed_cost: "Fixed cost", salary: "Salary" };

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v) {
  if (!v) return "";
  return typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
}

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
      description: row.description || "",
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError("");
    const payload = {
      type: editing.type,
      occurred_on: editing.occurred_on,
      amount: Number(editing.amount),
      description: editing.description || null,
      payment_method: editing.type === "sales" ? editing.payment_method : null,
      fixed_cost_type: editing.type === "fixed_cost" ? editing.fixed_cost_type : null,
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

  return (
    <div>
      <div className="card">
        <h2>Records — {business.name}</h2>
        <div className="filter-bar">
          <div className="field">
            <label>From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">All</option>
              <option value="sales">Sales</option>
              <option value="expense">Expense</option>
              <option value="fixed_cost">Fixed cost</option>
              <option value="salary">Salary</option>
            </select>
          </div>
          <button className="btn secondary" type="button" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
        {error && <div className="error-msg">{error}</div>}
      </div>

      {editing && (
        <form className="card" onSubmit={saveEdit}>
          <h3>Editing entry</h3>
          <div className="grid">
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
          </div>
          <div className="grid">
            <div className="field">
              <label>Amount</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
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
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              rows={2}
              maxLength={500}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
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

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">No records match these filters.</div>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{fmtDate(row.occurred_on)}</td>
                    <td data-label="Type">
                      <span className={`badge ${row.type}`}>{TYPE_LABEL[row.type] || row.type}</span>
                    </td>
                    <td data-label="Detail">{row.payment_method || row.fixed_cost_type || "—"}</td>
                    <td className="num" data-label="Amount">
                      {fmt(row.amount)}
                    </td>
                    <td data-label="Description">{row.description || <span className="muted">—</span>}</td>
                    <td data-label="Entered by">{row.entered_by}</td>
                    <td data-label="Actions" className="actions-col">
                      {canTouch(row) ? (
                        <>
                          <button className="btn small secondary" type="button" onClick={() => startEdit(row)}>
                            Edit
                          </button>
                          <button className="btn small danger" type="button" onClick={() => handleDelete(row)}>
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
