import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * An imported party arrives knowing which state it is in.
 *
 * The first two digits of a GSTIN are the state — a fact carried in the
 * number, not an inference. Where it is missing, GSTR-1 falls back to the
 * distributor's own state for place of supply, so an out-of-state retailer
 * books as CGST/SGST where IGST belongs. The retailer form has always derived
 * this from the GSTIN lookup; the importer did not, and nothing said so.
 */
test("an imported party gets the state its GSTIN already states", async ({ page }, testInfo) => {
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

  // 27 is Maharashtra; the workspace itself is not there, which is the case
  // that goes wrong silently.
  const far = `STATETEST FAR ${Date.now()}`;
  // Fifteen characters but not a GSTIN — nothing to derive, and inventing a
  // state from it would be worse than leaving it blank.
  const junk = `STATETEST JUNK ${Date.now()}`;

  await page.goto("/import");
  await page.getByRole("radio", { name: /Retailers/i }).click();
  await page
    .locator("textarea")
    .fill(`Party Name,GST No\n${far},27AAACT2727Q1ZW\n${junk},ABC1234566789RD`);
  await page.getByRole("button", { name: /Read the columns/i }).click();

  await expect(page.locator("[data-column]")).toHaveCount(2, { timeout: 60_000 });
  const choose = async (column: string, option: RegExp) => {
    await page.locator(`[data-column="${column}"]`).getByRole("combobox").click();
    await page.getByRole("option", { name: option }).click();
  };
  await choose("Party Name", /^name —/);
  await choose("GST No", /^gstin —/);

  await page.getByRole("button", { name: /Check what will happen/i }).click();
  await expect(page.getByText(/2 new, 0 updated/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Import 2 rows/i }).click();
  await expect(page.getByText(/2 created/)).toBeVisible({ timeout: 30_000 });

  const { data: rows } = await db
    .from("retailers")
    .select("id, name, gstin, state_code")
    .in("name", [far, junk]);
  expect(rows, "both retailers were created").toHaveLength(2);
  try {
    const a = rows!.find((r) => r.name === far)!;
    const b = rows!.find((r) => r.name === junk)!;
    expect(a.state_code, "27AAACT… is Maharashtra").toBe("27");
    expect(b.state_code, "not a GSTIN, so no state is invented").toBeNull();
  } finally {
    await db
      .from("retailers")
      .delete()
      .in(
        "id",
        rows!.map((r) => r.id),
      );
  }
});
