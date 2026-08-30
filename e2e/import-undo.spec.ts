import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * An import can be taken back — and knows what it must not take back.
 *
 * The dry run stops a bad mapping. Nothing stops a bad file, and "I imported
 * last year's export over the top of this year's" needs an answer better than
 * restoring the database. But undo is only safe if it is conservative: a value
 * somebody has edited since is their work, not the importer's to discard.
 *
 * So this drives two real imports over the same two parties, edits one of them
 * by hand in between, and checks that undo puts back exactly the one nobody
 * touched.
 */

function env() {
  return Object.fromEntries(
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
}

async function importRetailers(page: Page, csv: string, expectSummary: RegExp) {
  await page.goto("/import");
  await page.getByRole("radio", { name: /Retailers/i }).click();
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: /Read the columns/i }).click();
  await expect(page.locator("[data-column]")).toHaveCount(2, { timeout: 60_000 });
  // Set by hand so the test still runs on a day the model is rate-limited.
  const choose = async (column: string, option: RegExp) => {
    await page.locator(`[data-column="${column}"]`).getByRole("combobox").click();
    await page.getByRole("option", { name: option }).click();
  };
  await choose("Party Name", /^name —/);
  await choose("City", /^city —/);
  await page.getByRole("button", { name: /Check what will happen/i }).click();
  await expect(page.getByText(expectSummary)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Import \d+ rows$/i }).click();
  await expect(page.getByText(/created,/)).toBeVisible({ timeout: 30_000 });
}

test("an import can be taken back, except where someone has since edited it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(240_000);

  const e = env();
  const db = createClient(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  page.on("dialog", (d) => d.accept());

  const stamp = Date.now();
  const a = `UNDOTEST A ${stamp}`;
  const b = `UNDOTEST B ${stamp}`;
  const cityOf = async (name: string) => {
    const { data } = await db.from("retailers").select("city").eq("name", name).maybeSingle();
    return data?.city ?? null;
  };

  try {
    // First import creates both.
    await importRetailers(
      page,
      `Party Name,City\n${a},Ludhiana\n${b},Ludhiana`,
      /2 new, 0 updated/,
    );
    expect(await cityOf(a)).toBe("Ludhiana");
    expect(await cityOf(b)).toBe("Ludhiana");

    // Second import moves both. Matched on name, so updated rather than doubled.
    await importRetailers(
      page,
      `Party Name,City\n${a},Amritsar\n${b},Amritsar`,
      /0 new, 2 updated/,
    );
    expect(await cityOf(a)).toBe("Amritsar");
    expect(await cityOf(b)).toBe("Amritsar");

    // Then somebody edits one of them by hand, the way they would in the app.
    await db.from("retailers").update({ city: "Delhi" }).eq("name", a);

    // Undo the second import. B goes back; A is left alone, because the value
    // sitting there is no longer the one the import wrote.
    await page.goto("/import");
    await expect(page.getByText(/What you have brought in/)).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: /^Undo$/ })
      .first()
      .click();
    await expect(page.getByText(/put back/)).toBeVisible({ timeout: 30_000 });

    expect(await cityOf(b), "nobody touched B, so it goes back").toBe("Ludhiana");
    expect(await cityOf(a), "A was edited since, so the edit stands").toBe("Delhi");
    // And it must say so rather than reporting a clean undo. Said twice on
    // purpose — once in the toast, once on the run in the history — so first()
    // rather than a stricter locator.
    await expect(page.getByText(/edited since the import/).first()).toBeVisible();

    // Undo the first import: these rows were created by it, so they go.
    await page.reload();
    await page
      .getByRole("button", { name: /^Undo$/ })
      .first()
      .click();
    await expect(page.getByText(/removed/)).toBeVisible({ timeout: 30_000 });
    expect(await cityOf(a), "created by that import, so removed").toBeNull();
    expect(await cityOf(b), "created by that import, so removed").toBeNull();

    // A run already undone cannot be undone twice.
    await page.reload();
    await expect(page.getByText(/undone/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await db.from("retailers").delete().in("name", [a, b]);
  }
});

/**
 * Undo will not remove a product that has already been billed against.
 *
 * This is the case that would be unforgivable: deleting an imported product
 * that has since gone onto an invoice would either fail loudly or, if the
 * foreign key had been written with ON DELETE CASCADE, quietly take the
 * invoice line with it and change a filed return. It relies on the database
 * refusing, so it is worth proving the database actually refuses.
 */
test("undo leaves behind anything already used on a bill", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(240_000);

  const e = env();
  const db = createClient(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  page.on("dialog", (d) => d.accept());

  const name = `BILLEDTEST ${Date.now()}`;
  let productId: string | null = null;
  let invoiceId: string | null = null;
  try {
    await page.goto("/import");
    await page.locator("textarea").fill(`Item Name,Closing Qty\n${name},5`);
    await page.getByRole("button", { name: /Read the columns/i }).click();
    await expect(page.locator("[data-column]")).toHaveCount(2, { timeout: 60_000 });
    for (const [col, opt] of [
      ["Item Name", /^name —/],
      ["Closing Qty", /^current_stock —/],
    ] as [string, RegExp][]) {
      await page.locator(`[data-column="${col}"]`).getByRole("combobox").click();
      await page.getByRole("option", { name: opt }).click();
    }
    await page.getByRole("button", { name: /Check what will happen/i }).click();
    await expect(page.getByText(/1 new, 0 updated/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Import 1 rows$/i }).click();
    await expect(page.getByText(/1 created/)).toBeVisible({ timeout: 30_000 });

    const { data: prod } = await db.from("products").select("id, org_id").eq("name", name).single();
    productId = prod!.id;

    // Put it on a purchase bill, the way a week of trading would.
    const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
    const u = users.users.find((x) => x.email === process.env.E2E_EMAIL)!;
    const { data: inv } = await db
      .from("invoices")
      .insert({
        org_id: prod!.org_id,
        uploaded_by: u.id,
        storage_path: `${prod!.org_id}/billedtest.jpg`,
        mime_type: "image/jpeg",
        status: "review",
        extraction_engine: "ocr",
        supplier_name: "BILLEDTEST",
        invoice_number: `BT-${Date.now()}`,
      })
      .select("id")
      .single();
    invoiceId = inv!.id;
    await db.from("invoice_lines").insert([
      {
        invoice_id: invoiceId,
        org_id: prod!.org_id,
        line_no: 1,
        raw_description: name,
        matched_product_id: productId,
        quantity: 1,
        rate: 10,
        gst_rate: 18,
        taxable_value: 10,
      },
    ]);

    await page.goto("/import");
    await page
      .getByRole("button", { name: /^Undo$/ })
      .first()
      .click();
    await expect(page.getByText(/already used on a bill/).first()).toBeVisible({
      timeout: 30_000,
    });

    const { data: still } = await db.from("products").select("id").eq("id", productId);
    expect(still, "the product is on a bill, so it stays").toHaveLength(1);
    const { data: lines } = await db
      .from("invoice_lines")
      .select("id")
      .eq("matched_product_id", productId);
    expect(lines, "and the bill still refers to it").toHaveLength(1);
  } finally {
    if (invoiceId) await db.from("invoice_lines").delete().eq("invoice_id", invoiceId);
    if (invoiceId) await db.from("invoices").delete().eq("id", invoiceId);
    if (productId) await db.from("products").delete().eq("id", productId);
  }
});
