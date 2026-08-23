import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { matchLineToProduct, nameTokens, type MatchableProduct } from "./product-match";
import type { Database } from "@/integrations/supabase/types";

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
  // Set by the extractor when a line fails its own quantity x rate check.
  needs_review: z.boolean().nullable().optional(),
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

    // Auto-link lines to catalog products by name similarity + HSN.
    const { data: products } = await supabase
      .from("products").select("id, name, hsn").eq("org_id", inv.org_id);
    const catalog = (products ?? []) as MatchableProduct[];

    await supabase.from("invoice_lines").delete().eq("invoice_id", inv.id);
    const linesToInsert = parsed.lines.map((l, i) => ({
      matched_product_id: matchLineToProduct(l.raw_description, l.hsn, catalog)?.productId ?? null,
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
      // The extractor now flags lines whose own quantity x rate does not match
      // the printed amount — a figure taken from the wrong column reads as
      // perfectly plausible, so confidence alone will not catch it.
      needs_review: !!l.needs_review || (l.confidence ?? 0) < 90,
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

    // AI extractions are the metered resource — enforce the plan quota.
    if (data.engine === "ai") {
      const { getOrgBilling } = await import("./billing.functions");
      const billing = await getOrgBilling(supabase, mem.org_id);
      const remaining = billing.aiLimitPerMonth - billing.aiUsedThisMonth;
      if (data.items.length > remaining) {
        log.info("enqueue:quota_blocked", { org: mem.org_id, remaining, requested: data.items.length });
        throw new Error(
          `AI extraction limit reached (${billing.aiUsedThisMonth}/${billing.aiLimitPerMonth} used this month, ` +
          `${Math.max(0, remaining)} left). Use the free OCR engine, or upgrade your plan on the Billing page.`,
        );
      }
    }

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

    // Guard against double-posting stock on a repeated approve call.
    const { data: current } = await supabase.from("invoices")
      .select("status").eq("id", data.invoiceId).single();
    if (current?.status === "approved") return { ok: true };

    const { data: lines } = await supabase.from("invoice_lines")
      .select("matched_product_id, quantity, free_quantity, rate")
      .eq("invoice_id", data.invoiceId);
    for (const l of lines ?? []) {
      if (!l.matched_product_id) continue;
      const { data: p } = await supabase.from("products")
        .select("current_stock, avg_cost").eq("id", l.matched_product_id).single();
      const qty = Number(l.quantity ?? 0);
      const free = Number(l.free_quantity ?? 0);
      const unitsIn = qty + free;
      const curStock = Number(p?.current_stock ?? 0);
      const update: { current_stock: number; last_purchase_rate?: number; avg_cost?: number } = { current_stock: curStock + unitsIn };
      if (l.rate != null) {
        update.last_purchase_rate = l.rate;
        // Moving weighted-average cost. Free scheme units carry no spend, so
        // they pull the effective per-unit cost down. Clamp negative (oversold)
        // stock to 0 so a backorder receipt just prices at the purchase rate.
        const oldStock = Math.max(0, curStock);
        const oldAvg = Number(p?.avg_cost ?? 0);
        const newUnits = oldStock + unitsIn;
        if (newUnits > 0) {
          const spend = qty * Number(l.rate);
          update.avg_cost = +((oldStock * oldAvg + spend) / newUnits).toFixed(4);
        }
      }
      await supabase.from("products").update(update).eq("id", l.matched_product_id);
    }

    const { error } = await supabase.from("invoices").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", data.invoiceId);
    if (error) throw new Error(error.message);
    log.info("approve:done", { invoiceId: data.invoiceId });
    return { ok: true };
  });

export const setLineProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      lineId: z.string().uuid(),
      productId: z.string().uuid().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("invoice_lines")
      .update({ matched_product_id: data.productId })
      .eq("id", data.lineId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createProductFromLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lineId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: line, error: lineErr } = await supabase.from("invoice_lines")
      .select("org_id, raw_description, hsn, gst_rate, mrp, unit, rate")
      .eq("id", data.lineId).single();
    if (lineErr || !line) throw new Error(lineErr?.message ?? "Line not found");

    const name = (line.raw_description ?? "").trim();
    if (!name) throw new Error("Line has no description to name the product");

    // Stock stays 0 here — Approve & post adds this invoice's quantity.
    const { data: product, error: prodErr } = await supabase.from("products")
      .insert({
        org_id: line.org_id,
        name,
        hsn: line.hsn ?? null,
        gst_rate: line.gst_rate ?? null,
        mrp: line.mrp ?? null,
        unit: line.unit ?? null,
        purchase_rate: line.rate ?? null,
        current_stock: 0,
      })
      .select("id, name")
      .single();
    if (prodErr) throw new Error(prodErr.message);

    const { error: linkErr } = await supabase.from("invoice_lines")
      .update({ matched_product_id: product.id })
      .eq("id", data.lineId);
    if (linkErr) throw new Error(linkErr.message);

    log.info("createProductFromLine:done", { lineId: data.lineId, productId: product.id });
    return product;
  });

/**
 * Catalog key for a product name: the matcher's tokens, sorted, after closing
 * the gap in "1 KG" so it keys the same as "1KG" (suppliers write both, and
 * nameTokens would otherwise drop the bare "1" as too short).
 *
 * Deliberately exact rather than fuzzy. matchLineToProduct accepts anything
 * scoring over 0.5, which pairs "TATA SALT 1KG" with "TATA SALT 2KG" — fine
 * as a suggestion a human confirms, wrong as the basis for silently creating
 * or reusing a product. An extra duplicate is a merge; a wrong merge is
 * corrupted stock and cost. Returns "" when a name has nothing usable in it.
 */
const catalogKey = (s: string) =>
  [...nameTokens(s.replace(/(\d)\s+(?=[a-z])/gi, "$1"))].sort().join(" ");

/**
 * Create catalog products for every line on a purchase invoice that isn't
 * linked to one yet.
 *
 * This is the onboarding path for a distributor arriving with no existing
 * software: their first few supplier bills build the product master, instead
 * of somebody typing several hundred products in by hand. Lines whose name
 * already matches something in the catalog are linked rather than duplicated,
 * so running this across a stack of bills converges instead of multiplying.
 */
export const createProductsForUnmatchedLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: inv, error: invErr } = await supabase.from("invoices")
      .select("id, org_id, status").eq("id", data.invoiceId).single();
    if (invErr || !inv) throw new Error(invErr?.message ?? "Invoice not found");
    if (inv.status === "approved") {
      throw new Error("This purchase is already approved — link products before approving.");
    }

    const { data: lines, error: linesErr } = await supabase.from("invoice_lines")
      .select("id, raw_description, hsn, gst_rate, mrp, unit, rate")
      .eq("invoice_id", data.invoiceId)
      .is("matched_product_id", null)
      .order("line_no");
    if (linesErr) throw new Error(linesErr.message);

    const { data: existing, error: prodErr } = await supabase.from("products")
      .select("id, name").eq("org_id", inv.org_id);
    if (prodErr) throw new Error(prodErr.message);

    // Existing catalog first, so a line the fuzzy matcher missed but whose
    // name normalises to a product we already have gets linked, not cloned.
    const byKey = new Map<string, string>();
    for (const p of existing ?? []) {
      const k = catalogKey(p.name ?? "");
      if (k && !byKey.has(k)) byKey.set(k, p.id);
    }

    type Line = NonNullable<typeof lines>[number];
    const links: { lineId: string; productId: string }[] = [];
    const groups = new Map<string, { rep: Line; lineIds: string[] }>();
    let skipped = 0;
    let matchedExisting = 0;

    for (const l of lines ?? []) {
      const k = catalogKey((l.raw_description ?? "").trim());
      if (!k) { skipped++; continue; }           // nothing usable to name a product
      const hit = byKey.get(k);
      if (hit) { links.push({ lineId: l.id, productId: hit }); matchedExisting++; continue; }
      const g = groups.get(k);
      if (g) g.lineIds.push(l.id);              // same item twice on one bill
      else groups.set(k, { rep: l, lineIds: [l.id] });
    }

    // Stock stays 0 — "Approve & post" is what adds this invoice's quantity.
    const rows = [...groups.values()].map(g => ({
      org_id: inv.org_id,
      name: (g.rep.raw_description ?? "").trim(),
      hsn: g.rep.hsn ?? null,
      gst_rate: g.rep.gst_rate ?? null,
      mrp: g.rep.mrp ?? null,
      unit: g.rep.unit ?? null,
      purchase_rate: g.rep.rate ?? null,
      current_stock: 0,
    }));

    let created = 0;
    if (rows.length) {
      const { data: ins, error } = await supabase.from("products")
        .insert(rows).select("id, name");
      if (error) throw new Error(error.message);
      created = (ins ?? []).length;

      // Group names are distinct by construction, so name is a safe join key.
      const idByName = new Map((ins ?? []).map(p => [p.name, p.id]));
      for (const g of groups.values()) {
        const pid = idByName.get((g.rep.raw_description ?? "").trim());
        if (!pid) continue;
        for (const lineId of g.lineIds) links.push({ lineId, productId: pid });
      }
    }

    for (const { lineId, productId } of links) {
      const { error } = await supabase.from("invoice_lines")
        .update({ matched_product_id: productId }).eq("id", lineId);
      if (error) throw new Error(error.message);
    }

    log.info("createProductsForUnmatchedLines:done", {
      invoiceId: data.invoiceId, created, matchedExisting, linesLinked: links.length, skipped,
    });
    return { created, matchedExisting, linesLinked: links.length, skipped };
  });

/** Edit purchase-invoice header fields (supplier, number, date, totals). */
export const updatePurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      invoiceId: z.string().uuid(),
      supplier_name: z.string().nullish(),
      supplier_gstin: z.string().nullish(),
      invoice_number: z.string().nullish(),
      invoice_date: z.string().nullish(),
      subtotal: z.number().nullish(),
      tax_total: z.number().nullish(),
      grand_total: z.number().nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { invoiceId, ...fields } = data;
    const { error } = await context.supabase.from("invoices")
      .update({
        supplier_name: fields.supplier_name ?? null,
        supplier_gstin: fields.supplier_gstin ?? null,
        invoice_number: fields.invoice_number ?? null,
        invoice_date: fields.invoice_date ?? null,
        subtotal: fields.subtotal ?? null,
        tax_total: fields.tax_total ?? null,
        grand_total: fields.grand_total ?? null,
      })
      .eq("id", invoiceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Delete a purchase invoice. If it was approved, reverse the stock it added
 * so inventory stays correct (the scenario: re-buy the same item cheaper and
 * re-upload). Last purchase rate isn't restored — the next approved purchase
 * sets it — so re-upload + approve the corrected invoice right after.
 */
/**
 * Edit one field of one line on a bill under review.
 *
 * Two things are enforced server-side rather than left to the screen.
 *
 * An approved invoice is closed. Approving is what moves stock and rewrites
 * weighted-average cost, so editing a line afterwards would leave the ledger
 * saying one thing and the bill another, with nothing to reconcile them. The
 * UI disables the inputs; this refuses the write.
 *
 * And the amount follows the numbers it is made of. If someone corrects a
 * quantity or a rate, `taxable_value` has to move with it — cost per unit,
 * weighted-average cost and every margin downstream are built from that
 * figure, and leaving it stale would show a corrected line that still prices
 * the old way. Editing the amount directly is allowed, and then it is taken as
 * given: the bill is the authority, not the arithmetic.
 */
export const updateInvoiceLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      lineId: z.string().uuid(),
      field: z.enum([
        "raw_description", "hsn", "batch", "expiry_date",
        "quantity", "free_quantity", "rate", "discount_pct", "gst_rate", "taxable_value",
      ]),
      value: z.string().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: line, error: readErr } = await supabase.from("invoice_lines")
      .select("id, invoice_id, quantity, rate, discount_pct, gst_rate, taxable_value")
      .eq("id", data.lineId).single();
    if (readErr || !line) throw new Error("Line not found");

    const { data: inv } = await supabase.from("invoices")
      .select("status").eq("id", line.invoice_id).single();
    if (inv?.status === "approved") {
      throw new Error("This bill is approved — its stock and cost are already posted. Delete it to re-do.");
    }

    const NUMERIC = ["quantity", "free_quantity", "rate", "discount_pct", "gst_rate", "taxable_value"];
    const raw = data.value?.trim() ?? "";
    let parsed: string | number | null = raw === "" ? null : raw;
    if (NUMERIC.includes(data.field) && raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`"${raw}" is not a number`);
      parsed = n;
    }

    // Typed against the generated table so a field rename breaks the build
    // rather than silently writing nothing.
    type LinePatch = Database["public"]["Tables"]["invoice_lines"]["Update"];
    const patch: LinePatch = { [data.field]: parsed } as LinePatch;

    // The amount is derived unless the operator sets it themselves, and the row
    // total follows the amount. Leaving either stale shows a corrected line
    // that still prices the old way — the first version of this recomputed
    // taxable_value and not line_total, so a doubled quantity kept its old
    // total on screen.
    const money = (n: number) => Math.round(n * 100) / 100;
    if (["quantity", "rate", "discount_pct"].includes(data.field)) {
      const qty = data.field === "quantity" ? parsed : line.quantity;
      const rate = data.field === "rate" ? parsed : line.rate;
      const disc = data.field === "discount_pct" ? parsed : line.discount_pct;
      if (qty != null && rate != null) {
        patch.taxable_value = money(Number(qty) * Number(rate) * (1 - Number(disc ?? 0) / 100));
      }
    }
    const taxable = patch.taxable_value ?? (data.field === "taxable_value" ? parsed : line.taxable_value);
    const gst = data.field === "gst_rate" ? parsed : line.gst_rate;
    if (taxable != null) {
      const tax = money(Number(taxable) * Number(gst ?? 0) / 100);
      patch.tax_amount = tax;
      patch.line_total = money(Number(taxable) + tax);
    }

    // A line the operator has just corrected is no longer the extractor's
    // guess, so it stops being flagged as one.
    patch.needs_review = false;

    const { error } = await supabase.from("invoice_lines").update(patch).eq("id", data.lineId);
    if (error) throw new Error(error.message);
    log.info("line:edited", { lineId: data.lineId, field: data.field });
    return { ok: true, taxable_value: patch.taxable_value ?? null };
  });

export const deletePurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: inv } = await supabase.from("invoices")
      .select("status, storage_path").eq("id", data.invoiceId).single();

    if (inv?.status === "approved") {
      const { data: lines } = await supabase.from("invoice_lines")
        .select("matched_product_id, quantity, free_quantity")
        .eq("invoice_id", data.invoiceId);
      for (const l of lines ?? []) {
        if (!l.matched_product_id) continue;
        const { data: p } = await supabase.from("products")
          .select("current_stock").eq("id", l.matched_product_id).single();
        const removed = Number(l.quantity ?? 0) + Number(l.free_quantity ?? 0);
        await supabase.from("products")
          .update({ current_stock: Number(p?.current_stock ?? 0) - removed })
          .eq("id", l.matched_product_id);
      }
      log.info("deletePurchase:stock_reversed", { invoiceId: data.invoiceId });
    }

    await supabase.from("invoice_lines").delete().eq("invoice_id", data.invoiceId);
    const { error } = await supabase.from("invoices").delete().eq("id", data.invoiceId);
    if (error) throw new Error(error.message);

    // Best-effort remove the stored file so storage doesn't accumulate orphans.
    if (inv?.storage_path) {
      await supabase.storage.from("invoices").remove([inv.storage_path]);
    }
    log.info("deletePurchase:done", { invoiceId: data.invoiceId });
    return { ok: true };
  });
