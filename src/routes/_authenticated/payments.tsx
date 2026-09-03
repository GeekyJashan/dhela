import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { recordPayment, deletePayment } from "@/lib/payments.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Payments — Dhela" }] }),
  component: PaymentsPage,
});

type PaymentRow = {
  id: string; party_type: "retailer" | "supplier"; payment_date: string;
  amount: number; discount_amount: number; mode: string;
  reference: string | null; notes: string | null;
  retailer: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
};

type Balance = { party_type: string; party_id: string; name: string; balance: number };

const inr = (n: number) => `₹ ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const emptyForm = {
  party_type: "retailer" as "retailer" | "supplier",
  party_id: "",
  payment_date: new Date().toISOString().slice(0, 10),
  amount: "",
  discount_amount: "",
  mode: "cash" as "cash" | "upi" | "bank" | "cheque" | "other",
  reference: "",
  notes: "",
};

function PaymentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const record = useServerFn(recordPayment);
  const remove = useServerFn(deletePayment);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState<"all" | "retailer" | "supplier">("all");

  const { data: payments } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("id, party_type, payment_date, amount, discount_amount, mode, reference, notes, retailer:retailers(id, name), supplier:suppliers(id, name)")
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as PaymentRow[];
    },
  });

  const { data: balances } = useQuery({
    queryKey: ["party_balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("party_balances").select("*");
      if (error) throw error;
      return (data ?? []) as Balance[];
    },
  });

  // Receivables ageing: open sales invoices bucketed by days outstanding.
  const { data: ageing } = useQuery({
    queryKey: ["receivables_ageing"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_invoices")
        .select("retailer_id, invoice_date, grand_total, amount_paid, retailer:retailers(name)")
        .in("status", ["issued", "paid"])
        .neq("payment_status", "paid");
      if (error) throw error;
      const buckets = new Map<string, { name: string; b0: number; b30: number; b60: number }>();
      const today = Date.now();
      for (const inv of data ?? []) {
        const due = Number(inv.grand_total ?? 0) - Number(inv.amount_paid ?? 0);
        if (due <= 0) continue;
        const days = Math.floor((today - new Date(inv.invoice_date).getTime()) / 86_400_000);
        const cur = buckets.get(inv.retailer_id) ?? {
          name: (inv.retailer as { name: string } | null)?.name ?? "Unknown", b0: 0, b30: 0, b60: 0,
        };
        if (days <= 30) cur.b0 += due; else if (days <= 60) cur.b30 += due; else cur.b60 += due;
        buckets.set(inv.retailer_id, cur);
      }
      return [...buckets.entries()]
        .map(([id, v]) => ({ id, ...v, total: v.b0 + v.b30 + v.b60 }))
        .sort((a, b) => b.b60 - a.b60 || b.total - a.total);
    },
  });

  const { data: retailers } = useQuery({
    queryKey: ["retailers_min"],
    queryFn: async () => (await supabase.from("retailers").select("id, name").order("name")).data ?? [],
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers_min"],
    queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [],
  });

  const shownPayments = (payments ?? []).filter(
    p => direction === "all" || p.party_type === direction,
  );

  const partyOptions = form.party_type === "retailer" ? retailers : suppliers;
  const partyBalance = balances?.find(b => b.party_type === form.party_type && b.party_id === form.party_id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["party_balances"] });
    qc.invalidateQueries({ queryKey: ["receivables_ageing"] });
  };

  const submit = async () => {
    if (!form.party_id) { toast.error(form.party_type === "retailer" ? t("Pick a retailer") : t("Pick a supplier")); return; }
    if (!Number(form.amount)) { toast.error(t("Enter an amount")); return; }
    setSaving(true);
    try {
      const res = await record({ data: {
        party_type: form.party_type,
        retailer_id: form.party_type === "retailer" ? form.party_id : null,
        supplier_id: form.party_type === "supplier" ? form.party_id : null,
        payment_date: form.payment_date,
        amount: Number(form.amount),
        discount_amount: Number(form.discount_amount) || 0,
        mode: form.mode,
        reference: form.reference || null,
        notes: form.notes || null,
      }});
      toast.success(res.unallocated > 0
        ? t("Payment recorded — {{amt}} kept as advance", { amt: inr(res.unallocated) })
        : t("Payment recorded"));
      setOpen(false);
      setForm(emptyForm);
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const del = async (p: PaymentRow) => {
    if (!confirm(t("Delete this {{amt}} payment? Bill dues will be restored.", { amt: inr(p.amount) }))) return;
    try {
      await remove({ data: { id: p.id } });
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Payments")}</h1>
          <p className="text-muted-foreground mt-1">{t("Money in from retailers, money out to suppliers.")}</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> {t("Record payment")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("Record payment")}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!saving) submit(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("Direction")}</Label>
                <Select value={form.party_type}
                  onValueChange={v => setForm({ ...form, party_type: v as "retailer" | "supplier", party_id: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retailer">{t("Received from retailer")}</SelectItem>
                    <SelectItem value="supplier">{t("Paid to supplier")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{form.party_type === "retailer" ? t("Retailer *") : t("Supplier *")}</Label>
                <Select value={form.party_id} onValueChange={v => setForm({ ...form, party_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t("Choose party")} /></SelectTrigger>
                  <SelectContent>
                    {partyOptions?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {partyBalance && (
              <p className="text-xs text-muted-foreground">
                {t("Current balance:")} <span className="font-medium">{inr(Number(partyBalance.balance ?? 0))}</span>
                {form.party_type === "retailer" ? ` ${t("receivable")}` : ` ${t("payable")}`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("Amount (₹) *")}</Label>
                <Input type="number" placeholder={t("e.g. 5000")} value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>{t("Settlement discount (₹)")}</Label>
                <Input type="number" placeholder={t("Waived amount, if any")} value={form.discount_amount}
                  onChange={e => setForm({ ...form, discount_amount: e.target.value })} />
              </div>
              <div>
                <Label>{t("Date")}</Label>
                <Input type="date" value={form.payment_date}
                  onChange={e => setForm({ ...form, payment_date: e.target.value })} />
              </div>
              <div>
                <Label>{t("Mode")}</Label>
                <Select value={form.mode} onValueChange={v => setForm({ ...form, mode: v as typeof form.mode })}>
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
              <Input placeholder={t("UTR / cheque no. / UPI ref")} value={form.reference}
                onChange={e => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div>
              <Label>{t("Notes")}</Label>
              <Textarea rows={2} placeholder={t("Optional remarks")} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("The amount is settled against the party's oldest unpaid bills automatically; anything left over stays as an advance.")}
            </p>
            <DialogFooter>
              <Button type="submit" loading={saving}>{saving ? t("Saving…") : t("Save payment")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>{t("Receivables ageing")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("Unpaid bill amounts by how long they've been outstanding.")}</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Retailer")}</TableHead>
              <TableHead className="text-right">{t("0–30 days")}</TableHead>
              <TableHead className="text-right">{t("31–60 days")}</TableHead>
              <TableHead className="text-right">{t("60+ days")}</TableHead>
              <TableHead className="text-right">{t("Total due")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ageing?.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.b0 ? inr(r.b0) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.b30 ? inr(r.b30) : "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.b60 ? "text-destructive font-medium" : ""}`}>{r.b60 ? inr(r.b60) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{inr(r.total)}</TableCell>
                  <TableCell className="text-right">
                    <Link to="/statement" search={{ party: "retailer", id: r.id }}>
                      <Button size="sm" variant="ghost" title={t("View statement")}><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!ageing?.length && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {t("No outstanding bills — everything is collected.")}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>{t("Payment history ({{n}})", { n: shownPayments.length })}</CardTitle>
          <div className="flex rounded-md border p-0.5">
            {([
              ["all", t("All")],
              ["retailer", t("Received")],
              ["supplier", t("Paid out")],
            ] as const).map(([key, label]) => (
              <button key={key} onClick={() => setDirection(key)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  direction === key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted",
                )}>
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Party")}</TableHead>
              <TableHead>{t("Direction")}</TableHead>
              <TableHead>{t("Mode")}</TableHead>
              <TableHead>{t("Reference")}</TableHead>
              <TableHead className="text-right">{t("Amount")}</TableHead>
              <TableHead className="text-right">{t("Discount")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shownPayments.map(p => (
                <TableRow key={p.id}>
                  <TableCell>{p.payment_date}</TableCell>
                  <TableCell className="font-medium">{p.retailer?.name ?? p.supplier?.name ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${p.party_type === "retailer" ? "text-green-700" : "text-red-700"}`}>
                      {p.party_type === "retailer" ? t("Received") : t("Paid out")}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{t(p.mode)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(p.discount_amount) ? inr(p.discount_amount) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => del(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!shownPayments.length && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  {payments?.length
                    ? t("No payments match this filter.")
                    : t("No payments recorded yet.")}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
