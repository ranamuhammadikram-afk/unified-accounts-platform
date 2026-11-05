import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { PageHead } from "../components/ui.jsx";
import { humanize, niceDateTime } from "../format.js";

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
    <>
      <PageHead eyebrow={business.name} title="Audit trail" sub="Every create, update and delete in this business, newest first. Click a line to see what changed." />
      {error && <div className="error-msg">{error}</div>}
      <div className="card flush">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty">No activity recorded yet.</div>
        ) : (
          <ul className="activity">
            {entries.map((e) => (
              <li
                key={e.id}
                className={e.changes ? "clickable" : ""}
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                <span className={`bullet ${e.action}`} />
                <span className="what">
                  <strong>{humanize(e.action)}</strong> {humanize(e.entity_type)} #{e.entity_id} by {e.performed_by || "system"}
                </span>
                <span className="when">{niceDateTime(e.created_at)}</span>
                {expanded === e.id && e.changes && <pre className="changes">{JSON.stringify(e.changes, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
