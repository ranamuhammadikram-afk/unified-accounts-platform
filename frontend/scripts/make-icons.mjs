// Builds the home-screen icons and web-app manifests into public/ before `vite build`.
// Each business in src/appIcons.js gets its own icon, name and start page, so it can be
// added to a phone's home screen and open straight to that business.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUSINESS_ICONS, GENERIC_BUSINESS, MAIN_ICON, plateSvg, mainSvg } from "../src/appIcons.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const iconDir = join(pub, "icons");
mkdirSync(iconDir, { recursive: true });

let Resvg = null;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch (err) {
  console.warn("[icons] PNG renderer not available; only SVG icons will be written.", err.message);
}

function png(svg, size, file) {
  if (!Resvg) return false;
  const out = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(join(iconDir, file), out);
  return true;
}

const entries = [
  { ...MAIN_ICON, art: mainSvg, start: "/" },
  { ...GENERIC_BUSINESS, art: plateSvg, start: "/" },
  ...BUSINESS_ICONS.map((b) => ({ ...b, key: `biz-${b.slug}`, art: plateSvg, start: `/b/${b.slug}/entry` })),
];

for (const e of entries) {
  const square = e.art(e.bg);
  writeFileSync(join(iconDir, `${e.key}.svg`), e.art(e.bg, { rounded: true }));
  const icons = [{ src: `/icons/${e.key}.svg`, sizes: "any", type: "image/svg+xml" }];
  if (png(square, 192, `${e.key}-192.png`) && png(square, 512, `${e.key}-512.png`) && png(square, 180, `${e.key}-180.png`)) {
    icons.unshift(
      { src: `/icons/${e.key}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icons/${e.key}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icons/${e.key}-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }
    );
  }
  const manifest = {
    id: e.start === "/" ? `/?app=${e.key}` : e.start,
    name: e.name,
    short_name: e.short,
    start_url: e.start,
    scope: "/",
    display: "standalone",
    background_color: "#f6f3ec",
    theme_color: e.bg,
    icons,
  };
  writeFileSync(join(pub, `manifest-${e.key}.webmanifest`), JSON.stringify(manifest, null, 2));
}
console.log(`[icons] wrote ${entries.length} app icons${Resvg ? "" : " (SVG only)"}.`);
