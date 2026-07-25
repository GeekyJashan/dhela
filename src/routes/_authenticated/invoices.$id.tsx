import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { approveInvoice, extractInvoice, setLineProduct, createProductFromLine, updatePurchaseInvoice, deletePurchaseInvoice } from "@/lib/invoices.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "./dashboard";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, AlertTriangle, ArrowLeft, Link2, Plus, Trash2, Save } from "lucide-react";
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

  if (!inv) return <div className="p-8">{t("Loading…")}</div>;

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

  const doApprove = async () => {
    const unlinked = (lines ?? []).filter(l => !l.matched_product_id).length;
    if (unlinked > 0 && !confirm(
      t("{{n}} line(s) are not linked to a product — stock and purchase cost won't update for them. Approve anyway?", { n: unlinked }),
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

  const reprocess = async () => {
    try {
      await extract({ data: { invoiceId: id } });
      toast.success(t("Re-extracted"));
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/invoices" })}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {t("Back")}
          </Button>
          <div>
            <h1 className="font-display text-2xl">{inv.supplier_name ?? t("Unknown supplier")}</h1>
            <p className="text-xs text-muted-foreground">{t("Invoice")} {inv.invoice_number ?? "—"} · {inv.invoice_date ?? "—"}</p>
          </div>
          <StatusBadge status={inv.status} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reprocess}><RefreshCw className="h-4 w-4 mr-2" /> {t("Re-extract")}</Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={doDelete}>
            <Trash2 className="h-4 w-4 mr-2" /> {t("Delete")}
          </Button>
          <Button onClick={doApprove} disabled={inv.status === "approved"}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> {t("Approve & post")}
          </Button>
        </div>
      </div>

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
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">{t("Line items ({{n}})", { n: lines?.length ?? 0 })}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
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
                      <TableCell className="text-right tabular-nums">{l.line_total}</TableCell>
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
