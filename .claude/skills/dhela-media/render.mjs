/**
 * Shared slide renderer for Dhela marketing media.
 *
 * card.mjs (one PNG) and carousel.mjs (a multi-page PDF) both build their pages
 * from slideHtml() so a single card and a carousel slide are visibly the same
 * object. Brand tokens are copied from src/styles.css — if the product's theme
 * changes, change them here too.
 */

export const DEV = "http://localhost:8080";

/** Fails loudly rather than rendering a card in Times New Roman. */
export async function requireDevServer() {
  try {
    const r = await fetch(`${DEV}/fonts/inter-latin.woff2`, { method: "HEAD" });
    if (!r.ok) throw new Error();
  } catch {
    console.error(`Dev server is not serving fonts at ${DEV}. Run \`npm run dev\` first.`);
    process.exit(1);
  }
}

// Single-quoted on purpose. These get interpolated into a double-quoted
// style="..." attribute, and a double quote there terminates the attribute —
// which silently drops font-size and everything after it.
const FAMILY = {
  en: `'Instrument Serif', serif`,
  hi: `'Noto Sans Devanagari', serif`,
  pa: `'Noto Sans Gurmukhi', serif`,
};
const BODY_FAMILY = {
  en: `Inter, sans-serif`,
  hi: `'Noto Sans Devanagari', sans-serif`,
  pa: `'Noto Sans Gurmukhi', sans-serif`,
};

export const THEMES = {
  light: { bg: "var(--cream)", fg: "var(--ink)", eyebrow: "var(--teal)", accent: "var(--teal)", body: "var(--muted)", foot: "var(--teal)", rule: "oklch(0.42 0.09 200 / .22)", grid: true },
  deep:  { bg: "linear-gradient(150deg, var(--deep) 0%, oklch(0.23 0.035 200) 65%, oklch(0.29 0.05 195) 100%)", fg: "var(--gold)", eyebrow: "var(--gold)", accent: "oklch(0.97 0.01 90)", body: "oklch(0.88 0.01 90)", foot: "var(--gold)", rule: "oklch(0.78 0.14 65 / .3)" },
  ink:   { bg: "var(--ink)", fg: "oklch(0.97 0.01 90)", eyebrow: "var(--gold)", accent: "var(--gold)", body: "oklch(0.86 0.01 90)", foot: "var(--gold)", rule: "oklch(0.78 0.14 65 / .3)" },
};

export const esc = (s = "") => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** `|` is a line break; `*starred*` runs take the accent colour. */
const rich = (s = "") => esc(s).split("|").join("<br>").replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');

export const COIN = `<svg class="coin" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cf" x1=".15" y1="0" x2=".85" y2="1">
      <stop offset="0%" stop-color="#f6dfa4"/><stop offset="42%" stop-color="#e0a94e"/><stop offset="100%" stop-color="#a5702c"/>
    </linearGradient>
    <linearGradient id="cr" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eccd86"/><stop offset="100%" stop-color="#8d5d22"/>
    </linearGradient>
  </defs>
  <circle cx="24" cy="24" r="22.5" fill="url(#cf)"/>
  <circle cx="24" cy="24" r="21" fill="none" stroke="url(#cr)" stroke-width="3.4" stroke-dasharray="1.15 2.35"/>
  <circle cx="24" cy="24" r="17.4" fill="none" stroke="#1d3239" stroke-opacity=".45" stroke-width="1.15"/>
  <text x="24" y="31.6" text-anchor="middle" font-family="Georgia, serif" font-size="23" fill="#14262b">D</text>
  <path d="M16.6 35.4h14.8M18.9 38.1h10.2" stroke="#14262b" stroke-opacity=".55" stroke-width="1.15" stroke-linecap="round"/>
  <path d="M9.6 17.4A16.4 16.4 0 0 1 22.6 7.8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.1" stroke-linecap="round"/>
</svg>`;

/**
 * Head block. Indic faces come from Google on purpose: public/fonts holds a
 * 57-character subset built from the landing page and will tofu on new copy.
 */
export const HEAD = `<meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Gurmukhi:wght@400;600;700&display=swap">
<style>
  @font-face { font-family:"Instrument Serif"; src:url("${DEV}/fonts/instrument-serif-latin.woff2") format("woff2"); font-weight:400 700; }
  @font-face { font-family:"Inter"; src:url("${DEV}/fonts/inter-latin.woff2") format("woff2"); font-weight:400 700; }
  :root { --cream:oklch(0.985 0.006 90); --ink:oklch(0.22 0.03 200); --teal:oklch(0.42 0.09 200);
          --gold:oklch(0.78 0.14 65); --muted:oklch(0.5 0.02 200); --deep:oklch(0.14 0.02 200); }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; }
  .slide { width:1200px; height:1200px; position:relative; overflow:hidden; font-family:Inter, sans-serif;
           padding:96px 92px; display:flex; flex-direction:column; justify-content:space-between; }
  .glow { position:absolute; width:660px; height:660px; border-radius:50%; right:-190px; top:-210px;
          background:radial-gradient(circle, oklch(0.78 0.14 65 / .30), transparent 68%); }
  .grid { position:absolute; inset:0; opacity:.5;
          background-image:linear-gradient(oklch(0.42 0.09 200 / .07) 1px, transparent 1px),
                           linear-gradient(90deg, oklch(0.42 0.09 200 / .07) 1px, transparent 1px);
          background-size:60px 60px; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:center; position:relative; }
  .eyebrow { font-size:26px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; }
  .head { margin-top:34px; }
  .body { margin-top:40px; max-width:920px; }
  .foot { display:flex; align-items:center; gap:22px; font-size:30px; letter-spacing:.06em; position:relative; }
  .rule { flex:1; height:1px; }
  svg.coin { width:74px; height:74px; flex:none; }
  .pager { font-size:26px; letter-spacing:.14em; opacity:.75; }
  /* Per-slide, via a custom property set on .slide — a global rule would make
     the last slide's accent colour win for every slide in a carousel. */
  .accent { color: var(--slide-accent); }
  .swipe { position:absolute; right:92px; bottom:190px; font-size:24px; letter-spacing:.16em;
           text-transform:uppercase; opacity:.8; }
</style>`;

/**
 * One 1200x1200 slide.
 *
 * headline `|` breaks lines, `*stars*` accent. `pager` renders "3 / 7" in the
 * footer; `swipe` adds a "swipe →" hint. Latin display type carries a much
 * larger optical size than Indic at the same px, so Indic steps down and gains
 * leading — without that the Devanagari headline overflows the slide.
 */
export function slideHtml({ lang = "en", style = "light", eyebrow, headline, body, pager, swipe } = {}) {
  const t = THEMES[style] ?? THEMES.light;
  const headSize = lang === "en" ? 118 : 96;
  const headLead = lang === "en" ? 1.04 : 1.32;
  const bodySize = lang === "en" ? 34 : 33;
  const bodyLead = lang === "en" ? 1.5 : 1.72;

  return `<div class="slide" style="background:${t.bg}; color:${t.fg}; --slide-accent:${t.accent}">
  ${t.grid ? '<div class="grid"></div>' : ""}<div class="glow"></div>
  <div class="main">
    ${eyebrow ? `<div class="eyebrow" style="color:${t.eyebrow}">${esc(eyebrow)}</div>` : ""}
    <div class="head" style="font-family:${FAMILY[lang] ?? FAMILY.en}; font-size:${headSize}px;
         line-height:${headLead}; font-weight:${lang === "en" ? 400 : 700};
         letter-spacing:${lang === "en" ? "-0.02em" : "0"}">${rich(headline)}</div>
    ${body ? `<div class="body" style="font-family:${BODY_FAMILY[lang] ?? BODY_FAMILY.en};
         font-size:${bodySize}px; line-height:${bodyLead}; color:${t.body}">${rich(body)}</div>` : ""}
  </div>
  ${swipe ? `<div class="swipe" style="color:${t.foot}">${esc(swipe)}</div>` : ""}
  <div class="foot" style="color:${t.foot}">
    ${COIN}<span class="rule" style="background:${t.rule}"></span>
    ${pager ? `<span class="pager">${esc(pager)}</span>` : `<span>DHELA.IN</span>`}
  </div>
</div>`;
}
