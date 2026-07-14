import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentOrg } from "@/lib/org.functions";
import { suggestHsn } from "@/lib/hsn.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Search, Sparkles, Loader2 } from "lucide-react";


export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — Ledgerly" }] }),
  component: Products,
});

const empty = {
  name: "", sku: "", hsn: "", gst_rate: "", mrp: "", unit: "",
  current_stock: "",
};

function Products() {
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const aiSuggestHsn = useServerFn(suggestHsn);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof empty>(empty);
  const [hsnQuery, setHsnQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const hsnTouchedRef = useRef(false);

  // Auto-suggest HSN via GenAI when product name changes (debounced).
  // Skips if the user has already typed/picked an HSN.
  useEffect(() => {
    if (!open) return;
    if (hsnTouchedRef.current) return;
    const name = form.name.trim();
    if (name.length < 3) { setAiHint(null); return; }
    const t = setTimeout(async () => {
      setAiLoading(true);
      setAiHint(null);
      try {
        const s = await aiSuggestHsn({ data: { name } });
        if (hsnTouchedRef.current) return; // user typed while we waited
        if (s.hsn) {
          setForm(f => ({
            ...f,
            hsn: f.hsn || s.hsn || "",
            gst_rate: f.gst_rate || (s.gst_rate != null ? String(s.gst_rate) : ""),
          }));
          setAiHint(`AI: ${s.hsn}${s.gst_rate != null ? ` · GST ${s.gst_rate}%` : ""}${s.description ? ` · ${s.description}` : ""}`);
        } else {
          setAiHint("AI couldn't classify — search manually below");
        }
      } catch (e) {
        setAiHint(`AI failed: ${(e as Error).message}`);
      } finally {
        setAiLoading(false);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [form.name, open, aiSuggestHsn]);



  const { data } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products")
        .select("*, stock_group:stock_groups(id, name, hsn_code, discount_a, discount_b, discount_c)").order("name");
      if (error) throw error;
      return data;
    },
  });

  type GroupInfo = {
    id: string; name: string; hsn_code: string | null;
    discount_a: number; discount_b: number; discount_c: number;
  };

  // Group catalog rows by stock group (ungrouped products last).
  const grouped = (() => {
    if (!data) return [];
    const map = new Map<string, { group: GroupInfo | null; rows: typeof data }>();
    for (const p of data) {
      const g = p.stock_group as GroupInfo | null;
      const key = g?.id ?? "__none__";
      if (!map.has(key)) map.set(key, { group: g, rows: [] });
      map.get(key)!.rows.push(p);
    }
    return [...map.entries()]
      .sort(([ka, a], [kb, b]) =>
        ka === "__none__" ? 1 : kb === "__none__" ? -1
          : (a.group?.name ?? "").localeCompare(b.group?.name ?? ""))
      .map(([key, g]) => ({ key, ...g }));
  })();

  // Per-group discount drafts for the A/B/C retailer categories.
  const [gDrafts, setGDrafts] = useState<Record<string, { a: string; b: string; c: string }>>({});
  const gDraftFor = (g: GroupInfo) => gDrafts[g.id] ?? {
    a: String(Number(g.discount_a ?? 0)),
    b: String(Number(g.discount_b ?? 0)),
    c: String(Number(g.discount_c ?? 0)),
  };
  const gDirty = (g: GroupInfo) => {
    const d = gDrafts[g.id];
    if (!d) return false;
    return Number(d.a) !== Number(g.discount_a ?? 0)
      || Number(d.b) !== Number(g.discount_b ?? 0)
      || Number(d.c) !== Number(g.discount_c ?? 0);
  };
  const saveGroupDiscounts = async (g: GroupInfo) => {
    const d = gDraftFor(g);
    const { error } = await supabase.from("stock_groups").update({
      discount_a: Number(d.a) || 0,
      discount_b: Number(d.b) || 0,
      discount_c: Number(d.c) || 0,
    }).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${g.name} discounts saved`);
    setGDrafts(({ [g.id]: _gone, ...rest }) => rest);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_groups"] });
  };

  const { data: hsnResults } = useQuery({
    queryKey: ["hsn_search", hsnQuery],
    enabled: hsnQuery.length >= 2,
    queryFn: async () => {
      const q = hsnQuery.trim().replace(/[,()*]/g, " ").trim();
      const { data, error } = await supabase.from("hsn_codes")
        .select("code, description, gst_rate, category")
        .or(`code.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`)
        .order("code")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pickHsn = (h: { code: string; gst_rate: number }) => {
    hsnTouchedRef.current = true;
    setForm(f => ({ ...f, hsn: h.code, gst_rate: String(h.gst_rate) }));
    setHsnQuery("");
    setAiHint(null);
  };

  const handleDialogOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setForm(empty);
      setHsnQuery("");
      setAiHint(null);
      hsnTouchedRef.current = false;
    }
  };

  const submit = async () => {
    try {
      const { orgId } = await getOrg();
      const { error } = await supabase.from("products").insert({
        org_id: orgId,
        name: form.name,
        sku: form.sku || null,
        hsn: form.hsn || null,
        gst_rate: form.gst_rate ? Number(form.gst_rate) : null,
        mrp: form.mrp ? Number(form.mrp) : null,
        unit: form.unit || null,
        current_stock: form.current_stock ? Number(form.current_stock) : 0,
      });
      if (error) throw error;
      toast.success("Product added");
      handleDialogOpenChange(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Products</h1>
          <p className="text-muted-foreground mt-1">Your catalog. Used for AI matching, pricing, and sales.</p>
        </div>
        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New product</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Product name *</label>
                <Input placeholder="e.g. Maggi Masala Noodles 70g" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">SKU / item code</label>
                <Input placeholder="Optional internal code" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit</label>
                <Input placeholder="PCS / KG / BOX" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
              </div>

              <div className="col-span-2 space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">HSN code</label>
                    <Input placeholder="Auto-fills from name" value={form.hsn}
                      onChange={e => { hsnTouchedRef.current = true; setForm({ ...form, hsn: e.target.value }); }} />
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-muted-foreground">GST %</label>
                    <Input placeholder="e.g. 18" value={form.gst_rate}
                      onChange={e => { hsnTouchedRef.current = true; setForm({ ...form, gst_rate: e.target.value }); }} />
                  </div>
                </div>
                <div className="text-xs flex items-center gap-1.5 min-h-[18px]">
                  {aiLoading ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-muted-foreground">AI classifying HSN…</span></>
                  ) : aiHint ? (
                    <><Sparkles className="h-3 w-3 text-primary" /><span className="text-muted-foreground">{aiHint}</span></>
                  ) : (
                    <span className="text-muted-foreground/70">HSN auto-fills from product name. Edit or search to override.</span>
                  )}
                </div>

                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2 top-3 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search HSN by name or code (e.g. paracetamol, 3004, cement)" value={hsnQuery} onChange={e => setHsnQuery(e.target.value)} />
                  {hsnQuery.length >= 2 && hsnResults && hsnResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border rounded-md bg-popover shadow-lg max-h-60 overflow-auto">
                      {hsnResults.map(h => (
                        <button key={h.code} type="button" onClick={() => pickHsn(h)}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0">
                          <div className="flex justify-between">
                            <span className="font-mono font-medium">{h.code}</span>
                            <span className="text-muted-foreground">GST {h.gst_rate}%</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{h.description}{h.category ? ` · ${h.category}` : ""}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">MRP (₹)</label>
                <Input placeholder="Printed retail price" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Opening stock</label>
                <Input placeholder="Quantity on hand" value={form.current_stock} onChange={e => setForm({ ...form, current_stock: e.target.value })} />
              </div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={!form.name}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Catalog ({data?.length ?? 0})</CardTitle>
          <p className="text-sm text-muted-foreground">
            Grouped by HSN heading (first 4 digits). Set each group's discount for
            category A / B / C retailers — sales invoices apply them automatically.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead>HSN</TableHead>
              <TableHead>GST%</TableHead><TableHead>MRP</TableHead>
              <TableHead>Last cost</TableHead>
              <TableHead className="text-right">Stock</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {grouped.map(g => (
                <Fragment key={g.key}>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={7} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{g.group?.name ?? "Ungrouped"}</span>
                        {g.group?.hsn_code && <span className="font-mono text-xs text-muted-foreground">HSN {g.group.hsn_code}</span>}
                        <span className="text-xs text-muted-foreground">({g.rows.length})</span>
                        {g.group && (
                          <div className="ml-auto flex items-center gap-1.5">
                            {(["a", "b", "c"] as const).map(t => (
                              <label key={t} className="flex items-center gap-1 text-xs text-muted-foreground">
                                {t.toUpperCase()}
                                <Input type="number" className="h-7 w-16 text-right"
                                  value={gDraftFor(g.group!)[t]}
                                  onChange={e => setGDrafts(d => ({ ...d, [g.group!.id]: { ...gDraftFor(g.group!), [t]: e.target.value } }))} />
                                %
                              </label>
                            ))}
                            <Button size="sm" className="h-7" variant={gDirty(g.group) ? "default" : "ghost"}
                              disabled={!gDirty(g.group)} onClick={() => saveGroupDiscounts(g.group!)}>
                              Save
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {g.rows.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.sku}</TableCell>
                      <TableCell className="font-mono text-xs">{p.hsn}</TableCell>
                      <TableCell>{p.gst_rate}</TableCell>
                      <TableCell>{p.mrp ? `₹ ${Number(p.mrp).toLocaleString("en-IN")}` : "—"}</TableCell>
                      <TableCell>{p.last_purchase_rate ? `₹ ${Number(p.last_purchase_rate).toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(p.current_stock ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
