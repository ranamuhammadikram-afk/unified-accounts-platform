import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login, completeMfa } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canResetByEmail, setCanResetByEmail] = useState(false);

  useEffect(() => {
    api
      .get("/api/auth/options")
      .then((o) => setCanResetByEmail(Boolean(o.password_reset_by_email)))
      .catch(() => setCanResetByEmail(false));
  }, []);

  async function handlePassword(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await login(username.trim(), password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        setCode("");
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await completeMfa(mfaToken, code.trim());
      if (data.used_backup_code) {
        window.alert(
          `You signed in with a backup code. ${data.backup_codes_remaining} backup code(s) left. ` +
            "If your phone is lost, set up two-factor authentication again from the Security page."
        );
      }
      navigate("/", { replace: true });
    } catch (err) {
      if (err.status === 401 && /expired|session/i.test(err.message)) {
        setMfaToken(null);
        setPassword("");
      }
      setError(err.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setMfaToken(null);
    setPassword("");
    setCode("");
    setError("");
  }

  if (mfaToken) {
    return (
      <div className="centered-page">
        <form className="card" style={{ maxWidth: 380, width: "100%" }} onSubmit={handleCode}>
          <h2>Two-factor authentication</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 18 }}>
            Enter the 6-digit code from your authenticator app. If you don't have your phone, enter one of your
            backup codes instead.
          </p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              type="text"
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 8 }}>
            {busy ? "Checking…" : "Verify and sign in"}
          </button>
          <button type="button" className="btn ghost" onClick={backToPassword} style={{ width: "100%", marginTop: 8 }}>
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="centered-page">
      <form className="card" style={{ maxWidth: 380, width: "100%" }} onSubmit={handlePassword}>
        <h2>Unified Accounts Platform</h2>
        <p className="hint" style={{ marginTop: -8, marginBottom: 18 }}>
          Sign in to enter and review your business accounts.
        </p>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 8 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {canResetByEmail && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <Link to="/forgot-password" className="link">
              Forgot password?
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
