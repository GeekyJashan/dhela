import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * What a sales bill prints is the distributor's choice, with two things held
 * steady underneath it.
 *
 * A bill already issued keeps the layout it went out with, so a reprint pulled
 * months later matches the copy the retailer is holding. And the columns a tax
 * invoice is legally required to carry cannot be switched off, however the
 * request arrives — a layout posted by a stale tab is normalised on the way in
 * rather than trusted.
 */

function env() {
  return Object.fromEntries(
    fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
  );
}

const db = () => {
  const e = env();
  return createClient(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
};

/**
 * The org behind E2E_EMAIL, resolved explicitly.
 *
 * The service-role client bypasses RLS, so "select … limit 1" over a shared
 * table is whatever row the database felt like returning — which here was
 * another workspace's. A test that writes must say whose workspace it means.
 */
async function e2eOrg(sb: ReturnType<typeof db>) {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  const user = data.users.find(u => u.email === process.env.E2E_EMAIL);
  if (!user) throw new Error(`No user for E2E_EMAIL=${process.env.E2E_EMAIL}`);
  const { data: mem } = await sb.from("memberships")
    .select("org_id").eq("user_id", user.id).limit(1).single();
  return (mem as { org_id: string }).org_id;
}

/**
 * The visible <th> text of the printed line table, in order.
 *
 * Waits for a heading first: the screen renders "Loading…" with no table while
 * the query is in flight, and reading straight through that returns [] or the
 * layout from before a save landed.
 */
async function headings(page: Page) {
  // Polled rather than read once. Between routes there is a moment with no
  // table at all, and another where the table on screen is still the previous
  // route's — a single read lands in either and reports the wrong answer.
  let seen: string[] = [];
  await expect.poll(async () => {
    seen = await page.locator("table thead th").allInnerTexts();
    return seen.length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  return seen;
}

/** The list navigates on row click rather than through a link. */
async function openSeededBill(page: Page, number = "S-9") {
  await page.goto("/sales");
  // \b so S-9 does not also match S-10.
  const row = page.getByRole("row", { name: new RegExp(`\\b${number}\\b`) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.waitForURL(/\/sales\/[0-9a-f-]{36}/);
  await expect(page.locator("table thead th").first()).toBeVisible({ timeout: 30_000 });
}

test("a bill issued before columns were customisable still prints its original layout", async ({ page }) => {
  test.setTimeout(120_000);
  await openSeededBill(page);
  // Seeded rows carry no layout, which is what every pre-existing bill looks
  // like. They must render the eleven columns Dhela always printed.
  expect(await headings(page)).toEqual(
    ["#", "Description", "HSN", "Batch", "Qty", "Rate", "Disc%", "Taxable", "GST%", "Tax", "Total"],
  );
});

test("the columns a tax invoice must carry cannot be switched off", async ({ page }) => {
  test.setTimeout(120_000);
  await openSeededBill(page);
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bill columns" })).toBeVisible();

  for (const locked of ["Description", "HSN", "Qty", "Taxable", "GST%", "Tax", "Total"]) {
    const box = page.getByRole("checkbox", { name: locked, exact: true });
    await expect(box, `${locked} stays on`).toBeChecked();
    await expect(box, `${locked} cannot be unchecked`).toBeDisabled();
  }
  // Optional ones are genuinely optional.
  await expect(page.getByRole("checkbox", { name: "Batch", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Expiry", exact: true })).toBeEnabled();
});

test("switching Expiry on, and adding a column of your own, changes only that bill", async ({ page }) => {
  test.setTimeout(180_000);
  const sb = db();
  await openSeededBill(page);
  const url = page.url();
  const billId = url.split("/sales/")[1];

  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.getByRole("checkbox", { name: "Expiry", exact: true }).click();
  await page.getByRole("button", { name: /Add your own column/ }).click();
  await page.getByPlaceholder(/Column heading/).fill("Warranty");
  await page.getByRole("button", { name: /Use on this bill/ }).click();
  await expect(page.getByText("Columns updated")).toBeVisible({ timeout: 30_000 });
  // The toast fires on the save; the table redraws on the refetch after it.
  await expect(page.getByRole("columnheader", { name: "Expiry", exact: true }))
    .toBeVisible({ timeout: 30_000 });

  const after = await headings(page);
  expect(after, "expiry now has a column of its own").toContain("Expiry");
  expect(after, "and so does the one they named").toContain("Warranty");
  expect(after, "the mandatory ones are still there").toEqual(expect.arrayContaining(["HSN", "Taxable", "Tax"]));

  // The layout is stored on this bill, not on the workspace.
  const { data: inv } = await sb.from("sales_invoices").select("bill_columns").eq("id", billId).single();
  expect((inv!.bill_columns as { columns: string[] }).columns).toContain("expiry_date");

  const { data: org } = await sb.from("organizations")
    .select("bill_columns").eq("id", await e2eOrg(sb)).single();
  expect(org!.bill_columns, "the workspace default is untouched").toBeNull();

  // And a different bill is untouched.
  await openSeededBill(page, "S-10");
  expect(await headings(page), "the next bill still prints its own layout").not.toContain("Expiry");
});

test("a layout missing a mandatory column is repaired rather than rendered", async ({ page }) => {
  test.setTimeout(120_000);
  const sb = db();
  await openSeededBill(page);
  const billId = page.url().split("/sales/")[1];

  // Exactly what a stale tab, or a hand-written row, could put in the column.
  await sb.from("sales_invoices")
    .update({ bill_columns: { columns: ["description", "quantity", "nonsense"], custom: [], fields: [] } })
    .eq("id", billId);

  await page.reload();
  await expect(page.getByRole("columnheader", { name: "HSN", exact: true }))
    .toBeVisible({ timeout: 30_000 });
  const h = await headings(page);
  expect(h, "HSN is put back").toContain("HSN");
  expect(h, "so is the tax").toContain("Tax");
  expect(h, "a column that does not exist is dropped").not.toContain("nonsense");
});

test("a workspace default reaches a new bill: typed on the line, printed on the bill", async ({ page }) => {
  test.setTimeout(180_000);
  const sb = db();
  const org = await e2eOrg(sb);

  // The workspace sets its default once, on Account.
  await sb.from("organizations").update({
    bill_columns: {
      columns: ["line_no", "description", "hsn", "expiry_date", "quantity", "rate",
                "taxable_value", "gst_rate", "tax_amount", "line_total", "custom:w1"],
      custom: [{ id: "w1", label: "Warranty" }],
      fields: ["Transport"],
    },
  }).eq("id", org);

  try {
    await page.goto("/sales/new");

    // Whatever is switched on is what the entry table asks for — Batch is off
    // here, so it stops being asked for, and Expiry starts being asked for.
    await expect(page.getByRole("columnheader", { name: "Expiry", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("columnheader", { name: "Warranty", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Batch", exact: true })).toHaveCount(0);

    await page.getByRole("combobox").filter({ hasText: /Choose retailer/ }).click();
    await page.getByRole("option").first().click();
    await page.getByRole("combobox").filter({ hasText: /Pick product/ }).first().click();
    await page.getByRole("option").first().click();

    await page.getByRole("textbox", { name: "Expiry", exact: true }).fill("2027-03-31");
    await page.getByRole("textbox", { name: "Warranty", exact: true }).fill("2 years onsite");
    await page.getByRole("textbox", { name: "Field value", exact: true }).first().fill("Blue Dart");

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText("Tax Invoice")).toBeVisible({ timeout: 30_000 });

    const h = await headings(page);
    expect(h, "the bill prints what the workspace chose").toEqual(
      ["#", "Description", "HSN", "Expiry", "Qty", "Rate", "Taxable", "GST%", "Tax", "Total", "Warranty"],
    );
    await expect(page.getByRole("cell", { name: "2 years onsite" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "2027-03-31" })).toBeVisible();
    await expect(page.getByText("Blue Dart")).toBeVisible();

    // Expiry went into its own typed column, not into the free-text blob.
    const billId = page.url().split("/sales/")[1];
    const { data: lines } = await sb.from("sales_invoice_lines")
      .select("expiry_date, extra").eq("sales_invoice_id", billId);
    expect(lines![0].expiry_date, "a real date in a real column").toBe("2027-03-31");
    expect(lines![0].extra, "and only the custom value in extra").toEqual({ w1: "2 years onsite" });

    const { data: saved } = await sb.from("sales_invoices")
      .select("extra").eq("id", billId).single();
    expect(saved!.extra, "the bill-level field keyed by its own label").toEqual({ Transport: "Blue Dart" });
  } finally {
    await sb.from("organizations").update({ bill_columns: null }).eq("id", org);
  }
});
