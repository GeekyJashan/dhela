/**
 * Publishes a post to the Dhela LinkedIn company page, with media.
 *
 *   node .claude/skills/linkedin-post/post.mjs --list
 *   node .claude/skills/linkedin-post/post.mjs --next
 *   node .claude/skills/linkedin-post/post.mjs --post content/linkedin/2026-07-28-en-evening-routine.md
 *   node .claude/skills/linkedin-post/post.mjs --post <file> --publish
 *
 * Posts live in content/linkedin/*.md with front matter:
 *
 *   ---
 *   lang: en
 *   image: brand/post-en.png
 *   status: draft          # becomes `posted` after a successful publish
 *   ---
 *   Body. Blank line between paragraphs.
 *
 * Without --publish it composes everything, screenshots the composer to
 * /tmp/linkedin-preview.png and stops. That default is deliberate: publishing is
 * public, permanent, and in the founder's voice. Show the preview and the copy,
 * get a human yes, then re-run with --publish.
 *
 * DUPLICATE PROTECTION is two layers, because neither alone is trustworthy:
 *   1. the file's own `status: posted` — fast, but goes stale the moment a post
 *      is deleted on LinkedIn by hand;
 *   2. a live check of the page's published feed for this post's opening line —
 *      the actual source of truth, checked before composing.
 * --force overrides both, and says so loudly.
 *
 * Runs against the persistent profile at ~/.dhela-browser, not the user's own
 * Chrome. Playwright MCP's --extension mode cannot do this: Chrome blocks
 * DOM.setFileInputFiles over chrome.debugger, so media upload fails there.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { open } from "../../../scripts/browser-session.mjs";

const PAGE_ID = "142985997";
const PAGE_NAME = "Dhela";
const POSTS_DIR = "content/linkedin";

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const publish = has("publish");
const force = has("force");

/** Minimal front matter — `key: value` lines between --- fences. */
function parsePost(src, path) {
  const m = src.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: src.trim(), path };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2].trim(), path };
}

async function loadAll() {
  if (!existsSync(POSTS_DIR)) return [];
  const files = (await readdir(POSTS_DIR)).filter(f => f.endsWith(".md")).sort();
  return Promise.all(files.map(async f => {
    const p = join(POSTS_DIR, f);
    return parsePost(await readFile(p, "utf8"), p);
  }));
}

if (has("list")) {
  const all = await loadAll();
  if (!all.length) console.log(`no posts in ${POSTS_DIR}/`);
  for (const p of all) {
    const flag = p.meta.needs_proofread === "true" ? "  [needs proofread]" : "";
    console.log(`${(p.meta.status ?? "draft").padEnd(7)} ${(p.meta.lang ?? "?").padEnd(3)} ${p.path}${flag}`);
    console.log(`        ${p.body.split("\n")[0].slice(0, 74)}…`);
  }
  process.exit(0);
}

let postPath = arg("post");
if (has("next")) {
  const all = await loadAll();
  const next = all.find(p => (p.meta.status ?? "draft") !== "posted");
  if (!next) { console.error(`nothing left to post in ${POSTS_DIR}/ — every file is status: posted`); process.exit(1); }
  postPath = next.path;
  console.log(`next unposted: ${postPath}`);
}

// --text/--image stay as an escape hatch for one-offs that are not worth a file.
const textPath = arg("text");
if (!postPath && !textPath) {
  console.error("need --post <file>, --next, --list, or --text <file>");
  process.exit(1);
}

let meta = {}, raw;
if (postPath) {
  if (!existsSync(postPath)) { console.error(`no such post: ${postPath}`); process.exit(1); }
  ({ meta, body: raw } = parsePost(await readFile(postPath, "utf8"), postPath));
} else {
  if (!existsSync(textPath)) { console.error(`no such file: ${textPath}`); process.exit(1); }
  raw = (await readFile(textPath, "utf8")).replace(/\r\n/g, "\n").trim();
}

const imagePath = arg("image", meta.image ?? "");
if (imagePath && !existsSync(imagePath)) { console.error(`no such image: ${imagePath}`); process.exit(1); }

const paras = raw.split(/\n\s*\n/).map(s => s.replace(/\n/g, " ").trim()).filter(Boolean);
if (!paras.length) { console.error("post body is empty"); process.exit(1); }

// Layer 1: what the file says. Cheap, and wrong if the post was deleted by hand.
if (meta.status === "posted" && !force) {
  console.error(`\n${postPath} is marked status: posted (${meta.posted_at ?? "date unknown"}).`);
  console.error("Refusing to post it again. Use --force if you really mean to.");
  process.exit(1);
}
if (meta.needs_proofread === "true" && publish && !force) {
  console.error(`\n${postPath} is flagged needs_proofread: true.`);
  console.error("A native speaker should read it before it goes public. Remove the flag, or use --force.");
  process.exit(1);
}

console.log(`${paras.length} paragraphs, ${raw.length} characters${meta.lang ? `, lang=${meta.lang}` : ""}`);
if (raw.length > 3000) console.warn("warning: LinkedIn truncates around 3000 characters");

const ctx = await open({ headless: false });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let ok = false;

try {
  await page.goto(`https://www.linkedin.com/company/${PAGE_ID}/admin/dashboard/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  if (/login|authwall|uas\/login/.test(page.url())) {
    throw new Error("profile is signed out — the user must run: node scripts/browser-session.mjs login");
  }

  // Layer 2: ask LinkedIn. The file's status can be stale in both directions —
  // a post deleted by hand still reads `posted`, and a post published from
  // another machine does not read `posted` at all. This is the source of truth.
  const probe = paras[0].slice(0, 40);
  await page.goto(`https://www.linkedin.com/company/${PAGE_ID}/admin/page-posts/published/`,
    { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const existing = await page.locator("main").innerText().catch(() => "");
  if (existing.includes(probe)) {
    if (!force) {
      throw new Error(`this post is already live on the page — its opening line is on the published tab.\n`
        + `  "${probe}…"\n`
        + `  Nothing was composed. Use --force only if you genuinely want a second copy.`);
    }
    console.warn(`\nWARNING: this post is already live and --force was given. Publishing a duplicate.\n`);
  }

  await page.goto(`https://www.linkedin.com/company/${PAGE_ID}/admin/dashboard/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("link", { name: "Start a post" }).click({ timeout: 20_000 });
  await page.waitForTimeout(4500);

  const dialog = page.getByRole("dialog").first();

  // Posting as the page, never as the person. LinkedIn defaults to whichever
  // identity it feels like when the composer is opened from the wrong place.
  const header = await dialog.innerText();
  if (!header.includes(PAGE_NAME)) {
    throw new Error(`composer is not posting as ${PAGE_NAME}. Header said: ${header.slice(0, 120)}`);
  }

  if (imagePath) {
    const chooser = page.waitForEvent("filechooser", { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Add media" }).click();
    (await chooser).setFiles(resolve(imagePath));
    await page.waitForTimeout(6000);
    // The media sub-modal replaces the editor; Next/Done returns to it.
    for (const label of [/^Next$/, /^Done$/]) {
      const b = page.getByRole("dialog").first().getByRole("button", { name: label });
      if (await b.count() && await b.first().isEnabled().catch(() => false)) {
        await b.first().click();
        await page.waitForTimeout(3000);
      }
    }
    // Verify rather than assume. The upload can be silently rejected (wrong
    // type, too large, a sub-modal left open) and a post that goes out without
    // its image is the whole reason this script exists.
    // blob:/data: only. A locally uploaded file is a blob URL until the post is
    // submitted; matching licdn.com too would count the page's own avatar and
    // report success for an attachment that never happened.
    const media = page.getByRole("dialog").first().locator('img[src^="blob:"], img[src^="data:"]');
    await media.first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
    const n = await media.count();
    if (!n) {
      const srcs = await page.getByRole("dialog").first()
        .locator("img").evaluateAll(els => els.map(e => e.src.slice(0, 60)));
      throw new Error(`image did not attach: ${imagePath}\n  images in composer: ${JSON.stringify(srcs)}`);
    }
    console.log(`attached ${imagePath} — ${n} uploaded image(s) in composer`);
  }

  // contenteditable, not an input: fill() collapses the paragraph structure, so
  // type each paragraph and press Enter twice for a blank line between them.
  const editor = page.getByRole("dialog").first().locator('[contenteditable="true"]').first();
  await editor.click();
  await page.waitForTimeout(500);
  for (let i = 0; i < paras.length; i++) {
    await page.keyboard.insertText(paras[i]);
    if (i < paras.length - 1) { await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); }
  }
  await page.waitForTimeout(1500);

  const typed = (await editor.innerText()).replace(/\n{2,}/g, "\n").trim();
  const wanted = paras.join("\n");
  if (typed.replace(/\s+/g, " ") !== wanted.replace(/\s+/g, " ")) {
    console.warn("warning: composed text does not exactly match the source file");
    console.warn(`  got:    ${typed.slice(0, 90)}…`);
    console.warn(`  wanted: ${wanted.slice(0, 90)}…`);
  }

  // Typing leaves the composer scrolled to the caret, which is past the image.
  // Scroll back so the preview shows what a reader sees first.
  await page.getByRole("dialog").first().evaluate((d) => {
    d.querySelectorAll("*").forEach((el) => { if (el.scrollHeight > el.clientHeight) el.scrollTop = 0; });
  }).catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole("dialog").first().screenshot({ path: "/tmp/linkedin-preview.png" }).catch(() => {});
  console.log("preview: /tmp/linkedin-preview.png");

  if (!publish) {
    console.log("\nDRY RUN — nothing published. Re-run with --publish once a human has approved it.");
    ok = true;
  } else {
    const btn = page.getByRole("dialog").first().getByRole("button", { name: /^Post$/ });
    if (!(await btn.count()) || !(await btn.first().isEnabled())) throw new Error("Post button not clickable");
    await btn.first().click();
    await page.waitForTimeout(8000);

    // Whether the dialog closed is not evidence of anything — it has stayed
    // open on a post that published fine, and reporting that as "check whether
    // it published" is how you end up posting twice. Go and look instead.
    await page.goto(`https://www.linkedin.com/company/${PAGE_ID}/admin/page-posts/published/`,
      { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const feed = await page.locator("main").innerText().catch(() => "");
    const markers = feed.match(/Feed post number \d+/g) ?? [];
    if (!feed.includes(probe)) {
      throw new Error(`clicked Post but the published tab does not show it — check manually before retrying, or you will double-post`);
    }
    console.log(`PUBLISHED — ${markers.length} post(s) now on the page`);
    console.log("https://www.linkedin.com/company/dhelaa/posts/");

    // Record it in the file itself, so --next moves on and a future session can
    // see what has already gone out without asking LinkedIn.
    if (postPath) {
      const src = (await readFile(postPath, "utf8")).replace(/\r\n/g, "\n");
      const stamp = new Date().toISOString();
      let updated = src.includes("\nstatus:")
        ? src.replace(/\nstatus:.*/, `\nstatus: posted`)
        : src.replace(/^---\n/, `---\nstatus: posted\n`);
      updated = updated.includes("\nposted_at:")
        ? updated.replace(/\nposted_at:.*/, `\nposted_at: ${stamp}`)
        : updated.replace(/\nstatus: posted/, `\nstatus: posted\nposted_at: ${stamp}`);
      await writeFile(postPath, updated);
      console.log(`marked ${postPath} as posted`);
    }
    ok = true;
  }
} catch (err) {
  console.error(`\nfailed: ${err.message}`);
  await page.screenshot({ path: "/tmp/linkedin-error.png" }).catch(() => {});
  console.error("screenshot: /tmp/linkedin-error.png");
} finally {
  // Leave the window up on a dry run so a human can eyeball it.
  if (publish || !ok) await ctx.close();
  else console.log("(browser left open for review — close it when done)");
}
process.exit(ok ? 0 : 1);
