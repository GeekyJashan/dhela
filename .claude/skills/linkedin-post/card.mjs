/**
 * Renders a 1200x1200 Dhela brand card for a LinkedIn post.
 *
 *   node .claude/skills/linkedin-post/card.mjs \
 *     --lang en --style light \
 *     --eyebrow "Per supplier bill" \
 *     --headline "45 minutes|→ 2 minutes." \
 *     --body "AI reads every line…" \
 *     --out brand/post-en.png
 *
 * --lang   en | hi | pa    picks the typeface for headline and body
 * --style  light | deep | ink
 * --headline uses | for a line break; wrap a segment in *stars* to accent it
 *
 * Run from the repo root with `npm run dev` up: the Latin faces are self-hosted
 * at /fonts and served by the dev server. The Indic faces come from Google
 * Fonts on purpose — the copies in public/fonts are a 57-character subset of
 * the landing page and will tofu on anything new.
 */
import { chromium } from "@playwright/test";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const lang = arg("lang", "en");
const style = arg("style", "light");
const eyebrow = arg("eyebrow");
const headline = arg("headline");
const body = arg("body");
const out = arg("out", `brand/post-${lang}.png`);

if (!headline) {
  console.error("need --headline (use | for a line break, *stars* to accent)");
  process.exit(1);
}

const DEV = "http://localhost:8080";
try {
  const r = await fetch(`${DEV}/fonts/inter-latin.woff2`, { method: "HEAD" });
  if (!r.ok) throw new Error();
} catch {
  console.error(`Dev server not serving fonts at ${DEV}. Run \`npm run dev\` first.`);
  process.exit(1);
}

const FAMILY = {
  en: `"Instrument Serif", serif`,
  hi: `"Noto Sans Devanagari", serif`,
  pa: `"Noto Sans Gurmukhi", serif`,
}[lang] ?? `"Instrument Serif", serif`;

const BODY_FAMILY = {
  en: `Inter, sans-serif`,
  hi: `"Noto Sans Devanagari", sans-serif`,
  pa: `"Noto Sans Gurmukhi", sans-serif`,
}[lang] ?? `Inter, sans-serif`;

// Latin display type carries a much bigger optical size than Indic at the same
// px, so the Indic headline is stepped down and given more leading.
const HEAD_SIZE = lang === "en" ? 118 : 96;
const HEAD_LEADING = lang === "en" ? 1.04 : 1.32;
const BODY_SIZE = lang === "en" ? 34 : 33;
const BODY_LEADING = lang === "en" ? 1.5 : 1.72;

const THEME = {
  light: { bg: "var(--cream)", fg: "var(--ink)", eyebrow: "var(--teal)", accent: "var(--teal)", body: "var(--muted)", foot: "var(--teal)", rule: "oklch(0.42 0.09 200 / .22)" },
  deep:  { bg: "linear-gradient(150deg, var(--deep) 0%, oklch(0.23 0.035 200) 65%, oklch(0.29 0.05 195) 100%)", fg: "var(--gold)", eyebrow: "var(--gold)", accent: "oklch(0.97 0.01 90)", body: "oklch(0.88 0.01 90)", foot: "var(--gold)", rule: "oklch(0.78 0.14 65 / .3)" },
  ink:   { bg: "var(--ink)", fg: "oklch(0.97 0.01 90)", eyebrow: "var(--gold)", accent: "var(--gold)", body: "oklch(0.86 0.01 90)", foot: "var(--gold)", rule: "oklch(0.78 0.14 65 / .3)" },
}[style] ?? {};

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const headHtml = esc(headline)
  .split("|")
  .join("<br>")
  .replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Gurmukhi:wght@400;600;700&display=swap">
<style>
  @font-face { font-family:"Instrument Serif"; src:url("${DEV}/fonts/instrument-serif-latin.woff2") format("woff2"); font-weight:400 700; }
  @font-face { font-family:"Inter"; src:url("${DEV}/fonts/inter-latin.woff2") format("woff2"); font-weight:400 700; }
  :root { --cream:oklch(0.985 0.006 90); --ink:oklch(0.22 0.03 200); --teal:oklch(0.42 0.09 200);
          --gold:oklch(0.78 0.14 65); --muted:oklch(0.5 0.02 200); --deep:oklch(0.14 0.02 200); }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { margin:0; }
  #card { width:1200px; height:1200px; position:relative; overflow:hidden; background:${THEME.bg};
          color:${THEME.fg}; font-family:Inter, sans-serif; padding:96px 92px;
          display:flex; flex-direction:column; justify-content:space-between; }
  .glow { position:absolute; width:660px; height:660px; border-radius:50%; right:-190px; top:-210px;
          background:radial-gradient(circle, oklch(0.78 0.14 65 / .30), transparent 68%); }
  .grid { position:absolute; inset:0; opacity:.5;
          background-image:linear-gradient(oklch(0.42 0.09 200 / .07) 1px, transparent 1px),
                           linear-gradient(90deg, oklch(0.42 0.09 200 / .07) 1px, transparent 1px);
          background-size:60px 60px; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center; position:relative; }
  .eyebrow { font-size:26px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:${THEME.eyebrow}; }
  .head { font-family:${FAMILY}; font-size:${HEAD_SIZE}px; line-height:${HEAD_LEADING};
          letter-spacing:${lang === "en" ? "-0.02em" : "0"}; font-weight:${lang === "en" ? 400 : 700}; margin-top:34px; }
  .head .accent { color:${THEME.accent}; }
  .body { font-family:${BODY_FAMILY}; font-size:${BODY_SIZE}px; line-height:${BODY_LEADING};
          margin-top:40px; max-width:920px; color:${THEME.body}; }
  .foot { display:flex; align-items:center; gap:22px; font-size:30px; letter-spacing:.06em;
          color:${THEME.foot}; position:relative; }
  .rule { flex:1; height:1px; background:${THEME.rule}; }
  svg.coin { width:74px; height:74px; flex:none; }
</style>
<div id="card">
  ${style === "light" ? '<div class="grid"></div>' : ""}<div class="glow"></div>
  <div class="main">
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}
    <div class="head">${headHtml}</div>
    ${body ? `<div class="body">${esc(body)}</div>` : ""}
  </div>
  <div class="foot">
    <svg class="coin" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="f" x1=".15" y1="0" x2=".85" y2="1">
          <stop offset="0%" stop-color="#f6dfa4"/><stop offset="42%" stop-color="#e0a94e"/><stop offset="100%" stop-color="#a5702c"/>
        </linearGradient>
        <linearGradient id="r" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#eccd86"/><stop offset="100%" stop-color="#8d5d22"/>
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="url(#f)"/>
      <circle cx="24" cy="24" r="21" fill="none" stroke="url(#r)" stroke-width="3.4" stroke-dasharray="1.15 2.35"/>
      <circle cx="24" cy="24" r="17.4" fill="none" stroke="#1d3239" stroke-opacity=".45" stroke-width="1.15"/>
      <text x="24" y="31.6" text-anchor="middle" font-family="Georgia, serif" font-size="23" fill="#14262b">D</text>
      <path d="M16.6 35.4h14.8M18.9 38.1h10.2" stroke="#14262b" stroke-opacity=".55" stroke-width="1.15" stroke-linecap="round"/>
      <path d="M9.6 17.4A16.4 16.4 0 0 1 22.6 7.8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.1" stroke-linecap="round"/>
    </svg>
    <span class="rule"></span><span>DHELA.IN</span>
  </div>
</div>`;

// Served from the dev server's origin so the self-hosted @font-face URLs are
// same-origin; a data: or file: page cannot reach them.
await mkdir("public", { recursive: true });
await writeFile("public/_card-tmp.html", html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  await page.goto(`${DEV}/_card-tmp.html`, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  // Tofu renders as a fixed-width box; a wildly wrong width means the glyphs are
  // missing, which is the failure mode when someone points this at the subset.
  const missing = await page.evaluate(() => {
    const el = document.querySelector(".head");
    return el ? el.getBoundingClientRect().height < 20 : true;
  });
  if (missing) console.warn("warning: headline measured ~0 high — font may not have loaded");
  await mkdir(dirname(out), { recursive: true });
  await page.locator("#card").screenshot({ path: out });
  console.log(`wrote ${out}  (1200x1200, lang=${lang}, style=${style})`);
} finally {
  await browser.close();
  await unlink("public/_card-tmp.html").catch(() => {});
}
