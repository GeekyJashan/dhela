/**
 * Publishes a post to the Dhela LinkedIn company page, with media.
 *
 *   node .claude/skills/linkedin-post/post.mjs --text post.txt --image brand/post-en.png
 *   node .claude/skills/linkedin-post/post.mjs --text post.txt --image brand/post-en.png --publish
 *
 * Without --publish it composes everything, screenshots the composer to
 * /tmp/linkedin-preview.png and stops. That default is deliberate: publishing is
 * public, permanent, and in the founder's voice. Show the preview and the copy,
 * get a human yes, then re-run with --publish.
 *
 * Runs against the persistent profile at ~/.dhela-browser, not the user's own
 * Chrome. Playwright MCP's --extension mode cannot do this: Chrome blocks
 * DOM.setFileInputFiles over chrome.debugger, so media upload fails there.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { open } from "../../../scripts/browser-session.mjs";

const PAGE_ID = "142985997";
const PAGE_NAME = "Dhela";

const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const publish = process.argv.includes("--publish");

const textPath = arg("text");
const imagePath = arg("image");
if (!textPath) { console.error("need --text <file>"); process.exit(1); }
if (!existsSync(textPath)) { console.error(`no such file: ${textPath}`); process.exit(1); }
if (imagePath && !existsSync(imagePath)) { console.error(`no such image: ${imagePath}`); process.exit(1); }

const raw = (await readFile(textPath, "utf8")).replace(/\r\n/g, "\n").trim();
const paras = raw.split(/\n\s*\n/).map(s => s.replace(/\n/g, " ").trim()).filter(Boolean);
if (!paras.length) { console.error("post body is empty"); process.exit(1); }

console.log(`${paras.length} paragraphs, ${raw.length} characters`);
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
    const stillOpen = await page.getByRole("dialog").count();
    console.log(stillOpen ? "warning: composer still open — check whether it published" : "PUBLISHED");
    console.log(`https://www.linkedin.com/company/dhelaa/posts/`);
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
