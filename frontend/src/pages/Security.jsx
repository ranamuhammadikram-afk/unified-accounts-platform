import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext.jsx";

function BackupCodes({ codes, username, onDone }) {
  const text =
    `Unified Accounts Platform — 2FA backup codes for ${username}\n` +
    `Created ${new Date().toLocaleString()}\n\n` +
    codes.join("\n") +
    "\n\nEach code works once. Keep them somewhere safe, away from your phone.\n";

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-codes-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="temp-pass-box">
      <strong>Your backup codes</strong>
      <p style={{ margin: "6px 0 10px" }}>
        Save these now — they won't be shown again. If your phone is lost, each code can be used once to sign in
        instead of the authenticator code.
      </p>
      <ol className="code-list">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="row-actions">
        <button type="button" className="btn secondary small" onClick={download}>
          Download as text file
        </button>
        <button type="button" className="btn secondary small" onClick={() => navigator.clipboard.writeText(text)}>
          Copy
        </button>
        <button type="button" className="btn small" onClick={onDone}>
          I've saved them
        </button>
      </div>
    </div>
  );
}

export default function Security() {
  const { user, updateUser, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");

  // two-factor state
  const [mode, setMode] = useState(null); // null | "setup-password" | "setup-scan" | "disable" | "regen"
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [newCodes, setNewCodes] = useState(null);
  const [tfError, setTfError] = useState("");
  const [tfBusy, setTfBusy] = useState(false);

  // recovery email state
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [emError, setEmError] = useState("");
  const [emMessage, setEmMessage] = useState("");
  const [emBusy, setEmBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get("/api/auth/security"));
    } catch (err) {
      setLoadError(err.message || "Could not load security settings.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetTwoFactorForm() {
    setMode(null);
    setPassword("");
    setCode("");
    setSetup(null);
    setTfError("");
  }

  async function run(fn) {
    setTfError("");
    setTfBusy(true);
    try {
      await fn();
    } catch (err) {
      setTfError(err.message || "Something went wrong.");
    } finally {
      setTfBusy(false);
    }
  }

  const startSetup = (e) =>
    (e.preventDefault(),
    run(async () => {
      const res = await api.post("/api/auth/2fa/setup", { password });
      setSetup(res);
      setPassword("");
      setMode("setup-scan");
    }));

  const confirmSetup = (e) =>
    (e.preventDefault(),
    run(async () => {
      const res = await api.post("/api/auth/2fa/enable", { code: code.trim() });
      setNewCodes(res.backup_codes);
      resetTwoFactorForm();
      updateUser({ totp_enabled: true });
      load();
    }));

  const disable = (e) =>
    (e.preventDefault(),
    run(async () => {
      if (!window.confirm("Turn off two-factor authentication? Your account will be protected by the password only.")) return;
      await api.post("/api/auth/2fa/disable", { password, code: code.trim() });
      resetTwoFactorForm();
      setNewCodes(null);
      updateUser({ totp_enabled: false });
      load();
    }));

  const regenerate = (e) =>
    (e.preventDefault(),
    run(async () => {
      const res = await api.post("/api/auth/2fa/backup-codes", { password, code: code.trim() });
      setNewCodes(res.backup_codes);
      resetTwoFactorForm();
      load();
    }));

  async function emailRun(fn) {
    setEmError("");
    setEmMessage("");
    setEmBusy(true);
    try {
      await fn();
    } catch (err) {
      setEmError(err.message || "Something went wrong.");
    } finally {
      setEmBusy(false);
    }
  }

  const sendCode = (e) =>
    (e.preventDefault(),
    emailRun(async () => {
      const res = await api.post("/api/auth/recovery-email", { email: email.trim(), password: emailPassword });
      setEmailPassword("");
      setEmail("");
      setEmMessage(`A 6-digit code was sent to ${res.pending_email}. Enter it below to confirm the address.`);
      load();
    }));

  const confirmEmail = (e) =>
    (e.preventDefault(),
    emailRun(async () => {
      await api.post("/api/auth/recovery-email/verify", { code: verifyCode.trim() });
      setVerifyCode("");
      setEmMessage("Recovery email confirmed.");
      load();
    }));

  const removeEmail = () =>
    emailRun(async () => {
      const pw = window.prompt("Enter your password to remove the recovery email:");
      if (!pw) return;
      await api.post("/api/auth/recovery-email/remove", { password: pw });
      setEmMessage("Recovery email removed.");
      load();
    });

  const home = user.is_super_admin ? "/admin" : "/";

  return (
    <>
      <header className="appbar">
        <div>
          <h1>Account security</h1>
          <div className="sub">{user.full_name || user.username}</div>
        </div>
        <div className="right">
          <Link className="btnlike" to={home}>
            Back
          </Link>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main>
        {loadError && <div className="error-msg">{loadError}</div>}
        {!status && !loadError && <div className="page-loading">Loading…</div>}

        {status && (
          <>
            <div className="card">
              <h2>Two-factor authentication</h2>
              <p>
                Status:{" "}
                {status.totp_enabled ? (
                  <strong>On</strong>
                ) : (
                  <strong>Off</strong>
                )}
                {status.totp_enabled && (
                  <span className="muted"> · {status.backup_codes_remaining} backup code(s) left</span>
                )}
              </p>
              <p className="hint">
                With 2FA on, signing in needs your password plus a 6-digit code from an authenticator app on your phone
                such as Google Authenticator.
              </p>

              {newCodes && <BackupCodes codes={newCodes} username={user.username} onDone={() => setNewCodes(null)} />}

              {!status.totp_enabled && mode === null && !newCodes && (
                <button className="btn" onClick={() => setMode("setup-password")}>
                  Turn on two-factor authentication
                </button>
              )}

              {mode === "setup-password" && (
                <form onSubmit={startSetup} style={{ maxWidth: 360 }}>
                  <div className="field">
                    <label htmlFor="tf-pw">Your password</label>
                    <input id="tf-pw" type="password" autoFocus autoComplete="current-password" value={password}
                      onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                  {tfError && <div className="error-msg">{tfError}</div>}
                  <div className="row-actions">
                    <button className="btn" type="submit" disabled={tfBusy}>Continue</button>
                    <button className="btn ghost" type="button" onClick={resetTwoFactorForm}>Cancel</button>
                  </div>
                </form>
              )}

              {mode === "setup-scan" && setup && (
                <form onSubmit={confirmSetup}>
                  <p>1. In your authenticator app, add an account and scan this QR code:</p>
                  <img src={setup.qr_data_url} alt="QR code for the authenticator app" width="200" height="200" className="qr" />
                  <p className="hint">
                    Can't scan? Enter this key manually instead: <code className="key">{setup.secret}</code>
                  </p>
                  <p>2. Enter the 6-digit code the app shows:</p>
                  <div className="field" style={{ maxWidth: 200 }}>
                    <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                      onChange={(e) => setCode(e.target.value)} required />
                  </div>
                  {tfError && <div className="error-msg">{tfError}</div>}
                  <div className="row-actions">
                    <button className="btn" type="submit" disabled={tfBusy}>Turn on</button>
                    <button className="btn ghost" type="button" onClick={resetTwoFactorForm}>Cancel</button>
                  </div>
                </form>
              )}

              {status.totp_enabled && mode === null && !newCodes && (
                <div className="row-actions">
                  <button className="btn secondary" onClick={() => setMode("regen")}>Get new backup codes</button>
                  <button className="btn ghost" onClick={() => setMode("disable")}>Turn off</button>
                </div>
              )}

              {(mode === "disable" || mode === "regen") && (
                <form onSubmit={mode === "disable" ? disable : regenerate} style={{ maxWidth: 360 }}>
                  <p className="hint">
                    {mode === "disable"
                      ? "To turn off 2FA, enter your password and a code from your authenticator app (or a backup code)."
                      : "New codes replace all the old ones. Enter your password and a code from your authenticator app."}
                  </p>
                  <div className="field">
                    <label htmlFor="tf-pw2">Your password</label>
                    <input id="tf-pw2" type="password" autoFocus autoComplete="current-password" value={password}
                      onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="tf-code">Authenticator code</label>
                    <input id="tf-code" type="text" autoComplete="one-time-code" maxLength={12} value={code}
                      onChange={(e) => setCode(e.target.value)} required />
                  </div>
                  {tfError && <div className="error-msg">{tfError}</div>}
                  <div className="row-actions">
                    <button className={mode === "disable" ? "btn danger" : "btn"} type="submit" disabled={tfBusy}>
                      {mode === "disable" ? "Turn off 2FA" : "Create new codes"}
                    </button>
                    <button className="btn ghost" type="button" onClick={resetTwoFactorForm}>Cancel</button>
                  </div>
                </form>
              )}
            </div>

            {/* Shown only when the server has an email sender set up (BREVO_API_KEY or SMTP_*). */}
            {(status.email_sending_configured || status.recovery_email) && (
            <div className="card">
              <h2>Recovery email</h2>
              <p className="hint" style={{ marginTop: -6 }}>
                A second email address, used to reset your password if you forget it, and to alert you about
                important changes to your account.
              </p>
              <p>
                Current:{" "}
                {status.recovery_email && status.recovery_email_verified ? (
                  <>
                    <strong>{status.recovery_email}</strong> <span className="muted">(confirmed)</span>
                  </>
                ) : (
                  <span className="muted">none</span>
                )}
              </p>

              {!status.email_sending_configured && (
                <p className="error-msg">
                  Email sending isn't set up on the server yet, so a recovery email can't be added. The server owner
                  needs to add the email settings first.
                </p>
              )}

              {status.recovery_email_pending && (
                <form onSubmit={confirmEmail} style={{ maxWidth: 360 }}>
                  <p>
                    Waiting for confirmation: <strong>{status.recovery_email_pending}</strong>
                  </p>
                  <div className="field">
                    <label htmlFor="em-code">6-digit code from the email</label>
                    <input id="em-code" type="text" inputMode="numeric" maxLength={6} value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)} required />
                  </div>
                  <button className="btn" type="submit" disabled={emBusy}>Confirm</button>
                </form>
              )}

              {status.email_sending_configured && (
                <form onSubmit={sendCode} style={{ maxWidth: 360, marginTop: 14 }}>
                  <div className="field">
                    <label htmlFor="em-new">{status.recovery_email ? "Change to" : "Email address"}</label>
                    <input id="em-new" type="email" autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="em-pw">Your password</label>
                    <input id="em-pw" type="password" autoComplete="current-password" value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)} required />
                  </div>
                  <div className="row-actions">
                    <button className="btn secondary" type="submit" disabled={emBusy}>Send confirmation code</button>
                    {status.recovery_email && (
                      <button className="btn ghost" type="button" onClick={removeEmail} disabled={emBusy}>
                        Remove recovery email
                      </button>
                    )}
                  </div>
                </form>
              )}
              {emError && <div className="error-msg">{emError}</div>}
              {emMessage && <div className="success-msg">{emMessage}</div>}
            </div>
            )}

            <div className="card">
              <h2>Password</h2>
              <Link className="btn secondary" to="/change-password">Change password</Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
