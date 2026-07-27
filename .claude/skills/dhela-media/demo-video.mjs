/**
 * A screen-recorded walkthrough of the real app, for a LinkedIn video post.
 *
 *   node .claude/skills/dhela-media/demo-video.mjs --out brand/demo.mp4
 *   node .claude/skills/dhela-media/demo-video.mjs --out brand/demo.mp4 --steps dashboard,insights,gst
 *
 * This records the actual product against the seeded e2e workspace — not a
 * mockup. That is the point: a real screen is the most credible thing a
 * distributor can be shown, and it cannot drift from what the app does.
 *
 * Requires:
 *   - the dev server (`npm run dev`)
 *   - e2e/.auth/user.json — a signed-in session. Create it with `npx playwright test`
 *     once, or `node e2e/seed.mjs`; global-setup writes it.
 *   - ffmpeg, only to produce .mp4. LinkedIn does not accept the .webm that
 *     Playwright records, so without ffmpeg you get the webm and instructions.
 *
 * The recording is silent. LinkedIn autoplays muted in-feed, so captions matter
 * more than audio — burn them into the post text, not the video.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, rename, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, extname } from "node:path";

const run = promisify(execFile);
const arg = (k, d = "") => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const BASE = arg("base", "http://localhost:8080");
const AUTH = "e2e/.auth/user.json";
const out = arg("out", "brand/demo.mp4");
const [W, H] = arg("size", "1280x800").split("x").map(Number);

/** Each step is a route plus what to do once it has settled. */
const STEPS = {
  dashboard: { path: "/dashboard", hold: 3200, caption: "Your day at a glance" },
  upload:    { path: "/upload",    hold: 3400, caption: "Drop the whole pile of bills" },
  invoices:  { path: "/invoices",  hold: 3000, scroll: true, caption: "Every purchase, read and checked" },
  insights:  { path: "/insights",  hold: 4200, scroll: true, caption: "Where the money actually went" },
  gst:       { path: "/gst",       hold: 4000, scroll: true, caption: "GSTR-1 and 3B working papers" },
  payments:  { path: "/payments",  hold: 3400, scroll: true, caption: "Who owes you, and for how long" },
};

const wanted = arg("steps", "dashboard,upload,invoices,insights,gst,payments")
  .split(",").map(s => s.trim()).filter(Boolean);
const unknown = wanted.filter(s => !STEPS[s]);
if (unknown.length) {
  console.error(`unknown step(s): ${unknown.join(", ")}\nknown: ${Object.keys(STEPS).join(", ")}`);
  process.exit(1);
}

if (!existsSync(AUTH)) {
  console.error(`no signed-in session at ${AUTH}.\nRun \`npx playwright test --project=desktop -g "landing page"\` once — global-setup writes it.`);
  process.exit(1);
}
try {
  const r = await fetch(BASE, { method: "HEAD" });
  if (!r.ok) throw new Error();
} catch {
  console.error(`dev server not answering at ${BASE}. Run \`npm run dev\`.`);
  process.exit(1);
}

const tmpDir = ".playwright-video";
await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH,
  viewport: { width: W, height: H },
  recordVideo: { dir: tmpDir, size: { width: W, height: H } },
  // A demo full of half-finished transitions looks broken rather than fast.
  reducedMotion: "no-preference",
});
const page = await ctx.newPage();

try {
  for (const name of wanted) {
    const s = STEPS[name];
    process.stdout.write(`  ${name} … `);
    await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded" });
    // Let data load and the reveal animations finish before holding the frame.
    await page.waitForTimeout(1800);
    // A stale session redirects to /auth, and the recorder would happily film a
    // login screen for thirty seconds. Fail instead.
    if (/\/auth/.test(page.url())) {
      throw new Error(`redirected to ${page.url()} — the saved session has expired.\n`
        + `  Refresh it: npx playwright test --project=desktop -g "landing page"`);
    }
    // A still per step, so the recording can be reviewed without playing it.
    await page.screenshot({ path: join(tmpDir, `${name}.png`) }).catch(() => {});
    if (s.scroll) {
      // Slow, eased scroll — a jump-cut to the bottom reads as a glitch.
      await page.evaluate(async () => {
        const el = document.querySelector("main") ?? document.scrollingElement;
        const target = Math.min(el.scrollHeight - el.clientHeight, el.clientHeight * 1.4);
        const start = performance.now(), dur = 2200;
        await new Promise(res => {
          const tick = (now) => {
            const p = Math.min(1, (now - start) / dur);
            el.scrollTop = target * (1 - Math.pow(1 - p, 3));
            p < 1 ? requestAnimationFrame(tick) : res();
          };
          requestAnimationFrame(tick);
        });
      }).catch(() => {});
    }
    await page.waitForTimeout(s.hold);
    console.log(`ok — "${s.caption}"`);
  }
} finally {
  await ctx.close();   // flushes the video file
  await browser.close();
}

const [file] = (await readdir(tmpDir)).filter(f => extname(f) === ".webm");
if (!file) { console.error("no video was recorded"); process.exit(1); }
const webm = join(tmpDir, file);
await mkdir(dirname(out), { recursive: true });

// Keep the per-step stills next to the output so the recording can be checked
// at a glance; only the raw webm and temp dir are thrown away.
const stillsDir = join(dirname(out), "demo-stills");
await rm(stillsDir, { recursive: true, force: true });
await mkdir(stillsDir, { recursive: true });
for (const f of (await readdir(tmpDir)).filter(f => extname(f) === ".png")) {
  await rename(join(tmpDir, f), join(stillsDir, f));
}

let ffmpeg = true;
try { await run("ffmpeg", ["-version"]); } catch { ffmpeg = false; }

if (!ffmpeg || extname(out) === ".webm") {
  const dest = out.replace(/\.mp4$/, ".webm");
  await rename(webm, dest);
  await rm(tmpDir, { recursive: true, force: true });
  console.log(`\nwrote ${dest}`);
  if (!ffmpeg) {
    console.log("\nffmpeg is not installed, so this is .webm — LinkedIn will NOT accept it.");
    console.log("  brew install ffmpeg");
    console.log("then re-run to get an .mp4.");
  }
} else {
  // yuv420p + even dimensions: without both, the file plays on a desktop and
  // shows a black rectangle on most phones.
  await run("ffmpeg", [
    "-y", "-i", webm,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-preset", "slow", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ]);
  await rm(tmpDir, { recursive: true, force: true });
  console.log(`\nwrote ${out}  (${W}x${H}, silent)`);
}
console.log(`stills for review: ${stillsDir}/`);
console.log("Check them before posting — a demo showing a spinner or an empty table is worse than no demo.");
