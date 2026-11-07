// App icons: one main "Unified Accounts" icon for the owner overview, and one icon per business
// (a plate with fork and knife, since both businesses are restaurants). The same drawings are used
// for the home-screen icons (rendered to PNG at build time by scripts/make-icons.mjs) and inside the app.

export const GOLD = "#c9a66b";

// Businesses that get their own home-screen icon. `slug` must match the business's web address
// (/b/<slug>/...). Any other business uses the generic "business" icon.
export const BUSINESS_ICONS = [
  { slug: "khurais-camp", name: "Bofiyah Khurais Camp", short: "Bofiyah", bg: "#163a2f" },
  { slug: "hofuf", name: "Mataam Al Tayeba Hofuf", short: "Al Tayeba", bg: "#5b2229" },
];

export const GENERIC_BUSINESS = { key: "business", name: "Business Accounts", short: "Accounts", bg: "#163a2f" };
export const MAIN_ICON = { key: "main", name: "Unified Accounts", short: "Accounts", bg: "#163a2f" };

export function businessIcon(slug) {
  const b = BUSINESS_ICONS.find((x) => x.slug === slug);
  return b ? { ...b, key: `biz-${b.slug}` } : GENERIC_BUSINESS;
}

// Plate, fork and knife in gold. Drawn inside the central safe zone so Android's round or
// squircle masks never cut it off.
export function plateSvg(bg, { rounded = false } = {}) {
  const r = rounded ? ' rx="112"' : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512"${r} fill="${bg}"/>` +
    `<g fill="none" stroke="${GOLD}" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="256" cy="256" r="104" stroke-width="12"/>` +
    `<circle cx="256" cy="256" r="74" stroke-width="5" stroke-opacity=".55"/>` +
    `<path d="M120 150V206M136 150V206M152 150V206M120 206C120 236 152 236 152 206M136 228V362" stroke-width="11"/>` +
    `<path d="M384 362V254" stroke-width="12"/>` +
    `</g>` +
    `<path d="M378 148C402 166 410 226 394 256H378Z" fill="${GOLD}" stroke="${GOLD}" stroke-width="6" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

// The brand mark: a gold "U" on deep green, drawn as lines so it needs no font.
export function mainSvg(bg, { rounded = false } = {}) {
  const r = rounded ? ' rx="112"' : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512"${r} fill="${bg}"/>` +
    `<rect x="92" y="92" width="328" height="328" rx="56" fill="none" stroke="${GOLD}" stroke-opacity=".45" stroke-width="5"/>` +
    `<g fill="none" stroke="${GOLD}" stroke-linecap="round">` +
    `<path d="M196 178V280C196 316 222 342 256 342C290 342 316 316 316 280V178" stroke-width="26"/>` +
    `<path d="M170 172H222M290 172H342" stroke-width="10"/>` +
    `</g>` +
    `</svg>`
  );
}
