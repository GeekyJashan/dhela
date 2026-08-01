import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { matchLineToProduct, type MatchableProduct } from "./product-match";

/**
 * Read a sales invoice the distributor already issued and turn it into a draft.
 *
 * This exists for the first week, not the tenth. A distributor arriving with
 * six months of invoices written elsewhere has no history in Dhela, and
 * without history the stock is wrong, the weighted-average cost is wrong, and
 * every insight on the dashboard is built on a fraction of the business.
 * Typing them in is the reason people give up on switching.
 *
 * It produces a DRAFT, never an issued invoice. Issuing deducts stock and locks
 * cost, and a machine reading of a photograph is not a good enough reason to
 * move someone's inventory. The operator reviews it and issues it, exactly as
 * they would one they keyed in.
 */

const log = createLogger("sales-import");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const round = (v: number) => Math.round(v * 100) / 100;

const Extracted = z.object({
  supplier_name: z.string().nullable().optional(),   // the buyer, on a sales invoice
  supplier_gstin: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  tax_total: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(z.object({
    raw_description: z.string().default(""),
    hsn: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    free_quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    rate: z.number().nullable().optional(),
    mrp: z.number().nullable().optional(),
    discount_pct: z.number().nullable().optional(),
    gst_rate: z.number().nullable().optional(),
    taxable_value: z.number().nullable().optional(),
    tax_amount: z.number().nullable().optional(),
    line_total: z.number().nullable().optional(),
    batch: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
  })).default([]),
});

/** Find the retailer this invoice was made out to, or create them. */
async function resolveRetailer(db: Db, orgId: string, name: string | null, gstin: string | null) {
  const clean = (name ?? "").trim();
  // GSTIN first: it is the only identifier on an Indian invoice that is unique
  // by law. Names are spelled three ways across three bills from one shop.
  if (gstin) {
    const { data } = await db.from("retailers").select("id, name").eq("gstin", gstin.toUpperCase()).limit(1);
    if (data?.length) return { id: data[0].id as string, name: data[0].name as string, created: false };
  }
  if (clean) {
    const { data } = await db.from("retailers").select("id, name").ilike("name", clean).limit(1);
    if (data?.length) return { id: data[0].id as string, name: data[0].name as string, created: false };
  }
  if (!clean) return null;

  const { data: made, error } = await db.from("retailers")
    .insert({ org_id: orgId, name: clean, gstin: gstin ? gstin.toUpperCase() : null })
    .select("id, name").single();
  if (error) throw new Error(`Could not create retailer "${clean}": ${error.message}`);
  return { id: made.id as string, name: made.name as string, created: true };
}

export const importSalesInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ storagePath: z.string().min(1), mimeType: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const db = supabase as unknown as Db;

    const { data: mem } = await db.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id as string;

    const apiUrl = process.env.EXTRACTION_API_URL;
    if (!apiUrl) throw new Error("Extraction service is not configured (EXTRACTION_API_URL missing)");

    const { data: blob, error: dlErr } = await supabase.storage.from("invoices").download(data.storagePath);
    if (dlErr || !blob) throw new Error(`Could not read the uploaded file: ${dlErr?.message ?? "missing"}`);

    const form = new FormData();
    form.append("file", blob, data.storagePath.split("/").pop() ?? "invoice");
    form.append("mime_type", data.mimeType);
    // The only thing that differs from a purchase read: which party to keep.
    form.append("doc_type", "sales");

    const t0 = Date.now();
    const resp = await fetch(`${apiUrl.replace(/\/$/, "")}/extract`, { method: "POST", body: form });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 300);
      log.error("import:service_error", { status: resp.status, body });
      throw new Error(`Extraction service ${resp.status}: ${body}`);
    }
    const parsed = Extracted.parse(await resp.json());
    log.info("import:extracted", { ms: Date.now() - t0, lines: parsed.lines.length });

    if (!parsed.lines.length) throw new Error("No line items could be read from that invoice.");

    const retailer = await resolveRetailer(db, orgId, parsed.supplier_name ?? null, parsed.supplier_gstin ?? null);
    if (!retailer) throw new Error("Could not tell who this invoice was made out to. Add the customer first, or key this one in.");

    const { data: catalog } = await db.from("products").select("id, name, hsn").limit(5000);
    const products = (catalog ?? []) as MatchableProduct[];

    let unmatched = 0;
    const lines = parsed.lines.map((l, i) => {
      const match = matchLineToProduct(l.raw_description, l.hsn ?? null, products);
      if (!match) unmatched++;
      const qty = num(l.quantity);
      const rate = num(l.rate);
      const taxable = l.taxable_value != null
        ? num(l.taxable_value)
        : round(qty * rate * (1 - num(l.discount_pct) / 100));
      const gst = num(l.gst_rate);
      const tax = l.tax_amount != null ? num(l.tax_amount) : round(taxable * gst / 100);
      return {
        product_id: match?.productId ?? null,
        line_no: i + 1,
        description: l.raw_description || "Item",
        hsn: l.hsn ?? null,
        batch: l.batch ?? null,
        expiry_date: l.expiry_date ?? null,
        quantity: qty,
        free_quantity: num(l.free_quantity),
        unit: l.unit ?? null,
        mrp: l.mrp ?? null,
        rate,
        discount_pct: num(l.discount_pct),
        discount_amount: 0,
        taxable_value: taxable,
        gst_rate: gst,
        // Intrastate assumed on import; the operator sets place of supply on
        // the draft, and issuing recomputes the split from it.
        cgst_amount: round(tax / 2),
        sgst_amount: round(tax / 2),
        igst_amount: 0,
        tax_amount: tax,
        line_total: l.line_total != null ? num(l.line_total) : round(taxable + tax),
        // Cost and profit stay empty on purpose: they are set from the
        // product's weighted-average cost when the invoice is issued, not from
        // anything printed on the customer's copy.
        cost_price: 0,
        profit: 0,
      };
    });

    const subtotal = round(lines.reduce((s, l) => s + l.taxable_value, 0));
    const taxTotal = round(lines.reduce((s, l) => s + l.tax_amount, 0));

    const { data: invoice, error: insErr } = await db.from("sales_invoices").insert({
      org_id: orgId,
      retailer_id: retailer.id,
      invoice_number: parsed.invoice_number ?? null,
      invoice_date: parsed.invoice_date ?? new Date().toISOString().slice(0, 10),
      status: "draft",
      payment_status: "unpaid",
      subtotal, discount_total: 0,
      cgst_total: round(taxTotal / 2), sgst_total: round(taxTotal / 2), igst_total: 0,
      tax_total: taxTotal, round_off: 0,
      grand_total: parsed.grand_total != null ? num(parsed.grand_total) : round(subtotal + taxTotal),
      total_cost: 0, total_profit: 0,
      is_interstate: false,
      notes: parsed.notes ?? null,
      created_by: userId,
    }).select("id").single();
    if (insErr) throw new Error(insErr.message);

    const { error: lineErr } = await db.from("sales_invoice_lines")
      .insert(lines.map(l => ({ ...l, org_id: orgId, sales_invoice_id: invoice.id })));
    if (lineErr) throw new Error(lineErr.message);

    log.info("import:done", { invoiceId: invoice.id, lines: lines.length, unmatched, newRetailer: retailer.created });
    return {
      invoiceId: invoice.id as string,
      retailer: retailer.name,
      retailerCreated: retailer.created,
      lineCount: lines.length,
      unmatched,
    };
  });
