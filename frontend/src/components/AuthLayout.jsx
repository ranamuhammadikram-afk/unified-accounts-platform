import React from "react";
import { Brand } from "./ui.jsx";

// Split-screen frame for sign-in and password pages: a deep-green brand panel on the left,
// the form on warm paper on the right. On phones only the form is shown.
export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <Brand />
        <div className="auth-quote">
          <h1>
            Every business, <em>one</em> clear ledger.
          </h1>
          <p>Daily entries, monthly profit and loss, and a full audit trail — kept together and kept private.</p>
        </div>
        <div className="auth-foot">Secured with two-factor sign-in</div>
      </aside>
      <section className="auth-panel">
        <div className="auth-form">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
