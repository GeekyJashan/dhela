import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("payments.functions");

const PaymentInput = z.object({
  party_type: z.enum(["retailer", "supplier"]),
  retailer_id: z.string().uuid().nullish(),
  supplier_id: z.string().uuid().nullish(),
  payment_date: z.string(),
  amount: z.number().positive(),
  discount_amount: z.number().min(0).default(0),
  mode: z.enum(["cash", "upi", "bank", "cheque", "other"]).default("cash"),
  reference: z.string().nullish(),
  notes: z.string().nullish(),
});

export const recordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PaymentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.party_type === "retailer" && !data.retailer_id) throw new Error("Pick a retailer");
    if (data.party_type === "supplier" && !data.supplier_id) throw new Error("Pick a supplier");
    log.info("record:start", { party: data.party_type, amount: data.amount });

    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id;

    const { data: pay, error: insErr } = await supabase.from("payments")
      .insert({
        org_id: orgId,
        party_type: data.party_type,
        retailer_id: data.party_type === "retailer" ? data.retailer_id : null,
        supplier_id: data.party_type === "supplier" ? data.supplier_id : null,
        payment_date: data.payment_date,
        amount: data.amount,
        discount_amount: data.discount_amount,
        mode: data.mode,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Allocate oldest-first (FIFO) against open invoices so bill-wise
    // outstanding and ageing stay accurate.
    let toAllocate = data.amount + data.discount_amount;

    if (data.party_type === "retailer") {
      const { data: openInvoices } = await supabase.from("sales_invoices")
        .select("id, grand_total, amount_paid")
        .eq("retailer_id", data.retailer_id!)
        .in("status", ["issued", "paid"])
        .neq("payment_status", "paid")
        .order("invoice_date", { ascending: true })
        .order("created_at", { ascending: true });

      for (const inv of openInvoices ?? []) {
        if (toAllocate <= 0) break;
        const due = Number(inv.grand_total ?? 0) - Number(inv.amount_paid ?? 0);
        if (due <= 0) continue;
        const alloc = Math.min(due, toAllocate);
        const { error: allocErr } = await supabase.from("payment_allocations").insert({
          org_id: orgId, payment_id: pay.id, sales_invoice_id: inv.id, amount: alloc,
        });
        if (allocErr) { log.error("record:alloc_failed", { err: allocErr.message }); continue; }
        const paid = Number(inv.amount_paid ?? 0) + alloc;
        const { error: updErr } = await supabase.from("sales_invoices").update({
          amount_paid: paid,
          payment_status: paid >= Number(inv.grand_total ?? 0) ? "paid" : "partial",
        }).eq("id", inv.id);
        if (updErr) log.error("record:invoice_update_failed", { err: updErr.message });
        toAllocate -= alloc;
      }
    } else {
      const { data: purchases } = await supabase.from("invoices")
        .select("id, grand_total, payment_allocations(amount)")
        .eq("supplier_id", data.supplier_id!)
        .eq("status", "approved")
        .order("invoice_date", { ascending: true })
        .order("created_at", { ascending: true });

      for (const inv of purchases ?? []) {
        if (toAllocate <= 0) break;
        const already = (inv.payment_allocations ?? [])
          .reduce((s: number, a: { amount: number }) => s + Number(a.amount), 0);
        const due = Number(inv.grand_total ?? 0) - already;
        if (due <= 0) continue;
        const alloc = Math.min(due, toAllocate);
        const { error: allocErr } = await supabase.from("payment_allocations").insert({
          org_id: orgId, payment_id: pay.id, purchase_invoice_id: inv.id, amount: alloc,
        });
        if (allocErr) { log.error("record:alloc_failed", { err: allocErr.message }); continue; }
        toAllocate -= alloc;
      }
    }

    log.info("record:done", { id: pay.id, unallocated: toAllocate });
    return { id: pay.id, unallocated: toAllocate };
  });

export const deletePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Roll back what this payment had settled on sales invoices.
    const { data: allocs } = await supabase.from("payment_allocations")
      .select("sales_invoice_id, amount").eq("payment_id", data.id)
      .not("sales_invoice_id", "is", null);
    for (const a of allocs ?? []) {
      const { data: inv } = await supabase.from("sales_invoices")
        .select("grand_total, amount_paid").eq("id", a.sales_invoice_id!).single();
      if (!inv) continue;
      const paid = Math.max(0, Number(inv.amount_paid ?? 0) - Number(a.amount));
      await supabase.from("sales_invoices").update({
        amount_paid: paid,
        payment_status: paid <= 0 ? "unpaid" : paid >= Number(inv.grand_total ?? 0) ? "paid" : "partial",
      }).eq("id", a.sales_invoice_id!);
    }

    const { error } = await supabase.from("payments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
