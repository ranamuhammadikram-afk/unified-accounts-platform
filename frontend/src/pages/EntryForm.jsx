import React, { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";
import { PageHead, TypeTag, Icon } from "../components/ui.jsx";
import { fmt, todayStr, niceDate } from "../format.js";

const TYPES = [
  { value: "sales", label: "Sales" },
  { value: "expense", label: "Expense" },
  { value: "fixed_cost", label: "Fixed cost" },
  { value: "salary", label: "Salary" },
];

const TYPE_LABELS = {
  sales: "Sales",
  expense: "Expense",
  fixed_cost: "Fixed cost",
  salary: "Salary",
};

const TYPE_HINT = {
  sales: "Money received from customers.",
  expense: "Consumables and day-to-day purchases.",
  fixed_cost: "Rent, maintenance, utilities and other fixed costs.",
  salary: "Wages paid to staff.",
};

const EXPENSE_CATEGORY_LABELS = {
  supplies: "Supplies",
  utilities: "Utilities",
  maintenance: "Maintenance",
  transport: "Transport",
  marketing: "Marketing",
  other: "Other",
};

export default function EntryForm() {
  const { business, role } = useOutletContext();
  const currency = business.currency || "SAR";
  const [type, setType] = useState("sales");
  const [occurredOn, setOccurredOn] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [fixedCostType, setFixedCostType] = useState("rent");
  const [expenseCategory, setExpenseCategory] = useState("supplies");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(null);

  const loadDay = useCallback(async () => {
    try {
      setDay(await api.get(`/api/businesses/${business.id}/reports/daily?date=${occurredOn}`));
    } catch {
      setDay(null);
    }
  }, [business.id, occurredOn]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const payload = {
      type,
      occurred_on: occurredOn,
      amount: Number(amount),
      description: description || undefined,
    };
    if (type === "sales") payload.payment_method = paymentMethod;
    if (type === "fixed_cost") payload.fixed_cost_type = fixedCostType;
    if (type === "expense") payload.expense_category = expenseCategory;

    setBusy(true);
    try {
      await api.post(`/api/businesses/${business.id}/transactions`, payload);
      setSuccess(`${TYPE_LABELS[type]} of ${currency} ${fmt(amount)} saved.`);
      setAmount("");
      setDescription("");
      loadDay();
    } catch (err) {
      setError(err.message || "Could not save entry.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = role === "viewer";
  const t = day?.totals;
  const recent = (day?.entries || []).slice(-6).reverse();

  return (
    <>
      <PageHead eyebrow={business.name} title="New entry" sub="Record a sale or a payment. It appears in the reports straight away." />

      <div className="entry-layout">
        <form className="card" onSubmit={handleSubmit}>
          {readOnly && <div className="notice">You have view-only access to this business, so entries can't be saved.</div>}
          <div className="field">
            <label id="type-label">Type</label>
            <div className="segmented" role="radiogroup" aria-labelledby="type-label">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  className={type === t.value ? "on" : ""}
                  onClick={() => setType(t.value)}
                >
                  <span className={`dot ${t.value}`} /> {t.label}
                </button>
              ))}
            </div>
            <div className="hint">{TYPE_HINT[type]}</div>
          </div>

          <div className="field">
            <label htmlFor="amount">Amount</label>
            <div className="input-affix">
              <span className="affix">{currency}</span>
              <input
                id="amount"
                className="amount-input"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid">
            <div className="field">
              <label htmlFor="occurred_on">Date</label>
              <input id="occurred_on" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
            </div>
            {type === "sales" && (
              <div className="field">
                <label id="pm-label">Payment method</label>
                <div className="segmented two" role="radiogroup" aria-labelledby="pm-label">
                  {["cash", "card"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === m}
                      className={paymentMethod === m ? "on" : ""}
                      onClick={() => setPaymentMethod(m)}
                    >
                      {m === "cash" ? "Cash" : "Card"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {type === "fixed_cost" && (
              <div className="field">
                <label htmlFor="fixed_cost_type">Fixed cost type</label>
                <select id="fixed_cost_type" value={fixedCostType} onChange={(e) => setFixedCostType(e.target.value)}>
                  <option value="rent">Rent</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="utilities">Utilities</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
            {type === "expense" && (
              <div className="field">
                <label htmlFor="expense_category">Expense category</label>
                <select id="expense_category" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="description">
              Note <span className="muted">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={2}
              maxLength={500}
              placeholder={type === "salary" ? "e.g. October salary — Ahmed" : "What was this for?"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && <div className="error-msg">{error}</div>}
          {success && (
            <div className="success-msg" role="status">
              {success}
            </div>
          )}

          <button className="btn block" type="submit" disabled={busy || readOnly} style={{ minHeight: 46 }}>
            <Icon name="check" /> {busy ? "Saving…" : "Save entry"}
          </button>
        </form>

        <aside className="card day-panel">
          <h3>{occurredOn === todayStr() ? "Today so far" : niceDate(occurredOn)}</h3>
          <div className="day-row">
            <span>
              <span className="dot sales" /> Sales
            </span>
            <span className="num">{fmt(t?.sales)}</span>
          </div>
          <div className="day-row sub">
            <span>Cash · Card</span>
            <span className="num">
              {fmt(t?.salesCash)} · {fmt(t?.salesCard)}
            </span>
          </div>
          <div className="day-row">
            <span>
              <span className="dot expense" /> Expenses
            </span>
            <span className="num">{fmt(t?.expense)}</span>
          </div>
          <div className="day-row">
            <span>
              <span className="dot fixed" /> Fixed costs
            </span>
            <span className="num">{fmt(t?.fixedCost)}</span>
          </div>
          <div className="day-row">
            <span>
              <span className="dot salary" /> Salaries
            </span>
            <span className="num">{fmt(t?.salary)}</span>
          </div>
          <div className={`day-total${t && t.net < 0 ? " neg" : ""}`}>
            <span>Net</span>
            <span>
              <small>{currency}</small> {fmt(t?.net)}
            </span>
          </div>

          <h3 style={{ marginTop: 26 }}>Latest entries</h3>
          {recent.length === 0 ? (
            <div className="hint">Nothing recorded for this date yet.</div>
          ) : (
            <ul className="mini-list">
              {recent.map((e) => (
                <li key={e.id}>
                  <TypeTag type={e.type} />
                  <span className="num">{fmt(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
