import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { upsertRetailer, deleteRetailer } from "@/lib/retailers.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/retailers")({
  head: () => ({ meta: [{ title: "Retailers — Ledgerly" }] }),
  component: RetailersPage,
});

type Retailer = {
  id: string; name: string; gstin: string | null; phone: string | null;
  email: string | null; city: string | null; state_code: string | null;
  category: "A" | "B" | "C"; default_discount_pct: number | null;
  credit_limit: number | null; outstanding_balance: number | null;
  address: string | null; pincode: string | null; notes: string | null;
};

const empty = {
  name: "", gstin: "", phone: "", email: "", address: "", city: "",
  state_code: "", pincode: "", category: "C" as "A" | "B" | "C",
  default_discount_pct: 0, credit_limit: 0, notes: "",
};

function RetailersPage() {
  const qc = useQueryClient();
  const save = useServerFn(upsertRetailer);
  const remove = useServerFn(deleteRetailer);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Retailer | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);

  const { data } = useQuery({
    queryKey: ["retailers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("retailers")
        .select("*").order("name");
      if (error) throw error;
      return data as Retailer[];
    },
  });

  // Live balances from the ledger view (invoices − payments + opening).
  const { data: balanceRows } = useQuery({
    queryKey: ["party_balances", "retailer"],
    queryFn: async () => {
      const { data } = await supabase.from("party_balances")
        .select("party_id, balance").eq("party_type", "retailer");
      return data ?? [];
    },
  });
  const balances = new Map(balanceRows?.map(b => [b.party_id, Number(b.balance ?? 0)]));

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (r: Retailer) => {
    setEditing(r);
    setForm({
      name: r.name, gstin: r.gstin ?? "", phone: r.phone ?? "", email: r.email ?? "",
      address: r.address ?? "", city: r.city ?? "", state_code: r.state_code ?? "",
      pincode: r.pincode ?? "", category: r.category ?? "C",
      default_discount_pct: Number(r.default_discount_pct ?? 0),
      credit_limit: Number(r.credit_limit ?? 0), notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      await save({ data: {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        gstin: form.gstin || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state_code: form.state_code || null,
        pincode: form.pincode || null,
        category: form.category,
        default_discount_pct: Number(form.default_discount_pct) || 0,
        credit_limit: Number(form.credit_limit) || 0,
        notes: form.notes || null,
      }});
      toast.success(editing ? "Retailer updated" : "Retailer added");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["retailers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const del = async (id: string) => {
    if (!confirm("Delete retailer? Their past invoices remain.")) return;
    try {
      await remove({ data: { id } });
      qc.invalidateQueries({ queryKey: ["retailers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Retailers</h1>
          <p className="text-muted-foreground mt-1">Your customer master. Used to bill and calculate GST split.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> New retailer</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Edit retailer" : "Add retailer"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Business name *</label>
                <Input placeholder="e.g. Sharma General Store" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">GSTIN</label>
                <Input placeholder="15-character GST number" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">State code</label>
                <Input placeholder="e.g. 27 for Maharashtra" value={form.state_code} onChange={e => setForm({ ...form, state_code: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Phone</label>
                <Input placeholder="Mobile / landline" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <Input placeholder="billing@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Address</label>
                <Textarea placeholder="Street, area, landmark" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">City</label>
                <Input placeholder="City / town" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Pincode</label>
                <Input placeholder="6-digit PIN" value={form.pincode} onChange={e => setForm({ ...form, pincode: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Retailer category (discount tier)</label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as "A" | "B" | "C" })}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Category A — best discounts</SelectItem>
                    <SelectItem value="B">Category B</SelectItem>
                    <SelectItem value="C">Category C — standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Default discount % (fallback)</label>
                <Input type="number" placeholder="Used when no group discount" value={form.default_discount_pct} onChange={e => setForm({ ...form, default_discount_pct: Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Credit limit (₹)</label>
                <Input type="number" placeholder="0 = no limit" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Textarea placeholder="Anything worth remembering" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={!form.name}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Customers ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>GSTIN</TableHead>
              <TableHead>City/State</TableHead><TableHead>Category</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.gstin ?? "—"}</TableCell>
                  <TableCell>{[r.city, r.state_code].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell><span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-semibold">{r.category ?? "C"}</span></TableCell>
                  <TableCell>{r.phone ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {Number(r.credit_limit ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {(balances.get(r.id) ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Link to="/statement" search={{ party: "retailer", id: r.id }}>
                      <Button size="sm" variant="ghost" title="Account statement"><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No retailers yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
