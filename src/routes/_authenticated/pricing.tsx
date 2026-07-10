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
          <p className="text-muted-foreground mt-1">Set a custom rate per product, or a special rate for a specific retailer.</p>
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
