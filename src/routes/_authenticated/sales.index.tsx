import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState as useReactState } from "react";
import { importSalesInvoice } from "@/lib/sales-import.functions";
import { Upload, Loader2 } from "lucide-react";
import { recordPayment } from "@/lib/payments.functions";
import { issueSalesInvoice } from "@/lib/sales.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, IndianRupee, Send, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeError } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({ meta: [{ title: "Sales bills - Dhela" }] }),
  component: SalesList,
});

type SalesRow = {
  id: string; invoice_number: string; invoice_date: string;
  grand_total: number | null; total_profit: number | null; amount_paid: number | null;
  status: string; payment_status: string;
  retailer: { id: string; name: string } | null;
};

const inr = (n: number) => `₹ ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function SalesList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const record = useServerFn(recordPayment);
  const issue = useServerFn(issueSalesInvoice);

  const doIssue = async (id: string) => {
    if (!confirm(t("Issue this bill? Stock will be deducted and it becomes a receivable."))) return;
    try {
      await issue({ data: { id } });
      toast.success(t("Bill issued"));
      qc.invalidateQueries({ queryKey: ["sales_invoices"] });
    } catch (e) { toast.error(describeError(e)); }
  };

  const { data } = useQuery({
    queryKey: ["sales_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_invoices")
        .select("id, invoice_number, invoice_date, grand_total, total_profit, amount_paid, status, payment_status, retailer:retailers(id, name)")
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as SalesRow[];
    },
  });

  const [pay, setPay] = useState<{
    invoice: SalesRow; amount: string; discount: string; date: string;
    mode: "cash" | "upi" | "bank" | "cheque" | "other"; reference: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const openPay = (i: SalesRow) => {
    const due = Number(i.grand_total ?? 0) - Number(i.amount_paid ?? 0);
    setPay({
      invoice: i,
      amount: due > 0 ? String(due) : "",
      discount: "",
      date: new Date().toISOString().slice(0, 10),
      mode: "cash",
      reference: "",
    });
  };

  const submitPay = async () => {
    if (!pay || !pay.invoice.retailer) return;
    if (!Number(pay.amount)) { toast.error(t("Enter an amount")); return; }
    setSaving(true);
    try {
      await record({ data: {
        party_type: "retailer",
        retailer_id: pay.invoice.retailer.id,
        supplier_id: null,
        payment_date: pay.date,
        amount: Number(pay.amount),
        discount_amount: Number(pay.discount) || 0,
        mode: pay.mode,
        reference: pay.reference || null,
        notes: `Against ${pay.invoice.invoice_number}`,
      }});
      toast.success(t("Payment recorded"));
      setPay(null);
      qc.invalidateQueries({ queryKey: ["sales_invoices"] });
      qc.invalidateQueries({ queryKey: ["party_balances"] });
      qc.invalidateQueries({ queryKey: ["receivables_ageing"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
    } catch (e) { toast.error(describeError(e)); }
    finally { setSaving(false); }
  };

  const statusColor = (s: string) =>
    s === "issued" ? "bg-primary/15 text-primary"
    : s === "paid" ? "bg-success/20 text-success"
    : s === "cancelled" ? "bg-destructive/20 text-destructive"
    : "bg-muted text-muted-foreground";

  const due = pay ? Number(pay.invoice.grand_total ?? 0) - Number(pay.invoice.amount_paid ?? 0) : 0;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Sales bills")}</h1>
          <p className="text-muted-foreground mt-1">{t("Bill retailers, track GST and profit in real time.")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Reading an invoice the distributor already issued is how six
              months of history gets into Dhela without anyone retyping it.
              Secondary to writing a new one — this is a migration tool, not
              the daily path. */}
          <ImportSalesInvoice />
          <Link to="/sales/new"><Button size="lg"><Plus className="h-4 w-4 mr-2" /> {t("New sales bill")}</Button></Link>
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Bill #")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Retailer")}</TableHead>
              <TableHead className="text-right">{t("Total")}</TableHead>
              <TableHead className="text-right">{t("Profit")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Payment")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((i) => {
              const canPay = i.status === "issued" && i.payment_status !== "paid" && !!i.retailer;
              const isDraft = i.status === "draft";
              return (
                <TableRow key={i.id} className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate({ to: "/sales/$id", params: { id: i.id } })}>
                  <TableCell className="font-medium">{i.invoice_number}</TableCell>
                  <TableCell>{i.invoice_date}</TableCell>
                  <TableCell>{i.retailer?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {Number(i.grand_total ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">₹ {Number(i.total_profit ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell><Badge className={statusColor(i.status)} variant="secondary">{t(i.status)}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{t(i.payment_status)}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {i.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" title={t("Edit")} className="mr-1"
                        onClick={(e) => { e.stopPropagation(); navigate({ to: "/sales/new", search: { edit: i.id } }); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isDraft ? (
                      <Button size="sm" variant="outline" title={t("Issue bill")} onClick={(e) => { e.stopPropagation(); doIssue(i.id); }}>
                        <Send className="h-3.5 w-3.5 mr-1" /> {t("Issue")}
                      </Button>
                    ) : canPay ? (
                      <Button size="sm" variant="outline" title={t("Record payment")} onClick={(e) => { e.stopPropagation(); openPay(i); }}>
                        <IndianRupee className="h-3.5 w-3.5 mr-1" /> {t("Record")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {!data?.length && (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                {t("No sales bills yet. Add retailers and products first, then create your first bill.")}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!pay} onOpenChange={o => !o && setPay(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Record payment")} — {pay?.invoice.invoice_number}</DialogTitle>
          </DialogHeader>
          {pay && (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!saving) submitPay(); }}>
              <p className="text-sm text-muted-foreground">
                {pay.invoice.retailer?.name} · {t("Due")}: <span className="font-medium text-foreground">{inr(due)}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("Amount (₹) *")}</Label>
                  <Input type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} />
                </div>
                <div>
                  <Label>{t("Settlement discount (₹)")}</Label>
                  <Input type="number" placeholder={t("Waived amount, if any")} value={pay.discount} onChange={e => setPay({ ...pay, discount: e.target.value })} />
                </div>
                <div>
                  <Label>{t("Date")}</Label>
                  <Input type="date" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} />
                </div>
                <div>
                  <Label>{t("Mode")}</Label>
                  <Select value={pay.mode} onValueChange={v => setPay({ ...pay, mode: v as typeof pay.mode })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t("Cash")}</SelectItem>
                      <SelectItem value="upi">{t("UPI")}</SelectItem>
                      <SelectItem value="bank">{t("Bank transfer")}</SelectItem>
                      <SelectItem value="cheque">{t("Cheque")}</SelectItem>
                      <SelectItem value="other">{t("Other")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>{t("Reference")}</Label>
                <Input placeholder={t("UTR / cheque no. / UPI ref")} value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("The amount is settled against the party's oldest unpaid bills automatically; anything left over stays as an advance.")}
              </p>
              <DialogFooter>
                <Button type="submit" disabled={saving}>{t("Save payment")}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Upload an already-issued sales invoice and get a draft back.
 *
 * Always a draft. Issuing deducts stock and locks cost, and a machine reading
 * of a photograph is not grounds for moving someone's inventory — the operator
 * checks it and issues it themselves.
 */
function ImportSalesInvoice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runImport = useServerFn(importSalesInvoice);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useReactState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { data: mem } = await supabase.from("memberships")
        .select("org_id").eq("user_id", userRes.user!.id).limit(1).maybeSingle();
      if (!mem) throw new Error(t("No workspace"));

      const path = `${mem.org_id}/sales/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("invoices")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);

      const res = await runImport({ data: { storagePath: path, mimeType: file.type || "application/octet-stream" } });
      toast.success(
        res.retailerCreated
          ? t("Read {{n}} line(s) and added {{name}} as a new retailer.", { n: res.lineCount, name: res.retailer })
          : t("Read {{n}} line(s) for {{name}}.", { n: res.lineCount, name: res.retailer }),
      );
      if (res.unmatched) {
        // Said out loud because an unlinked line does not move stock when the
        // invoice is issued, and that is silent otherwise.
        toast.warning(t("{{n}} line(s) aren't linked to a product yet — link them before issuing.", { n: res.unmatched }));
      }
      navigate({ to: "/sales/$id", params: { id: res.invoiceId } });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={e => onPick(e.target.files?.[0])} />
      <Button size="lg" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("Reading…")}</>
          : <><Upload className="h-4 w-4 mr-2" /> {t("Upload bill")}</>}
      </Button>
    </>
  );
}
