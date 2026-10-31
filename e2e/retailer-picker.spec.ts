import { test, expect } from "@playwright/test";
import { db, e2eOrg } from "./helpers";

/**
 * A bill can name a shop that is not on the list yet.
 *
 * The retailer field used to be a plain dropdown, so the only billable
 * customers were ones already keyed in elsewhere. A distributor raising their
 * first bills hits that at once: the shop in front of them is not in the list
 * and the bill cannot start.
 *
 * The part worth guarding is not the typing, it is the state code. Creating a
 * retailer without one just moves the dead end — the bill keys fine and then
 * refuses to issue, which is worse than being stopped early.
 */

test("the retailer box filters as you type", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/sales/new");
  await page.getByRole("combobox", { name: "Retailer", exact: true }).click();
  await page.getByPlaceholder(/Search, or type a new name/).fill("zzz-no-such-shop");
  await expect(page.getByText(/No retailer by that name yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add "zzz-no-such-shop"/ })).toBeVisible();
});

test("a shop that is not on the list can be named on the bill and billed", async ({ page }) => {
  test.setTimeout(180_000);
  const sb = db();
  const shop = `QUICKADD STORE ${Date.now()}`;
  let createdId: string | null = null;

  try {
    await page.goto("/sales/new");
    await page.getByRole("combobox", { name: "Retailer", exact: true }).click();
    await page.getByPlaceholder(/Search, or type a new name/).fill(shop);
    await page.getByRole("button", { name: new RegExp(`Add "${shop}"`) }).click();

    // The name typed into the search carries into the form.
    await expect(page.getByLabel("Business name *")).toHaveValue(shop);

    // State is required even with no GSTIN, because it is what decides the
    // tax head — without it the bill would key fine and refuse to issue.
    await expect(page.getByRole("button", { name: "Add and use" })).toBeDisabled();
    await page.getByRole("combobox", { name: "State", exact: true }).click();
    await page.getByRole("option", { name: /^03 —/ }).click();
    await page.getByRole("button", { name: "Add and use" }).click();

    // Created, selected, and the bill in progress is still there.
    await expect(page.getByText(`${shop} added`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("combobox", { name: "Retailer", exact: true }))
      .toContainText(shop, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/sales\/new/);

    const { data: made } = await sb.from("retailers")
      .select("id, name, gstin, state_code")
      .eq("org_id", await e2eOrg(sb)).eq("name", shop).single();
    createdId = made!.id;
    expect(made!.gstin, "no GSTIN is allowed — an unregistered shop is a normal B2C sale").toBeNull();
    expect(made!.state_code, "but the state is captured, so the bill can be issued").toBe("03");

    // And it is now a normal pick on the next bill.
    await page.goto("/sales/new");
    await page.getByRole("combobox", { name: "Retailer", exact: true }).click();
    await page.getByPlaceholder(/Search, or type a new name/).fill("QUICKADD");
    await expect(page.getByRole("option", { name: new RegExp(shop) })).toBeVisible();
  } finally {
    if (createdId) await sb.from("retailers").delete().eq("id", createdId);
  }
});

test("a shop already on the list is not offered again as a new one", async ({ page }) => {
  test.setTimeout(120_000);
  const sb = db();
  const { data: existing } = await sb.from("retailers")
    .select("name").eq("org_id", await e2eOrg(sb)).limit(1).single();
  const name = (existing as { name: string }).name;

  await page.goto("/sales/new");
  await page.getByRole("combobox", { name: "Retailer", exact: true }).click();
  await page.getByPlaceholder(/Search, or type a new name/).fill(name);
  await expect(page.getByRole("option", { name: new RegExp(name.slice(0, 12)) })).toBeVisible();
  // Typing a name that already exists must not offer to duplicate it.
  await expect(page.getByRole("button", { name: new RegExp(`Add "${name}"`) })).toHaveCount(0);
});
