import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { matchLineToProduct, type MatchableProduct } from "./product-match";

/**
 * Several photos of the same bill.
 *
 * A distributor's bill from a D-Mart or a large FMCG supplier runs to three or
 * four pages, and the operator photographs each one. Read a page at a time,
 * that is three invoices with a third of the rows each and a nonsense total.
 *
 * So the whole batch goes to the model in ONE call and the model says which
 * photos are which bill. That is not only about page assembly: a continuation
 * page usually carries no supplier and no invoice number at all — nothing but
 * line numbers that carry on from the page before — so nothing that looks at
 * one photo in isolation can place it. It is also cheaper, one request instead
 * of N against a per-minute rate limit.
 *
 * Nothing is written until the operator has seen the proposed grouping. The
 * reason is asymmetry: a bill wrongly split is obvious on screen and costs a
 * regroup, while two bills wrongly merged writes one supplier's goods under
 * another's name, corrupts the weighted-average cost, and looks entirely
 * plausible afterwards.
 */

const log = createLogger("invoice-batch");

const LineSchema = z.object({
  line_no: z.number().nullable().optional(),
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
  mfg_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  needs_review: z.boolean().nullable().optional(),
});

const DocumentSchema = z.object({
  page_indexes: z.array(z.number()).default([]),
  duplicate_page_indexes: z.array(z.number()).default([]),
  page_labels: z.array(z.string().nullable()).default([]),
  missing_page_numbers: z.array(z.number()).default([]),
  grouping_reason: z.string().nullable().optional(),
  grouping_confidence: z.number().nullable().optional(),
  supplier_name: z.string().nullable().optional(),
  supplier_gstin: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  other_charges: z.number().nullable().optional(),
  tax_total: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  overall_confidence: z.number().nullable().optional(),
  line_count_on_bill: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(LineSchema).default([]),
});

const BatchSchema = z.object({
  documents: z.array(DocumentSchema).default([]),
  unassigned_page_indexes: z.array(z.number()).default([]),
});

export type ProposedDocument = z.infer<typeof DocumentSchema>;

const ItemSchema = z.object({
  storagePath: z.string(),
  mimeType: z.string().nullable().optional(),
});

/**
 * Mirrors the backend's own ceiling so the user is told before the upload.
 * Six is where reading photos together was measured to still work: six take
 * about 90 seconds, ten exceed the service's 300s ceiling and fail.
 */
export const MAX_PAGES_PER_BATCH = 6;

// The middleware hands back a fully generic Supabase client; naming its type
// here would pin this file to the generated Database type for no benefit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function orgOf(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  if (!data?.org_id) throw new Error("No organization");
  return data.org_id as string;
}

/**
 * Read a batch and propose a grouping. Writes nothing.
 *
 * The quota is checked but not spent here — an operator who looks at the
 * proposal and abandons it should not have paid for it. It is charged in
 * saveInvoiceGroups, one per bill rather than one per photo, because a bill
 * that happened to need four photos is still one bill.
 */
export const proposeInvoiceGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z.array(ItemSchema).min(1).max(MAX_PAGES_PER_BATCH),
        docType: z.enum(["purchase", "sales"]).default("purchase"),
        // Set when the operator has corrected the grouping on the review panel.
        // Their correction is then a fact rather than a suggestion, and the bills
        // are read again from scratch — line items cannot be moved between bills
        // afterwards, because nothing records which photo a row came from.
        groups: z.array(z.array(z.number().int().min(0))).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const orgId = await orgOf(supabase, userId);

    const { getOrgBilling } = await import("./billing.functions");
    const billing = await getOrgBilling(supabase, orgId);
    if (billing.aiLimitPerMonth - billing.aiUsedThisMonth <= 0) {
      throw new Error(
        `AI extraction limit reached (${billing.aiUsedThisMonth}/${billing.aiLimitPerMonth} used this ` +
          `month). Use the free OCR engine, or upgrade your plan on the Billing page.`,
      );
    }

    const form = new FormData();
    for (const item of data.items) {
      const { data: blob, error } = await supabase.storage
        .from("invoices")
        .download(item.storagePath);
      if (error || !blob) {
        log.error("propose:download_failed", { path: item.storagePath, err: error });
        throw new Error(`Could not read ${item.storagePath.split("/").pop()}`);
      }
      form.append("files", blob, item.storagePath.split("/").pop() ?? "page");
    }
    form.append("doc_type", data.docType);
    if (data.groups?.length) form.append("groups", JSON.stringify(data.groups));

    const apiUrl = (process.env.EXTRACTION_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
    const t0 = Date.now();
    const resp = await fetch(`${apiUrl}/extract-batch`, { method: "POST", body: form });
    log.info("propose:responded", {
      status: resp.status,
      ms: Date.now() - t0,
      files: data.items.length,
      regrouped: !!data.groups?.length,
    });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 400);
      throw new Error(`Extraction service ${resp.status}: ${body}`);
    }

    const batch = BatchSchema.parse(await resp.json());
    log.info("propose:grouped", {
      photos: data.items.length,
      bills: batch.documents.length,
      unassigned: batch.unassigned_page_indexes.length,
    });
    return {
      documents: batch.documents,
      unassignedPageIndexes: batch.unassigned_page_indexes,
      items: data.items,
    };
  });

/**
 * Persist a confirmed grouping: one invoice per bill, its photos in
 * invoice_pages, its rows in invoice_lines.
 *
 * Page 1 stays in invoices.storage_path so every existing screen — the
 * thumbnail, the re-extract, the storage cleanup — keeps working without
 * knowing multi-page bills exist.
 */
export const saveInvoiceGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z.array(ItemSchema).min(1).max(MAX_PAGES_PER_BATCH),
        documents: z.array(DocumentSchema).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const orgId = await orgOf(supabase, userId);

    // Charged per bill, which is what the operator thinks they uploaded, and
    // what it actually costs us now that a batch is a single model call.
    const { getOrgBilling } = await import("./billing.functions");
    const billing = await getOrgBilling(supabase, orgId);
    const remaining = billing.aiLimitPerMonth - billing.aiUsedThisMonth;
    if (data.documents.length > remaining) {
      throw new Error(
        `AI extraction limit reached (${billing.aiUsedThisMonth}/${billing.aiLimitPerMonth} used this ` +
          `month, ${Math.max(0, remaining)} left). Upgrade your plan on the Billing page.`,
      );
    }

    const { data: products } = await supabase
      .from("products")
      .select("id, name, hsn")
      .eq("org_id", orgId);
    const catalog = (products ?? []) as MatchableProduct[];

    const created: { id: string; invoiceNumber: string | null; pages: number }[] = [];

    for (const doc of data.documents) {
      // A grouping that names no photo cannot be saved: there would be nothing
      // to show the operator and nothing to re-extract from.
      const pages = doc.page_indexes.filter((i) => i >= 0 && i < data.items.length);
      if (!pages.length) {
        log.warn("save:document_without_pages", { invoice: doc.invoice_number });
        continue;
      }
      const first = data.items[pages[0]];

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          org_id: orgId,
          uploaded_by: userId,
          storage_path: first.storagePath,
          mime_type: first.mimeType ?? null,
          extraction_engine: "ai",
          status: "review",
          supplier_name: doc.supplier_name ?? null,
          supplier_gstin: doc.supplier_gstin ?? null,
          invoice_number: doc.invoice_number ?? null,
          invoice_date: doc.invoice_date ?? null,
          subtotal: doc.subtotal ?? null,
          tax_total: doc.tax_total ?? null,
          grand_total: doc.grand_total ?? null,
          confidence: doc.overall_confidence ?? null,
          raw_extraction: doc as never,
        })
        .select("id")
        .single();
      if (invErr || !inv) throw new Error(invErr?.message ?? "Could not create invoice");

      const pageRows = [
        ...pages.map((idx, n) => ({
          invoice_id: inv.id,
          org_id: orgId,
          page_no: n + 1,
          storage_path: data.items[idx].storagePath,
          mime_type: data.items[idx].mimeType ?? null,
          page_label: doc.page_labels[n] ?? null,
          is_duplicate: false,
        })),
        // Rejected photos are recorded too, numbered after the real pages. An
        // operator who took six photos and sees four should be able to find the
        // other two rather than wonder what happened to them.
        ...doc.duplicate_page_indexes
          .filter((i) => i >= 0 && i < data.items.length)
          .map((idx, n) => ({
            invoice_id: inv.id,
            org_id: orgId,
            page_no: pages.length + n + 1,
            storage_path: data.items[idx].storagePath,
            mime_type: data.items[idx].mimeType ?? null,
            page_label: null,
            is_duplicate: true,
          })),
      ];
      const { error: pagesErr } = await supabase.from("invoice_pages").insert(pageRows);
      if (pagesErr) throw new Error(pagesErr.message);

      const lineRows = doc.lines.map((l, i) => ({
        invoice_id: inv.id,
        org_id: orgId,
        matched_product_id:
          matchLineToProduct(l.raw_description, l.hsn ?? null, catalog)?.productId ?? null,
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
        needs_review: !!l.needs_review || (l.confidence ?? 0) < 90,
      }));
      if (lineRows.length) {
        const { error: linesErr } = await supabase.from("invoice_lines").insert(lineRows);
        if (linesErr) throw new Error(linesErr.message);
      }

      created.push({ id: inv.id, invoiceNumber: doc.invoice_number ?? null, pages: pages.length });
      log.info("save:invoice", {
        id: inv.id,
        invoice: doc.invoice_number,
        pages: pages.length,
        duplicates: doc.duplicate_page_indexes.length,
        lines: lineRows.length,
      });
    }

    if (!created.length) throw new Error("Nothing to save — no bill had a readable page");
    return { invoices: created };
  });
