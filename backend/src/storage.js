const http = require("http");
const https = require("https");

/**
 * Invoice file storage in Oracle Cloud Object Storage.
 *
 * Uses a read/write Pre-Authenticated Request (PAR) limited to the invoices folder of the
 * shared backup bucket, e.g. erp-backups/unified-accounts-platform/invoices/. The PAR URL is a
 * secret: it lives only in the OCI_INVOICE_PAR_URL environment variable, is never logged and
 * never sent to the browser — files are always uploaded and downloaded through this server,
 * after the user's access to the business has been checked.
 */

const DEFAULT_PREFIX = "unified-accounts-platform/invoices/";

function cleanEnv(name) {
  const raw = process.env[name];
  if (!raw) return raw;
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

function invoicePrefix() {
  let prefix = cleanEnv("OCI_INVOICE_PREFIX") || DEFAULT_PREFIX;
  prefix = prefix.replace(/^\/+/, "");
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function isConfigured() {
  const url = cleanEnv("OCI_INVOICE_PAR_URL");
  // An Oracle Object Storage PAR URL (or a local stand-in used for testing on this machine).
  return Boolean(
    url &&
      (/^https:\/\/objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/p\/.+\/b\/[^/]+\/o\//.test(url) ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/p\/.+\/b\/[^/]+\/o\//.test(url))
  );
}

/** Full object URL for `objectName` (which starts with the invoice prefix). Works whether the
 *  PAR URL ends in ".../o/" or already includes the prefix (".../o/unified-accounts-platform/invoices/"). */
function objectUrl(objectName) {
  const par = cleanEnv("OCI_INVOICE_PAR_URL");
  const base = par.endsWith("/") ? par : `${par}/`;
  const prefix = invoicePrefix();
  const encodedPrefix = prefix.split("/").map(encodeURIComponent).join("/");
  let rest = objectName;
  if (base.endsWith(`/o/${prefix}`) || base.endsWith(`/o/${encodedPrefix}`)) rest = objectName.slice(prefix.length);
  return base + rest.split("/").map(encodeURIComponent).join("/");
}

function send(method, url, { body, contentType } = {}) {
  const u = new URL(url);
  const client = u.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) {
      headers["Content-Type"] = contentType || "application/octet-stream";
      headers["Content-Length"] = body.length;
    }
    const req = client.request(u, { method, headers }, (res) => resolve(res));
    req.on("error", (err) => reject(new Error(`Oracle storage request failed: ${err.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function putFile(objectName, buffer, contentType) {
  const res = await send("PUT", objectUrl(objectName), { body: buffer, contentType });
  let data = "";
  res.setEncoding("utf8");
  for await (const chunk of res) data += chunk;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    // OCI's error body never contains the PAR token.
    throw new Error(`Oracle storage upload failed (HTTP ${res.statusCode}): ${data.slice(0, 300)}`);
  }
}

/** Returns the Oracle response stream for the object (caller pipes it to the client). */
async function getFile(objectName) {
  const res = await send("GET", objectUrl(objectName));
  if (res.statusCode < 200 || res.statusCode >= 300) {
    res.resume();
    const err = new Error(`Oracle storage download failed (HTTP ${res.statusCode}).`);
    err.status = res.statusCode === 404 ? 404 : 502;
    throw err;
  }
  return res;
}

module.exports = { isConfigured, invoicePrefix, putFile, getFile };
