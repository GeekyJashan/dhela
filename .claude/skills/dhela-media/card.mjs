/**
 * One 1200x1200 Dhela card as a PNG — the single-image LinkedIn post.
 *
 *   node .claude/skills/dhela-media/card.mjs \
 *     --lang en --style light \
 *     --eyebrow "Per supplier bill" \
 *     --headline "45 minutes|→ *2 minutes.*" \
 *     --body "AI reads every line…" \
 *     --out brand/post-en.png
 *
 * --lang en|hi|pa   --style light|deep|ink
 * headline: | breaks the line, *stars* take the accent colour
 *
 * Run from the repo root with `npm run dev` up.
 */
import { chromium } from "@playwright/test";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { HEAD, slideHtml, requireDevServer, DEV } from "./render.mjs";

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const lang = arg("lang", "en");
const style = arg("style", "light");
const headline = arg("headline");
const out = arg("out", `brand/card-${lang}.png`);

if (!headline) {
  console.error("need --headline (| breaks a line, *stars* accent)");
  process.exit(1);
}
await requireDevServer();

const html = `<!doctype html>${HEAD}
${slideHtml({ lang, style, eyebrow: arg("eyebrow"), headline, body: arg("body") })}`;

// Served from the dev server's origin so the self-hosted @font-face URLs
// resolve; a data: or file: page cannot reach them.
await mkdir("public", { recursive: true });
// Unique per run. Reusing one filename raced Vite's file watcher: the previous
// run's unlink was still settling when the next run wrote the same path, and the
// dev server served a 404 for a file that existed on disk.
const tmpName = `_media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.html`;
await writeFile(`public/${tmpName}`, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
try {
  await page.goto(`${DEV}/${tmpName}`, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  const h = await page.locator(".head").evaluate(el => el.getBoundingClientRect().height);
  if (h < 20) console.warn("warning: headline measured ~0 high — a font probably failed to load");
  await mkdir(dirname(out), { recursive: true });
  await page.locator(".slide").screenshot({ path: out });
  console.log(`wrote ${out}  (1200x1200, lang=${lang}, style=${style})`);
} finally {
  await browser.close();
  await unlink(`public/${tmpName}`).catch(() => {});
}
