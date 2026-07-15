import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createCreditNote, deleteCreditNote } from "@/lib/credit-notes.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Undo2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/returns")({
  head: () => ({ meta: [{ title: "Returns — Ledgerly" }] }),
  validateSearch: (s: Record<string, unknown>): { invoiceId?: string } =>
    typeof s.invoiceId === "string" ? { invoiceId: s.invoiceId } : {},
  component: ReturnsPage,
});

type Reason = "damaged" | "expired" | "wrong_item" | "rate_adjustment" | "other";

const REASONS: { value: Reason; label: string; restock: boolean }[] = [
  { value: "damaged", label: "Damaged goods", restock: false },
  { value: "expired", label: "Expired stock", restock: false },
  { value: "wrong_item", label: "Wrong item delivered", restock: true },
  { value: "rate_adjustment", label: "Rate adjustment", restock: false },
  { value: "other", label: "Other", restock: true },
];

type NoteRow = {
  id: string; credit_note_number: string; credit_date: string;
  reason: Reason; restock: boolean; grand_total: number;
  retailer: { name: string } | null;
  invoice: { invoice_number: string } | null;
};

type InvoiceLine = {
  id: string; product_id: string | null; description: string; hsn: string | null;
  quantity: number; rate: number; discount_pct: number; gst_rate: number;
};

const inr = (n: number) => `₹ ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ReturnsPage() {
  const { invoiceId: prefillInvoiceId } = Route.useSearch();
  const qc = useQueryClient();
  const create = useServerFn(createCreditNote);
  const remove = useServerFn(deleteCreditNote);

  const [open, setOpen] = useState(false);
  const [retailerId, setRetailerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [creditDate, setCreditDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<Reason>("damaged");
  const [restock, setRestock] = useState(false);
  const [notes, setNotes] = useState("");
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: notesList } = useQuery({
    queryKey: ["credit_notes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_notes")
        .select("id, credit_note_number, credit_date, reason, restock, grand_total, retailer:retailers(name), invoice:sales_invoices(invoice_number)")
        .order("credit_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as NoteRow[];
    },
  });

  const { data: retailers } = useQuery({
    queryKey: ["retailers_min"],
    queryFn: async () => (await supabase.from("retailers").select("id, name").order("name")).data ?? [],
  });

  const { data: invoices } = useQuery({
    queryKey: ["return_invoices", retailerId],
    enabled: !!retailerId,
    queryFn: async () => {
      const { data } = await supabase.from("sales_invoices")
        .select("id, invoice_number, invoice_date, grand_total")
        .eq("retailer_id", retailerId)
        .in("status", ["issued", "paid"])
        .order("invoice_date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: invoiceLines } = useQuery({
    queryKey: ["return_invoice_lines", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data } = await supabase.from("sales_invoice_lines")
        .select("id, product_id, description, hsn, quantity, rate, discount_pct, gst_rate")
        .eq("sales_invoice_id", invoiceId)
        .order("line_no");
      return (data ?? []) as InvoiceLine[];
    },
  });

  // ?invoiceId= — open the dialog pre-set to that invoice.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !prefillInvoiceId) return;
    (async () => {
      const { data: inv } = await supabase.from("sales_invoices")
        .select("id, retailer_id").eq("id", prefillInvoiceId).single();
      if (!inv) return;
      prefilledRef.current = true;
      setRetailerId(inv.retailer_id);
      setInvoiceId(inv.id);
      setOpen(true);
    })();
  }, [prefillInvoiceId]);

  const pickReason = (r: Reason) => {
    setReason(r);
    setRestock(REASONS.find(x => x.value === r)?.restock ?? true);
  };

  const openNew = () => {
    setRetailerId("");
    setInvoiceId("");
    setCreditDate(new Date().toISOString().slice(0, 10));
    pickReason("damaged");
    setNotes("");
    setReturnQty({});
    setOpen(true);
  };

  // Credit preview per line and total.
  const lineCredit = (l: InvoiceLine, qty: number) => {
    const taxable = qty * Number(l.rate) * (1 - Number(l.discount_pct || 0) / 100);
    return taxable * (1 + Number(l.gst_rate || 0) / 100);
  };
  const selectedLines = (invoiceLines ?? [])
    .map(l => ({ line: l, qty: Math.min(Number(returnQty[l.id]) || 0, Number(l.quantity)) }))
    .filter(x => x.qty > 0);
  const totalCredit = selectedLines.reduce((s, x) => s + lineCredit(x.line, x.qty), 0);

  const submit = async () => {
    if (!retailerId) { toast.error("Pick the retailer"); return; }
    if (!invoiceId) { toast.error("Pick the invoice being returned against"); return; }
    if (!selectedLines.length) { toast.error("Enter a return quantity on at least one item"); return; }
    setSaving(true);
    try {
      const res = await create({ data: {
        retailer_id: retailerId,
        sales_invoice_id: invoiceId,
        credit_date: creditDate,
        reason,
        restock,
        notes: notes || null,
        lines: selectedLines.map(({ line, qty }) => ({
          product_id: line.product_id,
          description: line.description,
          hsn: line.hsn,
          quantity: qty,
          rate: Number(line.rate),
          discount_pct: Number(line.discount_pct || 0),
          gst_rate: Number(line.gst_rate || 0),
        })),
      }});
      toast.success(`Credit note ${res.credit_note_number} created — ${inr(res.grand_total)} credited`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["credit_notes"] });
      qc.invalidateQueries({ queryKey: ["party_balances"] });
      qc.invalidateQueries({ queryKey: ["receivables_ageing"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const del = async (n: NoteRow) => {
    if (!confirm(`Delete ${n.credit_note_number}? Stock and dues will be restored.`)) return;
    try {
      await remove({ data: { id: n.id } });
      qc.invalidateQueries({ queryKey: ["credit_notes"] });
      qc.invalidateQueries({ queryKey: ["party_balances"] });
      qc.invalidateQueries({ queryKey: ["receivables_ageing"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const reasonLabel = (r: Reason) => REASONS.find(x => x.value === r)?.label ?? r;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Returns</h1>
          <p className="text-muted-foreground mt-1">
            Goods coming back from retailers. Each return creates a credit note that
            reduces what they owe — and puts sellable goods back in stock.
          </p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> New return</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Record a return</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!saving && selectedLines.length) submit(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Who is returning? *</Label>
                <Select value={retailerId} onValueChange={v => { setRetailerId(v); setInvoiceId(""); setReturnQty({}); }}>
                  <SelectTrigger><SelectValue placeholder="Choose retailer" /></SelectTrigger>
                  <SelectContent>
                    {retailers?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Against which invoice? *</Label>
                <Select value={invoiceId} onValueChange={v => { setInvoiceId(v); setReturnQty({}); }} disabled={!retailerId}>
                  <SelectTrigger><SelectValue placeholder={retailerId ? "Choose invoice" : "Pick retailer first"} /></SelectTrigger>
                  <SelectContent>
                    {invoices?.map(i => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.invoice_number} · {i.invoice_date} · {inr(Number(i.grand_total ?? 0))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {invoiceId && (
              <div>
                <Label>What came back?</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Enter the returned quantity next to each item — prices and GST come from the invoice itself.
                </p>
                <div className="border rounded-md max-h-64 overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="w-28">Returned</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {invoiceLines?.map(l => {
                        const qty = Math.min(Number(returnQty[l.id]) || 0, Number(l.quantity));
                        return (
                          <TableRow key={l.id}>
                            <TableCell className="font-medium">{l.description}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number(l.quantity)}</TableCell>
                            <TableCell>
                              <Input type="number" min="0" max={Number(l.quantity)} placeholder="0"
                                value={returnQty[l.id] ?? ""}
                                onChange={e => setReturnQty(q => ({ ...q, [l.id]: e.target.value }))} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {qty > 0 ? inr(lineCredit(l, qty)) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Why is it coming back?</Label>
                <Select value={reason} onValueChange={v => pickReason(v as Reason)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Return date</Label>
                <Input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Put goods back into stock?</div>
                <div className="text-xs text-muted-foreground">
                  {restock
                    ? "Yes — items will be added back and can be sold again."
                    : "No — damaged or expired goods won't count as sellable stock."}
                </div>
              </div>
              <Switch checked={restock} onCheckedChange={setRestock} />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional remarks" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <DialogFooter className="items-center gap-3">
              <span className="text-sm text-muted-foreground mr-auto">
                Credit to retailer: <span className="font-semibold text-foreground">{inr(totalCredit)}</span>
              </span>
              <Button type="submit" disabled={saving || !selectedLines.length}>
                <Undo2 className="h-4 w-4 mr-2" /> Create credit note
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle>Credit notes ({notesList?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Credit note</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Retailer</TableHead>
              <TableHead>Against</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Restocked</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {notesList?.map(n => (
                <TableRow key={n.id}>
                  <TableCell className="font-mono text-sm font-medium">{n.credit_note_number}</TableCell>
                  <TableCell>{n.credit_date}</TableCell>
                  <TableCell>{n.retailer?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{n.invoice?.invoice_number ?? "—"}</TableCell>
                  <TableCell>{reasonLabel(n.reason)}</TableCell>
                  <TableCell>{n.restock ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(Number(n.grand_total))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => del(n)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!notesList?.length && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No returns yet. When a retailer sends goods back, record it here.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
