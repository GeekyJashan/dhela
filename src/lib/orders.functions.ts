import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("orders.functions");

const OrderLineInput = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive(),
});

const OrderInput = z.object({
  id: z.string().uuid().optional(),
  retailer_id: z.string().uuid(),
  order_date: z.string(),
  notes: z.string().nullish(),
  lines: z.array(OrderLineInput).min(1),
});

export const upsertOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OrderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("upsert:start", { id: data.id, lines: data.lines.length });

    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id;

    let orderId = data.id;
    let orderNumber: string | null = null;
    // Fulfilled quantities carry over across edits, matched by product.
    const fulfilledByProduct = new Map<string, number>();

    if (!orderId) {
      const { data: numData, error: numErr } = await supabase
        .rpc("next_order_number", { _org: orgId });
      if (numErr) throw new Error(numErr.message);
      orderNumber = numData as unknown as string;

      const { data: ord, error: insErr } = await supabase.from("orders")
        .insert({
          org_id: orgId,
          retailer_id: data.retailer_id,
          order_number: orderNumber,
          order_date: data.order_date,
          notes: data.notes ?? null,
          created_by: userId,
        })
        .select("id, order_number")
        .single();
      if (insErr) throw new Error(insErr.message);
      orderId = ord.id;
      orderNumber = ord.order_number;
    } else {
      const { data: existing } = await supabase.from("order_lines")
        .select("product_id, fulfilled_quantity").eq("order_id", orderId);
      for (const l of existing ?? []) {
        fulfilledByProduct.set(
          l.product_id,
          (fulfilledByProduct.get(l.product_id) ?? 0) + Number(l.fulfilled_quantity ?? 0),
        );
      }

      const { error: updErr } = await supabase.from("orders")
        .update({
          retailer_id: data.retailer_id,
          order_date: data.order_date,
          notes: data.notes ?? null,
        }).eq("id", orderId);
      if (updErr) throw new Error(updErr.message);

      const { data: ord } = await supabase.from("orders")
        .select("order_number").eq("id", orderId).single();
      orderNumber = ord?.order_number ?? null;

      const { error: delErr } = await supabase.from("order_lines")
        .delete().eq("order_id", orderId);
      if (delErr) throw new Error(delErr.message);
    }

    const linePayload = data.lines.map(l => ({
      org_id: orgId,
      order_id: orderId,
      product_id: l.product_id,
      quantity: l.quantity,
      fulfilled_quantity: Math.min(l.quantity, fulfilledByProduct.get(l.product_id) ?? 0),
    }));
    const { error: linesErr } = await supabase.from("order_lines").insert(linePayload);
    if (linesErr) throw new Error(linesErr.message);

    // Roll up status from fulfillment (edits can change quantities).
    const allDone = linePayload.every(l => l.fulfilled_quantity >= l.quantity);
    const anyDone = linePayload.some(l => l.fulfilled_quantity > 0);
    const status = allDone ? "fulfilled" : anyDone ? "partial" : "pending";
    const { error: stErr } = await supabase.from("orders")
      .update({ status }).eq("id", orderId);
    if (stErr) throw new Error(stErr.message);

    log.info("upsert:done", { orderId, orderNumber, status });
    return { id: orderId, order_number: orderNumber };
  });

export const setOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["pending", "partial", "fulfilled", "cancelled"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("orders")
      .update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
