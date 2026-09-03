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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { ExtraInfo } from "@/components/extra-info";
import { toast } from "sonner";
import { Plus, Search, Sparkles, Loader2, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — Dhela" }] }),
  component: Products,
});

const empty = {
  name: "",
  sku: "",
  hsn: "",
  gst_rate: "",
  mrp: "",
  unit: "",
  purchase_rate: "",
  current_stock: "",
};

function Products() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const aiSuggestHsn = useServerFn(suggestHsn);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [hsnQuery, setHsnQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hsnUserEditedRef = useRef(false); // user manually typed/picked HSN or GST
  const loadedNameRef = useRef(""); // product name when an edit dialog opened

  // Auto-suggest HSN via GenAI when the product name changes (debounced).
  // Runs for both new and edited products, but never overrides a value the
  // user typed/picked, and won't re-classify an edited product until its name
  // actually changes from what was loaded.
  useEffect(() => {
    if (!open) return;
    if (hsnUserEditedRef.current) return;
    const name = form.name.trim();
    if (name.length < 3) {
      setAiHint(null);
      return;
    }
    if (editingId && name === loadedNameRef.current.trim()) return; // unchanged edit
    const timer = setTimeout(async () => {
      setAiLoading(true);
      setAiHint(null);
      try {
        const s = await aiSuggestHsn({ data: { name } });
        if (hsnUserEditedRef.current) return; // user typed while we waited
        if (s.hsn) {
          // The user hasn't touched HSN, so the latest AI classification wins
          // (overwrites any earlier auto-fill from a partial name).
          setForm((f) => ({
            ...f,
            hsn: s.hsn || "",
            gst_rate: s.gst_rate != null ? String(s.gst_rate) : "",
          }));
          setAiHint(
            `AI: ${s.hsn}${s.gst_rate != null ? ` · GST ${s.gst_rate}%` : ""}${s.description ? ` · ${s.description}` : ""}`,
          );
        } else {
          setAiHint(t("AI couldn't classify — search manually below"));
        }
      } catch (e) {
        setAiHint(t("AI failed: {{msg}}", { msg: (e as Error).message }));
      } finally {
        setAiLoading(false);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [form.name, open, editingId, aiSuggestHsn]);

  const { data } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        // Named rather than "*" so `extra` never rides along. It holds
        // whatever a distributor's old software carried that we have no field
        // for, and on a catalogue of several thousand it would be fetched for
        // every row on every load to be shown on none of them. It is read one
        // record at a time, when that record is opened.
        .select(
          "id, name, sku, hsn, gst_rate, mrp, unit, purchase_rate, current_stock, last_purchase_rate, stock_group:stock_groups(id, name, hsn_code, discount_a, discount_b, discount_c)",
        )
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  type GroupInfo = {
    id: string;
    name: string;
    hsn_code: string | null;
    discount_a: number;
    discount_b: number;
    discount_c: number;
  };

  // Catalogue search. Name, SKU and HSN are already loaded, so they filter in
  // the browser without a round trip.
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  // The fields carried over from the old software are the exception: they are
  // deliberately not in the catalogue query, so a rack code can only be found
  // by asking the database. It answers with ids, not blobs.
  const { data: extraHits } = useQuery({
    queryKey: ["products_extra_search", dq],
    enabled: dq.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("products_matching_extra", { _q: dq });
      if (error) throw error;
      return new Set((data ?? []).map((r: { id: string }) => r.id));
    },
  });

  const visible = (() => {
    if (!data) return [];
    if (!dq) return data;
    const needle = dq.toLowerCase();
    return data.filter(
      (p) =>
        p.name?.toLowerCase().includes(needle) ||
        p.sku?.toLowerCase().includes(needle) ||
        p.hsn?.toLowerCase().includes(needle) ||
        extraHits?.has(p.id),
    );
  })();

  // Group catalog rows by stock group (ungrouped products last).
  const grouped = (() => {
    if (!visible.length) return [];
    const map = new Map<string, { group: GroupInfo | null; rows: typeof visible }>();
    for (const p of visible) {
      const g = p.stock_group as GroupInfo | null;
      const key = g?.id ?? "__none__";
      if (!map.has(key)) map.set(key, { group: g, rows: [] });
      map.get(key)!.rows.push(p);
    }
    return [...map.entries()]
      .sort(([ka, a], [kb, b]) =>
        ka === "__none__"
          ? 1
          : kb === "__none__"
            ? -1
            : (a.group?.name ?? "").localeCompare(b.group?.name ?? ""),
      )
      .map(([key, g]) => ({ key, ...g }));
  })();

  // Per-group discount drafts for the A/B/C retailer categories.
  const [gDrafts, setGDrafts] = useState<Record<string, { a: string; b: string; c: string }>>({});
  const gDraftFor = (g: GroupInfo) =>
    gDrafts[g.id] ?? {
      a: String(Number(g.discount_a ?? 0)),
      b: String(Number(g.discount_b ?? 0)),
      c: String(Number(g.discount_c ?? 0)),
    };
  const gDirty = (g: GroupInfo) => {
    const d = gDrafts[g.id];
    if (!d) return false;
    return (
      Number(d.a) !== Number(g.discount_a ?? 0) ||
      Number(d.b) !== Number(g.discount_b ?? 0) ||
      Number(d.c) !== Number(g.discount_c ?? 0)
    );
  };
  const saveGroupDiscounts = async (g: GroupInfo) => {
    const d = gDraftFor(g);
    const { error } = await supabase
      .from("stock_groups")
      .update({
        discount_a: Number(d.a) || 0,
        discount_b: Number(d.b) || 0,
        discount_c: Number(d.c) || 0,
      })
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("{{name}} discounts saved", { name: g.name }));
    setGDrafts(({ [g.id]: _gone, ...rest }) => rest);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_groups"] });
  };

  const { data: hsnResults } = useQuery({
    queryKey: ["hsn_search", hsnQuery],
    enabled: hsnQuery.length >= 2,
    queryFn: async () => {
      const q = hsnQuery
        .trim()
        .replace(/[,()*]/g, " ")
        .trim();
      const { data, error } = await supabase
        .from("hsn_codes")
        .select("code, description, gst_rate, category")
        .or(`code.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`)
        .order("code")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pickHsn = (h: { code: string; gst_rate: number }) => {
    hsnUserEditedRef.current = true;
    setForm((f) => ({ ...f, hsn: h.code, gst_rate: String(h.gst_rate) }));
    setHsnQuery("");
    setAiHint(null);
  };

  const handleDialogOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setEditingId(null);
      setForm(empty);
      setHsnQuery("");
      setAiHint(null);
      hsnUserEditedRef.current = false;
      loadedNameRef.current = "";
    }
  };

  const openEdit = (p: {
    id: string;
    name: string;
    sku: string | null;
    hsn: string | null;
    gst_rate: number | null;
    mrp: number | null;
    unit: string | null;
    purchase_rate: number | null;
    current_stock: number | null;
  }) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      sku: p.sku ?? "",
      hsn: p.hsn ?? "",
      gst_rate: p.gst_rate != null ? String(p.gst_rate) : "",
      mrp: p.mrp != null ? String(p.mrp) : "",
      unit: p.unit ?? "",
      purchase_rate: p.purchase_rate != null ? String(p.purchase_rate) : "",
      current_stock: p.current_stock != null ? String(Number(p.current_stock)) : "",
    });
    // Keep the loaded HSN as-is; only re-classify if the user changes the name.
    hsnUserEditedRef.current = false;
    loadedNameRef.current = p.name;
    setOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        sku: form.sku || null,
        hsn: form.hsn || null,
        gst_rate: form.gst_rate ? Number(form.gst_rate) : null,
        mrp: form.mrp ? Number(form.mrp) : null,
        unit: form.unit || null,
        purchase_rate: form.purchase_rate ? Number(form.purchase_rate) : null,
        current_stock: form.current_stock ? Number(form.current_stock) : 0,
      };
      if (editingId) {
        const { error } = await supabase.from("products").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success(t("Product updated"));
      } else {
        const { orgId } = await getOrg();
        const { error } = await supabase.from("products").insert({ org_id: orgId, ...payload });
        if (error) throw error;
        toast.success(t("Product added"));
      }
      handleDialogOpenChange(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Products")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("Your catalog. Used for AI matching, pricing, and sales.")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> {t("New product")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{editingId ? t("Edit product") : t("Add product")}</DialogTitle>
            </DialogHeader>
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name && !saving) submit();
              }}
            >
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("Product name *")}</label>
                <Input
                  placeholder={t("e.g. Maggi Masala Noodles 70g")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("SKU / item code")}</label>
                <Input
                  placeholder={t("Optional internal code")}
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Unit")}</label>
                <Input
                  placeholder={t("PCS / KG / BOX")}
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>

              <div className="col-span-2 space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">{t("HSN code")}</label>
                    <Input
                      placeholder={t("Auto-fills from name")}
                      value={form.hsn}
                      onChange={(e) => {
                        hsnUserEditedRef.current = true;
                        setForm({ ...form, hsn: e.target.value });
                      }}
                    />
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-muted-foreground">{t("GST %")}</label>
                    <Input
                      placeholder={t("e.g. 18")}
                      value={form.gst_rate}
                      onChange={(e) => {
                        hsnUserEditedRef.current = true;
                        setForm({ ...form, gst_rate: e.target.value });
                      }}
                    />
                  </div>
                </div>
                <div className="text-xs flex items-center gap-1.5 min-h-[18px]">
                  {aiLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="text-muted-foreground">{t("AI classifying HSN…")}</span>
                    </>
                  ) : aiHint ? (
                    <>
                      <Sparkles className="h-3 w-3 text-primary" />
                      <span className="text-muted-foreground">{aiHint}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">
                      {t("HSN auto-fills from product name. Edit or search to override.")}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2 top-3 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={t("Search HSN by name or code (e.g. paracetamol, 3004, cement)")}
                    value={hsnQuery}
                    onChange={(e) => setHsnQuery(e.target.value)}
                  />
                  {hsnQuery.length >= 2 && hsnResults && hsnResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border rounded-md bg-popover shadow-lg max-h-60 overflow-auto">
                      {hsnResults.map((h) => (
                        <button
                          key={h.code}
                          type="button"
                          onClick={() => pickHsn(h)}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0"
                        >
                          <div className="flex justify-between">
                            <span className="font-mono font-medium">{h.code}</span>
                            <span className="text-muted-foreground">GST {h.gst_rate}%</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {h.description}
                            {h.category ? ` · ${h.category}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">{t("MRP (₹)")}</label>
                <Input
                  placeholder={t("Printed retail price")}
                  value={form.mrp}
                  onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Purchase cost (₹)")}</label>
                <Input
                  placeholder={t("What you pay the supplier")}
                  value={form.purchase_rate}
                  onChange={(e) => setForm({ ...form, purchase_rate: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">
                  {editingId ? t("Current stock") : t("Opening stock")}
                </label>
                <Input
                  placeholder={t("Quantity on hand")}
                  value={form.current_stock}
                  onChange={(e) => setForm({ ...form, current_stock: e.target.value })}
                />
              </div>
              {editingId && (
                <div className="col-span-2">
                  <ExtraInfo table="products" id={editingId} />
                </div>
              )}
              <DialogFooter className="col-span-2">
                <Button type="submit" loading={saving} disabled={!form.name}>
                  {saving ? t("Saving…") : t("Save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              {dq
                ? t("Catalog ({{n}} of {{total}})", { n: visible.length, total: data?.length ?? 0 })
                : t("Catalog ({{n}})", { n: data?.length ?? 0 })}
            </CardTitle>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Search name, SKU, HSN — or a rack code you brought over")}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {t(
              "Grouped by HSN heading (first 4 digits). Set each group's discount for category A / B / C retailers — sales bills apply them automatically.",
            )}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("SKU")}</TableHead>
                <TableHead>{t("HSN")}</TableHead>
                <TableHead>{t("GST%")}</TableHead>
                <TableHead>{t("MRP")}</TableHead>
                <TableHead>{t("Last cost")}</TableHead>
                <TableHead className="text-right">{t("Stock")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map((g) => (
                <Fragment key={g.key}>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={8} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{g.group?.name ?? t("Ungrouped")}</span>
                        {g.group?.hsn_code && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {t("HSN")} {g.group.hsn_code}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">({g.rows.length})</span>
                        {g.group && (
                          <div className="ml-auto flex items-center gap-1.5">
                            {(["a", "b", "c"] as const).map((tier) => (
                              <label
                                key={tier}
                                className="flex items-center gap-1 text-xs text-muted-foreground"
                              >
                                {tier.toUpperCase()}
                                <Input
                                  type="number"
                                  className="h-7 w-16 text-right"
                                  value={gDraftFor(g.group!)[tier]}
                                  onChange={(e) =>
                                    setGDrafts((d) => ({
                                      ...d,
                                      [g.group!.id]: {
                                        ...gDraftFor(g.group!),
                                        [tier]: e.target.value,
                                      },
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && gDirty(g.group!))
                                      saveGroupDiscounts(g.group!);
                                  }}
                                />
                                %
                              </label>
                            ))}
                            <Button
                              size="sm"
                              className="h-7"
                              variant={gDirty(g.group) ? "default" : "ghost"}
                              disabled={!gDirty(g.group)}
                              onClick={() => saveGroupDiscounts(g.group!)}
                            >
                              {t("Save")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {g.rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.sku}</TableCell>
                      <TableCell className="font-mono text-xs">{p.hsn}</TableCell>
                      <TableCell>{p.gst_rate}</TableCell>
                      <TableCell>
                        {p.mrp ? `₹ ${Number(p.mrp).toLocaleString("en-IN")}` : "—"}
                      </TableCell>
                      <TableCell>
                        {p.last_purchase_rate
                          ? `₹ ${Number(p.last_purchase_rate).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(p.current_stock ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t("Edit product")}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
              {!data?.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {t("No products yet.")}
                  </TableCell>
                </TableRow>
              )}
              {/* An empty catalogue and a search that found nothing are
                  different things, and a blank table says neither. */}
              {!!data?.length && !visible.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {t("Nothing matches “{{q}}”.", { q: dq })}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
