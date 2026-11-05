import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AuthLayout from "../components/AuthLayout.jsx";

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
      <AuthLayout>
        <form onSubmit={handleCode}>
          <div className="eyebrow">Step 2 of 2</div>
          <h2>Two-factor authentication</h2>
          <p className="lede">
            Enter the 6-digit code from Google Authenticator. Without your phone, use one of your backup codes.
          </p>
          <div className="field">
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              className="code-input"
              type="text"
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={12}
              placeholder="000 000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Verify and sign in"}
          </button>
          <div className="auth-links">
            <button type="button" className="link" onClick={backToPassword}>
              Back
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={handlePassword}>
        <div className="eyebrow">Welcome back</div>
        <h2>Sign in</h2>
        <p className="lede">Enter and review the accounts for your businesses.</p>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
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
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {canResetByEmail && (
          <div className="auth-links">
            <Link to="/forgot-password" className="link">
              Forgot password?
            </Link>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
