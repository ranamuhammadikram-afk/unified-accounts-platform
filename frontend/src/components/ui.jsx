import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { fmt, initials, humanize } from "../format.js";

/* ---------- Icons (thin-line, 24px grid) ---------- */
const paths = {
  entry: "M12 5v14M5 12h14",
  daily: "M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
  monthly: "M4 19h16M7 16V10M12 16V6M17 16v-4",
  records: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74",
  audit: "M12 8v4l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z",
  shield: "M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3l1-1v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7Zm1.5 2.5h.01",
  logout: "M15 17l5-5-5-5M20 12H9M12 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7",
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5",
  swap: "M7 7h13l-3-3M17 17H4l3 3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  alert: "M12 9v4M12 17h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5 10 17 19 7",
  chevron: "M3 4.5 6 7.5 9 4.5",
};

export function Icon({ name, ...rest }) {
  if (name === "chevron") {
    return (
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
        <path d={paths.chevron} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

/* ---------- Brand ---------- */
export function Brand({ context }) {
  return (
    <div className="brand">
      <div className="brand-mark">U</div>
      <div className="brand-text">
        <span className="brand-name">Unified Accounts</span>
        {context && <span className="brand-context">{context}</span>}
      </div>
    </div>
  );
}

/* ---------- User menu ---------- */
function UserMenu() {
  const { user, businesses, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const name = user.full_name || user.username;
  const role = user.is_super_admin ? "Owner" : "Member";
  const shown = businesses.slice(0, 8);

  return (
    <div className="usermenu" ref={ref}>
      <button
        type="button"
        className="usermenu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen(!open)}
      >
        <span className="avatar">{initials(name)}</span>
        <span className="usermenu-who">
          <strong>{name}</strong>
          <span>{role}</span>
        </span>
        <Icon name="chevron" className="chev" />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          {user.is_super_admin && (
            <Link to="/admin" role="menuitem">
              <Icon name="home" width="16" height="16" /> Overview
            </Link>
          )}
          {shown.length > 0 && (user.is_super_admin || businesses.length > 1) && (
            <>
              <div className="menu-label">Businesses</div>
              {shown.map((b) => (
                <Link key={b.id} to={`/b/${b.slug}/entry`} role="menuitem">
                  <span className="dot sales" style={{ opacity: b.is_active === false ? 0.3 : 1 }} /> {b.name}
                </Link>
              ))}
              <hr />
            </>
          )}
          <Link to="/security" role="menuitem">
            <Icon name="shield" width="16" height="16" /> Security
          </Link>
          <Link to="/change-password" role="menuitem">
            <Icon name="key" width="16" height="16" /> Change password
          </Link>
          <hr />
          <button type="button" role="menuitem" onClick={logout}>
            <Icon name="logout" width="16" height="16" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Top bar ---------- */
export function TopBar({ context, children }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" aria-label="Home">
          <Brand context={context} />
        </Link>
        <nav className="topnav">{children}</nav>
        <UserMenu />
      </div>
    </header>
  );
}

export function TopLink({ to, children, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
      {children}
    </NavLink>
  );
}

/* ---------- Page pieces ---------- */
export function PageHead({ eyebrow, title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Figure({ label, value, currency, dot, keyFigure, sub }) {
  const n = Number(value || 0);
  return (
    <div className={`figure${keyFigure ? " key" : ""}${keyFigure && n < 0 ? " neg" : ""}`}>
      <div className="label">
        {dot && <span className={`dot ${dot}`} />}
        {label}
      </div>
      <div className="value" title={`${currency || ""} ${fmt(n)}`.trim()}>
        {currency && <span className="cur">{currency}</span>}
        {fmt(n)}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export const TYPE_LABEL = { sales: "Sales", expense: "Expense", fixed_cost: "Fixed cost", salary: "Salary" };

export function TypeTag({ type, label }) {
  return (
    <span className="tag">
      <span className={`dot ${type}`} />
      {label || TYPE_LABEL[type] || humanize(type)}
    </span>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
