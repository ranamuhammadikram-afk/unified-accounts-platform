/**
 * Sends account-security emails (recovery-email confirmation codes, password-reset links,
 * security alerts). Two ways to send are supported, chosen by environment variables:
 *
 *  1. Brevo HTTP API  — BREVO_API_KEY + MAIL_FROM. Works on Render's free plan, which blocks
 *                       outgoing SMTP ports (25/465/587).
 *  2. SMTP            — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS + MAIL_FROM. For example
 *                       iCloud Mail (smtp.mail.me.com, port 587, Apple ID + app-specific password)
 *                       or a cPanel mailbox. Needs a host that allows outgoing SMTP.
 *
 * MAIL_FROM is the sender, e.g.  "Unified Accounts <noreply@example.com>"  or just an address.
 * If neither is configured, isMailConfigured() is false and the features that need email say so.
 */

function parseFrom(from) {
  const m = String(from || "").match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "") || undefined, email: m[2] };
  return { name: undefined, email: String(from || "").trim() };
}

function mailMode() {
  if (process.env.BREVO_API_KEY && process.env.MAIL_FROM) return "brevo";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM) return "smtp";
  return null;
}

function isMailConfigured() {
  return mailMode() !== null;
}

async function sendViaBrevo({ to, subject, text }) {
  const sender = parseFrom(process.env.MAIL_FROM);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo email send failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
}

let smtpTransport = null;
async function sendViaSmtp({ to, subject, text }) {
  if (!smtpTransport) {
    const nodemailer = require("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
    });
  }
  await smtpTransport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
}

/** Sends a plain-text email. Throws if sending fails or isn't configured. */
async function sendMail({ to, subject, text }) {
  const mode = mailMode();
  if (mode === "brevo") return sendViaBrevo({ to, subject, text });
  if (mode === "smtp") return sendViaSmtp({ to, subject, text });
  throw new Error("Email sending is not configured (set BREVO_API_KEY or SMTP_* plus MAIL_FROM).");
}

module.exports = { sendMail, isMailConfigured };
