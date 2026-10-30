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
import { Trash2, Plus, Save, Send, AlertTriangle, Columns3 } from "lucide-react";
import { BillColumnsDialog } from "@/components/bill-columns-dialog";
import {
  layoutForNewBill, normaliseLayout, builtIn, isCustom, customId, headingFor,
  MAX_VALUE_LEN, type BillLayout,
} from "@/lib/bill-columns";
import { useTranslation } from "react-i18next";
import { describeError } from "@/lib/offline";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sales/new")({
  head: () => ({ meta: [{ title: "New sales bill - Dhela" }] }),
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

type RowDraft = SalesLineDraft & { key: string; extra: Record<string, string> };

const blankRow = (): RowDraft => ({
  key: crypto.randomUUID(),
  product_id: null, description: "", hsn: null, batch: null, expiry_date: null,
  quantity: 1, free_quantity: 0, unit: null, mrp: null, rate: 0,
  discount_pct: 0, gst_rate: 0, cost_price: null, extra: {},
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
  /*
   * The layout starts as the workspace default and is saved onto this bill.
   * Changing it here is a one-off: the workspace default is only edited on
   * Account, so tweaking one bill never silently re-formats the next one.
   */
  const [layout, setLayout] = useState<BillLayout>(layoutForNewBill(null));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [billFields, setBillFields] = useState<{ label: string; value: string }[]>([]);
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
      if (!invRow) { toast.error(t("Bill not found")); return; }
      setRetailerId(invRow.retailer_id);
      prevRetailerRef.current = invRow.retailer_id;
      setInvoiceDate(invRow.invoice_date);
      setDueDate(invRow.due_date ?? "");
      setNotes(invRow.notes ?? "");
      // A saved bill carries its own layout; keep editing it the way it prints.
      const saved = normaliseLayout((invRow as { bill_columns?: unknown }).bill_columns);
      if (saved.columns.length) setLayout(saved);
      const onBill = (invRow as { extra?: Record<string, string> | null }).extra ?? {};
      setBillFields([
        ...saved.fields.map(label => ({ label, value: onBill[label] ?? "" })),
        ...Object.entries(onBill)
          .filter(([label]) => !saved.fields.includes(label))
          .map(([label, value]) => ({ label, value })),
      ]);
      setRows((lineRows ?? []).map(l => ({
        key: crypto.randomUUID(),
        product_id: l.product_id, description: l.description, hsn: l.hsn,
        batch: l.batch, expiry_date: l.expiry_date,
        quantity: Number(l.quantity), free_quantity: Number(l.free_quantity ?? 0),
        unit: l.unit, mrp: l.mrp != null ? Number(l.mrp) : null,
        rate: Number(l.rate), discount_pct: Number(l.discount_pct ?? 0),
        gst_rate: Number(l.gst_rate ?? 0), cost_price: l.cost_price != null ? Number(l.cost_price) : null,
        extra: ((l as { extra?: Record<string, string> | null }).extra ?? {}),
      })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    (async () => {
      const { orgId } = await getOrg();
      const { data } = await supabase.from("organizations")
        .select("state_code, default_margin_pct, gstin, bill_columns").eq("id", orgId).single();
      if (data) {
        setOrgState(data.state_code ?? null);
        setOrgGstin(data.gstin ?? null);
        setOrgMargin(Number(data.default_margin_pct ?? 15));
        // Editing an existing bill loads that bill's own layout below; this
        // must not overwrite it with the workspace default.
        if (!editId) {
          const l = layoutForNewBill(data.bill_columns);
          setLayout(l);
          setBillFields(l.fields.map(label => ({ label, value: "" })));
        }
      }
    })();
  }, [getOrg, editId]);

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

  /*
   * Product is the description column, and the money columns are worked out
   * rather than typed, so what is left is the set this screen has to ask for.
   * Under the built-in layout that comes to HSN, Batch, Qty, Disc% and GST% —
   * the five inputs this table always had.
   */
  const entryCols = useMemo(
    () => layout.columns.filter(k => k !== "description" && (isCustom(k) || !!builtIn(k)?.input)),
    [layout],
  );
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

  /** Adopt any default field the layout names that this bill does not have yet. */
  const applyLayout = (next: BillLayout) => {
    setLayout(next);
    setBillFields(cur => [
      ...cur,
      ...next.fields.filter(f => !cur.some(c => c.label === f)).map(label => ({ label, value: "" })),
    ]);
    setColumnsOpen(false);
  };

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
        // Copied onto the bill, so a reprint months from now is this document
        // and not whatever the workspace default has become since.
        bill_columns: layout,
        extra: Object.fromEntries(
          billFields
            .map(f => [f.label.trim(), f.value.trim()] as const)
            .filter(([label, value]) => label && value),
        ),
        ...totals,
        lines: computed
          .filter(r => r.description && r.quantity > 0)
          .map((r, i) => {
            const { key, ...rest } = r; void key;
            return { ...rest, line_no: i + 1 };
          }),
      };
      const res = await save({ data: payload });
      toast.success(editId ? t("Bill {{n}} updated", { n: res.invoice_number })
        : status === "issued" ? t("Bill {{n}} issued", { n: res.invoice_number })
        : t("Bill {{n}} saved as draft", { n: res.invoice_number }));
      navigate({ to: "/sales/$id", params: { id: res.id! } });
    } catch (e) { toast.error(describeError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{editId ? t("Edit sales bill") : t("New sales bill")}</h1>
          <p className="text-muted-foreground mt-1">
            {order ? `${t("Against order")} ${order.order_number} · ` : ""}
            {statesKnown
              ? isInterstate ? t("Inter-state (IGST)") : t("Intra-state (CGST + SGST)")
              : t("Tax head unknown")}
            {orgState ? ` · ${t("From state")} ${orgState}` : ` · ${t("Set your organization state code in settings")}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setColumnsOpen(true)}>
            <Columns3 className="h-4 w-4 mr-2"/>{t("Columns")}
          </Button>
          <Button variant="outline" onClick={() => submit("draft")} disabled={saving}><Save className="h-4 w-4 mr-2"/>{t("Save draft")}</Button>
          <Button onClick={() => submit("issued")} disabled={saving || blockIssue !== null}
            title={blockIssue ?? undefined}>
            <Send className="h-4 w-4 mr-2"/>{t("Issue bill")}
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
            <p className="font-medium">{t("This bill cannot be issued yet")}</p>
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
            <Label>{t("Bill date")}</Label>
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
                {/* Exactly the columns this bill prints that somebody has to
                    type. Switch Expiry on and the input appears here; switch
                    Batch off and it stops being asked for. */}
                {entryCols.map(key => (
                  <TableHead key={key} className={widthFor(key)}>
                    {isCustom(key) ? headingFor(key, layout) : t(headingFor(key, layout))}
                  </TableHead>
                ))}
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
                  {entryCols.map(key => (
                    <TableCell key={key}>
                      <LineField col={key} row={r} onChange={patch => updateRow(r.key, patch)}
                        label={isCustom(key) ? headingFor(key, layout) : t(headingFor(key, layout))} />
                    </TableCell>
                  ))}
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

      {billFields.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("Bill details")}</CardTitle>
            <Button size="sm" variant="outline"
              onClick={() => setBillFields(f => [...f, { label: "", value: "" }])}>
              <Plus className="h-4 w-4 mr-2"/>{t("Add a field")}
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {billFields.map((f, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="w-40 shrink-0">
                  <Label className="text-xs">{t("Field")}</Label>
                  <Input aria-label={t("Field name")} value={f.label} placeholder={t("Transport")}
                    onChange={e => setBillFields(cur => cur.map((c, n) => n === i ? { ...c, label: e.target.value } : c))} />
                </div>
                <div className="min-w-0 flex-1">
                  <Label className="text-xs">{t("Value")}</Label>
                  <Input aria-label={t("Field value")} value={f.value} maxLength={MAX_VALUE_LEN}
                    onChange={e => setBillFields(cur => cur.map((c, n) => n === i ? { ...c, value: e.target.value } : c))} />
                </div>
                <Button size="sm" variant="ghost" className="text-destructive"
                  onClick={() => setBillFields(cur => cur.filter((_, n) => n !== i))}>
                  <Trash2 className="h-3.5 w-3.5"/>
                </Button>
              </div>
            ))}
            {/* An empty value is left off the printed bill rather than
                printing a heading with nothing after it. */}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("Printed above the totals. A field you leave blank is not printed.")}
            </p>
          </CardContent>
        </Card>
      )}

      {billFields.length === 0 && (
        <Button variant="outline" size="sm"
          onClick={() => setBillFields([{ label: "", value: "" }])}>
          <Plus className="h-4 w-4 mr-2"/>{t("Add a bill field (transport, LR number…)")}
        </Button>
      )}

      <BillColumnsDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        layout={layout}
        scope="bill"
        onSave={applyLayout}
      />

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

/** Narrow inputs for the short numeric columns, so the row still fits. */
function widthFor(key: string) {
  const i = isCustom(key) ? null : builtIn(key)?.input;
  if (i === "number") return "w-24";
  if (i === "date") return "w-40";
  return "";
}

/**
 * One typed cell on the entry row.
 *
 * Every branch writes a real typed field except the custom one, which writes
 * free text into `extra`. That split is the whole point: expiry goes into
 * `expiry_date` where a report can find it, not into a column named "Expiry"
 * that only a human will ever read.
 */
function LineField({ col, row, onChange, label }: {
  col: string;
  row: RowDraft;
  onChange: (patch: Partial<RowDraft>) => void;
  /** The column heading, so the input is named for a screen reader. */
  label: string;
}) {
  const a = { "aria-label": label };
  if (isCustom(col)) {
    const id = customId(col);
    return (
      <Input {...a} value={row.extra?.[id] ?? ""} maxLength={MAX_VALUE_LEN}
        onChange={e => onChange({ extra: { ...row.extra, [id]: e.target.value } })} />
    );
  }
  const num = (v: string) => Number(v === "" ? 0 : v);
  switch (col) {
    case "hsn": return <Input {...a} value={row.hsn ?? ""} onChange={e => onChange({ hsn: e.target.value })} />;
    case "batch": return <Input {...a} value={row.batch ?? ""} onChange={e => onChange({ batch: e.target.value })} />;
    case "unit": return <Input {...a} value={row.unit ?? ""} onChange={e => onChange({ unit: e.target.value || null })} />;
    case "expiry_date": return <Input {...a} type="date" value={row.expiry_date ?? ""}
      onChange={e => onChange({ expiry_date: e.target.value || null })} />;
    case "quantity": return <Input {...a} type="number" value={row.quantity}
      onChange={e => onChange({ quantity: num(e.target.value) })} />;
    case "free_quantity": return <Input {...a} type="number" value={row.free_quantity}
      onChange={e => onChange({ free_quantity: num(e.target.value) })} />;
    case "mrp": return <Input {...a} type="number" value={row.mrp ?? ""}
      onChange={e => onChange({ mrp: e.target.value === "" ? null : Number(e.target.value) })} />;
    case "discount_pct": return <Input {...a} type="number" value={row.discount_pct}
      onChange={e => onChange({ discount_pct: num(e.target.value) })} />;
    case "gst_rate": return <Input {...a} type="number" value={row.gst_rate}
      onChange={e => onChange({ gst_rate: num(e.target.value) })} />;
    default: return null;
  }
}

function Line({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">₹ {v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
