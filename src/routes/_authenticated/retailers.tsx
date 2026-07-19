import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { upsertRetailer, deleteRetailer } from "@/lib/retailers.functions";
import { verifyGstin } from "@/lib/gstin.functions";
import { GstHint, GstFilerField, useFlash } from "@/components/gst-fields";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  gst_status: string | null; gst_filer_rating: string | null;
  gst_legal_name: string | null; gst_constitution: string | null;
  gst_taxpayer_type: string | null; gst_registration_date: string | null;
};

const empty = {
  name: "", gstin: "", phone: "", email: "", address: "", city: "",
  state_code: "", pincode: "", category: "C" as "A" | "B" | "C",
  default_discount_pct: "", credit_limit: "", notes: "",
  gst_status: "", gst_filer_rating: "",
  gst_legal_name: "", gst_constitution: "", gst_taxpayer_type: "", gst_registration_date: "",
};

type GstInfo = {
  valid: boolean; formatOk: boolean; state: string | null; stateCode: string;
  legalName: string | null; tradeName: string | null;
  status: string | null; filerRating: string | null;
  constitution: string | null; taxpayerType: string | null; registrationDate: string | null;
  address: string | null; city: string | null; pincode: string | null;
  source: "format" | "api"; proRequired?: boolean; lookupUnavailable?: boolean;
};

function RetailersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useServerFn(upsertRetailer);
  const remove = useServerFn(deleteRetailer);
  const checkGstin = useServerFn(verifyGstin);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Retailer | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [gst, setGst] = useState<GstInfo | null>(null);
  const [gstChecking, setGstChecking] = useState(false);
  const [flash, triggerFlash] = useFlash();

  // Verify GSTIN (debounced) whenever a full 15-char GSTIN is present.
  useEffect(() => {
    const g = form.gstin.trim().toUpperCase();
    if (g.length !== 15) { setGst(null); return; }
    const timer = setTimeout(async () => {
      setGstChecking(true);
      try {
        const info = await checkGstin({ data: { gstin: g } }) as GstInfo;
        setGst(info);
        setForm(f => {
          const next = { ...f };
          if (info.stateCode) next.state_code = info.stateCode;
          const apiName = info.tradeName || info.legalName;
          if (apiName && !f.name.trim()) next.name = apiName;
          if (info.address && !f.address.trim()) next.address = info.address;
          if (info.city && !f.city.trim()) next.city = info.city;
          if (info.pincode && !f.pincode.trim()) next.pincode = info.pincode;
          next.gst_status = info.status ?? "";
          next.gst_filer_rating = info.filerRating ?? "";
          next.gst_legal_name = info.legalName ?? "";
          next.gst_constitution = info.constitution ?? "";
          next.gst_taxpayer_type = info.taxpayerType ?? "";
          next.gst_registration_date = info.registrationDate ?? "";
          return next;
        });
        if (info.valid) triggerFlash();
      } catch { setGst(null); }
      finally { setGstChecking(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [form.gstin, checkGstin]);

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

  const openNew = () => { setEditing(null); setForm(empty); setGst(null); setOpen(true); };
  const openEdit = (r: Retailer) => {
    setEditing(r);
    setGst(null);
    setForm({
      name: r.name, gstin: r.gstin ?? "", phone: r.phone ?? "", email: r.email ?? "",
      address: r.address ?? "", city: r.city ?? "", state_code: r.state_code ?? "",
      pincode: r.pincode ?? "", category: r.category ?? "C",
      default_discount_pct: r.default_discount_pct != null ? String(r.default_discount_pct) : "",
      credit_limit: r.credit_limit != null ? String(r.credit_limit) : "", notes: r.notes ?? "",
      gst_status: r.gst_status ?? "", gst_filer_rating: r.gst_filer_rating ?? "",
      gst_legal_name: r.gst_legal_name ?? "", gst_constitution: r.gst_constitution ?? "",
      gst_taxpayer_type: r.gst_taxpayer_type ?? "", gst_registration_date: r.gst_registration_date ?? "",
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
        gst_status: form.gst_status || null,
        gst_filer_rating: form.gst_filer_rating || null,
        gst_legal_name: form.gst_legal_name || null,
        gst_constitution: form.gst_constitution || null,
        gst_taxpayer_type: form.gst_taxpayer_type || null,
        gst_registration_date: form.gst_registration_date || null,
      }});
      toast.success(editing ? t("Retailer updated") : t("Retailer added"));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["retailers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const del = async (id: string) => {
    if (!confirm(t("Delete retailer? Their past invoices remain."))) return;
    try {
      await remove({ data: { id } });
      qc.invalidateQueries({ queryKey: ["retailers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Retailers")}</h1>
          <p className="text-muted-foreground mt-1">{t("Your customer master. Used to bill and calculate GST split.")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> {t("New retailer")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? t("Edit retailer") : t("Add retailer")}</DialogTitle></DialogHeader>
            <form className="grid grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); if (form.name) submit(); }}>
              <GstHint show={!editing && !form.gstin.trim()} className="col-span-2" />
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("Business name *")}</label>
                <Input className={cn(flash && "field-flash")} placeholder={t("e.g. Sharma General Store")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("GSTIN")}</label>
                <Input className={cn(!form.gstin.trim() && "gstin-attract")} placeholder={t("15-character GST number")} value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
                <div className="text-xs mt-1 min-h-[16px] flex items-center gap-1.5">
                  {gstChecking ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-muted-foreground">{t("Checking GSTIN…")}</span></>
                  ) : gst ? (
                    gst.valid ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                        <span className="text-muted-foreground">
                          {gst.state ?? gst.stateCode}
                          {gst.legalName || gst.tradeName ? ` · ${gst.tradeName ?? gst.legalName}` : ""}
                          {gst.status ? ` · ${gst.status}` : ""}
                          {gst.filerRating && gst.filerRating !== "Unrated" ? ` · ${t("Filer")}: ${gst.filerRating}` : ""}
                          {gst.proRequired ? <> · <Link to="/billing" className="text-primary hover:underline">{t("Get business name + filer rating on Pro")}</Link></> : null}
                          {gst.lookupUnavailable ? <> · <span className="text-amber-700">{t("live lookup unavailable — add paid GST-API credits")}</span></> : null}
                        </span>
                      </>
                    ) : (
                      <><XCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{t("Invalid GSTIN (check digits)")}</span></>
                    )
                  ) : null}
                </div>
                {gst?.valid && (gst.constitution || gst.taxpayerType || gst.registrationDate) && (
                  <div className="text-xs text-muted-foreground mt-1 space-x-2">
                    {gst.constitution && <span>{gst.constitution}</span>}
                    {gst.taxpayerType && <span>· {gst.taxpayerType}</span>}
                    {gst.registrationDate && <span>· {t("Reg")}: {gst.registrationDate}</span>}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("State code")}</label>
                <Input className={cn(flash && "field-flash")} placeholder={t("e.g. 27 for Maharashtra")} value={form.state_code} onChange={e => setForm({ ...form, state_code: e.target.value })} />
              </div>
              <GstFilerField className="col-span-2" flash={flash} status={form.gst_status} rating={form.gst_filer_rating} taxpayerType={form.gst_taxpayer_type} />
              <div>
                <label className="text-xs text-muted-foreground">{t("Phone")}</label>
                <Input placeholder={t("Mobile / landline")} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Email")}</label>
                <Input placeholder="billing@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("Address")}</label>
                <Textarea className={cn(flash && "field-flash")} placeholder={t("Street, area, landmark")} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("City")}</label>
                <Input className={cn(flash && "field-flash")} placeholder={t("City / town")} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Pincode")}</label>
                <Input className={cn(flash && "field-flash")} placeholder={t("6-digit PIN")} value={form.pincode} onChange={e => setForm({ ...form, pincode: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Retailer category (discount tier)")}</label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as "A" | "B" | "C" })}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">{t("Category A — best discounts")}</SelectItem>
                    <SelectItem value="B">{t("Category B")}</SelectItem>
                    <SelectItem value="C">{t("Category C — standard")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("Default discount % (fallback)")}</label>
                <Input type="number" placeholder={t("Used when no group discount")} value={form.default_discount_pct} onChange={e => setForm({ ...form, default_discount_pct: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("Credit limit (₹)")}</label>
                <Input type="number" placeholder={t("0 = no limit")} value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("Notes")}</label>
                <Textarea placeholder={t("Anything worth remembering")} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={!form.name}>{t("Save")}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("Customers ({{n}})", { n: data?.length ?? 0 })}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Name")}</TableHead><TableHead>{t("GSTIN")}</TableHead>
              <TableHead>{t("City/State")}</TableHead><TableHead>{t("Category")}</TableHead>
              <TableHead>{t("GST filer")}</TableHead>
              <TableHead>{t("Phone")}</TableHead>
              <TableHead className="text-right">{t("Credit")}</TableHead>
              <TableHead className="text-right">{t("Outstanding")}</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.gstin ?? "—"}</TableCell>
                  <TableCell>{[r.city, r.state_code].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell><span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-semibold">{r.category ?? "C"}</span></TableCell>
                  <TableCell><FilerBadge rating={r.gst_filer_rating} /></TableCell>
                  <TableCell>{r.phone ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {Number(r.credit_limit ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {(balances.get(r.id) ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Link to="/statement" search={{ party: "retailer", id: r.id }}>
                      <Button size="sm" variant="ghost" title={t("Account statement")}><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">{t("No retailers yet.")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilerBadge({ rating }: { rating: string | null }) {
  const { t } = useTranslation();
  if (!rating) return <span className="text-muted-foreground">—</span>;
  const cls = rating === "Good" ? "bg-green-100 text-green-800"
    : rating === "Average" ? "bg-amber-100 text-amber-800"
    : rating === "Poor" || rating === "Defaulter" ? "bg-red-100 text-red-800"
    : "bg-muted text-muted-foreground";
  return <Badge variant="secondary" className={cls}>{t(rating)}</Badge>;
}
