import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { upsertPriceOverride, deletePriceOverride } from "@/lib/price-overrides.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pricing")({
  head: () => ({ meta: [{ title: "Pricing — Ledgerly" }] }),
  component: PricingPage,
});

type StockGroupRow = {
  id: string; name: string; hsn_code: string | null;
  discount_a: number; discount_b: number; discount_c: number;
  products: { count: number }[];
};

function StockGroupsCard() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { name: string; a: string; b: string; c: string }>>({});

  const { data: groups } = useQuery({
    queryKey: ["stock_groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_groups")
        .select("id, name, hsn_code, discount_a, discount_b, discount_c, products(count)")
        .order("name");
      if (error) throw error;
      return data as unknown as StockGroupRow[];
    },
  });

  const draftFor = (g: StockGroupRow) => drafts[g.id] ?? {
    name: g.name,
    a: String(Number(g.discount_a ?? 0)),
    b: String(Number(g.discount_b ?? 0)),
    c: String(Number(g.discount_c ?? 0)),
  };

  const patch = (g: StockGroupRow, p: Partial<{ name: string; a: string; b: string; c: string }>) =>
    setDrafts(d => ({ ...d, [g.id]: { ...draftFor(g), ...p } }));

  const isDirty = (g: StockGroupRow) => {
    const d = drafts[g.id];
    if (!d) return false;
    return d.name !== g.name
      || Number(d.a) !== Number(g.discount_a ?? 0)
      || Number(d.b) !== Number(g.discount_b ?? 0)
      || Number(d.c) !== Number(g.discount_c ?? 0);
  };

  const saveGroup = async (g: StockGroupRow) => {
    const d = draftFor(g);
    const { error } = await supabase.from("stock_groups").update({
      name: d.name.trim() || g.name,
      discount_a: Number(d.a) || 0,
      discount_b: Number(d.b) || 0,
      discount_c: Number(d.c) || 0,
    }).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${d.name} saved`);
    setDrafts(({ [g.id]: _gone, ...rest }) => rest);
    qc.invalidateQueries({ queryKey: ["stock_groups"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock group discounts</CardTitle>
        <p className="text-sm text-muted-foreground">
          Products are grouped automatically by HSN code. Set the discount each retailer
          category gets — sales invoices pick these up automatically.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Group</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="w-28">Disc% — A</TableHead>
            <TableHead className="w-28">Disc% — B</TableHead>
            <TableHead className="w-28">Disc% — C</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {groups?.map(g => {
              const d = draftFor(g);
              return (
                <TableRow key={g.id}>
                  <TableCell><Input value={d.name} onChange={e => patch(g, { name: e.target.value })} /></TableCell>
                  <TableCell className="font-mono text-xs">{g.hsn_code ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.products?.[0]?.count ?? 0}</TableCell>
                  <TableCell><Input type="number" value={d.a} onChange={e => patch(g, { a: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" value={d.b} onChange={e => patch(g, { b: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" value={d.c} onChange={e => patch(g, { c: e.target.value })} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={isDirty(g) ? "default" : "ghost"} disabled={!isDirty(g)} onClick={() => saveGroup(g)}>Save</Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!groups?.length && (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                No stock groups yet — they're created automatically when you add products with an HSN code.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PricingPage() {
  const qc = useQueryClient();
  const save = useServerFn(upsertPriceOverride);
  const remove = useServerFn(deletePriceOverride);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ product_id: "", retailer_id: "__none__", selling_rate: 0, discount_pct: 0 });

  const { data: rows } = useQuery({
    queryKey: ["price_overrides_list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_price_overrides")
        .select("id, selling_rate, discount_pct, product:products(id, name, mrp), retailer:retailers(id, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products_min"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name, mrp").order("name");
      return data ?? [];
    },
  });

  const { data: retailers } = useQuery({
    queryKey: ["retailers_min"],
    queryFn: async () => {
      const { data } = await supabase.from("retailers").select("id, name").order("name");
      return data ?? [];
    },
  });

  const submit = async () => {
    try {
      await save({ data: {
        product_id: form.product_id,
        retailer_id: form.retailer_id === "__none__" ? null : form.retailer_id,
        selling_rate: Number(form.selling_rate),
        discount_pct: Number(form.discount_pct) || 0,
      }});
      toast.success("Price override saved");
      setOpen(false);
      setForm({ product_id: "", retailer_id: "__none__", selling_rate: 0, discount_pct: 0 });
      qc.invalidateQueries({ queryKey: ["price_overrides_list"] });
      qc.invalidateQueries({ queryKey: ["price-overrides"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const del = async (id: string) => {
    if (!confirm("Remove this price override?")) return;
    await remove({ data: { id } });
    qc.invalidateQueries({ queryKey: ["price_overrides_list"] });
    qc.invalidateQueries({ queryKey: ["price-overrides"] });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Pricing rules</h1>
          <p className="text-muted-foreground mt-1">Stock-group discounts by retailer category, plus per-product or per-retailer overrides.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2"/>New override</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New price override</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Product *</label>
                <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
                  <SelectContent>{products?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Retailer (leave blank = applies to everyone)</label>
                <Select value={form.retailer_id} onValueChange={(v) => setForm({ ...form, retailer_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Any retailer (product default) —</SelectItem>
                    {retailers?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Selling rate (₹) *</label>
                  <Input type="number" value={form.selling_rate} onChange={e => setForm({ ...form, selling_rate: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Discount %</label>
                  <Input type="number" value={form.discount_pct} onChange={e => setForm({ ...form, discount_pct: Number(e.target.value) })} />
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={!form.product_id || !form.selling_rate}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <StockGroupsCard />

      <Card>
        <CardHeader><CardTitle>Overrides ({rows?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead>Retailer</TableHead>
              <TableHead>MRP</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Disc%</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows?.map((row) => {
                const p = row.product as { name: string; mrp: number | null } | null;
                const r = row.retailer as { name: string } | null;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{p?.name}</TableCell>
                    <TableCell>{r?.name ?? <span className="text-muted-foreground italic">Any retailer</span>}</TableCell>
                    <TableCell>{p?.mrp ? `₹ ${Number(p.mrp).toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">₹ {Number(row.selling_rate).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right">{Number(row.discount_pct ?? 0).toFixed(1)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => del(row.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows?.length && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No overrides. Suggested price will be computed from cost + margin.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
