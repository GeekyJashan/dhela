import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Seeds inside the run, after global setup has wiped, then approves through the
// real UI and reads what actually landed on the product.
test("approving a discounted bill costs what was paid", async ({ page }) => {
  test.setTimeout(180_000);
  const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n")
    .filter(l => l.includes("=")).map(l => { const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const u = users.users.find(x => x.email === process.env.E2E_EMAIL)!;
  const { data: mem } = await db.from("memberships").select("org_id").eq("user_id", u.id).limit(1).single();
  const org = (mem as { org_id: string }).org_id;

  // Fresh product: avg_cost after one purchase is then unambiguous.
  const { data: prod } = await db.from("products").insert({
    org_id: org, name: `COSTTEST ${Date.now()}`, current_stock: 0, avg_cost: 0, gst_rate: 18,
  }).select("id").single();
  const { data: inv } = await db.from("invoices").insert({
    org_id: org, uploaded_by: u.id, storage_path: `${org}/costtest.jpg`, mime_type: "image/jpeg",
    status: "review", extraction_engine: "ai", supplier_name: "COSTTEST", invoice_number: `CT-${Date.now()}`,
    subtotal: 8757, tax_total: 1576.26, grand_total: 10333.26,
  }).select("id").single();
  // 40 @ 486.50 less 55% = 8757.00 paid => 218.925 per unit.
  await db.from("invoice_lines").insert([{
    invoice_id: inv!.id, org_id: org, line_no: 1, raw_description: "COSTTEST WIDGET",
    matched_product_id: prod!.id, quantity: 40, free_quantity: 0,
    rate: 486.5, discount_pct: 55, gst_rate: 18, taxable_value: 8757,
  }]);

  page.on("dialog", d => d.accept());
  await page.goto(`/invoices/${inv!.id}`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  await page.getByRole("button", { name: /Approve/i }).click();
  await page.waitForTimeout(8000);

  const { data: after } = await db.from("products")
    .select("current_stock, avg_cost, last_purchase_rate").eq("id", prod!.id).single();
  const a = after as { current_stock: number; avg_cost: number; last_purchase_rate: number };
  console.log("stock            :", a.current_stock, "(expect 40)");
  console.log("avg_cost         :", a.avg_cost, "(expect 218.925 — list-rate bug would give 486.50)");
  console.log("last_purchase_rate:", a.last_purchase_rate, "(expect 218.925)");

  expect(a.current_stock).toBe(40);
  expect(Number(a.avg_cost)).toBeCloseTo(218.925, 2);
  expect(Number(a.last_purchase_rate)).toBeCloseTo(218.925, 2);

  await db.from("invoice_lines").delete().eq("invoice_id", inv!.id);
  await db.from("invoices").delete().eq("id", inv!.id);
  await db.from("products").delete().eq("id", prod!.id);
});
