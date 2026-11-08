import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Icon } from "./ui.jsx";

// Purchase invoices (photos or PDFs) attached to expenses and fixed costs.

export const MAX_INVOICES = 5;
const ACCEPT = "image/*,application/pdf";

let statusPromise = null;
/** Whether the server has invoice storage set up (checked once per page load). */
export function useInvoiceStorage() {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    if (!statusPromise) {
      statusPromise = api
        .get("/api/storage/status")
        .then((r) => Boolean(r.invoices_enabled))
        .catch(() => {
          statusPromise = null;
          return false;
        });
    }
    let alive = true;
    statusPromise.then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** Large phone photos are scaled down (max 2000 px, JPEG) before upload so they stay readable but small. */
async function prepareFile(file) {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return file;
  if (file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadInvoice(businessId, transactionId, file) {
  const ready = await prepareFile(file);
  if (ready.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB.`);
  const res = await api.upload(
    `/api/businesses/${businessId}/attachments/entry/${transactionId}?name=${encodeURIComponent(ready.name)}`,
    ready
  );
  return res.attachment;
}

function sizeLabel(bytes) {
  if (!bytes && bytes !== 0) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** File chooser used on the entry and edit forms. `files` is an array of File objects. */
export function InvoicePicker({ files, onChange, disabled, existingCount = 0 }) {
  const input = useRef(null);
  const room = MAX_INVOICES - existingCount - files.length;

  function add(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    const ok = picked.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    onChange([...files, ...ok].slice(0, Math.max(0, MAX_INVOICES - existingCount)));
  }

  return (
    <div className="invoice-picker">
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Icon name="clip" width="15" height="15" />
              <span className="file-name">{f.name}</span>
              <span className="muted">{sizeLabel(f.size)}</span>
              <button type="button" className="link" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {room > 0 && (
        <button type="button" className="btn secondary" disabled={disabled} onClick={() => input.current && input.current.click()}>
          <Icon name="camera" /> {files.length || existingCount ? "Add another invoice" : "Attach purchase invoice"}
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={add} />
      <div className="hint">Photo or PDF, up to 10 MB each, {MAX_INVOICES} per entry. On a phone you can take a photo directly.</div>
    </div>
  );
}

/** Small paperclip buttons that open an entry's invoices. */
export function InvoiceLinks({ businessId, attachments, compact }) {
  const [open, setOpen] = useState(null);
  if (!attachments || attachments.length === 0) return compact ? null : <span className="muted">—</span>;
  return (
    <>
      <span className="invoice-links">
        {attachments.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="clip-btn"
            title={`View invoice: ${a.file_name}`}
            aria-label={`View invoice ${i + 1}: ${a.file_name}`}
            onClick={() => setOpen(a)}
          >
            <Icon name="clip" width="14" height="14" />
            {attachments.length > 1 && <span>{i + 1}</span>}
          </button>
        ))}
      </span>
      {open && <InvoiceViewer businessId={businessId} attachment={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Shows an invoice (image or PDF) in a dialog, with a download button. */
export function InvoiceViewer({ businessId, attachment, onClose, onRemove }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let objectUrl = null;
    let alive = true;
    api
      .blob(`/api/businesses/${businessId}/attachments/${attachment.id}`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (alive) setUrl(objectUrl);
      })
      .catch((e) => alive && setError(e.message || "Could not open the invoice."));
    const esc = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", esc);
    return () => {
      alive = false;
      document.removeEventListener("keydown", esc);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [businessId, attachment.id]);

  const isPdf = attachment.content_type === "application/pdf";
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal invoice-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${attachment.file_name}`}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" width="18" height="18" />
        </button>
        <div className="invoice-head">
          <Icon name="clip" width="16" height="16" />
          <strong>{attachment.file_name}</strong>
        </div>
        <div className="invoice-body">
          {error ? (
            <div className="error-msg">{error}</div>
          ) : !url ? (
            <div className="page-loading">Loading…</div>
          ) : isPdf ? (
            <iframe title={attachment.file_name} src={url} />
          ) : (
            <img src={url} alt={attachment.file_name} />
          )}
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          {onRemove && (
            <button type="button" className="btn danger" onClick={() => onRemove(attachment)}>
              Remove
            </button>
          )}
          {url && (
            <a className="btn secondary" href={url} download={attachment.file_name}>
              <Icon name="download" /> Download
            </a>
          )}
          {url && isPdf && (
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Manage the invoices of an existing entry (used in the Records edit form). */
export function InvoiceManager({ businessId, transactionId, attachments, onChanged }) {
  const enabled = useInvoiceStorage();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [viewing, setViewing] = useState(null);

  async function uploadAll() {
    setBusy(true);
    setMsg("");
    try {
      for (const f of files) await uploadInvoice(businessId, transactionId, f);
      setFiles([]);
      onChanged && onChanged();
    } catch (e) {
      setMsg(e.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(a) {
    if (!window.confirm(`Remove the invoice "${a.file_name}" from this entry?`)) return;
    try {
      await api.del(`/api/businesses/${businessId}/attachments/${a.id}`);
      setViewing(null);
      onChanged && onChanged();
    } catch (e) {
      setMsg(e.message || "Could not remove the invoice.");
    }
  }

  return (
    <div className="field">
      <label>Purchase invoices</label>
      {attachments.length > 0 && (
        <ul className="file-list">
          {attachments.map((a) => (
            <li key={a.id}>
              <Icon name="clip" width="15" height="15" />
              <button type="button" className="link file-name" onClick={() => setViewing(a)}>
                {a.file_name}
              </button>
              <span className="muted">{sizeLabel(a.size_bytes)}</span>
              <button type="button" className="link" onClick={() => remove(a)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {enabled === false ? (
        <div className="hint">Invoice upload will be available once invoice storage is set up on the server.</div>
      ) : (
        <>
          <InvoicePicker files={files} onChange={setFiles} disabled={busy || !enabled} existingCount={attachments.length} />
          {files.length > 0 && (
            <button type="button" className="btn" style={{ marginTop: 10 }} disabled={busy} onClick={uploadAll}>
              {busy ? "Uploading…" : `Upload ${files.length === 1 ? "invoice" : `${files.length} invoices`}`}
            </button>
          )}
        </>
      )}
      {msg && <div className="error-msg">{msg}</div>}
      {viewing && (
        <InvoiceViewer businessId={businessId} attachment={viewing} onClose={() => setViewing(null)} onRemove={remove} />
      )}
    </div>
  );
}

const CATEGORY_LABEL = {
  supplies: "Supplies",
  utilities: "Utilities",
  maintenance: "Maintenance",
  transport: "Transport",
  marketing: "Marketing",
  other: "Other",
  rent: "Rent",
};
export const PAID_BY_LABEL = { cash: "Cash", card: "Card", bank: "Bank transfer" };

/** Plain-text pieces describing an entry: what it was and, for purchases, who/which invoice/how paid. */
export function entryDetailText(e) {
  const purchase = e.type === "expense" || e.type === "fixed_cost";
  const main =
    e.type === "sales"
      ? PAID_BY_LABEL[e.payment_method] || ""
      : CATEGORY_LABEL[e.expense_category || e.fixed_cost_type] || "";
  const sub = purchase
    ? [e.supplier_name, e.invoice_number && `Inv ${e.invoice_number}`, PAID_BY_LABEL[e.payment_method]].filter(Boolean).join(" · ")
    : "";
  return { main, sub };
}

export function EntryDetail({ entry }) {
  const { main, sub } = entryDetailText(entry);
  if (!main && !sub) return <span className="muted">—</span>;
  return (
    <span className="entry-detail">
      <span>{main || "—"}</span>
      {sub && <span className="detail-sub">{sub}</span>}
    </span>
  );
}
