import { useEffect } from "react";
import { businessIcon, MAIN_ICON } from "./appIcons.js";

// Points the page's favicon, home-screen icon, app name and web-app manifest at the business
// being viewed, so "Add to Home Screen" from a business page creates that business's own icon
// that opens straight to it. Outside a business the main "Unified Accounts" icon is used.
function setHref(id, href) {
  const el = document.getElementById(id);
  if (el && el.getAttribute("href") !== href) el.setAttribute("href", href);
}

export function applyAppIdentity(slug) {
  const icon = slug ? businessIcon(slug) : MAIN_ICON;
  setHref("app-favicon", `/icons/${icon.key}.svg`);
  setHref("app-touch-icon", `/icons/${icon.key}-180.png`);
  setHref("app-manifest", `/manifest-${icon.key}.webmanifest`);
  const title = document.getElementById("app-title");
  if (title) title.setAttribute("content", icon.short);
  return icon;
}

export function useAppIdentity(slug) {
  useEffect(() => {
    applyAppIdentity(slug);
    return () => applyAppIdentity(null);
  }, [slug]);
}

// Chrome and Edge offer their own install prompt; keep it so the "Add to Home Screen"
// menu item can show it. Safari has no prompt, so the app shows short instructions instead.
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  p.prompt();
  const choice = await p.userChoice.catch(() => null);
  return Boolean(choice && choice.outcome === "accepted");
}

export function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true
  );
}

export function deviceKind() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}
