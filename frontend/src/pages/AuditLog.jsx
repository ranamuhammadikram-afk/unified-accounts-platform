import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";

function describe(entry) {
  const action = entry.action.replace("_", " ");
  const entity = entry.entity_type.replace(/_/g, " ");
  return `${action} ${entity} #${entry.entity_id}`;
}

export default function AuditLog() {
  const { business } = useOutletContext();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/businesses/${business.id}/audit`);
      setEntries(res.entries);
    } catch (err) {
      setError(err.message || "Could not load audit trail.");
    } finally {
      setLoading(false);
    }
  }, [business.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card">
      <h2>Audit trail — {business.name}</h2>
      <p className="hint" style={{ marginTop: -8 }}>
        Every create, update, and delete performed in this business, most recent first.
      </p>
      {error && <div className="error-msg">{error}</div>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty">No activity recorded yet.</div>
      ) : (
        <div className="stack">
          {entries.map((e) => (
            <div className="userRow" key={e.id} style={{ alignItems: "flex-start", cursor: "pointer" }} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
              <div style={{ width: "100%" }}>
                <div className="uname">
                  {describe(e)} <span className="muted">by {e.performed_by || "system"}</span>
                </div>
                <div className="hint">{new Date(e.created_at).toLocaleString()}</div>
                {expanded === e.id && e.changes && (
                  <pre
                    style={{
                      background: "#fafbfc",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 10,
                      marginTop: 8,
                      fontSize: 11.5,
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(e.changes, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
