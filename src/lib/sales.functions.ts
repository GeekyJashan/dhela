import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("sales.functions");

const LineInput = z.object({
  product_id: z.string().uuid().nullable(),
  line_no: z.number().int().optional(),
  description: z.string().min(1),
  hsn: z.string().nullable(),
  batch: z.string().nullable(),
  expiry_date: z.string().nullable(),
  quantity: z.number(),
  free_quantity: z.number().default(0),
  unit: z.string().nullable(),
  mrp: z.number().nullable(),
  rate: z.number(),
  discount_pct: z.number().default(0),
  discount_amount: z.number().default(0),
  taxable_value: z.number().default(0),
  gst_rate: z.number().default(0),
  cgst_amount: z.number().default(0),
  sgst_amount: z.number().default(0),
  igst_amount: z.number().default(0),
  tax_amount: z.number().default(0),
  line_total: z.number().default(0),
  cost_price: z.number().nullable(),
  profit: z.number().default(0),
});

const InvoiceInput = z.object({
  id: z.string().uuid().optional(),
  order_id: z.string().uuid().nullable().optional(),
  retailer_id: z.string().uuid(),
  invoice_date: z.string(),
  due_date: z.string().nullable().optional(),
  place_of_supply: z.string().nullable().optional(),
  is_interstate: z.boolean(),
  notes: z.string().nullable().optional(),
  status: z.enum(["draft", "issued"]).default("draft"),
  subtotal: z.number(),
  discount_total: z.number(),
  cgst_total: z.number(),
  sgst_total: z.number(),
  igst_total: z.number(),
  tax_total: z.number(),
  round_off: z.number(),
  grand_total: z.number(),
  total_cost: z.number(),
  total_profit: z.number(),
  lines: z.array(LineInput).min(1),
});

export const saveSalesInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InvoiceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("save:start", { id: data.id, lines: data.lines.length, status: data.status });

    const { data: mem, error: memErr } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (memErr || !mem) throw new Error("No organization");
    const orgId = mem.org_id;

    const { lines, id, ...header } = data;

    let invoiceId = id;
    let invoiceNumber: string | null = null;

    if (!invoiceId) {
      // generate invoice number
      const { data: numData, error: numErr } = await supabase
        .rpc("next_sales_invoice_number", { _org: orgId });
      if (numErr) throw new Error(numErr.message);
      invoiceNumber = numData as unknown as string;
      log.info("save:generated_number", { invoiceNumber });

      const { data: inv, error: insErr } = await supabase.from("sales_invoices")
        .insert({
          ...header,
          org_id: orgId,
          created_by: userId,
          invoice_number: invoiceNumber,
        })
        .select("id, invoice_number")
        .single();
      if (insErr) throw new Error(insErr.message);
      invoiceId = inv.id;
      invoiceNumber = inv.invoice_number;
    } else {
      const { error: updErr } = await supabase.from("sales_invoices")
        .update(header).eq("id", invoiceId);
      if (updErr) throw new Error(updErr.message);
      const { data: existing } = await supabase.from("sales_invoices")
        .select("invoice_number").eq("id", invoiceId).single();
      invoiceNumber = existing?.invoice_number ?? null;

      // wipe old lines; we replace on save
      const { error: delErr } = await supabase.from("sales_invoice_lines")
        .delete().eq("sales_invoice_id", invoiceId);
      if (delErr) throw new Error(delErr.message);
    }

    const linePayload = lines.map((l, i) => ({
      ...l,
      org_id: orgId,
      sales_invoice_id: invoiceId,
      line_no: l.line_no ?? i + 1,
    }));
    const { error: linesErr } = await supabase.from("sales_invoice_lines").insert(linePayload);
    if (linesErr) throw new Error(linesErr.message);

    // If invoice is 'issued', deduct stock from products.
    if (data.status === "issued") {
      for (const l of lines) {
        if (!l.product_id) continue;
        const { data: p } = await supabase.from("products")
          .select("current_stock").eq("id", l.product_id).single();
        const newStock = Number(p?.current_stock ?? 0) - (l.quantity + (l.free_quantity ?? 0));
        await supabase.from("products").update({ current_stock: newStock }).eq("id", l.product_id);
      }
    }

    // If issued against an order, record fulfilled quantities and roll up order status.
    if (data.status === "issued" && data.order_id) {
      const { data: orderLines, error: olErr } = await supabase.from("order_lines")
        .select("id, product_id, quantity, fulfilled_quantity")
        .eq("order_id", data.order_id);
      if (olErr) {
        log.error("save:order_lines_fetch_failed", { err: olErr.message });
      } else if (orderLines?.length) {
        const invoicedByProduct = new Map<string, number>();
        for (const l of lines) {
          if (!l.product_id) continue;
          invoicedByProduct.set(l.product_id, (invoicedByProduct.get(l.product_id) ?? 0) + l.quantity);
        }
        for (const ol of orderLines) {
          const invoiced = invoicedByProduct.get(ol.product_id) ?? 0;
          const already = Number(ol.fulfilled_quantity ?? 0);
          const add = Math.min(invoiced, Number(ol.quantity) - already);
          if (add <= 0) continue;
          const { error: fulErr } = await supabase.from("order_lines")
            .update({ fulfilled_quantity: already + add }).eq("id", ol.id);
          if (fulErr) log.error("save:fulfill_failed", { line: ol.id, err: fulErr.message });
          else ol.fulfilled_quantity = already + add;
        }
        const allDone = orderLines.every(ol => Number(ol.fulfilled_quantity ?? 0) >= Number(ol.quantity));
        const anyDone = orderLines.some(ol => Number(ol.fulfilled_quantity ?? 0) > 0);
        const orderStatus = allDone ? "fulfilled" : anyDone ? "partial" : "pending";
        const { error: osErr } = await supabase.from("orders")
          .update({ status: orderStatus }).eq("id", data.order_id);
        if (osErr) log.error("save:order_status_failed", { err: osErr.message });
        log.info("save:order_updated", { orderId: data.order_id, orderStatus });
      }
    }

    log.info("save:done", { invoiceId, invoiceNumber });
    return { id: invoiceId, invoice_number: invoiceNumber };
  });

export const deleteSalesInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sales_invoices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
