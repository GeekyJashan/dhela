/**
 * Downloads the woff2 files we actually need into public/fonts/ and writes
 * src/fonts.css to match. Run with `npm run fonts` after changing the fonts,
 * the weights, or any Hindi/Punjabi copy on the landing page.
 *
 * Why self-host at all: the Google Fonts <link> is render-blocking and sat on
 * a second origin, and its unicode-range split was pulling 318 KB — 40% of the
 * whole page. Two things were paying for that:
 *
 *   1. The rupee sign. U+20B9 lives in Google's `latin-ext` range, so one glyph
 *      forced the full latin-ext subset of Inter (83 KB), Instrument Serif
 *      (7.6 KB) and Noto Devanagari (13.5 KB). We fetch a rupee-only subset
 *      instead and give it a unicode-range of exactly U+20B9.
 *   2. Full Noto Devanagari + Gurmukhi (151 KB) for a hero tagline and two FAQ
 *      entries. We subset those to the characters the marketing page actually
 *      uses. The app is different — a distributor can type any Devanagari they
 *      like into a product name — so `setLanguage` loads the complete families
 *      from Google on demand, and the stack falls through to them (and then to
 *      the system Indic font) for anything the subset misses. Worst case is a
 *      font mismatch, never tofu.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public/fonts");

// css2 hands back woff2 (and the variable-font file) only to a modern browser UA.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function css(params) {
  const r = await fetch(`https://fonts.googleapis.com/css2?${params}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`css2 ${params} → ${r.status}`);
  return r.text();
}

/**
 * Pull the url() for one named subset, or the sole url() of a `text=` response
 * (those come back as a single unlabelled block).
 */
function pick(sheet, subset) {
  if (!subset) {
    const url = sheet.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
    if (!url) throw new Error("no woff2 in text= response");
    return url;
  }
  // css2 labels each block with a `/* latin */` comment immediately above it.
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, label, body] of sheet.matchAll(re)) {
    if (label !== subset) continue;
    const url = body.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
    if (url) return url;
  }
  throw new Error(`subset "${subset}" not found`);
}

/**
 * Returns null when the family has no glyph for the requested characters —
 * gstatic answers those with a 400 and an HTML body, which is exactly how a
 * base64 `<html lang=…>` once ended up inlined as a font.
 */
async function fetchFont(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") return null;
  return buf;
}

async function grab(url, name) {
  const buf = await fetchFont(url);
  if (!buf) throw new Error(`no woff2 for ${name}`);
  await writeFile(join(OUT, name), buf);
  console.log(`  ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${name}`);
  return buf.length;
}

/**
 * The rupee subsets are ~2 KB each — smaller than the request that would fetch
 * them. Inlining costs a third more bytes as base64 but saves two round trips
 * on a stylesheet that is already being downloaded.
 */
async function inline(url, label) {
  const buf = await fetchFont(url);
  if (!buf) {
    console.log(`        —  ${label}: family has no such glyph, skipping`);
    return null;
  }
  console.log(`  ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${label} (inlined)`);
  return { size: buf.length, src: `data:font/woff2;base64,${buf.toString("base64")}` };
}

/** Every Devanagari and Gurmukhi codepoint that appears in the public page. */
async function indicChars() {
  const src = await readFile(join(ROOT, "src/routes/index.tsx"), "utf8");
  const found = new Set(src.match(/[ऀ-ॿ਀-੿‌‍]/gu) ?? []);
  return [...found].sort().join("");
}

await mkdir(OUT, { recursive: true });
let total = 0;
const chars = await indicChars();
console.log(`Indic characters on the landing page: ${chars.length}\n  ${chars}\n`);

console.log("fonts:");
// Inter and Instrument Serif ship as variable fonts, so one file covers 400–700.
total += await grab(pick(await css("family=Inter:wght@400..700&display=swap"), "latin"), "inter-latin.woff2");
total += await grab(pick(await css("family=Instrument+Serif&display=swap"), "latin"), "instrument-serif-latin.woff2");
// Instrument Serif has no U+20B9, so there is nothing to inline for it and ₹ in
// display type falls through the stack — which is what it already did.
const interRupee = await inline(pick(await css("family=Inter:wght@400..700&text=%E2%82%B9")), "Inter ₹");
const serifRupee = await inline(pick(await css("family=Instrument+Serif&text=%E2%82%B9")), "Instrument Serif ₹");
total += (interRupee?.size ?? 0) + (serifRupee?.size ?? 0);

const enc = encodeURIComponent(chars);
total += await grab(pick(await css(`family=Noto+Sans+Devanagari:wght@400..600&text=${enc}`)), "noto-devanagari-subset.woff2");
total += await grab(pick(await css(`family=Noto+Sans+Gurmukhi:wght@400..600&text=${enc}`)), "noto-gurmukhi-subset.woff2");

console.log(`\n  total ${(total / 1024).toFixed(1)} KB (was 317.7 KB over 7 requests from fonts.gstatic.com)`);

const face = (family, src, extra = "") =>
  `@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n  src: url("${src}") format("woff2");\n${extra}}\n`;
const file = (name) => `/fonts/${name}`;

await writeFile(join(ROOT, "src/fonts.css"), `/* Generated by scripts/build-fonts.mjs — run \`npm run fonts\` to regenerate. */

${face("Inter", file("inter-latin.woff2"))}
/* The rupee sign only, inlined. Kept out of the latin file so U+20B9 stops
   dragging in Google's whole latin-ext subset — 83 KB of Inter for one glyph. */
${interRupee ? face("Inter", interRupee.src, "  unicode-range: U+20B9;\n") : ""}
${face("Instrument Serif", file("instrument-serif-latin.woff2"))}
${serifRupee ? face("Instrument Serif", serifRupee.src, "  unicode-range: U+20B9;\n") : ""}
/* Subset to the Hindi/Punjabi copy on the landing page. The full families load
   from Google only when someone switches the app to Hindi or Punjabi — see
   setLanguage in src/i18n.ts. */
${face("Noto Sans Devanagari Subset", file("noto-devanagari-subset.woff2"))}
${face("Noto Sans Gurmukhi Subset", file("noto-gurmukhi-subset.woff2"))}`);
console.log("wrote src/fonts.css");
