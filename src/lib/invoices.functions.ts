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
  lines: z.array(LineSchema),
});

export const extractInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const invoiceId = data.invoiceId;
    const apiUrl = process.env.EXTRACTION_API_URL ?? "http://localhost:8000";
    log.info("extract:start", { invoiceId, apiUrl });

    const { data: inv, error: invErr } = await supabase
      .from("invoices").select("*").eq("id", invoiceId).single();
    if (invErr || !inv) {
      log.error("extract:invoice_not_found", { invoiceId, err: invErr });
      throw new Error(invErr?.message ?? "Invoice not found");
    }

    await supabase.from("invoices")
      .update({ status: "processing", error_message: null }).eq("id", inv.id);
    log.debug("extract:status=processing", { invoiceId });

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("invoices").download(inv.storage_path);
    if (dlErr || !fileBlob) {
      log.error("extract:download_failed", { invoiceId, path: inv.storage_path, err: dlErr });
      await supabase.from("invoices").update({
        status: "failed", error_message: dlErr?.message ?? "download failed",
      }).eq("id", inv.id);
      throw new Error(dlErr?.message ?? "Download failed");
    }
    log.info("extract:file_downloaded", {
      invoiceId, bytes: fileBlob.size, type: fileBlob.type,
    });

    const mime = inv.mime_type ?? fileBlob.type ?? "application/octet-stream";

    try {
      const form = new FormData();
      form.append("file", fileBlob, inv.storage_path.split("/").pop() ?? "invoice");
      form.append("mime_type", mime);

      const target = `${apiUrl.replace(/\/$/, "")}/extract`;
      log.info("extract:posting_to_service", { invoiceId, target, mime });
      const t0 = Date.now();
      const resp = await fetch(target, { method: "POST", body: form });
      log.info("extract:service_responded", {
        invoiceId, status: resp.status, ms: Date.now() - t0,
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 400);
        log.error("extract:service_error", { invoiceId, status: resp.status, body });
        throw new Error(`Extraction service ${resp.status}: ${body}`);
      }
      const json = await resp.json();
      const parsed = ExtractionSchema.parse(json);
      log.info("extract:parsed", {
        invoiceId, lines: parsed.lines.length, supplier: parsed.supplier_name,
      });

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
        if (linesErr) {
          log.error("extract:lines_insert_failed", { invoiceId, err: linesErr });
          throw new Error(linesErr.message);
        }
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
      if (updErr) {
        log.error("extract:invoice_update_failed", { invoiceId, err: updErr });
        throw new Error(updErr.message);
      }

      log.info("extract:done", { invoiceId, lineCount: linesToInsert.length });
      return { ok: true, lineCount: linesToInsert.length };
    } catch (err) {
      const msg = (err as Error).message ?? "Extraction failed";
      log.error("extract:failed", { invoiceId, err });
      await supabase.from("invoices").update({
        status: "failed", error_message: msg,
      }).eq("id", inv.id);
      throw new Error(msg);
    }
  });

export const approveInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("approve:start", { invoiceId: data.invoiceId, userId });
    const { error } = await supabase.from("invoices").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", data.invoiceId);
    if (error) {
      log.error("approve:failed", { invoiceId: data.invoiceId, err: error });
      throw new Error(error.message);
    }
    log.info("approve:done", { invoiceId: data.invoiceId });
    return { ok: true };
  });
