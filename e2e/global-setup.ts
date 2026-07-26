import { chromium, type FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";
// @ts-expect-error — plain ESM module, no types needed for a test helper
import { resolveAccount, wipe, seed } from "./seed.mjs";

/**
 * Wipe and re-seed the workspace, then log in once and save the session for
 * every test to reuse. Doing the reset here rather than per-test is what makes
 * the suite repeatable: `npm run test:e2e` twice in a row gives the same result.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set — copy .env.test.example to .env.test");
  }

  const { orgId, userId } = await resolveAccount();
  await wipe(orgId);
  const counts = await seed(orgId, userId);
  console.log(`[e2e] seeded ${email}: ${JSON.stringify(counts)}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/auth");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  const authDir = path.resolve(import.meta.dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: path.join(authDir, "user.json") });
  await browser.close();
  console.log("[e2e] signed in, session saved");
}
