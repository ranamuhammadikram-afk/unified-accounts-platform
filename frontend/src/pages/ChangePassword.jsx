import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";
import AuthLayout from "../components/AuthLayout.jsx";

export default function ChangePassword() {
  const { user, updateUser, replaceToken, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const forced = Boolean(user && user.must_change_password);

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
      const res = await api.post("/api/auth/change-password", { currentPassword, newPassword });
      replaceToken(res && res.token);
      updateUser({ must_change_password: false });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">{forced ? "First sign-in" : "Your account"}</div>
        <h2>{forced ? "Set a new password" : "Change password"}</h2>
        <p className="lede">
          {forced
            ? "This account was created with a temporary password. Choose a new one to continue."
            : "Choose a new password. You'll stay signed in on this device."}
        </p>
        <div className="field">
          <label htmlFor="currentPassword">{forced ? "Temporary password" : "Current password"}</label>
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
          <div className="hint">At least 8 characters.</div>
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
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </button>
        <div className="auth-links" style={{ gap: 22 }}>
          {!forced && (
            <button type="button" className="link" onClick={() => navigate(-1)}>
              Cancel
            </button>
          )}
          <button type="button" className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
