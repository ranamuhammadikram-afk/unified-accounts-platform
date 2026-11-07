import React from "react";
import { NavLink, Outlet, useParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { TopBar, TopLink, Icon } from "./ui.jsx";

export default function BusinessLayout() {
  const { slug } = useParams();
  const { user, businesses, loadingBusinesses } = useAuth();

  if (loadingBusinesses && businesses.length === 0) {
    return <div className="page-loading">Loading…</div>;
  }

  const business = businesses.find((b) => b.slug === slug);
  if (!business) {
    return (
      <div className="page-loading">
        You don't have access to that business.{" "}
        <Link className="link" to="/">
          Go back
        </Link>
      </div>
    );
  }

  const role = user.is_super_admin ? "super_admin" : business.role;
  const canManage = role === "business_admin" || role === "super_admin";
  const tabClass = ({ isActive }) => (isActive ? "active" : "");

  return (
    <>
      <TopBar context={business.name} slug={business.slug}>
        {user.is_super_admin && <TopLink to="/admin">Overview</TopLink>}
        {!user.is_super_admin && businesses.length > 1 && <TopLink to="/choose-business">Switch business</TopLink>}
      </TopBar>
      <nav className="subnav" aria-label={`${business.name} sections`}>
        <div className="subnav-inner">
          <NavLink to="entry" className={tabClass}>
            <Icon name="entry" /> Entry
          </NavLink>
          <NavLink to="daily" className={tabClass}>
            <Icon name="daily" /> Daily
          </NavLink>
          <NavLink to="monthly" className={tabClass}>
            <Icon name="monthly" /> Monthly
          </NavLink>
          <NavLink to="records" className={tabClass}>
            <Icon name="records" /> Records
          </NavLink>
          {canManage && (
            <NavLink to="users" className={tabClass}>
              <Icon name="users" /> Users
            </NavLink>
          )}
          {canManage && (
            <NavLink to="audit" className={tabClass}>
              <Icon name="audit" /> Audit
            </NavLink>
          )}
        </div>
      </nav>
      <main>
        <Outlet context={{ business, role, canManage }} />
      </main>
    </>
  );
}
