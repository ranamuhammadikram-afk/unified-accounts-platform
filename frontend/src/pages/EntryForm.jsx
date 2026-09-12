import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api";

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

const TYPE_LABELS = {
  sales: "Sales",
  expense: "Expense (consumables)",
  fixed_cost: "Fixed cost",
  salary: "Salary",
};

export default function EntryForm() {
  const { business } = useOutletContext();
  const [type, setType] = useState("sales");
  const [occurredOn, setOccurredOn] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [fixedCostType, setFixedCostType] = useState("rent");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

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

    setBusy(true);
    try {
      await api.post(`/api/businesses/${business.id}/transactions`, payload);
      setSuccess(`${TYPE_LABELS[type]} entry of ${amount} saved.`);
      setAmount("");
      setDescription("");
    } catch (err) {
      setError(err.message || "Could not save entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h2>New entry — {business.name}</h2>
      <form onSubmit={handleSubmit}>
        <div className="grid">
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="sales">Sales</option>
              <option value="expense">Expense (consumables)</option>
              <option value="fixed_cost">Fixed cost (rent, maintenance…)</option>
              <option value="salary">Salary</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="occurred_on">Date</label>
            <input
              id="occurred_on"
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid">
          <div className="field">
            <label htmlFor="amount">Amount ({business.currency || "SAR"})</label>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          {type === "sales" && (
            <div className="field">
              <label htmlFor="payment_method">Payment method</label>
              <select id="payment_method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
              </select>
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
        </div>

        <div className="field">
          <label htmlFor="description">Description / note (optional)</label>
          <textarea
            id="description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save entry"}
        </button>
      </form>
    </div>
  );
}
