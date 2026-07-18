import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { recordPayment } from "@/lib/payments.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({ meta: [{ title: "Sales invoices — Ledgerly" }] }),
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
  const qc = useQueryClient();
  const record = useServerFn(recordPayment);

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
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const statusColor = (s: string) =>
    s === "issued" ? "bg-primary/15 text-primary"
    : s === "paid" ? "bg-success/20 text-success"
    : s === "cancelled" ? "bg-destructive/20 text-destructive"
    : "bg-muted text-muted-foreground";

  const due = pay ? Number(pay.invoice.grand_total ?? 0) - Number(pay.invoice.amount_paid ?? 0) : 0;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Sales invoices")}</h1>
          <p className="text-muted-foreground mt-1">{t("Bill retailers, track GST and profit in real time.")}</p>
        </div>
        <Link to="/sales/new"><Button size="lg"><Plus className="h-4 w-4 mr-2" /> {t("New sales invoice")}</Button></Link>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Invoice #")}</TableHead>
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
              const canPay = i.status !== "cancelled" && i.payment_status !== "paid" && !!i.retailer;
              return (
                <TableRow key={i.id} className="cursor-pointer">
                  <TableCell>
                    <Link to="/sales/$id" params={{ id: i.id }} className="font-medium hover:underline">
                      {i.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>{i.invoice_date}</TableCell>
                  <TableCell>{i.retailer?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {Number(i.grand_total ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">₹ {Number(i.total_profit ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell><Badge className={statusColor(i.status)} variant="secondary">{t(i.status)}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{t(i.payment_status)}</Badge></TableCell>
                  <TableCell className="text-right">
                    {canPay && (
                      <Button size="sm" variant="outline" title={t("Record payment")} onClick={() => openPay(i)}>
                        <IndianRupee className="h-3.5 w-3.5 mr-1" /> {t("Record")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!data?.length && (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                {t("No sales invoices yet. Add retailers and products first, then create your first invoice.")}
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
                {t("The amount is settled against the party's oldest unpaid invoices automatically; anything left over stays as an advance.")}
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
