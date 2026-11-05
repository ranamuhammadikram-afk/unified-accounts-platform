import React from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";

import Login from "./pages/Login.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Security from "./pages/Security.jsx";
import SuperAdminDashboard from "./pages/SuperAdminDashboard.jsx";
import BusinessLayout from "./components/BusinessLayout.jsx";
import EntryForm from "./pages/EntryForm.jsx";
import DailyReport from "./pages/DailyReport.jsx";
import MonthlyReport from "./pages/MonthlyReport.jsx";
import Records from "./pages/Records.jsx";
import BusinessUsers from "./pages/BusinessUsers.jsx";
import AuditLog from "./pages/AuditLog.jsx";

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

function RootRedirect() {
  const { user, businesses, loadingBusinesses } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (user.is_super_admin) return <Navigate to="/admin" replace />;
  if (loadingBusinesses) return <div className="page-loading">Loading…</div>;
  if (businesses.length === 1) return <Navigate to={`/b/${businesses[0].slug}/entry`} replace />;
  if (businesses.length > 1) return <Navigate to="/choose-business" replace />;
  return <div className="page-loading">Your account doesn't have access to any business yet. Ask your admin to grant you access.</div>;
}

function ChooseBusiness() {
  const { businesses, logout } = useAuth();
  return (
    <div className="centered-page">
      <div className="card" style={{ maxWidth: 460, width: "100%" }}>
        <div className="eyebrow">Welcome</div>
        <h2>Choose a business</h2>
        <p className="hint" style={{ marginBottom: 22 }}>Select which business's accounts you want to work on.</p>
        <div className="stack">
          {businesses.map((b) => (
            <Link key={b.id} className="choice" to={`/b/${b.slug}/entry`}>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="monogram">{b.name.slice(0, 1).toUpperCase()}</span>
                <strong>{b.name}</strong>
              </span>
              <span className="tag plain muted">{String(b.role || "").replace(/_/g, " ")}</span>
            </Link>
          ))}
        </div>
        <div className="auth-links">
          <button type="button" className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/security"
        element={
          <RequireAuth>
            <Security />
          </RequireAuth>
        }
      />
      <Route
        path="/change-password"
        element={
          <RequireAuthIgnoreForcedChange>
            <ChangePassword />
          </RequireAuthIgnoreForcedChange>
        }
      />
      <Route path="/" element={<RootRedirect />} />
      <Route
        path="/choose-business"
        element={
          <RequireAuth>
            <ChooseBusiness />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <SuperAdminDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/b/:slug"
        element={
          <RequireAuth>
            <BusinessLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="entry" replace />} />
        <Route path="entry" element={<EntryForm />} />
        <Route path="daily" element={<DailyReport />} />
        <Route path="monthly" element={<MonthlyReport />} />
        <Route path="records" element={<Records />} />
        <Route path="users" element={<BusinessUsers />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuthIgnoreForcedChange({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
