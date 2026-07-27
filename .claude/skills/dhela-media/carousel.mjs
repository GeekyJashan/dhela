/**
 * A LinkedIn carousel — which is a PDF, not a set of images.
 *
 * LinkedIn "document posts" take a PDF and render it as a swipeable deck. That
 * is the only way to get a carousel; uploading several PNGs produces a plain
 * multi-image post, which behaves differently and reads worse.
 *
 *   node .claude/skills/dhela-media/carousel.mjs --spec deck.json --out brand/deck.pdf
 *
 * deck.json:
 *   {
 *     "lang": "en",
 *     "slides": [
 *       { "style": "deep", "eyebrow": "The problem", "headline": "Forty bills.|One operator.",
 *         "body": "…", "swipe": "swipe →" },
 *       { "style": "light", "headline": "45 minutes|→ *2 minutes.*", "body": "…" }
 *     ]
 *   }
 *
 * Per-slide `lang` and `style` override the deck defaults. `pager` is added
 * automatically unless you pass "pager": false on a slide.
 *
 * Run from the repo root with `npm run dev` up.
 */
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { HEAD, slideHtml, requireDevServer, DEV } from "./render.mjs";

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const specPath = arg("spec");
const out = arg("out", "brand/carousel.pdf");
if (!specPath) { console.error("need --spec <deck.json>"); process.exit(1); }

const spec = JSON.parse(await readFile(specPath, "utf8"));
const slides = spec.slides ?? [];
if (!slides.length) { console.error("spec has no slides"); process.exit(1); }
if (slides.length > 20) console.warn(`warning: ${slides.length} slides — past about 10 people stop swiping`);

await requireDevServer();

const pages = slides.map((s, i) => slideHtml({
  lang: s.lang ?? spec.lang ?? "en",
  style: s.style ?? spec.style ?? (i % 2 ? "light" : "deep"),
  eyebrow: s.eyebrow,
  headline: s.headline,
  body: s.body,
  swipe: s.swipe ?? (i === 0 ? "swipe →" : undefined),
  pager: s.pager === false ? undefined : `${i + 1} / ${slides.length}`,
})).join("\n");

// Each .slide is exactly one PDF page. break-inside avoids Chromium splitting a
// slide across two pages when a descender lands on the boundary.
const html = `<!doctype html>${HEAD}
<style>
  .slide { break-after: page; break-inside: avoid; }
  .slide:last-child { break-after: auto; }
  @page { size: 1200px 1200px; margin: 0; }
</style>
${pages}`;

await mkdir("public", { recursive: true });
await writeFile("public/_media-tmp.html", html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
try {
  await page.goto(`${DEV}/_media-tmp.html`, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const short = await page.locator(".head").evaluateAll(els =>
    els.map((e, i) => [i + 1, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 20));
  if (short.length) console.warn(`warning: slides ${short.map(s => s[0]).join(", ")} have a ~0-height headline`);

  // Overflow is invisible in a PDF — a slide just silently loses its last line.
  const overflow = await page.locator(".slide").evaluateAll(els =>
    els.map((e, i) => [i + 1, e.scrollHeight - e.clientHeight]).filter(([, d]) => d > 2));
  if (overflow.length) {
    console.warn(`warning: content overflows on slide(s) ${overflow.map(o => `${o[0]} (+${o[1]}px)`).join(", ")} — shorten the body`);
  }

  await mkdir(dirname(out), { recursive: true });
  await page.pdf({ path: out, width: "1200px", height: "1200px", printBackground: true, pageRanges: `1-${slides.length}` });
  const { size } = await stat(out);
  console.log(`wrote ${out}  (${slides.length} slides, ${(size / 1024 / 1024).toFixed(2)} MB)`);
  if (size > 100 * 1024 * 1024) console.warn("warning: over LinkedIn's 100 MB document limit");
} finally {
  await browser.close();
  await unlink("public/_media-tmp.html").catch(() => {});
}
