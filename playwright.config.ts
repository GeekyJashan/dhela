import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// .env.test holds the throwaway login; .env holds the Supabase keys the seed
// needs. Neither is committed.
for (const file of [".env", ".env.test"]) {
  const p = path.resolve(import.meta.dirname, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) {
      process.env[k] = line.slice(i + 1).trim().replace(/^["']/, "").replace(/["']$/, "");
    }
  }
}

const baseURL = process.env.E2E_BASE_URL || "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  // The suite shares one workspace, so parallel runs would fight over seeded
  // rows. Correctness beats speed at this size.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    storageState: "e2e/.auth/user.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // A synthetic microphone, so getUserMedia resolves and the realtime voice
    // path can actually be exercised. Without a device it fails before it
    // reaches any of the code worth testing.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Only start a dev server when pointing at localhost; if E2E_BASE_URL is a
  // deployed URL we just drive that.
  webServer: baseURL.includes("localhost")
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
