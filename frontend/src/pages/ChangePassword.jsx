import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";

export default function ChangePassword() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      updateUser({ must_change_password: false });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered-page">
      <form className="card" style={{ maxWidth: 400, width: "100%" }} onSubmit={handleSubmit}>
        <h2>{user && user.must_change_password ? "Set a new password" : "Change password"}</h2>
        <p className="hint" style={{ marginTop: -8, marginBottom: 18 }}>
          {user && user.must_change_password
            ? "This account was created with a temporary password. Choose a new one to continue."
            : "Update your account password."}
        </p>
        <div className="field">
          <label htmlFor="currentPassword">Current / temporary password</label>
          <input
            id="currentPassword"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div className="row-actions">
          <button className="btn" type="submit" disabled={busy} style={{ flex: 1 }}>
            {busy ? "Saving…" : "Save new password"}
          </button>
          <button type="button" className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </form>
    </div>
  );
}
