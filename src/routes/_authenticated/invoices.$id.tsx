import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { approveInvoice, extractInvoice } from "@/lib/invoices.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "./dashboard";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, AlertTriangle, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Review invoice — Ledgerly" }] }),
  component: InvoiceReview,
});

function InvoiceReview() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const approve = useServerFn(approveInvoice);
  const extract = useServerFn(extractInvoice);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!inv?.storage_path) return;
    supabase.storage.from("invoices").createSignedUrl(inv.storage_path, 600).then(({ data }) => {
      if (data?.signedUrl) setPreviewUrl(data.signedUrl);
    });
  }, [inv?.storage_path]);

  if (!inv) return <div className="p-8">Loading…</div>;

  const doApprove = async () => {
    await approve({ data: { invoiceId: id } });
    toast.success("Approved and posted to inventory");
    qc.invalidateQueries();
    navigate({ to: "/invoices" });
  };

  const reprocess = async () => {
    try {
      await extract({ data: { invoiceId: id } });
      toast.success("Re-extracted");
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/invoices" })}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="font-display text-2xl">{inv.supplier_name ?? "Unknown supplier"}</h1>
            <p className="text-xs text-muted-foreground">Invoice {inv.invoice_number ?? "—"} · {inv.invoice_date ?? "—"}</p>
          </div>
          <StatusBadge status={inv.status} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reprocess}><RefreshCw className="h-4 w-4 mr-2" /> Re-extract</Button>
          <Button onClick={doApprove} disabled={inv.status === "approved"}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Approve & post
          </Button>
        </div>
      </div>

      {inv.status === "failed" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div><p className="font-medium">Extraction failed</p><p className="text-sm text-muted-foreground">{inv.error_message}</p></div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        <Card className="min-h-[500px]">
          <CardHeader><CardTitle className="text-sm">Original invoice</CardTitle></CardHeader>
          <CardContent>
            {previewUrl ? (
              inv.mime_type?.startsWith("image/") ? (
                <img src={previewUrl} alt="Invoice" className="w-full rounded border" />
              ) : (
                <iframe src={previewUrl} className="w-full h-[700px] rounded border" title="Invoice" />
              )
            ) : <div className="text-sm text-muted-foreground">Loading preview…</div>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Header</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Supplier" value={inv.supplier_name} />
              <Field label="GSTIN" value={inv.supplier_gstin} />
              <Field label="Invoice #" value={inv.invoice_number} />
              <Field label="Date" value={inv.invoice_date} />
              <Field label="Subtotal" value={inv.subtotal ? `₹ ${Number(inv.subtotal).toLocaleString("en-IN")}` : null} />
              <Field label="Tax" value={inv.tax_total ? `₹ ${Number(inv.tax_total).toLocaleString("en-IN")}` : null} />
              <Field label="Grand total" value={inv.grand_total ? `₹ ${Number(inv.grand_total).toLocaleString("en-IN")}` : null} />
              <Field label="Confidence" value={inv.confidence ? `${Number(inv.confidence).toFixed(0)}%` : null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Line items ({lines?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Free</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>GST%</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines?.map(l => (
                    <TableRow key={l.id} className={l.needs_review ? "bg-warning/10" : ""}>
                      <TableCell className="text-xs">{l.line_no}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={l.raw_description ?? ""}>{l.raw_description}</TableCell>
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

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input readOnly value={value ?? ""} className="mt-1 bg-muted/30" />
    </div>
  );
}
