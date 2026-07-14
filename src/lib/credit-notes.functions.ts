import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("credit-notes.functions");

const CreditLineInput = z.object({
  product_id: z.string().uuid().nullable(),
  description: z.string().min(1),
  hsn: z.string().nullish(),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  discount_pct: z.number().min(0).default(0),
  gst_rate: z.number().min(0).default(0),
});

const CreditNoteInput = z.object({
  retailer_id: z.string().uuid(),
  sales_invoice_id: z.string().uuid().nullish(),
  credit_date: z.string(),
  reason: z.enum(["damaged", "expired", "wrong_item", "rate_adjustment", "other"]).default("other"),
  restock: z.boolean().default(true),
  notes: z.string().nullish(),
  lines: z.array(CreditLineInput).min(1),
});

export const createCreditNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreditNoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("create:start", { retailer: data.retailer_id, lines: data.lines.length });

    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id;

    // Totals computed here so the document is always internally consistent.
    const computed = data.lines.map(l => {
      const gross = l.quantity * l.rate;
      const taxable = +(gross * (1 - (l.discount_pct || 0) / 100)).toFixed(2);
      const tax = +((taxable * (l.gst_rate || 0)) / 100).toFixed(2);
      return { ...l, taxable_value: taxable, tax_amount: tax, line_total: +(taxable + tax).toFixed(2) };
    });
    const subtotal = +computed.reduce((s, l) => s + l.taxable_value, 0).toFixed(2);
    const tax_total = +computed.reduce((s, l) => s + l.tax_amount, 0).toFixed(2);
    const grand_total = +(subtotal + tax_total).toFixed(2);

    const { data: numData, error: numErr } = await supabase
      .rpc("next_credit_note_number", { _org: orgId });
    if (numErr) throw new Error(numErr.message);
    const creditNoteNumber = numData as unknown as string;

    const { data: note, error: insErr } = await supabase.from("credit_notes")
      .insert({
        org_id: orgId,
        retailer_id: data.retailer_id,
        sales_invoice_id: data.sales_invoice_id ?? null,
        credit_note_number: creditNoteNumber,
        credit_date: data.credit_date,
        reason: data.reason,
        restock: data.restock,
        notes: data.notes ?? null,
        subtotal, tax_total, grand_total,
        created_by: userId,
      })
      .select("id, credit_note_number")
      .single();
    if (insErr) throw new Error(insErr.message);

    const { error: linesErr } = await supabase.from("credit_note_lines").insert(
      computed.map(l => ({
        org_id: orgId,
        credit_note_id: note.id,
        product_id: l.product_id,
        description: l.description,
        hsn: l.hsn ?? null,
        quantity: l.quantity,
        rate: l.rate,
        discount_pct: l.discount_pct,
        gst_rate: l.gst_rate,
        taxable_value: l.taxable_value,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
      })),
    );
    if (linesErr) throw new Error(linesErr.message);

    // Returned goods back into sellable stock (unless damaged/expired).
    if (data.restock) {
      for (const l of computed) {
        if (!l.product_id) continue;
        const { data: p } = await supabase.from("products")
          .select("current_stock").eq("id", l.product_id).single();
        await supabase.from("products")
          .update({ current_stock: Number(p?.current_stock ?? 0) + l.quantity })
          .eq("id", l.product_id);
      }
    }

    // Settle the source invoice's dues with the credited amount so
    // bill-wise outstanding and ageing stay right.
    if (data.sales_invoice_id) {
      const { data: inv } = await supabase.from("sales_invoices")
        .select("grand_total, amount_paid").eq("id", data.sales_invoice_id).single();
      if (inv) {
        const due = Number(inv.grand_total ?? 0) - Number(inv.amount_paid ?? 0);
        const settle = Math.min(Math.max(due, 0), grand_total);
        if (settle > 0) {
          const paid = Number(inv.amount_paid ?? 0) + settle;
          await supabase.from("sales_invoices").update({
            amount_paid: paid,
            payment_status: paid >= Number(inv.grand_total ?? 0) ? "paid" : "partial",
          }).eq("id", data.sales_invoice_id);
        }
      }
    }

    log.info("create:done", { id: note.id, number: note.credit_note_number, grand_total });
    return { id: note.id, credit_note_number: note.credit_note_number, grand_total };
  });

export const deleteCreditNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: note } = await supabase.from("credit_notes")
      .select("id, restock, grand_total, sales_invoice_id, credit_note_lines(product_id, quantity)")
      .eq("id", data.id).single();
    if (!note) throw new Error("Credit note not found");

    // Take restocked goods back out of stock.
    if (note.restock) {
      for (const l of note.credit_note_lines ?? []) {
        if (!l.product_id) continue;
        const { data: p } = await supabase.from("products")
          .select("current_stock").eq("id", l.product_id).single();
        await supabase.from("products")
          .update({ current_stock: Number(p?.current_stock ?? 0) - Number(l.quantity) })
          .eq("id", l.product_id);
      }
    }

    // Restore the settled amount on the source invoice.
    if (note.sales_invoice_id) {
      const { data: inv } = await supabase.from("sales_invoices")
        .select("grand_total, amount_paid").eq("id", note.sales_invoice_id).single();
      if (inv) {
        const paid = Math.max(0, Number(inv.amount_paid ?? 0) - Number(note.grand_total));
        await supabase.from("sales_invoices").update({
          amount_paid: paid,
          payment_status: paid <= 0 ? "unpaid" : paid >= Number(inv.grand_total ?? 0) ? "paid" : "partial",
        }).eq("id", note.sales_invoice_id);
      }
    }

    const { error } = await supabase.from("credit_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
