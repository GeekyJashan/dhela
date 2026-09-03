import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { upsertOrder, deleteOrder, setOrderStatus, enqueueOrderUploads } from "@/lib/orders.functions";
import { getCurrentOrg } from "@/lib/org.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Receipt, Ban, FileUp, Loader2, X } from "lucide-react";
import { CaptureInput } from "@/components/capture-input";
import { useTranslation } from "react-i18next";

const MAX_ORDER_FILES = 100;

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({ meta: [{ title: "Orders — Dhela" }] }),
  component: OrdersPage,
});

type OrderLine = {
  id: string; product_id: string; quantity: number; fulfilled_quantity: number;
  product: { id: string; name: string; unit: string | null; current_stock: number | null } | null;
};

type Order = {
  id: string; order_number: string; order_date: string;
  status: "pending" | "partial" | "fulfilled" | "cancelled";
  notes: string | null;
  upload_status: string | null;
  error_message: string | null;
  retailer: { id: string; name: string } | null;
  order_lines: OrderLine[];
};

type LineDraft = { key: string; product_id: string; quantity: string };

const blankLine = (): LineDraft => ({ key: crypto.randomUUID(), product_id: "", quantity: "1" });

const STATUS_STYLE: Record<Order["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  partial: "bg-blue-100 text-blue-800",
  fulfilled: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground",
};

function OrdersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useServerFn(upsertOrder);
  const remove = useServerFn(deleteOrder);
  const setStatus = useServerFn(setOrderStatus);
  const getOrg = useServerFn(getCurrentOrg);
  const enqueueOrders = useServerFn(enqueueOrderUploads);
  const pollRef = useRef<number | null>(null);

  const [upl, setUpl] = useState<{ retailerId: string; engine: "ai" | "ocr"; files: File[] } | null>(null);
  const [uplBusy, setUplBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [retailerId, setRetailerId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [saving, setSaving] = useState(false);

  const { data: orders } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders")
        .select("id, order_number, order_date, status, notes, upload_status, error_message, retailer:retailers(id, name), order_lines(id, product_id, quantity, fulfilled_quantity, product:products(id, name, unit, current_stock))")
        .order("order_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Order[];
    },
  });

  // Poll while any uploaded order is still being read in the background.
  useEffect(() => {
    const active = (orders ?? []).some(o => o.upload_status === "queued" || o.upload_status === "processing");
    if (!active) {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      fetch("/api/public/hooks/process-order-queue", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 5 }),
      }).catch(() => {});
    }, 3000);
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  }, [orders, qc]);

  const { data: retailers } = useQuery({
    queryKey: ["retailers_min"],
    queryFn: async () => {
      const { data } = await supabase.from("retailers").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products_for_orders"],
    queryFn: async () => {
      const { data } = await supabase.from("products")
        .select("id, name, unit, current_stock").order("name");
      return data ?? [];
    },
  });

  // Pending demand per product across open orders vs stock on hand.
  const pendingSummary = (() => {
    const map = new Map<string, { name: string; unit: string | null; stock: number; pending: number }>();
    for (const o of orders ?? []) {
      if (o.status !== "pending" && o.status !== "partial") continue;
      for (const l of o.order_lines) {
        const pending = Number(l.quantity) - Number(l.fulfilled_quantity ?? 0);
        if (pending <= 0) continue;
        const cur = map.get(l.product_id) ?? {
          name: l.product?.name ?? "Unknown product",
          unit: l.product?.unit ?? null,
          stock: Number(l.product?.current_stock ?? 0),
          pending: 0,
        };
        cur.pending += pending;
        map.set(l.product_id, cur);
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v, shortfall: Math.max(0, v.pending - v.stock) }))
      .sort((a, b) => b.shortfall - a.shortfall || b.pending - a.pending);
  })();

  const openNew = () => {
    setEditing(null);
    setRetailerId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setLines([blankLine()]);
    setOpen(true);
  };

  const openEdit = (o: Order) => {
    setEditing(o);
    setRetailerId(o.retailer?.id ?? "");
    setOrderDate(o.order_date);
    setNotes(o.notes ?? "");
    setLines(o.order_lines.map(l => ({
      key: l.id, product_id: l.product_id, quantity: String(Number(l.quantity)),
    })));
    setOpen(true);
  };

  const patchLine = (key: string, p: Partial<LineDraft>) =>
    setLines(ls => ls.map(l => l.key === key ? { ...l, ...p } : l));

  const submit = async () => {
    const validLines = lines
      .filter(l => l.product_id && Number(l.quantity) > 0)
      .map(l => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
    if (!retailerId) { toast.error(t("Pick a retailer")); return; }
    if (!validLines.length) { toast.error(t("Add at least one product")); return; }
    setSaving(true);
    try {
      const res = await save({ data: {
        ...(editing ? { id: editing.id } : {}),
        retailer_id: retailerId,
        order_date: orderDate,
        notes: notes || null,
        lines: validLines,
      }});
      toast.success(editing ? t("Order {{n}} updated", { n: res.order_number }) : t("Order {{n}} created", { n: res.order_number }));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const submitUpload = async () => {
    if (!upl || !upl.retailerId || !upl.files.length) { toast.error(t("Pick a retailer and at least one file")); return; }
    setUplBusy(true);
    try {
      const { orgId } = await getOrg();
      // Upload files to storage (concurrency 3), then enqueue for background
      // extraction — the worker reads + matches each in parallel.
      const uploaded: Array<{ storagePath: string; mimeType: string }> = [];
      const queue = [...upl.files];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const file = queue.shift();
          if (!file) return;
          const path = `${orgId}/order-${crypto.randomUUID()}-${file.name}`;
          const { error } = await supabase.storage.from("invoices").upload(path, file, { contentType: file.type, upsert: false });
          if (!error) uploaded.push({ storagePath: path, mimeType: file.type || "application/octet-stream" });
        }
      });
      await Promise.all(workers);
      if (!uploaded.length) { toast.error(t("All uploads failed")); return; }

      await enqueueOrders({ data: {
        retailer_id: upl.retailerId,
        order_date: new Date().toISOString().slice(0, 10),
        engine: upl.engine,
        items: uploaded,
      }});

      // Kick the worker immediately (fire-and-forget); polling picks up the rest.
      fetch("/api/public/hooks/process-order-queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: Math.min(10, uploaded.length) }),
      }).catch(() => {});

      toast.success(t("{{n}} order(s) queued — reading in the background", { n: uploaded.length }));
      setUpl(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setUplBusy(false); }
  };

  const del = async (o: Order) => {
    if (!confirm(t("Delete order {{n}}? Issued bills remain.", { n: o.order_number }))) return;
    try {
      await remove({ data: { id: o.id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const cancel = async (o: Order) => {
    if (!confirm(t("Cancel order {{n}}?", { n: o.order_number }))) return;
    try {
      await setStatus({ data: { id: o.id, status: "cancelled" } });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const progress = (o: Order) => {
    const total = o.order_lines.reduce((s, l) => s + Number(l.quantity), 0);
    const done = o.order_lines.reduce((s, l) => s + Number(l.fulfilled_quantity ?? 0), 0);
    return { total, done };
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Orders")}</h1>
          <p className="text-muted-foreground mt-1">{t("Retailer orders — turn them into bills when you're ready to bill.")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUpl({ retailerId: "", engine: "ai", files: [] })}>
            <FileUp className="h-4 w-4 mr-2" /> {t("Upload order")}
          </Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> {t("New order")}</Button>
        </div>
      </div>

      <Dialog open={!!upl} onOpenChange={o => !o && setUpl(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Upload order")}</DialogTitle></DialogHeader>
          {upl && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("Upload a photo or PDF of the retailer's order. We'll read the items and match them to your products.")}
              </p>
              <div>
                <Label>{t("Retailer *")}</Label>
                <Select value={upl.retailerId} onValueChange={v => setUpl({ ...upl, retailerId: v })}>
                  <SelectTrigger><SelectValue placeholder={t("Choose retailer")} /></SelectTrigger>
                  <SelectContent>
                    {retailers?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("Order file(s) *")}</Label>
                <CaptureInput
                  className="mt-1.5"
                  photoCount={upl.files.filter(f => f.type.startsWith("image/")).length}
                  onFiles={files => setUpl(u => u && ({
                    ...u,
                    files: [...u.files, ...files].slice(0, MAX_ORDER_FILES),
                  }))}
                />
                {upl.files.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {upl.files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                        <button type="button" aria-label={t("Remove")}
                          onClick={() => setUpl(u => u && ({ ...u, files: u.files.filter((_, n) => n !== i) }))}
                          className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  {upl.files.length > 0
                    ? t("{{n}} file(s) selected — one order each", { n: upl.files.length })
                    : t("Pick one file, or several to create multiple orders at once.")}
                </p>
              </div>
              <div>
                <Label>{t("Reader")}</Label>
                <Select value={upl.engine} onValueChange={v => setUpl({ ...upl, engine: v as "ai" | "ocr" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ai">{t("AI (best accuracy)")}</SelectItem>
                    <SelectItem value="ocr">{t("OCR (free)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            {/* Button spins by itself when onClick returns a promise. */}
            <Button onClick={submitUpload} disabled={!upl?.retailerId || !upl?.files.length}>
              {uplBusy ? t("Reading…") : (upl && upl.files.length > 1 ? t("Create {{n}} orders", { n: upl.files.length }) : t("Create order"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? t("Edit {{n}}", { n: editing.order_number }) : t("New order")}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!saving) submit(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("Retailer *")}</Label>
                <Select value={retailerId} onValueChange={setRetailerId}>
                  <SelectTrigger><SelectValue placeholder={t("Choose retailer")} /></SelectTrigger>
                  <SelectContent>
                    {retailers?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("Order date")}</Label>
                <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>{t("Products *")}</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines(ls => [...ls, blankLine()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("Add line")}
                </Button>
              </div>
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {lines.map(l => {
                  const p = products?.find(x => x.id === l.product_id);
                  return (
                    <div key={l.key} className="flex gap-2 items-center">
                      <div className="flex-1">
                        <Select value={l.product_id} onValueChange={v => patchLine(l.key, { product_id: v })}>
                          <SelectTrigger><SelectValue placeholder={t("Pick product")} /></SelectTrigger>
                          <SelectContent>
                            {products?.map(pr => (
                              <SelectItem key={pr.id} value={pr.id}>
                                {pr.name}{pr.current_stock != null ? ` · ${t("stock")} ${Number(pr.current_stock)}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input className="w-24" type="number" min="0" placeholder={t("Qty")} title={t("Quantity")} value={l.quantity}
                        onChange={e => patchLine(l.key, { quantity: e.target.value })} />
                      <span className="text-xs text-muted-foreground w-10">{p?.unit ?? ""}</span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : ls)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>{t("Notes")}</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Delivery instructions, references…")} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>{editing ? t("Save changes") : t("Create order")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle>{t("Orders ({{n}})", { n: orders?.length ?? 0 })}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Order #")}</TableHead>
              <TableHead>{t("Retailer")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Items")}</TableHead>
              <TableHead className="text-right">{t("Fulfilled")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {orders?.map(o => {
                const { total, done } = progress(o);
                const processing = o.upload_status === "queued" || o.upload_status === "processing";
                const openOrder = (o.status === "pending" || o.status === "partial") && !processing;
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm font-medium">{o.order_number}</TableCell>
                    <TableCell>{o.retailer?.name ?? "—"}</TableCell>
                    <TableCell>{o.order_date}</TableCell>
                    <TableCell>
                      {processing ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" /> {t("Reading…")}
                        </span>
                      ) : o.upload_status === "failed" ? (
                        <span title={o.error_message ?? undefined}
                          className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          {t("Upload failed")}
                        </span>
                      ) : (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[o.status]}`}>
                          {t(o.status)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t("{{n}} products", { n: o.order_lines.length })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{done} / {total}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {openOrder && (
                        <Button size="sm" variant="outline" className="mr-1"
                          onClick={() => navigate({ to: "/sales/new", search: { orderId: o.id } })}>
                          <Receipt className="h-3.5 w-3.5 mr-1" /> {t("Bill")}
                        </Button>
                      )}
                      {openOrder && (
                        <Button size="sm" variant="ghost" title={t("Cancel order")} onClick={() => cancel(o)}>
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => del(o)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!orders?.length && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  {t("No orders yet. Add one when a retailer places an order.")}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Pending stock summary")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("Quantity still to deliver across open orders, against stock on hand.")}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Product")}</TableHead>
              <TableHead className="text-right">{t("Pending qty")}</TableHead>
              <TableHead className="text-right">{t("In stock")}</TableHead>
              <TableHead className="text-right">{t("Shortfall")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pendingSummary.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}{p.unit ? <span className="text-xs text-muted-foreground ml-1">({p.unit})</span> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.pending}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.stock}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${p.shortfall > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {p.shortfall > 0 ? p.shortfall : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!pendingSummary.length && (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  {t("Nothing pending — all open orders are covered.")}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
