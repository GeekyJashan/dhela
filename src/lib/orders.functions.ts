import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { matchLineToProduct, type MatchableProduct } from "./product-match";

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

/**
 * Create an order from an uploaded document (photo/PDF of a retailer's order
 * list). Runs the same extraction service as purchase invoices, matches each
 * line to a catalog product, and creates the order from the matches.
 */
export const createOrderFromUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      retailer_id: z.string().uuid(),
      order_date: z.string(),
      file_base64: z.string().min(1),
      mime_type: z.string(),
      engine: z.enum(["ai", "ocr"]).default("ai"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const orgId = mem.org_id;

    // Extract line items via the backend service.
    const apiUrl = (process.env.EXTRACTION_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
    const endpoint = data.engine === "ocr" ? "/extract-ocr" : "/extract";
    const bytes = Buffer.from(data.file_base64, "base64");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: data.mime_type }), "order");
    form.append("mime_type", data.mime_type);

    const resp = await fetch(`${apiUrl}${endpoint}`, { method: "POST", body: form });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 300);
      log.error("orderUpload:extract_failed", { status: resp.status, body });
      throw new Error(`Extraction failed (${resp.status})`);
    }
    const parsed = await resp.json() as {
      lines?: { raw_description?: string; hsn?: string | null; quantity?: number | null }[];
    };
    const lines = parsed.lines ?? [];
    if (!lines.length) throw new Error("No line items found in the uploaded order");

    // Match each extracted line to a catalog product.
    const { data: products } = await supabase
      .from("products").select("id, name, hsn").eq("org_id", orgId);
    const catalog = (products ?? []) as MatchableProduct[];

    const byProduct = new Map<string, number>();
    const unmatched: string[] = [];
    for (const l of lines) {
      const desc = (l.raw_description ?? "").trim();
      if (!desc) continue;
      const m = matchLineToProduct(desc, l.hsn ?? null, catalog);
      const qty = Number(l.quantity ?? 0) || 1;
      if (m) byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + qty);
      else unmatched.push(desc);
    }

    if (!byProduct.size) {
      return { orderId: null, orderNumber: null, matched: 0, unmatched };
    }

    // Create the order.
    const { data: numData, error: numErr } = await supabase.rpc("next_order_number", { _org: orgId });
    if (numErr) throw new Error(numErr.message);
    const orderNumber = numData as unknown as string;

    const { data: ord, error: insErr } = await supabase.from("orders")
      .insert({
        org_id: orgId, retailer_id: data.retailer_id, order_number: orderNumber,
        order_date: data.order_date, status: "pending", created_by: userId,
        notes: unmatched.length ? `Uploaded — ${unmatched.length} item(s) not matched` : "Uploaded order",
      })
      .select("id, order_number").single();
    if (insErr) throw new Error(insErr.message);

    const linePayload = [...byProduct.entries()].map(([product_id, quantity]) => ({
      org_id: orgId, order_id: ord.id, product_id, quantity, fulfilled_quantity: 0,
    }));
    const { error: linesErr } = await supabase.from("order_lines").insert(linePayload);
    if (linesErr) throw new Error(linesErr.message);

    log.info("orderUpload:done", { orderId: ord.id, matched: byProduct.size, unmatched: unmatched.length });
    return { orderId: ord.id, orderNumber: ord.order_number, matched: byProduct.size, unmatched };
  });
