import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import AuthLayout from "../components/AuthLayout.jsx";

export default function ForgotPassword() {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await api.post("/api/auth/forgot-password", { username: username.trim() });
      setMessage(res.message);
    } catch (err) {
      setError(err.message || "Could not send the reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit}>
        <div className="eyebrow">Account recovery</div>
        <h2>Forgot password</h2>
        <p className="lede">Enter your username. A reset link will be sent to the recovery email confirmed on your account.</p>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        {message && <div className="success-msg">{message}</div>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <div className="auth-links">
          <Link to="/login" className="link">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
