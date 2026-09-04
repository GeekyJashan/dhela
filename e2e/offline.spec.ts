import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Losing signal mid-batch must be a wait, not a loss.
 *
 * Before this, a dropped connection marked every remaining photo red and a
 * reload lost the files entirely: the one feature that makes Dhela worth using,
 * failing in the exact place it is used, a godown with two bars.
 */

/** A real JPEG, small enough to inline. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function fixture(name: string) {
  const dir = "/tmp/dhela-offline-fixtures";
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JPEG);
  return p;
}

/** How many photos are sitting in IndexedDB on the device right now. */
function countQueued(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open("dhela-offline", 1);
        r.onsuccess = () => {
          const db = r.result;
          const c = db.transaction("uploads", "readonly").objectStore("uploads").count();
          c.onsuccess = () => resolve(c.result);
          c.onerror = () => resolve(-1);
        };
        r.onerror = () => resolve(-1);
      }),
  );
}

test("photos taken with no signal are held, then sent when it returns", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(180_000);

  const files = [1, 2, 3, 4, 5].map((n) => fixture(`offline-${Date.now()}-${n}.jpg`));

  // Visited while there is still a signal. In dev the route's code is fetched
  // on demand, so a screen never opened cannot render offline whatever the
  // cache holds. This mirrors the real case anyway: the operator has been in
  // the app, then walks into the godown.
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /^Products$/ })).toBeVisible({ timeout: 30_000 });

  await page.goto("/upload");
  await expect(page.getByRole("heading", { name: "Upload bills" })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('input[type="file"][multiple]').first().setInputFiles(files);
  // OCR keeps the model out of it: this test is about the network, and the
  // daily AI allowance should not decide whether it passes.
  await page.getByText(/OCR \(free\)/).click();

  // The signal goes, mid-batch.
  await context.setOffline(true);
  await page.getByRole("button", { name: /Upload & extract/i }).click();

  // Held, not failed, and said out loud.
  await expect(page.getByText(/Waiting for network/).first()).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(/photo\(s\) are waiting|are saved on this device/i).first(),
  ).toBeVisible({ timeout: 30_000 });

  // Polled, not read once. The rows are queued one at a time, so the banner
  // and the first "Waiting for network" appear before the last photo has been
  // written. Reading the count at that moment gave 4 of 5.
  await expect
    .poll(() => countQueued(page), { timeout: 30_000, message: "all five photos on the device" })
    .toBe(5);

  // Offline *reading* is not asserted here, deliberately. It is the service
  // worker that serves the shell with no network, and the worker is not
  // registered in dev, which is what this suite runs against. Asserting it
  // here would either pass for the wrong reason or force the worker on in
  // development, where it fights hot reload. It is verified against a real
  // build instead, and the worker's rules are pinned below.

  // Signal returns. The queue should drain by itself, with nobody pressing
  // anything.
  await context.setOffline(false);
  await page
    .getByRole("link", { name: /Upload bill/ })
    .first()
    .click();

  await expect
    .poll(() => countQueued(page), {
      timeout: 90_000,
      message: "the queue should empty itself once back online",
    })
    .toBe(0);

  // The flush really does enqueue five bills, so this test creates five rows
  // every run. Cleaned up, or the invoice list fills with rubbish nobody put
  // there and the next person debugging a failed read chases ghosts.
  const { createClient } = await import("@supabase/supabase-js");
  const env = Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  for (const f of files) {
    const name = f.split("/").pop();
    const { data: made } = await db.from("invoices").select("id").like("storage_path", `%${name}`);
    for (const row of made ?? []) {
      await db.from("invoice_lines").delete().eq("invoice_id", row.id);
      await db.from("invoices").delete().eq("id", row.id);
    }
  }
});

/**
 * The worker's rules, pinned.
 *
 * Its behaviour cannot be exercised here: it is not registered in dev, which is
 * what this suite runs against. It was verified by hand against a production
 * build, where an offline reload renders the app instead of the browser's error
 * page. What follows guards the rules that make that safe, because the failure
 * mode of getting them wrong is showing somebody yesterday's stock as today's,
 * or replaying a write and creating a second invoice.
 */
test("the service worker never touches a write, and forgets data on sign out", () => {
  const sw = fs.readFileSync("src/sw.template.js", "utf8");

  // The single most important line in the file. A queued or replayed POST is
  // how you get a duplicate invoice.
  expect(sw).toMatch(/if \(req\.method !== "GET"\) return;/);

  // Reads are network-first: fresh whenever there is a signal, last-known only
  // when there is not, and tagged so the UI can tell the difference.
  expect(sw).toMatch(/x-dhela-from-cache/);

  // One workspace's stock and rates must not outlive its session on a shared
  // godown phone.
  expect(sw).toMatch(/clear-data-cache/);
  const root = fs.readFileSync("src/routes/__root.tsx", "utf8");
  expect(root).toMatch(/SIGNED_OUT[\s\S]{0,200}clear-data-cache/);

  // Registered, and only where it belongs. In dev it fights hot reload.
  expect(root).toMatch(/navigator\.serviceWorker/);
  expect(root).toMatch(/\.register\(\s*"\/sw\.js"\s*\)/);
  expect(root).toMatch(/import\.meta\.env\.DEV/);
  expect(root).toMatch(/rel: "manifest"/);

  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  expect(manifest.start_url).toBe("/dashboard");
  expect(manifest.display).toBe("standalone");
});
