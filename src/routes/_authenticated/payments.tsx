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
import { Plus, Trash2, FileText, ArrowDownLeft, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Payments — Ledgerly" }] }),
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
  const qc = useQueryClient();
  const record = useServerFn(recordPayment);
  const remove = useServerFn(deletePayment);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

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

  const receivable = (balances ?? []).filter(b => b.party_type === "retailer")
    .reduce((s, b) => s + Number(b.balance ?? 0), 0);
  const payable = (balances ?? []).filter(b => b.party_type === "supplier")
    .reduce((s, b) => s + Number(b.balance ?? 0), 0);

  const partyOptions = form.party_type === "retailer" ? retailers : suppliers;
  const partyBalance = balances?.find(b => b.party_type === form.party_type && b.party_id === form.party_id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["party_balances"] });
    qc.invalidateQueries({ queryKey: ["receivables_ageing"] });
  };

  const submit = async () => {
    if (!form.party_id) { toast.error(`Pick a ${form.party_type}`); return; }
    if (!Number(form.amount)) { toast.error("Enter an amount"); return; }
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
        ? `Payment recorded — ${inr(res.unallocated)} kept as advance`
        : "Payment recorded");
      setOpen(false);
      setForm(emptyForm);
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const del = async (p: PaymentRow) => {
    if (!confirm(`Delete this ${inr(p.amount)} payment? Invoice dues will be restored.`)) return;
    try {
      await remove({ data: { id: p.id } });
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Payments</h1>
          <p className="text-muted-foreground mt-1">Money in from retailers, money out to suppliers.</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Record payment
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
              <ArrowDownLeft className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">To receive from retailers</div>
              <div className="text-2xl font-semibold tabular-nums">{inr(receivable)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">To pay suppliers</div>
              <div className="text-2xl font-semibold tabular-nums">{inr(payable)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!saving) submit(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Direction</Label>
                <Select value={form.party_type}
                  onValueChange={v => setForm({ ...form, party_type: v as "retailer" | "supplier", party_id: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retailer">Received from retailer</SelectItem>
                    <SelectItem value="supplier">Paid to supplier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{form.party_type === "retailer" ? "Retailer *" : "Supplier *"}</Label>
                <Select value={form.party_id} onValueChange={v => setForm({ ...form, party_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose party" /></SelectTrigger>
                  <SelectContent>
                    {partyOptions?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {partyBalance && (
              <p className="text-xs text-muted-foreground">
                Current balance: <span className="font-medium">{inr(Number(partyBalance.balance ?? 0))}</span>
                {form.party_type === "retailer" ? " receivable" : " payable"}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount (₹) *</Label>
                <Input type="number" placeholder="e.g. 5000" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Settlement discount (₹)</Label>
                <Input type="number" placeholder="Waived amount, if any" value={form.discount_amount}
                  onChange={e => setForm({ ...form, discount_amount: e.target.value })} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={form.payment_date}
                  onChange={e => setForm({ ...form, payment_date: e.target.value })} />
              </div>
              <div>
                <Label>Mode</Label>
                <Select value={form.mode} onValueChange={v => setForm({ ...form, mode: v as typeof form.mode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Reference</Label>
              <Input placeholder="UTR / cheque no. / UPI ref" value={form.reference}
                onChange={e => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional remarks" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              The amount is settled against the party's oldest unpaid invoices automatically;
              anything left over stays as an advance.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={saving}>Save payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Receivables ageing</CardTitle>
          <p className="text-sm text-muted-foreground">Unpaid invoice amounts by how long they've been outstanding.</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Retailer</TableHead>
              <TableHead className="text-right">0–30 days</TableHead>
              <TableHead className="text-right">31–60 days</TableHead>
              <TableHead className="text-right">60+ days</TableHead>
              <TableHead className="text-right">Total due</TableHead>
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
                      <Button size="sm" variant="ghost" title="View statement"><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!ageing?.length && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No outstanding invoices — everything is collected.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment history ({payments?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {payments?.map(p => (
                <TableRow key={p.id}>
                  <TableCell>{p.payment_date}</TableCell>
                  <TableCell className="font-medium">{p.retailer?.name ?? p.supplier?.name ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${p.party_type === "retailer" ? "text-green-700" : "text-red-700"}`}>
                      {p.party_type === "retailer" ? "Received" : "Paid out"}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{p.mode}</TableCell>
                  <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(p.discount_amount) ? inr(p.discount_amount) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => del(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!payments?.length && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No payments recorded yet.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
