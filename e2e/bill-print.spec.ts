import { test, expect } from "@playwright/test";
import { db, e2eOrg, openSeededBill } from "./helpers";

/**
 * What a printed bill must not contain.
 *
 * A distributor prints a bill and hands it to a retailer. Two things were
 * landing on that sheet that have nothing to do with the sale: our own
 * "a new version of Dhela is ready" toast, printed across the header and
 * pushing out a second page carrying nothing else, and the extractor's
 * working notes from reading the bill off a photo — a paragraph of software
 * saying it could not make out the handwriting.
 */

test("a toast never prints on the bill", async ({ page }) => {
  test.setTimeout(120_000);
  await openSeededBill(page);

  // A real toast, raised the way the app raises one.
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.getByRole("checkbox", { name: "Batch", exact: true }).click();
  await page.getByRole("button", { name: /Use on this bill/ }).click();

  const toast = page.getByText("Columns updated");
  await expect(toast, "on screen it is shown").toBeVisible({ timeout: 30_000 });

  await page.emulateMedia({ media: "print" });
  await expect(toast, "on paper it is gone").toBeHidden();
  // The toaster itself, not just this toast — it is the fixed-position box
  // that pushes the extra sheet out.
  await expect(page.locator("[data-sonner-toaster]")).toBeHidden();

  await page.emulateMedia({ media: "screen" });
  await expect(toast, "and still shown back on screen").toBeVisible();
});

test("the reader's notes reach the operator and never the retailer", async ({ page }) => {
  test.setTimeout(120_000);
  const sb = db();
  const org = await e2eOrg(sb);
  const reader = "Handwriting very faint — verify quantities against the paper bill.";
  const printed = "Goods once sold will not be taken back.";

  const { data: bill } = await sb.from("sales_invoices")
    .select("id").eq("org_id", org).eq("invoice_number", "S-9").single();
  const id = (bill as { id: string }).id;

  try {
    await sb.from("sales_invoices")
      .update({ import_notes: reader, notes: printed }).eq("id", id);

    await openSeededBill(page);

    // On screen the operator sees both, and is told which is which.
    await expect(page.getByText(reader)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not printed on the bill/)).toBeVisible();
    await expect(page.getByText(printed)).toBeVisible();

    // On paper only the distributor's own terms survive.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(reader), "the extractor's doubts stay off the bill").toBeHidden();
    await expect(page.getByText(printed), "the terms they typed still print").toBeVisible();
  } finally {
    await page.emulateMedia({ media: "screen" });
    await sb.from("sales_invoices").update({ import_notes: null, notes: null }).eq("id", id);
  }
});

test("no sales bill is still carrying extractor prose in its printed notes", async () => {
  const sb = db();
  // The seven already in the database were moved to import_notes. This is the
  // guard against the importer quietly writing there again.
  const { data } = await sb.from("sales_invoices").select("invoice_number, notes").not("notes", "is", null);
  const suspicious = (data ?? []).filter((r) => {
    const n = (r.notes ?? "").trim();
    return n.length > 120 && !n.startsWith("Against order");
  });
  expect(suspicious.map(r => r.invoice_number), "printed notes should be the distributor's, not the reader's").toEqual([]);
});
