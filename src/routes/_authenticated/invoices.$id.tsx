import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { approveInvoice, extractInvoice, setLineProduct, createProductFromLine, createProductsForUnmatchedLines, updatePurchaseInvoice, deletePurchaseInvoice } from "@/lib/invoices.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "./dashboard";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, AlertTriangle, ArrowLeft, Link2, Plus, Trash2, Save, Sparkles, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExtractionAccuracy, ExtractionAccuracyLabel } from "@/components/extraction-accuracy";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Review invoice — Dhela" }] }),
  component: InvoiceReview,
});

function InvoiceReview() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const approve = useServerFn(approveInvoice);
  const extract = useServerFn(extractInvoice);
  const linkProduct = useServerFn(setLineProduct);
  const createProduct = useServerFn(createProductFromLine);
  const createAllProducts = useServerFn(createProductsForUnmatchedLines);
  const [bulkBusy, setBulkBusy] = useState(false);
  const updateHeader = useServerFn(updatePurchaseInvoice);
  const removeInvoice = useServerFn(deletePurchaseInvoice);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hdr, setHdr] = useState<{
    supplier_name: string; supplier_gstin: string; invoice_number: string;
    invoice_date: string; subtotal: string; tax_total: string; grand_total: string;
  } | null>(null);

  const { data: inv } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2000 : false),
  });

  const { data: lines } = useQuery({
    queryKey: ["invoice-lines", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("line_no");
      if (error) throw error;
      return data;
    },
    enabled: !!inv,
  });

  const { data: products } = useQuery({
    queryKey: ["products_min_match"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name").order("name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!inv?.storage_path) return;
    supabase.storage.from("invoices").createSignedUrl(inv.storage_path, 600).then(({ data }) => {
      if (data?.signedUrl) setPreviewUrl(data.signedUrl);
    });
  }, [inv?.storage_path]);

  useEffect(() => {
    if (!inv) return;
    setHdr({
      supplier_name: inv.supplier_name ?? "",
      supplier_gstin: inv.supplier_gstin ?? "",
      invoice_number: inv.invoice_number ?? "",
      invoice_date: inv.invoice_date ?? "",
      subtotal: inv.subtotal != null ? String(inv.subtotal) : "",
      tax_total: inv.tax_total != null ? String(inv.tax_total) : "",
      grand_total: inv.grand_total != null ? String(inv.grand_total) : "",
    });
  }, [inv?.id]);

  /**
   * Cross-check the extracted figures against each other. The per-field
   * confidence score says how sure the model was, not whether the result is
   * arithmetically possible — a photo of a bill can come back "90% High" with
   * a subtotal and a grand total that can't both be true. Approving posts
   * these into stock and weighted-average cost, so it's worth saying so.
   *
   * Tolerance is 1% or ₹1, whichever is larger, to allow for round-off lines.
   */
  const arithmeticIssues = useMemo(() => {
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const fmt = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
    const off = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.01);
    const issues: string[] = [];

    const sub = num(inv?.subtotal), tax = num(inv?.tax_total), grand = num(inv?.grand_total);
    if (sub != null && tax != null && grand != null && off(sub + tax, grand)) {
      issues.push(t("Subtotal {{sub}} + tax {{tax}} = {{sum}}, but the grand total says {{grand}}.", {
        sub: fmt(sub), tax: fmt(tax), sum: fmt(sub + tax), grand: fmt(grand),
      }));
    }

    const taxables = (lines ?? [])
      .map(l => num(l.taxable_value) ?? (num(l.quantity) != null && num(l.rate) != null
        ? num(l.quantity)! * num(l.rate)! : null))
      .filter((v): v is number => v != null);
    if (sub != null && taxables.length === (lines?.length ?? 0) && taxables.length > 0) {
      const lineSum = taxables.reduce((a, b) => a + b, 0);
      if (off(lineSum, sub)) {
        issues.push(t("Line items add up to {{sum}}, but the subtotal says {{sub}}.", {
          sum: fmt(lineSum), sub: fmt(sub),
        }));
      }
    }

    if (grand != null && grand > 0 && sub != null && sub > 0 && grand > sub * 3) {
      issues.push(t("The grand total is more than three times the subtotal — one of them was probably misread."));
    }
    return issues;
  }, [inv?.subtotal, inv?.tax_total, inv?.grand_total, lines, t]);

  if (!inv) return <div className="p-4 sm:p-8">{t("Loading…")}</div>;

  const saveHeader = async () => {
    if (!hdr) return;
    try {
      await updateHeader({ data: {
        invoiceId: id,
        supplier_name: hdr.supplier_name || null,
        supplier_gstin: hdr.supplier_gstin || null,
        invoice_number: hdr.invoice_number || null,
        invoice_date: hdr.invoice_date || null,
        subtotal: hdr.subtotal ? Number(hdr.subtotal) : null,
        tax_total: hdr.tax_total ? Number(hdr.tax_total) : null,
        grand_total: hdr.grand_total ? Number(hdr.grand_total) : null,
      }});
      toast.success(t("Invoice details saved"));
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const doDelete = async () => {
    if (!confirm(inv.status === "approved"
      ? t("Delete this approved purchase? The stock it added will be reversed.")
      : t("Delete this purchase invoice?"))) return;
    try {
      await removeInvoice({ data: { invoiceId: id } });
      toast.success(t("Purchase deleted"));
      qc.invalidateQueries();
      navigate({ to: "/invoices" });
    } catch (e) { toast.error((e as Error).message); }
  };

  /**
   * A read where most lines fail their own quantity x rate is not a read with
   * some errors in it — the columns were misidentified for the whole table, so
   * every figure is suspect, including the ones that happen to look right.
   * Twelve such lines once reached this screen under a "72% · Medium" badge.
   */
  const badLines = (lines ?? []).filter(l => l.needs_review).length;
  const unusable = !!lines?.length && badLines * 2 >= lines.length;

  // Stored on every invoice already; nothing reads it today.
  const extractionNote = (() => {
    const raw = inv?.raw_extraction as { notes?: string | null } | null | undefined;
    const note = raw?.notes?.trim();
    return note && note.length > 1 ? note : null;
  })();

  const unlinkedCount = (lines ?? []).filter(l => !l.matched_product_id).length;


  const doApprove = async () => {
    if (unlinkedCount > 0 && !confirm(
      t("{{n}} line(s) are not linked to a product — stock and purchase cost won't update for them. Approve anyway?", { n: unlinkedCount }),
    )) return;
    await approve({ data: { invoiceId: id } });
    toast.success(t("Approved and posted to inventory"));
    qc.invalidateQueries();
    navigate({ to: "/invoices" });
  };

  const pickProduct = async (lineId: string, value: string) => {
    try {
      if (value === "__create__") {
        const p = await createProduct({ data: { lineId } });
        toast.success(t('Product "{{name}}" created and linked', { name: p.name }));
        qc.invalidateQueries({ queryKey: ["products_min_match"] });
        qc.invalidateQueries({ queryKey: ["products"] });
      } else {
        await linkProduct({ data: { lineId, productId: value === "__none__" ? null : value } });
      }
      qc.invalidateQueries({ queryKey: ["invoice-lines", id] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const buildCatalog = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await createAllProducts({ data: { invoiceId: id } });
      const parts = [
        r.created ? t("{{n}} new product(s) created", { n: r.created }) : null,
        r.matchedExisting ? t("{{n}} line(s) matched products you already had", { n: r.matchedExisting }) : null,
        r.skipped ? t("{{n}} line(s) skipped — no usable description", { n: r.skipped }) : null,
      ].filter(Boolean);
      toast.success(parts.join(" · ") || t("Nothing to add — every line is already linked"));
      qc.invalidateQueries({ queryKey: ["invoice-lines", id] });
      qc.invalidateQueries({ queryKey: ["products_min_match"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const reprocess = async () => {
    try {
      await extract({ data: { invoiceId: id } });
      toast.success(t("Re-extracted"));
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button variant="ghost" size="sm" className="shrink-0 px-2"
            onClick={() => navigate({ to: "/invoices" })}>
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">{t("Back")}</span>
          </Button>
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl truncate">
              {inv.supplier_name ?? t("Unknown supplier")}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {t("Invoice")} {inv.invoice_number ?? "—"} · {inv.invoice_date ?? "—"}
            </p>
          </div>
          <StatusBadge status={inv.status} />
        </div>
        {/* Three buttons side by side run off a 390px screen. Below sm the two
            secondary actions share a row and Approve takes the full width. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button variant="outline" size="sm" className="sm:h-9" onClick={reprocess}>
            <RefreshCw className="h-4 w-4 mr-1.5 sm:mr-2" />{t("Re-extract")}
          </Button>
          <Button variant="outline" size="sm" className="sm:h-9 text-destructive hover:text-destructive" onClick={doDelete}>
            <Trash2 className="h-4 w-4 mr-1.5 sm:mr-2" />{t("Delete")}
          </Button>
          <Button size="sm" className="col-span-2 sm:col-span-1 sm:h-9"
            onClick={doApprove} disabled={inv.status === "approved"}>
            <CheckCircle2 className="h-4 w-4 mr-1.5 sm:mr-2" />{t("Approve & post")}
          </Button>
        </div>
      </div>

      {arithmeticIssues.length > 0 && inv.status !== "approved" && (
        <Card className="border-amber-400/60 bg-warning/10">
          <CardContent className="pt-6 flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-medium">{t("These numbers don't add up")}</p>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {arithmeticIssues.map(i => <li key={i}>· {i}</li>)}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("Common on photos of bills. Check against the original and correct the fields before approving — approving posts these figures into stock and cost.")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {inv.status === "failed" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div><p className="font-medium">{t("Extraction failed")}</p><p className="text-sm text-muted-foreground">{inv.error_message}</p></div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        <Card className="min-h-[500px]">
          <CardHeader><CardTitle className="text-sm">{t("Original invoice")}</CardTitle></CardHeader>
          <CardContent>
            {previewUrl ? (
              inv.mime_type?.startsWith("image/") ? (
                <img src={previewUrl} alt="Invoice" className="w-full rounded border" />
              ) : (
                <iframe src={previewUrl} className="w-full h-[700px] rounded border" title="Invoice" />
              )
            ) : <div className="text-sm text-muted-foreground">{t("Loading preview…")}</div>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm">{t("Header")}</CardTitle>
              <Button size="sm" variant="outline" onClick={saveHeader}><Save className="h-3.5 w-3.5 mr-1.5" /> {t("Save")}</Button>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <EditField label={t("Supplier")} value={hdr?.supplier_name ?? ""} onChange={v => setHdr(h => h && { ...h, supplier_name: v })} />
              <EditField label={t("GSTIN")} value={hdr?.supplier_gstin ?? ""} onChange={v => setHdr(h => h && { ...h, supplier_gstin: v.toUpperCase() })} />
              <EditField label={t("Invoice #")} value={hdr?.invoice_number ?? ""} onChange={v => setHdr(h => h && { ...h, invoice_number: v })} />
              <EditField label={t("Date")} type="date" value={hdr?.invoice_date ?? ""} onChange={v => setHdr(h => h && { ...h, invoice_date: v })} />
              <EditField label={t("Subtotal")} type="number" value={hdr?.subtotal ?? ""} onChange={v => setHdr(h => h && { ...h, subtotal: v })} />
              <EditField label={t("Tax")} type="number" value={hdr?.tax_total ?? ""} onChange={v => setHdr(h => h && { ...h, tax_total: v })} />
              <EditField label={t("Grand total")} type="number" value={hdr?.grand_total ?? ""} onChange={v => setHdr(h => h && { ...h, grand_total: v })} />
              <div>
                <p className="text-xs text-muted-foreground"><ExtractionAccuracyLabel /></p>
                <div className="mt-1.5"><ExtractionAccuracy value={inv.confidence} /></div>
              </div>
            </CardContent>
            {unusable && inv.status !== "approved" && (
              <CardContent className="pt-0">
                <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-medium text-destructive">
                      {t("Don't approve this — {{bad}} of {{all}} lines don't add up", { bad: badLines, all: lines?.length ?? 0 })}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {t("Quantity x rate doesn't produce the printed amount, so the columns were probably read in the wrong order. Re-extract, or type the figures in yourself.")}
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
            {extractionNote && (
              /* The model explains itself — "continued to page number 2",
                 which totals it could not see, which figures disagree — and
                 until now that went into raw_extraction and was never read.
                 A blank Grand total with no reason looks like a broken parser
                 rather than a bill whose second page was never photographed. */
              <CardContent className="pt-0">
                <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                  <Info className="h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">{t("What the reader noticed")}</p>
                    <p className="mt-0.5 text-muted-foreground">{extractionNote}</p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">{t("Line items ({{n}})", { n: lines?.length ?? 0 })}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {unlinkedCount > 0 && inv.status !== "approved" && (
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/50 bg-warning/10 px-4 py-3">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <p className="flex-1 min-w-[220px] text-sm">
                    {t("{{n}} line(s) aren't linked to a product yet. Add them to your catalog in one go — names, HSN, GST rate, MRP and unit come straight off this bill.", { n: unlinkedCount })}
                  </p>
                  <Button size="sm" onClick={buildCatalog} loading={bulkBusy}>
                    <Plus className="h-4 w-4 mr-1" /> {t("Add {{n}} to catalog", { n: unlinkedCount })}
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t("Description")}</TableHead>
                    <TableHead className="min-w-[200px]">
                      <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> {t("Product")}</span>
                    </TableHead>
                    <TableHead>{t("HSN")}</TableHead>
                    <TableHead>{t("Qty")}</TableHead>
                    <TableHead>{t("Free")}</TableHead>
                    <TableHead>{t("Rate")}</TableHead>
                    <TableHead>{t("GST%")}</TableHead>
                    <TableHead>{t("Batch")}</TableHead>
                    <TableHead>{t("Expiry")}</TableHead>
                    <TableHead className="text-right">{t("Total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines?.map(l => (
                    <TableRow key={l.id} className={l.needs_review ? "bg-warning/10" : ""}>
                      <TableCell className="text-xs">{l.line_no}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={l.raw_description ?? ""}>{l.raw_description}</TableCell>
                      <TableCell>
                        <Select value={l.matched_product_id ?? "__none__"}
                          onValueChange={v => pickProduct(l.id, v)}
                          disabled={inv.status === "approved"}>
                          <SelectTrigger className={`h-8 text-xs ${!l.matched_product_id ? "border-amber-400 text-amber-700" : ""}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("— Not linked —")}</SelectItem>
                            <SelectItem value="__create__">
                              <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" /> {t("Create new product from this line")}</span>
                            </SelectItem>
                            {products?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs">{l.hsn}</TableCell>
                      <TableCell className="tabular-nums">{l.quantity}</TableCell>
                      <TableCell className="tabular-nums">{l.free_quantity || "—"}</TableCell>
                      <TableCell className="tabular-nums">{l.rate}</TableCell>
                      <TableCell className="tabular-nums">{l.gst_rate}</TableCell>
                      <TableCell className="text-xs">{l.batch}</TableCell>
                      <TableCell className="text-xs">{l.expiry_date}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <LineTotal line={l} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Line total, falling back to a computed figure when the extractor didn't
 * return one. A blank cell tells the operator nothing, and checking the
 * numbers is the entire job of this screen.
 *
 * Derived values are italic with a tooltip so they're never mistaken for a
 * figure actually read off the bill.
 */
function LineTotal({ line }: {
  line: {
    line_total: number | null; quantity: number | null; rate: number | null;
    discount_pct: number | null; gst_rate: number | null; taxable_value: number | null;
  };
}) {
  const { t } = useTranslation();
  const n = (v: number | null | undefined) => (v == null ? null : Number(v));

  const stored = n(line.line_total);
  if (stored) return <>{stored.toLocaleString("en-IN")}</>;

  const qty = n(line.quantity);
  const rate = n(line.rate);
  const taxable = n(line.taxable_value)
    ?? (qty != null && rate != null ? qty * rate * (1 - (n(line.discount_pct) ?? 0) / 100) : null);
  if (taxable == null) return <span className="text-muted-foreground">—</span>;

  const total = taxable * (1 + (n(line.gst_rate) ?? 0) / 100);
  return (
    <span className="italic text-muted-foreground"
      title={t("Not read off the bill — calculated from quantity, rate and GST")}>
      {Math.round(total).toLocaleString("en-IN")}*
    </span>
  );
}

function EditField({ label, value, onChange, type }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} className="mt-1" />
    </div>
  );
}
