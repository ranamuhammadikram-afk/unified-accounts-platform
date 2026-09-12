import React from "react";
import { NavLink, Outlet, useParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function BusinessLayout() {
  const { slug } = useParams();
  const { user, businesses, loadingBusinesses, logout } = useAuth();

  if (loadingBusinesses && businesses.length === 0) {
    return <div className="page-loading">Loading…</div>;
  }

  const business = businesses.find((b) => b.slug === slug);
  if (!business) {
    return (
      <div className="page-loading">
        You don't have access to that business. <Link to="/">Go back</Link>
      </div>
    );
  }

  const role = user.is_super_admin ? "super_admin" : business.role;
  const canManage = role === "business_admin" || role === "super_admin";
  const tabClass = ({ isActive }) => (isActive ? "active" : "");

  return (
    <>
      <header className="appbar">
        <div>
          <h1>{business.name}</h1>
          <div className="sub">
            {business.currency || "SAR"} · your role: {String(role).replace("_", " ")}
          </div>
        </div>
        <div className="right">
          {user.is_super_admin && (
            <Link className="btnlike" to="/admin">
              Admin dashboard
            </Link>
          )}
          {businesses.length > 1 && (
            <Link className="btnlike" to="/choose-business">
              Switch business
            </Link>
          )}
          <span className="who">{user.full_name || user.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <nav className="tabs">
        <NavLink to="entry" className={tabClass}>
          Entry
        </NavLink>
        <NavLink to="daily" className={tabClass}>
          Daily
        </NavLink>
        <NavLink to="monthly" className={tabClass}>
          Monthly
        </NavLink>
        <NavLink to="records" className={tabClass}>
          Records
        </NavLink>
        {canManage && (
          <NavLink to="users" className={tabClass}>
            Users
          </NavLink>
        )}
        {canManage && (
          <NavLink to="audit" className={tabClass}>
            Audit
          </NavLink>
        )}
      </nav>
      <main>
        <Outlet context={{ business, role, canManage }} />
      </main>
    </>
  );
}
