import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";

const ROLE_LABEL = { business_admin: "Business admin", staff: "Staff", viewer: "Viewer" };

export default function BusinessUsers() {
  const { business, role } = useOutletContext();
  const isSuperAdmin = role === "super_admin";

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tempPassword, setTempPassword] = useState(null); // { username, password }

  const [form, setForm] = useState({ username: "", full_name: "", email: "", role: "staff" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/businesses/${business.id}/users`);
      setUsers(res.users);
    } catch (err) {
      setError(err.message || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, [business.id]);

  useEffect(() => {
    load();
  }, [load]);

  function canModify(row) {
    return isSuperAdmin || row.role !== "business_admin";
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await api.post(`/api/businesses/${business.id}/users`, form);
      setTempPassword({ username: res.user.username, password: res.temporaryPassword });
      setForm({ username: "", full_name: "", email: "", role: "staff" });
      load();
    } catch (err) {
      setError(err.message || "Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(row) {
    try {
      await api.patch(`/api/businesses/${business.id}/users/${row.id}`, { is_active: !row.is_active });
      load();
    } catch (err) {
      setError(err.message || "Could not update user.");
    }
  }

  async function handleEditName(row) {
    const newName = window.prompt(`Enter the new full name for ${row.username}:`, row.full_name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === row.full_name) return;
    try {
      await api.patch(`/api/businesses/${business.id}/users/${row.id}`, { full_name: trimmed });
      setToast(`${row.username}'s name updated to ${trimmed}.`);
      setTimeout(() => setToast(""), 3000);
      load();
    } catch (err) {
      setError(err.message || "Could not update name.");
    }
  }

  async function handleResetPassword(row) {
    if (!window.confirm(`Reset ${row.username}'s password and issue a new temporary one?`)) return;
    try {
      const res = await api.post(`/api/businesses/${business.id}/users/${row.id}/reset-password`, {});
      setTempPassword({ username: row.username, password: res.temporaryPassword });
    } catch (err) {
      setError(err.message || "Could not reset password.");
    }
  }

  async function handleRevoke(row) {
    if (!window.confirm(`Remove ${row.username}'s access to ${business.name}? Their account itself is kept.`)) return;
    try {
      await api.del(`/api/businesses/${business.id}/users/${row.id}/grant`);
      setToast(`${row.username} no longer has access to this business.`);
      setTimeout(() => setToast(""), 3000);
      load();
    } catch (err) {
      setError(err.message || "Could not remove access.");
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Users — {business.name}</h2>
        <p className="hint" style={{ marginTop: -8 }}>
          Create accounts for people who need to enter or review this business's accounts.
        </p>

        <form onSubmit={handleCreate}>
          <div className="grid">
            <div className="field">
              <label>Username</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Full name</label>
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="grid">
            <div className="field">
              <label>Email (optional)</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff — can enter and edit own entries</option>
                <option value="viewer">Viewer — read-only access</option>
                {isSuperAdmin && <option value="business_admin">Business admin — full control of this business</option>}
              </select>
            </div>
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>

        {tempPassword && (
          <div className="temp-pass-box">
            Account for <strong>{tempPassword.username}</strong> is ready. Temporary password (shown once — share it
            securely): <code>{tempPassword.password}</code>. They'll be asked to set their own password on first
            login.
            <div style={{ marginTop: 8 }}>
              <button className="btn small ghost" type="button" onClick={() => setTempPassword(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>People with access</h3>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : users.length === 0 ? (
          <div className="empty">No one has access yet.</div>
        ) : (
          <div className="stack">
            {users.map((u) => (
              <div className="userRow" key={u.id}>
                <div>
                  <div className="uname">
                    {u.full_name} <span className="muted">({u.username})</span>{" "}
                    <span className="badge role">{ROLE_LABEL[u.role] || u.role}</span>{" "}
                    {!u.is_active && <span className="badge" style={{ background: "#94a3b8" }}>inactive</span>}
                  </div>
                  <div className="hint">
                    {u.email || "no email on file"}
                    {u.last_login_at ? ` · last login ${new Date(u.last_login_at).toLocaleString()}` : " · never logged in"}
                  </div>
                </div>
                {canModify(u) && (
                  <div className="row-actions">
                    <button className="btn small secondary" type="button" onClick={() => handleEditName(u)}>
                      Edit name
                    </button>
                    <button className="btn small secondary" type="button" onClick={() => handleToggleActive(u)}>
                      {u.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn small secondary" type="button" onClick={() => handleResetPassword(u)}>
                      Reset password
                    </button>
                    <button className="btn small danger" type="button" onClick={() => handleRevoke(u)}>
                      Remove access
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
