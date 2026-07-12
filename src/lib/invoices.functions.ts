import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("invoices.functions");

const LineSchema = z.object({
  line_no: z.number().nullable().optional(),
  raw_description: z.string(),
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
  mfg_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
});

const ExtractionSchema = z.object({
  supplier_name: z.string().nullable().optional(),
  supplier_gstin: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  tax_total: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  overall_confidence: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(LineSchema).default([]),
});

type Engine = "ai" | "ocr";

async function runExtraction(
  supabase: any,
  invoiceId: string,
  engine: Engine,
): Promise<{ ok: true; lineCount: number }> {
  const apiUrl = process.env.EXTRACTION_API_URL ?? "http://localhost:8000";
  log.info("extract:start", { invoiceId, engine, apiUrl });

  const { data: inv, error: invErr } = await supabase
    .from("invoices").select("*").eq("id", invoiceId).single();
  if (invErr || !inv) {
    log.error("extract:invoice_not_found", { invoiceId, err: invErr });
    throw new Error(invErr?.message ?? "Invoice not found");
  }

  await supabase.from("invoices")
    .update({ status: "processing", error_message: null, extraction_engine: engine })
    .eq("id", inv.id);

  const { data: fileBlob, error: dlErr } = await supabase.storage
    .from("invoices").download(inv.storage_path);
  if (dlErr || !fileBlob) {
    log.error("extract:download_failed", { invoiceId, path: inv.storage_path, err: dlErr });
    await supabase.from("invoices").update({
      status: "failed", error_message: dlErr?.message ?? "download failed",
    }).eq("id", inv.id);
    throw new Error(dlErr?.message ?? "Download failed");
  }

  const mime = inv.mime_type ?? fileBlob.type ?? "application/octet-stream";
  const endpoint = engine === "ocr" ? "/extract-ocr" : "/extract";

  try {
    const form = new FormData();
    form.append("file", fileBlob, inv.storage_path.split("/").pop() ?? "invoice");
    form.append("mime_type", mime);

    const target = `${apiUrl.replace(/\/$/, "")}${endpoint}`;
    log.info("extract:posting", { invoiceId, target, mime, engine });
    const t0 = Date.now();
    const resp = await fetch(target, { method: "POST", body: form });
    log.info("extract:responded", { invoiceId, status: resp.status, ms: Date.now() - t0 });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 400);
      log.error("extract:service_error", { invoiceId, status: resp.status, body });
      throw new Error(`Extraction service ${resp.status}: ${body}`);
    }
    const parsed = ExtractionSchema.parse(await resp.json());

    await supabase.from("invoice_lines").delete().eq("invoice_id", inv.id);
    const linesToInsert = parsed.lines.map((l, i) => ({
      invoice_id: inv.id,
      org_id: inv.org_id,
      line_no: l.line_no ?? i + 1,
      raw_description: l.raw_description,
      hsn: l.hsn ?? null,
      quantity: l.quantity ?? null,
      free_quantity: l.free_quantity ?? null,
      unit: l.unit ?? null,
      rate: l.rate ?? null,
      mrp: l.mrp ?? null,
      discount_pct: l.discount_pct ?? null,
      gst_rate: l.gst_rate ?? null,
      taxable_value: l.taxable_value ?? null,
      tax_amount: l.tax_amount ?? null,
      line_total: l.line_total ?? null,
      batch: l.batch ?? null,
      mfg_date: l.mfg_date ?? null,
      expiry_date: l.expiry_date ?? null,
      match_confidence: l.confidence ?? null,
      needs_review: (l.confidence ?? 0) < 90,
    }));
    if (linesToInsert.length) {
      const { error: linesErr } = await supabase.from("invoice_lines").insert(linesToInsert);
      if (linesErr) throw new Error(linesErr.message);
    }

    const { error: updErr } = await supabase.from("invoices").update({
      status: "review",
      supplier_name: parsed.supplier_name ?? null,
      supplier_gstin: parsed.supplier_gstin ?? null,
      invoice_number: parsed.invoice_number ?? null,
      invoice_date: parsed.invoice_date ?? null,
      subtotal: parsed.subtotal ?? null,
      tax_total: parsed.tax_total ?? null,
      grand_total: parsed.grand_total ?? null,
      confidence: parsed.overall_confidence ?? null,
      raw_extraction: parsed as never,
    }).eq("id", inv.id);
    if (updErr) throw new Error(updErr.message);

    log.info("extract:done", { invoiceId, lineCount: linesToInsert.length, engine });
    return { ok: true, lineCount: linesToInsert.length };
  } catch (err) {
    const msg = (err as Error).message ?? "Extraction failed";
    log.error("extract:failed", { invoiceId, err });
    await supabase.from("invoices").update({
      status: "failed", error_message: msg,
    }).eq("id", inv.id);
    throw new Error(msg);
  }
}

export const extractInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    invoiceId: z.string().uuid(),
    engine: z.enum(["ai", "ocr"]).default("ai"),
  }).parse(d))
  .handler(async ({ data, context }) => runExtraction(context.supabase, data.invoiceId, data.engine));

/**
 * Enqueue a batch. Rows are created with status='queued' and picked up by
 * the cron worker (see /api/public/hooks/process-invoice-queue). The client
 * uploads to storage first, then calls this with the resulting paths.
 */
export const enqueueInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    engine: z.enum(["ai", "ocr"]).default("ai"),
    items: z.array(z.object({
      storagePath: z.string(),
      mimeType: z.string().nullable().optional(),
    })).min(1).max(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase
      .from("memberships").select("org_id").eq("user_id", userId).limit(1).single();
    if (!mem?.org_id) throw new Error("No organization");

    const rows = data.items.map((it) => ({
      org_id: mem.org_id,
      storage_path: it.storagePath,
      mime_type: it.mimeType ?? null,
      status: "queued" as const,
      extraction_engine: data.engine,
      uploaded_by: userId,
    }));
    const { data: inserted, error } = await supabase
      .from("invoices").insert(rows).select("id, storage_path");
    if (error) {
      log.error("enqueue:failed", { err: error });
      throw new Error(error.message);
    }
    log.info("enqueue:ok", { count: inserted?.length ?? 0, engine: data.engine });
    return { ids: (inserted ?? []).map((r) => r.id) };
  });

/**
 * Worker: process up to `limit` queued invoices. Called by pg_cron every
 * minute and can also be triggered manually right after enqueue for snappy
 * UX. Safe to call in parallel — each row is claimed atomically via a
 * conditional UPDATE (queued → processing).
 */
export const processQueue = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(20).default(5) })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: candidates, error } = await supabaseAdmin
      .from("invoices")
      .select("id, extraction_engine")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    if (!candidates?.length) return { processed: 0 };

    let processed = 0;
    for (const row of candidates) {
      // Claim atomically
      const { data: claimed } = await supabaseAdmin
        .from("invoices")
        .update({ status: "processing" })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      const engine: Engine = row.extraction_engine === "ocr" ? "ocr" : "ai";
      try {
        await runExtraction(supabaseAdmin, row.id, engine);
        processed++;
      } catch (e) {
        log.error("queue:row_failed", { id: row.id, err: e });
      }
    }
    return { processed };
  });

export const approveInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("approve:start", { invoiceId: data.invoiceId, userId });

    const { data: lines } = await supabase.from("invoice_lines")
      .select("matched_product_id, quantity, free_quantity, rate")
      .eq("invoice_id", data.invoiceId);
    for (const l of lines ?? []) {
      if (!l.matched_product_id) continue;
      const { data: p } = await supabase.from("products")
        .select("current_stock").eq("id", l.matched_product_id).single();
      const added = Number(l.quantity ?? 0) + Number(l.free_quantity ?? 0);
      await supabase.from("products").update({
        current_stock: Number(p?.current_stock ?? 0) + added,
        last_purchase_rate: l.rate ?? undefined,
      }).eq("id", l.matched_product_id);
    }

    const { error } = await supabase.from("invoices").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", data.invoiceId);
    if (error) throw new Error(error.message);
    log.info("approve:done", { invoiceId: data.invoiceId });
    return { ok: true };
  });
