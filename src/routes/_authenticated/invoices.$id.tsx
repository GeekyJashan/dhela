import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { approveInvoice, extractInvoice, setLineProduct, createProductFromLine, createProductsForUnmatchedLines, updatePurchaseInvoice, deletePurchaseInvoice, updateInvoiceLine } from "@/lib/invoices.functions";
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
  head: () => ({ meta: [{ title: "Review bill - Dhela" }] }),
  component: InvoiceReview,
});

function InvoiceReview() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const approve = useServerFn(approveInvoice);
  const saveLine = useServerFn(updateInvoiceLine);
  const extract = useServerFn(extractInvoice);
  const linkProduct = useServerFn(setLineProduct);
  const createProduct = useServerFn(createProductFromLine);
  const createAllProducts = useServerFn(createProductsForUnmatchedLines);
  const [bulkBusy, setBulkBusy] = useState(false);
  const updateHeader = useServerFn(updatePurchaseInvoice);
  const removeInvoice = useServerFn(deletePurchaseInvoice);
  /**
   * Every photo the bill was read from, not just the first.
   *
   * A multi-page bill lives in invoice_pages; page one is also on the invoice
   * row itself for everything that predates that table. An operator checking a
   * figure needs the page it was printed on, and until now the screen only
   * ever showed the first one.
   */
  const [pages, setPages] = useState<
    { url: string; label: string | null; duplicate: boolean; mime: string | null }[]
  >([]);
  /** Index of the page opened full-screen, or null when minimised. */
  const [zoomed, setZoomed] = useState<number | null>(null);
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

  // Read off the invoice once so the effect depends on the two values it uses
  // rather than on the whole row, which changes identity on every refetch.
  const invPath = inv?.storage_path;
  const invMime = inv?.mime_type;
  useEffect(() => {
    if (!invPath) return;
    let cancelled = false;
    (async () => {
      const { data: rows } = await supabase
        .from("invoice_pages")
        .select("page_no, storage_path, mime_type, page_label, is_duplicate")
        .eq("invoice_id", id)
        .order("page_no");

      // Fall back to the invoice's own file for every bill uploaded before
      // multi-page existed, so nothing loses its preview.
      const wanted = rows?.length
        ? rows.map(r => ({
            path: r.storage_path, label: r.page_label,
            duplicate: r.is_duplicate, mime: r.mime_type,
          }))
        : [{ path: invPath, label: null, duplicate: false, mime: invMime ?? null }];

      const signed = await Promise.all(wanted.map(async w => {
        const { data } = await supabase.storage.from("invoices").createSignedUrl(w.path, 600);
        return data?.signedUrl ? { url: data.signedUrl, label: w.label, duplicate: w.duplicate, mime: w.mime } : null;
      }));
      if (!cancelled) setPages(signed.filter((x): x is NonNullable<typeof x> => !!x));
    })();
    return () => { cancelled = true; };
  }, [id, invPath, invMime]);

  // Esc closes the full-screen page. Registered once rather than per image.
  useEffect(() => {
    if (zoomed === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(null);
      if (e.key === "ArrowRight") setZoomed(z => (z === null ? z : Math.min(pages.length - 1, z + 1)));
      if (e.key === "ArrowLeft") setZoomed(z => (z === null ? z : Math.max(0, z - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed, pages.length]);

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

  /**
   * Everything worth knowing about this read, in one list.
   *
   * Three sources: the totals that do not reconcile, the individual rows whose
   * own quantity x rate less discount does not match their amount, and what
   * the reader said in its own words. Problems are marked so they can be set
   * in bold — an operator scanning this needs the wrong number to jump out,
   * not to be one sentence among several.
   *
   * The per-row check is recomputed here rather than read off needs_review,
   * because that flag is also set by low confidence. Counting it once told an
   * operator that thirteen perfectly correct lines did not add up.
   */
  /**
   * needs_review is set for any reason, low confidence included, so counting it
   * told an operator that thirteen correct lines "don't add up". The banner has
   * to test the thing it claims: quantity x rate, less the discount the bill
   * actually charged, against the printed amount.
   */
  const failsArithmetic = (l: { quantity: number | null; rate: number | null;
                                discount_pct: number | null; taxable_value: number | null }) => {
    if (l.quantity == null || l.rate == null || l.taxable_value == null) return false;
    const expected = l.quantity * l.rate * (1 - (l.discount_pct ?? 0) / 100);
    return Math.abs(expected - l.taxable_value) > Math.max(1, Math.abs(expected) * 0.01);
  };
  const badLines = (lines ?? []).filter(failsArithmetic).length;
  const unusable = !!lines?.length && badLines * 2 >= lines.length;

  // Stored on every invoice already; nothing reads it today.
  const extractionNote = (() => {
    const raw = inv?.raw_extraction as { notes?: string | null } | null | undefined;
    const note = raw?.notes?.trim();
    return note && note.length > 1 ? note : null;
  })();

  const readerNotes = useMemo(() => {
    const out: { text: string; problem: boolean }[] = [];
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const fmt = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

    for (const issue of arithmeticIssues) out.push({ text: issue, problem: true });

    for (const l of lines ?? []) {
      const qty = num(l.quantity), rate = num(l.rate), amount = num(l.taxable_value);
      if (qty == null || rate == null || amount == null) continue;
      const expected = qty * rate * (1 - (num(l.discount_pct) ?? 0) / 100);
      if (Math.abs(expected - amount) > Math.max(1, Math.abs(amount) * 0.01)) {
        out.push({
          problem: true,
          text: t('Line {{n}} "{{desc}}": {{qty}} x {{rate}}{{disc}} comes to {{expected}}, but the amount reads {{amount}}.', {
            n: l.line_no ?? "?",
            desc: (l.raw_description ?? "").slice(0, 40),
            qty, rate: fmt(rate),
            disc: num(l.discount_pct) ? ` less ${num(l.discount_pct)}%` : "",
            expected: fmt(Math.round(expected * 100) / 100),
            amount: fmt(amount),
          }),
        });
      }
    }

    // The reader writes for the operator and joins its points with semicolons.
    // The reader joins its points with semicolons, so the fragments after the
    // first arrive lower-cased and unpunctuated. As bullets they each need to
    // read as a sentence.
    for (const part of (extractionNote ?? "").split(/;|\n/).map(x => x.trim()).filter(Boolean)) {
      const sentence = part.charAt(0).toUpperCase() + part.slice(1);
      out.push({ text: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`, problem: false });
    }
    return out;
  }, [arithmeticIssues, lines, extractionNote, t]);

  const problemCount = readerNotes.filter(n => n.problem).length;

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
      toast.success(t("Bill details saved"));
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const doDelete = async () => {
    if (!confirm(inv.status === "approved"
      ? t("Delete this approved purchase? The stock it added will be reversed.")
      : t("Delete this purchase bill?"))) return;
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

  /**
   * The reader said this bill carries on past the page(s) it was given.
   *
   * This is the quietest way to lose money in the product: a photo of page 1 of
   * 3 extracts cleanly, reconciles against its own carried-forward figure, and
   * looks like a finished bill. Approving it books a third of the goods and a
   * third of the cost, and nothing later ever contradicts it.
   */
  const continuation = (() => {
    const raw = inv?.raw_extraction as {
      continues_on_another_page?: boolean | null;
      page_label?: string | null;
      total_pages_on_bill?: number | null;
    } | null | undefined;
    if (!raw?.continues_on_another_page) return null;
    return { label: raw.page_label ?? null, total: raw.total_pages_on_bill ?? null };
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

  /** Edit one field on one line. The server owns what that implies. */
  const editLine = async (lineId: string, field: string, value: string) => {
    await saveLine({ data: { lineId, field: field as never, value } });
    // Refetch rather than patch locally: changing a quantity also moves the
    // amount, and the server is what decides that.
    await qc.invalidateQueries({ queryKey: ["invoice-lines", id] });
    await qc.invalidateQueries({ queryKey: ["invoice", id] });
  };

  // Approving is what posts stock and rewrites weighted-average cost, so an
  // approved bill is closed to editing. The server refuses it too.
  const LOCKED = inv?.status === "approved";

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
              {t("Bill")} {inv.invoice_number ?? "—"} · {inv.invoice_date ?? "—"}
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

      {/* Full screen page. Deliberately not a Dialog: the point is to see the
          paper as large as the screen allows, so it is a plain overlay with no
          chrome competing for the space. Esc and the arrow keys are bound
          above; clicking the backdrop also closes it. */}
      {zoomed !== null && pages[zoomed] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 print:hidden"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("Page {{n}} of the bill", { n: zoomed + 1 })}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between text-white/80">
            <span className="text-sm">
              {pages[zoomed].label || t("Page {{n}}", { n: zoomed + 1 })}
              {pages.length > 1 && (
                <span className="ml-2 text-white/50">{zoomed + 1} / {pages.length}</span>
              )}
            </span>
            <span className="flex items-center gap-4 text-xs text-white/50">
              {pages.length > 1 && <span>{t("← → to move between pages")}</span>}
              <span>{t("Esc to close")}</span>
            </span>
          </div>
          <img
            src={pages[zoomed].url}
            alt={t("Page {{n}} of the bill", { n: zoomed + 1 })}
            className="min-h-0 flex-1 cursor-zoom-out object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {continuation && inv.status !== "approved" && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-medium">
                {continuation.label
                  ? t("This is page {{label}} — the bill carries on", { label: continuation.label })
                  : t("This bill carries on past the page you photographed")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {continuation.total
                  ? t("The paper says it has {{n}} pages. Rows on the pages you did not photograph are missing from this bill, so the total below is only part of what you were charged.", { n: continuation.total })
                  : t("Rows on the pages you did not photograph are missing from this bill, so the total below is only part of what you were charged.")}
              </p>
              <p className="mt-2 text-sm">
                {t("Photograph every page, then upload them together with")}{" "}
                <Link to="/upload" className="font-medium text-primary underline underline-offset-2">
                  {t("\"One bill, several pages\"")}
                </Link>{" "}
                {t("— and delete this partial one.")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {readerNotes.length > 0 && inv.status !== "approved" && (
        <Card className={problemCount > 0 ? "border-amber-400/60 bg-warning/10" : ""}>
          <CardContent className="flex gap-3 pt-6">
            {problemCount > 0
              ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
              : <Info className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <p className="font-medium">{t("What the reader noticed")}</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {readerNotes.map((n, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className={n.problem ? "text-amber-600" : "text-muted-foreground"}>·</span>
                    {/* Bold is reserved for a figure that does not add up, so
                        the wrong number is what the eye lands on. */}
                    <span className={n.problem ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {n.text}
                    </span>
                  </li>
                ))}
              </ul>
              {problemCount > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("Common on photos of bills. Check against the original and correct the fields before approving — approving posts these figures into stock and cost.")}
                </p>
              )}
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
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {t("Original bill")}
              {pages.length > 1 && (
                <span className="ml-2 font-normal text-muted-foreground">
                  {t("{{n}} pages", { n: pages.length })}
                </span>
              )}
            </CardTitle>
            {pages.length > 0 && (
              <span className="text-xs text-muted-foreground">{t("Click a page to enlarge")}</span>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {pages.length === 0 && (
              <div className="text-sm text-muted-foreground">{t("Loading preview…")}</div>
            )}
            {pages.map((pg, i) =>
              pg.mime?.startsWith("image/") === false ? (
                <iframe key={i} src={pg.url} className="h-[700px] w-full rounded border" title={`Page ${i + 1}`} />
              ) : (
                <figure key={i} className="group relative">
                  <button
                    type="button"
                    onClick={() => setZoomed(i)}
                    className="block w-full cursor-zoom-in overflow-hidden rounded border transition hover:border-primary/50"
                    aria-label={t("Enlarge page {{n}}", { n: i + 1 })}
                  >
                    <img src={pg.url} alt={t("Page {{n}} of the bill", { n: i + 1 })}
                      className={`w-full ${pg.duplicate ? "opacity-60" : ""}`} />
                  </button>
                  {(pages.length > 1 || pg.duplicate) && (
                    <figcaption className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{pg.label || t("Page {{n}}", { n: i + 1 })}</span>
                      {pg.duplicate && (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {t("same page again — not read twice")}
                        </span>
                      )}
                    </figcaption>
                  )}
                </figure>
              ),
            )}
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
              <EditField label={t("Bill #")} value={hdr?.invoice_number ?? ""} onChange={v => setHdr(h => h && { ...h, invoice_number: v })} />
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

          </Card>

        </div>
      </div>

      <div className="mt-4">
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
                    <TableHead>{t("Disc%")}</TableHead>
                    {/* What the unit actually cost, after the trade discount.
                        Rate is the list price — on this supplier's bills it is
                        nearly three times what was paid. Stock cost and every
                        profit figure downstream are built from this number, so
                        it is the one worth showing. */}
                    <TableHead className="text-right">{t("Cost/unit")}</TableHead>
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
                      <TableCell className="max-w-[240px]">
                        <LineCell value={l.raw_description} width="w-[220px]" disabled={LOCKED}
                          placeholder="Description on the bill"
                          onSave={v => editLine(l.id, "raw_description", v)} />
                      </TableCell>
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
                      <TableCell><LineCell value={l.hsn} width="w-24" disabled={LOCKED}
                        onSave={v => editLine(l.id, "hsn", v)} /></TableCell>
                      <TableCell><LineCell value={l.quantity} numeric width="w-16" disabled={LOCKED}
                        onSave={v => editLine(l.id, "quantity", v)} /></TableCell>
                      <TableCell><LineCell value={l.free_quantity} numeric width="w-14" disabled={LOCKED}
                        onSave={v => editLine(l.id, "free_quantity", v)} /></TableCell>
                      <TableCell><LineCell value={l.rate} numeric width="w-20" disabled={LOCKED}
                        onSave={v => editLine(l.id, "rate", v)} /></TableCell>
                      <TableCell><LineCell value={l.discount_pct} numeric width="w-16" disabled={LOCKED}
                        onSave={v => editLine(l.id, "discount_pct", v)} /></TableCell>
                      <TableCell className="tabular-nums text-right font-medium">
                        {l.quantity && l.taxable_value
                          ? (l.taxable_value / l.quantity).toLocaleString("en-IN",
                              { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "—"}
                      </TableCell>
                      <TableCell><LineCell value={l.gst_rate} numeric width="w-16" disabled={LOCKED}
                        onSave={v => editLine(l.id, "gst_rate", v)} /></TableCell>
                      <TableCell><LineCell value={l.batch} width="w-24" disabled={LOCKED}
                        onSave={v => editLine(l.id, "batch", v)} /></TableCell>
                      <TableCell><LineCell value={l.expiry_date} width="w-28" disabled={LOCKED}
                        placeholder="YYYY-MM-DD"
                        onSave={v => editLine(l.id, "expiry_date", v)} /></TableCell>
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

/**
 * One line-item field, edited in place.
 *
 * Saves on blur rather than on every keystroke: an operator correcting a rate
 * types several characters, and writing each one would be a request per digit
 * and a half-typed number briefly stored as the truth. Escape abandons the
 * edit, which matters when the thing being corrected is money.
 */
function LineCell({ value, onSave, numeric, disabled, width = "w-20", placeholder }: {
  value: string | number | null;
  onSave: (v: string) => Promise<void>;
  numeric?: boolean;
  disabled?: boolean;
  width?: string;
  placeholder?: string;
}) {
  const initial = value == null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  // Re-sync when the row is refetched, unless the user is mid-edit.
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(initial); }, [initial, focused]);

  const commit = async () => {
    setFocused(false);
    if (draft === initial) return;
    setSaving(true);
    try { await onSave(draft); }
    catch (e) { setDraft(initial); toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  if (disabled) {
    return <span className={numeric ? "tabular-nums" : ""}>{initial || "—"}</span>;
  }
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      inputMode={numeric ? "decimal" : undefined}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(initial); setFocused(false); (e.target as HTMLInputElement).blur(); }
      }}
      className={`h-8 ${width} px-1.5 text-xs ${numeric ? "tabular-nums text-right" : ""} ${saving ? "opacity-60" : ""}`}
    />
  );
}

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
