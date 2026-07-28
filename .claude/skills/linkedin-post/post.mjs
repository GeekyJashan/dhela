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
const scheduleAt = arg("schedule");   // e.g. 2026-08-06T10:00
/** A post is "done" if it is out or queued to go out. */
const isDone = (m) => ["posted", "scheduled"].includes(m.status ?? "draft");

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

/**
 * Queue every remaining draft in one command, spaced out.
 *
 * This is the answer to "publish all drafts". Publishing them together would
 * put several posts in front of the same small audience at once — the later
 * ones get nothing — and a burst of automated publishes is what gets a company
 * page restricted. Scheduling is LinkedIn's own feature: one command now,
 * posts land days apart, nothing has to keep running.
 *
 *   --schedule-all --from 2026-08-04 --every 3 --at 10:00 [--publish]
 */
if (has("schedule-all")) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const drafts = (await loadAll()).filter(p => !isDone(p.meta));
  if (!drafts.length) { console.log("nothing to schedule — every post is out or queued."); process.exit(0); }

  const every = Number(arg("every", "3"));
  const at = arg("at", "10:00");
  const from = arg("from") ? new Date(`${arg("from")}T${at}`)
    : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
  const [hh, mm] = at.split(":").map(Number);
  from.setHours(hh, mm ?? 0, 0, 0);

  const plan = drafts.map((p, i) => {
    const when = new Date(from);
    when.setDate(when.getDate() + i * every);
    return { p, when };
  });

  console.log(`\n${plan.length} post(s) to schedule, ${every} day(s) apart at ${at}:\n`);
  for (const { p, when } of plan) {
    const blocked = p.meta.needs_proofread === "true" && !force;
    console.log(`  ${when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}  ${p.meta.lang}  ${p.path}`
      + (blocked ? "   ← BLOCKED: needs_proofread" : ""));
  }
  if (!publish) {
    console.log("\nDRY RUN — nothing scheduled. Add --publish to queue these.");
    process.exit(0);
  }

  let done = 0;
  for (const { p, when } of plan) {
    if (p.meta.needs_proofread === "true" && !force) {
      console.log(`\nskipping ${p.path} — needs_proofread`);
      continue;
    }
    // One child process per post: each gets a fresh browser and re-runs every
    // guard, so a failure part-way leaves the rest untouched and re-runnable.
    const args = [process.argv[1], "--post", p.path, "--schedule",
      `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`
      + `T${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`,
      "--publish", ...(force ? ["--force"] : [])];
    console.log(`\n── ${p.path}`);
    try {
      const { stdout } = await run(process.execPath, args, { maxBuffer: 10 << 20 });
      process.stdout.write(stdout.split("\n").map(l => `   ${l}`).join("\n") + "\n");
      done++;
    } catch (e) {
      console.error(`   FAILED: ${(e.stdout || "") + (e.stderr || e.message)}`.slice(0, 800));
      console.error("   stopping — fix this one, then re-run; the rest are untouched.");
      break;
    }
  }
  console.log(`\n${done}/${plan.length} scheduled.`);
  process.exit(done === plan.length ? 0 : 1);
}

let postPath = arg("post");
if (has("next")) {
  const all = await loadAll();
  const next = all.find(p => !isDone(p.meta));
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

/**
 * Opens the post composer.
 *
 * The dashboard has two layouts and which one you get depends on whether the
 * page has published anything. With zero posts it shows a "Start a post" prompt
 * inline; once there are posts that prompt is replaced by "Manage recent posts"
 * and the only way in is the Create menu. Written against the empty state, this
 * broke the moment the page had its first post.
 */
async function openComposer(page) {
  const direct = page.getByRole("link", { name: "Start a post" });
  if (await direct.count()) {
    await direct.first().click({ timeout: 15_000 });
  } else {
    const create = page.getByRole("link", { name: /^Create$/ })
      .or(page.getByRole("button", { name: /^Create$/ }));
    await create.first().click({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await page.getByText("Start a post", { exact: true }).first().click({ timeout: 20_000 });
  }
  await page.waitForTimeout(4000);
  // The composer is whichever dialog owns a contenteditable; waiting on that
  // rather than on "a dialog" skips the Create menu, which is also a dialog.
  await page.getByRole("dialog").locator('[contenteditable="true"]').first()
    .waitFor({ state: "visible", timeout: 25_000 });
}

/**
 * Hands the post to LinkedIn's own scheduler.
 *
 * This is the right way to queue several posts at once. Publishing them in a
 * burst competes for the same small audience and looks like bulk automation;
 * scheduling is a first-class LinkedIn feature that spaces them out server-side,
 * so nothing has to keep running.
 *
 * The dialog wants M/D/YYYY and a 12-hour time on a 30-minute grid.
 */
async function scheduleInComposer(page, when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) throw new Error(`bad --schedule value: ${when}`);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const mins = d.getMinutes() < 30 ? "00" : "30";
  const h24 = d.getHours();
  const time = `${((h24 + 11) % 12) + 1}:${mins} ${h24 < 12 ? "AM" : "PM"}`;

  await page.getByRole("dialog").first()
    .getByRole("button", { name: /Schedule post/i }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3000);

  const dlg = page.getByRole("dialog").last();
  await dlg.getByRole("textbox", { name: "Date" }).fill(date);
  await page.waitForTimeout(600);

  // "Time" reports role=combobox but is an <input> typeahead, not a <select>,
  // so selectOption() cannot drive it. Type the value and take the matching
  // option from the listbox; fall back to Enter if the list does not open.
  const timeInput = dlg.getByRole("combobox", { name: "Time" });
  await timeInput.click();
  await timeInput.fill(time);
  await page.waitForTimeout(1200);
  const opt = page.getByRole("option", { name: time, exact: true });
  if (await opt.count()) await opt.first().click();
  else await timeInput.press("Enter");
  await page.waitForTimeout(800);

  const got = await timeInput.inputValue();
  if (got.replace(/\s+/g, " ").toUpperCase() !== time.toUpperCase()) {
    throw new Error(`time did not take: wanted "${time}", field says "${got}"`);
  }
  await dlg.getByRole("button", { name: /^Next$/ }).click();
  await page.waitForTimeout(3000);
  console.log(`scheduled for ${date} ${time}`);
  return { date, time };
}

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
  await openComposer(page);

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
    console.log(`\nDRY RUN — nothing ${scheduleAt ? "scheduled" : "published"}.`
      + " Re-run with --publish once a human has approved it.");
    ok = true;
  } else {
    if (scheduleAt) await scheduleInComposer(page, scheduleAt);

    // After scheduling, the primary button says "Schedule" instead of "Post".
    const btn = page.getByRole("dialog").first()
      .getByRole("button", { name: scheduleAt ? /^Schedule$/ : /^Post$/ });
    if (!(await btn.count()) || !(await btn.first().isEnabled())) {
      throw new Error(`${scheduleAt ? "Schedule" : "Post"} button not clickable`);
    }
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

    if (scheduleAt) {
      // A company page exposes no scheduled-posts list: /page-posts/scheduled/
      // redirects to the dashboard, and LinkedIn's own "View all scheduled
      // posts" button lands back on Published. So this is the one path that
      // cannot be positively confirmed. What CAN be checked is that it did not
      // go out now — if it is already live, the schedule silently did not take.
      if (feed.includes(probe)) {
        throw new Error("asked to schedule, but the post is already live on the page."
          + " The schedule did not take. Delete it before retrying.");
      }
      console.log("SCHEDULED (unverified) — it is not live now, which is consistent"
        + " with being queued. LinkedIn shows no scheduled list for company pages,"
        + " so confirm it by hand in the composer's schedule dialog.");
    } else {
      if (!feed.includes(probe)) {
        throw new Error(`clicked Post but the published tab does not show it`
          + ` — check manually before retrying, or you will double-post`);
      }
      console.log(`PUBLISHED — ${markers.length} post(s) now on the page`);
    }
    console.log("https://www.linkedin.com/company/dhelaa/posts/");

    // Record it in the file itself, so --next moves on and a future session can
    // see what has already gone out without asking LinkedIn.
    if (postPath) {
      const src = (await readFile(postPath, "utf8")).replace(/\r\n/g, "\n");
      // `scheduled` is deliberately distinct from `posted`: it is queued, not
      // out, and --list should say so until LinkedIn actually publishes it.
      const state = scheduleAt ? "scheduled" : "posted";
      const key = scheduleAt ? "scheduled_for" : "posted_at";
      const stamp = scheduleAt ? scheduleAt : new Date().toISOString();
      let updated = src.includes("\nstatus:")
        ? src.replace(/\nstatus:.*/, `\nstatus: ${state}`)
        : src.replace(/^---\n/, `---\nstatus: ${state}\n`);
      updated = new RegExp(`\\n${key}:`).test(updated)
        ? updated.replace(new RegExp(`\\n${key}:.*`), `\n${key}: ${stamp}`)
        : updated.replace(`\nstatus: ${state}`, `\nstatus: ${state}\n${key}: ${stamp}`);
      await writeFile(postPath, updated);
      console.log(`marked ${postPath} as ${state}`);
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
