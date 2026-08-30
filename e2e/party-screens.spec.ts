import { test, expect } from "@playwright/test";

/**
 * The three list screens still render after their queries stopped using "*".
 *
 * Naming columns is what keeps the `extra` blob off a list load, but it swaps
 * one failure mode for another: forget a column and the page renders blank or
 * throws, with nothing failing at build time. TypeScript catches a field the
 * code reads; it cannot catch a screen that no longer paints. These three had
 * no browser coverage at all, which is why this exists.
 */
for (const screen of [
  { path: "/products", heading: /^Products$/, empty: "No products yet." },
  { path: "/suppliers", heading: /^Suppliers$/, empty: "No suppliers yet." },
  { path: "/retailers", heading: /^Retailers$/, empty: "No retailers yet." },
]) {
  test(`${screen.path} renders with its columns named`, async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|hydrat/i.test(m.text())) failures.push(m.text());
    });

    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading })).toBeVisible({
      timeout: 30_000,
    });
    // Seeded rows, not just the shell. A select naming a column that does not
    // exist fails silently — react-query keeps the error, the heading and the
    // table head still paint, and the only visible difference is the empty
    // state. So the empty state is what this asserts against.
    await expect(page.locator("table thead")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(screen.empty),
      `${screen.path} loaded no rows — the query probably failed`,
    ).toHaveCount(0);
    expect(failures, `${screen.path} logged errors`).toEqual([]);
  });
}
