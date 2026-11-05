import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import AuthLayout from "../components/AuthLayout.jsx";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
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
      await api.post("/api/auth/reset-password", { token: token.trim(), newPassword });
      setDone(true);
    } catch (err) {
      setError(err.message || "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="eyebrow">All set</div>
        <h2>Password changed</h2>
        <p className="lede">Your new password is saved. Sign in with it now.</p>
        <Link className="btn" to="/login">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  const fromLink = Boolean(params.get("token"));

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">Account recovery</div>
        <h2>Reset password</h2>
        <p className="lede">Choose a new password for your account.</p>
        {!fromLink && (
          <div className="field">
            <label htmlFor="token">Reset code from the email</label>
            <input id="token" type="text" value={token} onChange={(e) => setToken(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            autoFocus
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
        <div className="auth-links">
          <Link to="/forgot-password" className="link">
            Request a new link
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
