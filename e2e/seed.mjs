/**
 * Reset and seed the e2e workspace.
 *
 * Runs before every test run so the suite is deterministic and repeatable —
 * a test that depends on whatever happened to be in the database last time
 * is worse than no test.
 *
 * Product names, HSN codes and rate structure are modelled on a real
 * sanitaryware/hardware distributor's purchase bills, so the numbers exercise
 * the same paths (18% GST, PCS units, four-figure rates, mixed HSN chapters)
 * without copying any other workspace's rows.
 *
 * Uses the service-role key, so it bypasses RLS and must never ship to the
 * browser. Node only.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trim().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']/, "").replace(/["']$/, "");
  }
  return out;
}
const env = { ...loadEnv(".env"), ...loadEnv(".env.test"), ...process.env };

const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = env.E2E_EMAIL;
if (!URL || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env)");
if (!EMAIL) throw new Error("E2E_EMAIL must be set (.env.test) — the workspace this wipes and seeds");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathname, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${pathname} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const insert = (table, rows) =>
  rest(table, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "return=representation" } });

export async function resolveAccount() {
  const users = await (await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: H })).json();
  const user = (users.users || []).find(u => u.email === EMAIL);
  if (!user) throw new Error(`No user ${EMAIL} — create it before seeding`);
  const [m] = await rest(`memberships?select=org_id&user_id=eq.${user.id}&limit=1`);
  if (!m) throw new Error(`${EMAIL} has no workspace`);
  return { orgId: m.org_id, userId: user.id };
}

/** Children before parents. party_ledger is a UNION view and clears itself. */
const WIPE_ORDER = [
  "payment_allocations", "payments",
  "credit_note_lines", "credit_notes",
  "sales_invoice_lines", "sales_invoices",
  "order_lines", "orders",
  "invoice_lines", "invoices",
  "product_price_overrides", "products",
  "retailers", "suppliers", "stock_groups",
  "assistant_messages", "audit_log",
];

export async function wipe(orgId) {
  for (const t of WIPE_ORDER) {
    await rest(`${t}?org_id=eq.${orgId}`, { method: "DELETE" });
  }
}

const PRODUCTS = [
  { name: "EWC 1 PC ASPIRO NEO S-100-SW", sku: "EWC-ASP-100", hsn: "69101000", unit: "PCS", gst_rate: 18, mrp: 8500, purchase_rate: 5779.66 },
  { name: "EWC 1 PC PRIMA WD S-220 INT JET", sku: "EWC-PRM-220", hsn: "69101000", unit: "PCS", gst_rate: 18, mrp: 6800, purchase_rate: 4470.85 },
  { name: "WASH BASIN DELTA 55x40 S.WHITE", sku: "WB-DEL-5540", hsn: "69101000", unit: "PCS", gst_rate: 18, mrp: 1400, purchase_rate: 876 },
  { name: "PEDESTAL TALL S.WHITE", sku: "PED-TALL", hsn: "69101000", unit: "PCS", gst_rate: 18, mrp: 1450, purchase_rate: 916 },
  { name: "PILLAR COCK CHROME", sku: "F650001CP", hsn: "84818020", unit: "PCS", gst_rate: 18, mrp: 1200, purchase_rate: 753.75 },
  { name: "BIB COCK WITH WALL FLANGE", sku: "F650004CP", hsn: "84818020", unit: "PCS", gst_rate: 18, mrp: 1100, purchase_rate: 697.5 },
  { name: "CENTRE HOLE BASIN MIXER", sku: "F690014CP", hsn: "84818020", unit: "PCS", gst_rate: 18, mrp: 2100, purchase_rate: 1334.5 },
  { name: "RAIN SHOWER CHROME 100MM", sku: "F160147CP", hsn: "84818020", unit: "PCS", gst_rate: 18, mrp: 650, purchase_rate: 399.5 },
  { name: "LED PANEL 36W WHITE", sku: "LED-36W", hsn: "94054900", unit: "PCS", gst_rate: 18, mrp: 1900, purchase_rate: 1250 },
  // 0% — must land in Table 8, never in B2B/B2CS at rate 0.
  { name: "PACKING JUTE TWINE", sku: "PKG-TWINE", hsn: "53079000", unit: "KGS", gst_rate: 0, mrp: 90, purchase_rate: 60 },
];

const SUPPLIERS = [
  { name: "Anand Enterprises", gstin: "03AABCA1234K1Z5", city: "Ludhiana", state_code: "03" },
  { name: "Shree Ceramics Pvt Ltd", gstin: "06AACCS5678M1Z9", city: "Gurugram", state_code: "06" },
];

const RETAILERS = [
  { name: "Gupta Sanitary Store", gstin: "03AAECG7654P1Z2", city: "Jalandhar", state_code: "03", credit_limit: 200000, default_discount_pct: 3, category: "A" },
  { name: "Verma Hardware", gstin: "03AAFCV3321Q1Z7", city: "Amritsar", state_code: "03", credit_limit: 150000, default_discount_pct: 2, category: "B" },
  // No GSTIN, intrastate — lands in GSTR-1 B2CS.
  { name: "Singh Traders", gstin: null, city: "Phagwara", state_code: "03", credit_limit: 50000, default_discount_pct: 0, category: "C" },
];

const round = v => Math.round(v * 100) / 100;

export async function seed(orgId, userId) {
  const products = await insert("products", PRODUCTS.map(p => ({
    ...p, org_id: orgId, current_stock: 0, selling_rate: round(p.purchase_rate * 1.18),
  })));
  const suppliers = await insert("suppliers", SUPPLIERS.map(s => ({ ...s, org_id: orgId, opening_balance: 0 })));
  const retailers = await insert("retailers", RETAILERS.map(r => ({
    ...r, org_id: orgId, opening_balance: 0,
  })));

  // Three purchases: two approved (so stock and avg_cost exist) and one left
  // in review, which is what the catalog-builder and totals checks act on.
  const purchases = [
    { supplier: suppliers[0], number: "INV-45", date: "2026-07-03", status: "approved", items: [[0, 5], [4, 22]] },
    { supplier: suppliers[0], number: "INV-49", date: "2026-07-15", status: "approved", items: [[2, 22], [3, 22]] },
    { supplier: suppliers[1], number: "INV-53", date: "2026-07-17", status: "review", items: [[5, 22], [7, 35]] },
  ];

  for (const p of purchases) {
    const lines = p.items.map(([pi, qty], n) => {
      const prod = PRODUCTS[pi];
      const taxable = round(prod.purchase_rate * qty);
      const tax = round(taxable * prod.gst_rate / 100);
      return {
        org_id: orgId, line_no: n + 1, raw_description: prod.name, hsn: prod.hsn,
        quantity: qty, unit: prod.unit, rate: prod.purchase_rate, mrp: prod.mrp,
        gst_rate: prod.gst_rate, taxable_value: taxable, tax_amount: tax,
        line_total: round(taxable + tax), match_confidence: 95, needs_review: false,
        _productIdx: pi,
      };
    });
    const subtotal = round(lines.reduce((a, l) => a + l.taxable_value, 0));
    const taxTotal = round(lines.reduce((a, l) => a + l.tax_amount, 0));
    const [inv] = await insert("invoices", [{
      org_id: orgId, supplier_id: p.supplier.id, supplier_name: p.supplier.name,
      supplier_gstin: p.supplier.gstin, invoice_number: p.number, invoice_date: p.date,
      subtotal, tax_total: taxTotal, grand_total: round(subtotal + taxTotal),
      status: p.status, extraction_engine: "ai", confidence: 92, uploaded_by: userId,
      // NOT NULL, and nothing in the suite fetches the original file.
      storage_path: `${orgId}/seed/${p.number}.pdf`, mime_type: "application/pdf",
    }]);
    await insert("invoice_lines", lines.map(({ _productIdx, ...l }) => ({
      ...l, invoice_id: inv.id, matched_product_id: products[_productIdx].id,
    })));
    if (p.status === "approved") {
      for (const [pi, qty] of p.items) {
        const prod = products[pi];
        await rest(`products?id=eq.${prod.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            current_stock: Number(prod.current_stock ?? 0) + qty,
            avg_cost: PRODUCTS[pi].purchase_rate,
            last_purchase_rate: PRODUCTS[pi].purchase_rate,
          }),
        });
        prod.current_stock = Number(prod.current_stock ?? 0) + qty;
      }
    }
  }

  // Two issued sales: one B2B (retailer has GSTIN), one B2CS (no GSTIN).
  // Both intrastate, so CGST+SGST — GSTR-1 needs both kinds present.
  const sales = [
    { retailer: retailers[0], number: "S-9", date: "2026-07-20", items: [[0, 2], [4, 6]] },
    { retailer: retailers[2], number: "S-10", date: "2026-07-22", items: [[2, 3]] },
    // Nil-rated goods to a registered retailer → Table 8 row 8B.
    { retailer: retailers[1], number: "S-11", date: "2026-07-24", items: [[9, 20]] },
  ];
  for (const s of sales) {
    const lines = s.items.map(([pi, qty], n) => {
      const prod = PRODUCTS[pi];
      const rate = round(prod.purchase_rate * 1.18);
      const taxable = round(rate * qty);
      const half = round(taxable * prod.gst_rate / 200);
      return {
        org_id: orgId, line_no: n + 1, description: prod.name, hsn: prod.hsn,
        quantity: qty, unit: prod.unit, rate, mrp: prod.mrp, gst_rate: prod.gst_rate,
        taxable_value: taxable, cgst_amount: half, sgst_amount: half, igst_amount: 0,
        tax_amount: round(half * 2), line_total: round(taxable + half * 2),
        cost_price: prod.purchase_rate, profit: round(taxable - prod.purchase_rate * qty),
        _productIdx: pi,
      };
    });
    const subtotal = round(lines.reduce((a, l) => a + l.taxable_value, 0));
    const cgst = round(lines.reduce((a, l) => a + l.cgst_amount, 0));
    const [si] = await insert("sales_invoices", [{
      org_id: orgId, retailer_id: s.retailer.id, invoice_number: s.number, invoice_date: s.date,
      place_of_supply: "03", is_interstate: false, subtotal,
      cgst_total: cgst, sgst_total: cgst, igst_total: 0, tax_total: round(cgst * 2),
      grand_total: round(subtotal + cgst * 2), status: "issued", payment_status: "unpaid",
      amount_paid: 0, total_cost: round(lines.reduce((a, l) => a + l.cost_price * l.quantity, 0)),
      total_profit: round(lines.reduce((a, l) => a + l.profit, 0)),
    }]);
    await insert("sales_invoice_lines", lines.map(({ _productIdx, ...l }) => ({
      ...l, sales_invoice_id: si.id, product_id: products[_productIdx].id,
    })));
  }

  // Payments so receivables ageing and the Insights charts have something to
  // show. Two collections from retailers, one payment out to a supplier.
  const [saleA] = await rest(
    `sales_invoices?select=id,retailer_id,grand_total&org_id=eq.${orgId}&invoice_number=eq.S-9`);
  // PostgREST rejects a bulk insert whose objects don't share a key set, so
  // every row carries both party columns with one of them null.
  const payment = (o) => ({
    org_id: orgId, retailer_id: null, supplier_id: null, reference: null,
    discount_amount: 0, created_by: userId, ...o,
  });
  await insert("payments", [
    payment({ party_type: "retailer", retailer_id: saleA.retailer_id,
      payment_date: "2026-07-21", amount: 25000, mode: "upi", reference: "UTR2026072100194" }),
    payment({ party_type: "retailer", retailer_id: retailers[1].id,
      payment_date: "2026-07-23", amount: 12000, mode: "cash" }),
    payment({ party_type: "supplier", supplier_id: suppliers[0].id,
      payment_date: "2026-07-19", amount: 40000, mode: "bank", reference: "NEFT-88213" }),
  ]);

  // A credit note against the no-GSTIN intrastate sale. This is the case that
  // must NOT land in CDNUR (which only accepts B2CL/EXPWP/EXPWOP) and must
  // instead net down the B2CS bucket.
  const [b2csSale] = await rest(
    `sales_invoices?select=id,retailer_id&org_id=eq.${orgId}&invoice_number=eq.S-10`);
  const cnProduct = PRODUCTS[2];
  const cnRate = round(cnProduct.purchase_rate * 1.18);
  const cnTaxable = round(cnRate * 1);
  const cnTax = round(cnTaxable * cnProduct.gst_rate / 100);
  const [cn] = await insert("credit_notes", [{
    org_id: orgId, retailer_id: b2csSale.retailer_id, sales_invoice_id: b2csSale.id,
    credit_note_number: "CN-001", credit_date: "2026-07-25",
    subtotal: cnTaxable, tax_total: cnTax, grand_total: round(cnTaxable + cnTax),
    reason: "damaged", restock: false, created_by: userId,
  }]);
  await insert("credit_note_lines", [{
    org_id: orgId, credit_note_id: cn.id, product_id: products[2].id,
    description: cnProduct.name, hsn: cnProduct.hsn, quantity: 1, rate: cnRate,
    gst_rate: cnProduct.gst_rate, taxable_value: cnTaxable, tax_amount: cnTax,
    line_total: round(cnTaxable + cnTax),
  }]);

  // One stored answer written the way the models actually reply, so the
  // assistant panel can be tested for markdown rendering without spending an
  // AI credit or depending on what a model feels like emitting today.
  await insert("assistant_messages", [{
    org_id: orgId, user_id: userId,
    question: "Which retailers owe me the most?",
    answer: "Retailers owe you **₹1,42,500** in total.\n\n"
      + "| Retailer | Outstanding |\n|---|---:|\n"
      + "| Shree Sanitary House | ₹98,000 |\n| Balaji Hardware | ₹44,500 |\n\n"
      + "- Oldest bill is 42 days past due\n- Nothing has crossed 60 days yet",
  }]);

  return { products: products.length, suppliers: suppliers.length, retailers: retailers.length,
    purchases: purchases.length, sales: sales.length, creditNotes: 1, payments: 3,
    // Exact figures the e2e assertions check against.
    expect: {
      b2csTaxable: round(round(cnRate * 3) - cnTaxable),
      creditNoteTaxable: cnTaxable,
      // 20 units of a 0% line at cost*1.18 — belongs in Table 8, not B2B.
      nilRated: round(round(PRODUCTS[9].purchase_rate * 1.18) * 20),
      docSeriesFrom: "S-9", docSeriesTo: "S-11",
    } };
}

// `node e2e/seed.mjs` runs it standalone; Playwright imports the functions.
if (process.argv[1] && process.argv[1].endsWith("seed.mjs")) {
  const { orgId, userId } = await resolveAccount();
  console.log(`workspace ${orgId} (${EMAIL})`);
  await wipe(orgId);
  console.log("wiped");
  console.log("seeded", await seed(orgId, userId));
}
