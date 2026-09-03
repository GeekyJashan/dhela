import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { saveSalesInvoice } from "@/lib/sales.functions";
import { getCurrentOrg } from "@/lib/org.functions";
import {
  suggestPrice, splitGst, computeLine, computeInvoiceTotals,
  amountInWords, stockGroupDiscount,
  type SalesLineDraft, type PriceOverride, type ProductForPricing,
  type StockGroup, type RetailerCategory,
} from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, Save, Send, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sales/new")({
  head: () => ({ meta: [{ title: "New sales invoice — Dhela" }] }),
  validateSearch: (s: Record<string, unknown>): { orderId?: string; edit?: string } => ({
    ...(typeof s.orderId === "string" ? { orderId: s.orderId } : {}),
    ...(typeof s.edit === "string" ? { edit: s.edit } : {}),
  }),
  component: NewSalesInvoice,
});

type Product = ProductForPricing & {
  name: string; sku: string | null; hsn: string | null;
  unit: string | null; current_stock: number | null;
  stock_group_id: string | null;
};

type Retailer = {
  id: string; name: string; state_code: string | null;
  default_discount_pct: number | null; gstin: string | null;
  category: RetailerCategory | null;
};

type RowDraft = SalesLineDraft & { key: string };

const blankRow = (): RowDraft => ({
  key: crypto.randomUUID(),
  product_id: null, description: "", hsn: null, batch: null, expiry_date: null,
  quantity: 1, free_quantity: 0, unit: null, mrp: null, rate: 0,
  discount_pct: 0, gst_rate: 0, cost_price: null,
});

function NewSalesInvoice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orderId, edit: editId } = Route.useSearch();
  const save = useServerFn(saveSalesInvoice);
  const getOrg = useServerFn(getCurrentOrg);

  const [orgState, setOrgState] = useState<string | null>(null);
  const [orgGstin, setOrgGstin] = useState<string | null>(null);
  const [orgMargin, setOrgMargin] = useState<number | null>(15);
  const [retailerId, setRetailerId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<RowDraft[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const prevRetailerRef = useRef("");

  // Edit mode: load the existing invoice + lines once.
  const editLoadedRef = useRef(false);
  useEffect(() => {
    if (!editId || editLoadedRef.current) return;
    editLoadedRef.current = true;
    (async () => {
      const [{ data: invRow }, { data: lineRows }] = await Promise.all([
        supabase.from("sales_invoices").select("*").eq("id", editId).single(),
        supabase.from("sales_invoice_lines").select("*").eq("sales_invoice_id", editId).order("line_no"),
      ]);
      if (!invRow) { toast.error(t("Invoice not found")); return; }
      setRetailerId(invRow.retailer_id);
      prevRetailerRef.current = invRow.retailer_id;
      setInvoiceDate(invRow.invoice_date);
      setDueDate(invRow.due_date ?? "");
      setNotes(invRow.notes ?? "");
      setRows((lineRows ?? []).map(l => ({
        key: crypto.randomUUID(),
        product_id: l.product_id, description: l.description, hsn: l.hsn,
        batch: l.batch, expiry_date: l.expiry_date,
        quantity: Number(l.quantity), free_quantity: Number(l.free_quantity ?? 0),
        unit: l.unit, mrp: l.mrp != null ? Number(l.mrp) : null,
        rate: Number(l.rate), discount_pct: Number(l.discount_pct ?? 0),
        gst_rate: Number(l.gst_rate ?? 0), cost_price: l.cost_price != null ? Number(l.cost_price) : null,
      })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    (async () => {
      const { orgId } = await getOrg();
      const { data } = await supabase.from("organizations")
        .select("state_code, default_margin_pct, gstin").eq("id", orgId).single();
      if (data) {
        setOrgState(data.state_code ?? null);
        setOrgGstin(data.gstin ?? null);
        setOrgMargin(Number(data.default_margin_pct ?? 15));
      }
    })();
  }, [getOrg]);

  const { data: retailers } = useQuery({
    queryKey: ["retailers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("retailers")
        .select("id, name, state_code, default_discount_pct, gstin, category").order("name");
      if (error) throw error;
      return data as Retailer[];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products", "for-sale"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products")
        .select("id, name, sku, hsn, gst_rate, mrp, unit, selling_rate, purchase_rate, last_purchase_rate, avg_cost, default_margin_pct, current_stock, stock_group_id")
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: overrides } = useQuery({
    queryKey: ["price-overrides"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_price_overrides")
        .select("product_id, retailer_id, selling_rate, discount_pct");
      if (error) throw error;
      return data as PriceOverride[];
    },
  });

  const { data: stockGroups } = useQuery({
    queryKey: ["stock_groups", "for-sale"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_groups")
        .select("id, name, hsn_code, discount_a, discount_b, discount_c");
      if (error) throw error;
      return data as StockGroup[];
    },
  });

  const { data: order } = useQuery({
    queryKey: ["order-prefill", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase.from("orders")
        .select("id, retailer_id, order_number, status, order_lines(product_id, quantity, fulfilled_quantity)")
        .eq("id", orderId!).single();
      if (error) throw error;
      return data;
    },
  });

  const retailer = retailers?.find(r => r.id === retailerId) ?? null;
  const { isInterstate, known: statesKnown } = splitGst(orgState, retailer?.state_code);


  const computed = useMemo(() => rows.map(r => ({ ...r, ...computeLine(r, isInterstate) })), [rows, isInterstate]);
  const totals = useMemo(() => computeInvoiceTotals(computed), [computed]);

  // Mirrors the server guard in issueSalesInvoice. Tax on the invoice is what
  // makes the state pair matter: a bill of supply with no GST is fine without
  // either, which is how an unregistered dealer legitimately bills.
  const blockIssue = (() => {
    if (!retailerId) return null;                 // nothing to judge yet
    if (totals.tax_total <= 0) return null;        // no tax, no head to get wrong
    const missing: string[] = [];
    if (!orgGstin?.trim()) missing.push(t("your own GSTIN is not set (Account)"));
    if (!orgState?.trim()) missing.push(t("your own state code is not set (Account)"));
    if (!retailer?.state_code?.trim()) {
      missing.push(t("{{name}} has no state code (Retailers)", { name: retailer?.name ?? t("this retailer") }));
    }
    if (!missing.length) return null;
    return t("{{reasons}}. Without both state codes there is no way to tell IGST from CGST/SGST, and issuing would lock in a guess. Save it as a draft, fill these in, then issue.",
      { reasons: missing.join(", and ") });
  })();

  // Rate + discount for a product: override rate chain, then discount from
  // override → stock group × retailer category → retailer default.
  const priceLine = (p: Product, ret: Retailer | null) => {
    const s = suggestPrice(p, ret?.id ?? null, overrides ?? [], orgMargin);
    const group = stockGroups?.find(g => g.id === p.stock_group_id) ?? null;
    const discount = s.discountPct
      ?? stockGroupDiscount(group, ret?.category)
      ?? Number(ret?.default_discount_pct ?? 0);
    return {
      product_id: p.id,
      description: p.name,
      hsn: p.hsn,
      unit: p.unit,
      mrp: p.mrp ? Number(p.mrp) : null,
      rate: s.rate,
      discount_pct: discount,
      gst_rate: Number(p.gst_rate ?? 0),
      cost_price: Number(p.avg_cost ?? p.last_purchase_rate ?? p.purchase_rate ?? 0),
    };
  };

  const pickProduct = (rowKey: string, productId: string) => {
    const p = products?.find(x => x.id === productId);
    if (!p) return;
    setRows(rs => rs.map(r => r.key === rowKey ? { ...r, ...priceLine(p, retailer) } : r));
  };

  // Re-resolve rates/discounts on the rows when the retailer changes —
  // category discounts and dealer overrides differ per retailer.
  useEffect(() => {
    if (retailerId === prevRetailerRef.current) return;
    if (!retailer) return;
    prevRetailerRef.current = retailerId;
    setRows(rs => rs.map(r => {
      const p = products?.find(x => x.id === r.product_id);
      return p ? { ...r, ...priceLine(p, retailer) } : r;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retailerId, retailer, products, overrides, stockGroups, orgMargin]);

  // Prefill from an order (?orderId=): lock in the retailer and load its
  // pending lines with qty capped at available stock.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || editId) return;
    if (!orderId || !order || !products || !retailers || !stockGroups || !overrides) return;
    prefilledRef.current = true;
    prevRetailerRef.current = order.retailer_id;
    setRetailerId(order.retailer_id);
    const ret = retailers.find(r => r.id === order.retailer_id) ?? null;
    const prefillRows: RowDraft[] = [];
    for (const ol of order.order_lines ?? []) {
      const p = products.find(x => x.id === ol.product_id);
      if (!p) continue;
      const pending = Number(ol.quantity) - Number(ol.fulfilled_quantity ?? 0);
      if (pending <= 0) continue;
      const qty = Math.max(0, Math.min(pending, Number(p.current_stock ?? 0)));
      prefillRows.push({ ...blankRow(), ...priceLine(p, ret), quantity: qty });
    }
    if (prefillRows.length) setRows(prefillRows);
    setNotes(n => n || `Against order ${order.order_number}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order, products, retailers, stockGroups, overrides]);

  const updateRow = (key: string, patch: Partial<RowDraft>) =>
    setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));

  const removeRow = (key: string) => setRows(rs => rs.filter(r => r.key !== key));
  const addRow = () => setRows(rs => [...rs, blankRow()]);

  const submit = async (status: "draft" | "issued") => {
    if (!retailerId) { toast.error(t("Pick a retailer")); return; }
    if (!computed.length || computed.every(r => !r.description)) { toast.error(t("Add at least one line")); return; }
    setSaving(true);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        order_id: orderId ?? null,
        retailer_id: retailerId,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        place_of_supply: retailer?.state_code ?? null,
        is_interstate: isInterstate,
        notes: notes || null,
        status,
        ...totals,
        lines: computed
          .filter(r => r.description && r.quantity > 0)
          .map((r, i) => {
            const { key, ...rest } = r; void key;
            return { ...rest, line_no: i + 1 };
          }),
      };
      const res = await save({ data: payload });
      toast.success(editId ? t("Invoice {{n}} updated", { n: res.invoice_number })
        : status === "issued" ? t("Invoice {{n}} issued", { n: res.invoice_number })
        : t("Invoice {{n}} saved as draft", { n: res.invoice_number }));
      navigate({ to: "/sales/$id", params: { id: res.id! } });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{editId ? t("Edit sales invoice") : t("New sales invoice")}</h1>
          <p className="text-muted-foreground mt-1">
            {order ? `${t("Against order")} ${order.order_number} · ` : ""}
            {statesKnown
              ? isInterstate ? t("Inter-state (IGST)") : t("Intra-state (CGST + SGST)")
              : t("Tax head unknown")}
            {orgState ? ` · ${t("From state")} ${orgState}` : ` · ${t("Set your organization state code in settings")}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => submit("draft")} disabled={saving}><Save className="h-4 w-4 mr-2"/>{t("Save draft")}</Button>
          <Button onClick={() => submit("issued")} disabled={saving || blockIssue !== null}
            title={blockIssue ?? undefined}>
            <Send className="h-4 w-4 mr-2"/>{t("Issue invoice")}
          </Button>
        </div>
      </div>

      {/* Said here rather than only on the server, so nobody keys a whole
          invoice before finding out it cannot be issued. The draft still
          saves. */}
      {blockIssue && (
        <div className="mt-4 flex gap-3 rounded-lg border border-amber-400/60 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">{t("This invoice cannot be issued yet")}</p>
            <p className="mt-0.5 text-muted-foreground">{blockIssue}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{t("Bill to")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label>{t("Retailer *")}</Label>
            <Select value={retailerId} onValueChange={setRetailerId}>
              <SelectTrigger><SelectValue placeholder={t("Choose retailer")} /></SelectTrigger>
              <SelectContent>
                {retailers?.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}{r.state_code ? ` — ${r.state_code}` : ""}{r.gstin ? ` · ${r.gstin}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("Invoice date")}</Label>
            <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <Label>{t("Due date")}</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("Line items")}</CardTitle>
          <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-4 w-4 mr-2"/>{t("Add row")}</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">{t("Product")}</TableHead>
                <TableHead>{t("HSN")}</TableHead>
                <TableHead>{t("Batch")}</TableHead>
                <TableHead className="w-20">{t("Qty")}</TableHead>
                <TableHead className="w-20">{t("Disc%")}</TableHead>
                <TableHead className="w-20">{t("GST%")}</TableHead>
                <TableHead className="text-right">{t("Taxable")}</TableHead>
                <TableHead className="text-right">{t("Tax")}</TableHead>
                <TableHead className="text-right">{t("Total")}</TableHead>
                <TableHead className="text-right text-success">{t("Profit")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {computed.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <Select value={r.product_id ?? ""} onValueChange={(v) => pickProduct(r.key, v)}>
                      <SelectTrigger><SelectValue placeholder={r.description || t("Pick product")} /></SelectTrigger>
                      <SelectContent>
                        {products?.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}{p.current_stock != null ? ` · ${t("stock")} ${p.current_stock}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input value={r.hsn ?? ""} onChange={e => updateRow(r.key, { hsn: e.target.value })} /></TableCell>
                  <TableCell><Input value={r.batch ?? ""} onChange={e => updateRow(r.key, { batch: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" value={r.quantity} onChange={e => updateRow(r.key, { quantity: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" value={r.discount_pct} onChange={e => updateRow(r.key, { discount_pct: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" value={r.gst_rate} onChange={e => updateRow(r.key, { gst_rate: Number(e.target.value) })} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.taxable_value.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tax_amount.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.line_total.toFixed(2)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{r.profit.toFixed(2)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => removeRow(r.key)}><Trash2 className="h-3.5 w-3.5"/></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{t("Notes")}</CardTitle></CardHeader>
          <CardContent>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Terms, transport, remarks…")} rows={5} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("Totals")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Line label={t("Subtotal")} v={totals.subtotal} />
            <Line label={t("Discount")} v={-totals.discount_total} />
            {isInterstate
              ? <Line label="IGST" v={totals.igst_total} />
              : <><Line label="CGST" v={totals.cgst_total} /><Line label="SGST" v={totals.sgst_total} /></>
            }
            <Line label={t("Round off")} v={totals.round_off} />
            <div className="border-t pt-2 mt-2 flex justify-between text-lg font-semibold">
              <span>{t("Grand total")}</span>
              <span className="tabular-nums">₹ {totals.grand_total.toLocaleString("en-IN")}</span>
            </div>
            <div className="text-xs text-muted-foreground italic pt-1">{amountInWords(totals.grand_total)}</div>
            <div className="border-t pt-2 mt-2 flex justify-between">
              <span className="text-muted-foreground">{t("Cost")}</span>
              <span className="tabular-nums">₹ {totals.total_cost.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between font-medium text-success">
              <span>{t("Profit")}</span>
              <span className="tabular-nums">₹ {totals.total_profit.toLocaleString("en-IN")}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">₹ {v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
