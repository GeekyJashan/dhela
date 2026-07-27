/**
 * A long-lived Chrome profile that Claude can drive end to end.
 *
 * Why this exists: Playwright MCP's --extension mode attaches to your real
 * browser through Chrome's chrome.debugger API, and Chrome blocks
 * DOM.setFileInputFiles on that path — so uploads fail with "Not allowed".
 * A browser Playwright launches itself has no such restriction.
 *
 *   node scripts/browser-session.mjs login    # opens a window; sign in, then close it
 *   node scripts/browser-session.mjs check    # reports which sites are signed in
 *
 * The profile lives outside the repo and holds only what you sign into. Keep it
 * to the accounts that need automating — it is a standing credential, and the
 * point of a separate profile is that a mistake here cannot touch your email.
 */
import { chromium } from "@playwright/test";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROFILE = join(homedir(), ".dhela-browser");

/** Persistent context: cookies and localStorage survive between runs. */
export async function open({ headless = false } = {}) {
  return chromium.launchPersistentContext(PROFILE, {
    headless,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

// Only act as a CLI when run directly — post.mjs imports open() from here, and
// without this guard that import would print usage and misread its argv.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const cmd = isMain ? process.argv[2] : null;

if (!isMain) {
  // imported as a library; nothing to do
} else if (cmd === "login") {
  const ctx = await open();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.linkedin.com/login");
  console.log(`Profile: ${PROFILE}`);
  console.log("Sign in, then close the browser window when you're done.");
  await ctx.waitForEvent("close", { timeout: 0 });
  console.log("Saved.");
} else if (cmd === "check") {
  const ctx = await open({ headless: true });
  const page = await ctx.newPage();
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const url = page.url();
  console.log(`linkedin: ${/login|authwall|uas/.test(url) ? "SIGNED OUT" : "signed in"}  (${url})`);
  await ctx.close();
} else {
  console.log("usage: node scripts/browser-session.mjs [login|check]");
}
