import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * A column the old software had and Dhela has no field for survives the trip.
 *
 * The guard tests around this one read the source; this one runs the real
 * thing — the actual mapping screen, the actual server function, the actual
 * row — because "it is stored" and "the operator can find it" are different
 * claims and only the second one is worth anything.
 */
test("a column we have no field for is kept, and shows on the record", async ({
  page,
}, testInfo) => {
  // One project is enough: the mapping step calls the model, and the daily
  // free-tier allowance is small enough that doubling it for a second viewport
  // buys nothing.
  test.skip(testInfo.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(180_000);

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
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const name = `EXTRATEST WIDGET ${Date.now()}`;
  await page.goto("/import");

  // Headings nothing like ours, which is the normal case: "Rack" is a real bin
  // location, not derivable from anything else, and has nowhere to live.
  await page.locator("textarea").fill(`Item Name,Rack,Closing Qty\n${name},A-01,7`);
  await page.getByRole("button", { name: /Read the columns/i }).click();

  // Set each column by hand rather than trusting the proposal — this test is
  // about what happens after the operator decides, and it must still pass on a
  // day the model is rate-limited.
  await expect(page.locator("[data-column]")).toHaveCount(3, { timeout: 60_000 });
  const choose = async (column: string, option: RegExp) => {
    await page.locator(`[data-column="${column}"]`).getByRole("combobox").click();
    await page.getByRole("option", { name: option }).click();
  };
  await choose("Item Name", /^name —/);
  await choose("Rack", /Keep as extra info/);
  await choose("Closing Qty", /^current_stock —/);

  await page.getByRole("button", { name: /Check what will happen/i }).click();
  await expect(page.getByText(/1 new, 0 updated/)).toBeVisible({ timeout: 30_000 });
  // The screen has to say what it is doing with the column it cannot place.
  await expect(page.getByText(/1 column\(s\) kept as extra info/)).toBeVisible();

  await page.getByRole("button", { name: /Import 1 rows/i }).click();
  await expect(page.getByText(/1 created/)).toBeVisible({ timeout: 30_000 });

  // What actually landed on the row.
  const { data: rows } = await db
    .from("products")
    .select("id, name, current_stock, extra, has_extra")
    .eq("name", name);
  expect(rows, "the product was created").toHaveLength(1);
  const row = rows![0];
  try {
    expect(row.extra, "the rack code is kept under its own heading").toEqual({ Rack: "A-01" });
    expect(row.has_extra, "the generated flag follows the column").toBe(true);
    expect(Number(row.current_stock), "the mapped columns still import normally").toBe(7);

    // And an operator can find it: open the product and read it off the screen.
    await page.goto("/products");
    await page
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: /Edit product/i })
      .click();
    await expect(page.getByText(/From your old system/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("A-01")).toBeVisible();
    // Said plainly, or someone assumes a value kept here is costing their stock.
    await expect(page.getByText(/not used in any pricing, stock or tax calculation/)).toBeVisible();
    await page.keyboard.press("Escape");

    // And it can be found by it. The catalogue query does not load `extra`, so
    // this only works if the search asks the database — which is the whole
    // point: kept, visible, and findable, not just kept.
    //
    // Asserted on the filtered count first, deliberately. The search is
    // debounced, so "is the row visible" answers yes for the first quarter
    // second no matter what the filter does, and an earlier version of this
    // test passed against a search that was not wired up at all.
    await page.getByPlaceholder(/Search name, SKU, HSN/).fill("A-01");
    await expect(page.getByText(/Catalog \(1 of \d+\)/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

    // A rack code that matches nothing must not quietly return the catalogue,
    // and must say so rather than showing an empty table.
    await page.getByPlaceholder(/Search name, SKU, HSN/).fill("Z-99");
    await expect(page.getByText(/Catalog \(0 of \d+\)/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  } finally {
    await db.from("products").delete().eq("id", row.id);
  }
});
