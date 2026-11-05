import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { PageHead, Toast } from "../components/ui.jsx";
import { initials, niceDateTime } from "../format.js";

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
    <>
      <PageHead eyebrow={business.name} title="Users" sub="People who can enter or review this business's accounts." />

      <div className="report-grid users-grid">
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">People with access</h2>
            <span className="section-note">{users.length} {users.length === 1 ? "person" : "people"}</span>
          </div>
          {error && <div className="error-msg">{error}</div>}
          <div className="card flush">
            {loading && users.length === 0 ? (
              <div className="empty">Loading…</div>
            ) : users.length === 0 ? (
              <div className="empty">No one has access yet.</div>
            ) : (
              <div className="list">
                {users.map((u) => (
                  <div className={`list-row${u.is_active ? "" : " inactive"}`} key={u.id}>
                    <div className="list-main">
                      <span className="avatar">{initials(u.full_name || u.username)}</span>
                      <div>
                        <div className="list-title">
                          {u.full_name} <span className="muted">@{u.username}</span>{" "}
                          <span className={`tag plain${u.role === "business_admin" ? " gold" : ""}`}>{ROLE_LABEL[u.role] || u.role}</span>{" "}
                          {!u.is_active && <span className="tag plain muted">Inactive</span>}
                        </div>
                        <div className="list-meta">
                          {u.email || "No email on file"}
                          {u.last_login_at ? ` · last sign-in ${niceDateTime(u.last_login_at)}` : " · never signed in"}
                        </div>
                      </div>
                    </div>
                    {canModify(u) && (
                      <div className="list-actions">
                        <button className="btn small ghost" type="button" onClick={() => handleEditName(u)}>
                          Edit name
                        </button>
                        <button className="btn small ghost" type="button" onClick={() => handleResetPassword(u)}>
                          Reset password
                        </button>
                        <button className="btn small secondary" type="button" onClick={() => handleToggleActive(u)}>
                          {u.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button className="btn small danger" type="button" onClick={() => handleRevoke(u)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Add a person</h2>
          </div>
          <form className="card" onSubmit={handleCreate}>
            <div className="field">
              <label htmlFor="u-name">Full name</label>
              <input id="u-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="u-username">Username</label>
              <input
                id="u-username"
                autoCapitalize="none"
                spellCheck={false}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="u-email">
                Email <span className="muted">(optional)</span>
              </label>
              <input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="u-role">Role</label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff — enters and edits own entries</option>
                <option value="viewer">Viewer — read-only</option>
                {isSuperAdmin && <option value="business_admin">Business admin — full control</option>}
              </select>
            </div>
            <button className="btn block" type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create user"}
            </button>

            {tempPassword && (
              <div className="temp-pass-box">
                <strong>{tempPassword.username}</strong> is ready. Temporary password (shown once — share it securely):
                <div style={{ margin: "10px 0" }}>
                  <code>{tempPassword.password}</code>
                </div>
                <div className="hint" style={{ marginTop: 0 }}>They'll choose their own password at first sign-in.</div>
                <div style={{ marginTop: 10 }}>
                  <button className="btn small secondary" type="button" onClick={() => setTempPassword(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </form>
        </section>
      </div>

      <Toast message={toast} />
    </>
  );
}
