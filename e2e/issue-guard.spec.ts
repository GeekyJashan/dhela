import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * An invoice carrying GST is not issued until the tax head can be worked out.
 *
 * Two state codes decide IGST against CGST plus SGST. With either missing there
 * is no answer, and the old behaviour was to assume intra-state and charge
 * CGST plus SGST anyway. Issuing freezes that, so the wrong head ends up on a
 * real invoice and needs a credit note to undo. Three of the six issued
 * invoices in the live database were raised that way.
 *
 * Checked on the server rather than only in the screen: the screen can be
 * skipped, and this is the last point at which being wrong is still cheap.
 */
test("a taxed invoice will not issue while a state code is missing", async ({ page }) => {
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
  page.on("dialog", (d) => d.accept());

  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const u = users.users.find((x) => x.email === process.env.E2E_EMAIL)!;
  const { data: mem } = await db
    .from("memberships")
    .select("org_id")
    .eq("user_id", u.id)
    .limit(1)
    .single();
  const org = (mem as { org_id: string }).org_id;

  const stamp = Date.now();
  let retailerId: string | null = null;
  let invoiceId: string | null = null;
  let productId: string | null = null;
  try {
    // A retailer with no state code, which is exactly the shape that went wrong.
    const { data: ret } = await db
      .from("retailers")
      .insert({ org_id: org, name: `GUARDTEST RETAILER ${stamp}`, state_code: null, category: "C" })
      .select("id")
      .single();
    retailerId = ret!.id;

    const { data: prod } = await db
      .from("products")
      .insert({ org_id: org, name: `GUARDTEST ITEM ${stamp}`, current_stock: 100, avg_cost: 10, gst_rate: 18 })
      .select("id")
      .single();
    productId = prod!.id;

    // A draft carrying ₹180 of GST.
    const { data: inv, error: invErr } = await db
      .from("sales_invoices")
      .insert({
        org_id: org,
        retailer_id: retailerId,
        invoice_number: `GT-${stamp}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        is_interstate: false,
        subtotal: 1000,
        cgst_total: 90,
        sgst_total: 90,
        igst_total: 0,
        grand_total: 1180,
        created_by: u.id,
      })
      .select("id")
      .single();
    if (invErr) throw new Error("seed invoice: " + invErr.message);
    invoiceId = inv!.id;
    await db.from("sales_invoice_lines").insert([
      {
        sales_invoice_id: invoiceId,
        org_id: org,
        line_no: 1,
        description: `GUARDTEST ITEM ${stamp}`,
        product_id: productId,
        quantity: 10,
        rate: 100,
        gst_rate: 18,
        taxable_value: 1000,
        cgst_amount: 90,
        sgst_amount: 90,
      },
    ]);

    // Issuing must be refused, and must say why in terms the operator can act on.
    await page.goto("/sales");
    const row = page.getByRole("row", { name: new RegExp(`GT-${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /^Issue$/ }).click();
    await expect(page.getByText(/no state code on GUARDTEST RETAILER/i)).toBeVisible({
      timeout: 30_000,
    });

    const { data: after } = await db
      .from("sales_invoices")
      .select("status")
      .eq("id", invoiceId)
      .single();
    expect(after!.status, "still a draft").toBe("draft");
    const { data: stock } = await db
      .from("products")
      .select("current_stock")
      .eq("id", productId)
      .single();
    expect(Number(stock!.current_stock), "stock is untouched by a refused issue").toBe(100);

    // With the state code filled in, the same invoice issues. A guard that
    // blocks everything is not a guard, it is an outage.
    await db.from("retailers").update({ state_code: "03" }).eq("id", retailerId);
    await page.reload();
    await page
      .getByRole("row", { name: new RegExp(`GT-${stamp}`) })
      .getByRole("button", { name: /^Issue$/ })
      .click();

    // Asserted against the row rather than any "issued" text on the page:
    // other rows are already issued, so a page-wide match would pass whatever
    // happened here.
    await expect(
      page.getByRole("row", { name: new RegExp(`GT-${stamp}`) }).getByText("issued"),
    ).toBeVisible({ timeout: 30_000 });

    const { data: done } = await db
      .from("sales_invoices")
      .select("status")
      .eq("id", invoiceId)
      .single();
    expect(done!.status, "issues once the state code is there").toBe("issued");
  } finally {
    if (invoiceId) {
      await db.from("sales_invoice_lines").delete().eq("sales_invoice_id", invoiceId);
      await db.from("sales_invoices").delete().eq("id", invoiceId);
    }
    if (productId) await db.from("products").delete().eq("id", productId);
    if (retailerId) await db.from("retailers").delete().eq("id", retailerId);
  }
});
