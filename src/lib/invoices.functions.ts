import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const LineSchema = z.object({
  line_no: z.number().nullable(),
  raw_description: z.string(),
  hsn: z.string().nullable(),
  quantity: z.number().nullable(),
  free_quantity: z.number().nullable(),
  unit: z.string().nullable(),
  rate: z.number().nullable(),
  mrp: z.number().nullable(),
  discount_pct: z.number().nullable(),
  gst_rate: z.number().nullable(),
  taxable_value: z.number().nullable(),
  tax_amount: z.number().nullable(),
  line_total: z.number().nullable(),
  batch: z.string().nullable(),
  mfg_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  confidence: z.number().nullable(),
});

const ExtractionSchema = z.object({
  supplier_name: z.string().nullable(),
  supplier_gstin: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  subtotal: z.number().nullable(),
  tax_total: z.number().nullable(),
  grand_total: z.number().nullable(),
  overall_confidence: z.number().nullable(),
  notes: z.string().nullable(),
  lines: z.array(LineSchema),
});

const SYSTEM_PROMPT = `You are an expert Indian purchase-invoice parser used by pharma, FMCG, hardware and grocery distributors.
Extract every product line and every header field precisely as printed on the invoice.

Rules:
- Return dates in YYYY-MM-DD format when possible; return null if unreadable.
- Quantities and money are numbers (no currency symbols).
- Detect free schemes (e.g. "10+1", "BUY 100 GET 12 FREE") and record billed qty in quantity, free units in free_quantity.
- Set confidence (0-100) per line based on legibility.
- Prefer null over guessing.
- Extract HSN, batch, expiry, mfg date whenever printed.`;

export const extractInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: inv, error: invErr } = await supabase
      .from("invoices").select("*").eq("id", data.invoiceId).single();
    if (invErr || !inv) throw new Error(invErr?.message ?? "Invoice not found");

    await supabase.from("invoices").update({ status: "processing", error_message: null }).eq("id", inv.id);

    // Download file
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("invoices").download(inv.storage_path);
    if (dlErr || !fileBlob) {
      await supabase.from("invoices").update({ status: "failed", error_message: dlErr?.message ?? "download failed" }).eq("id", inv.id);
      throw new Error(dlErr?.message ?? "Download failed");
    }
    const buf = new Uint8Array(await fileBlob.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...buf));
    const mime = inv.mime_type ?? fileBlob.type ?? "application/octet-stream";

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const isImage = mime.startsWith("image/");
    const contentBlock = isImage
      ? { type: "image" as const, image: `data:${mime};base64,${base64}` }
      : { type: "file" as const, data: `data:${mime};base64,${base64}`, mediaType: mime };

    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract the full purchase invoice as structured JSON." },
            contentBlock as never,
          ],
        }],
        output: Output.object({ schema: ExtractionSchema }),
      });
      const parsed = result.output as z.infer<typeof ExtractionSchema>;

      // Persist
      await supabase.from("invoice_lines").delete().eq("invoice_id", inv.id);
      const linesToInsert = parsed.lines.map((l, i) => ({
        invoice_id: inv.id,
        org_id: inv.org_id,
        line_no: l.line_no ?? i + 1,
        raw_description: l.raw_description,
        hsn: l.hsn,
        quantity: l.quantity,
        free_quantity: l.free_quantity,
        unit: l.unit,
        rate: l.rate,
        mrp: l.mrp,
        discount_pct: l.discount_pct,
        gst_rate: l.gst_rate,
        taxable_value: l.taxable_value,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
        batch: l.batch,
        mfg_date: l.mfg_date,
        expiry_date: l.expiry_date,
        match_confidence: l.confidence,
        needs_review: (l.confidence ?? 0) < 90,
      }));
      if (linesToInsert.length) {
        const { error: linesErr } = await supabase.from("invoice_lines").insert(linesToInsert);
        if (linesErr) throw new Error(linesErr.message);
      }

      await supabase.from("invoices").update({
        status: "review",
        supplier_name: parsed.supplier_name,
        supplier_gstin: parsed.supplier_gstin,
        invoice_number: parsed.invoice_number,
        invoice_date: parsed.invoice_date,
        subtotal: parsed.subtotal,
        tax_total: parsed.tax_total,
        grand_total: parsed.grand_total,
        confidence: parsed.overall_confidence,
        raw_extraction: parsed as never,
      }).eq("id", inv.id);

      return { ok: true, lineCount: linesToInsert.length };
    } catch (err) {
      const msg = NoObjectGeneratedError.isInstance(err)
        ? "Model returned unstructured output"
        : (err as Error).message;
      await supabase.from("invoices").update({ status: "failed", error_message: msg }).eq("id", inv.id);
      throw new Error(msg);
    }
  });

export const approveInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("invoices").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", data.invoiceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
