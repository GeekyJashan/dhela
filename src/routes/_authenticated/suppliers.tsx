import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentOrg } from "@/lib/org.functions";
import { verifyGstin } from "@/lib/gstin.functions";
import { GstHint, GstFilerField, useFlash } from "@/components/gst-fields";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ExtraInfo } from "@/components/extra-info";
import { toast } from "sonner";
import { Plus, FileText, CheckCircle2, XCircle, Loader2, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Dhela" }] }),
  component: Suppliers,
});

type GstInfo = {
  valid: boolean; formatOk: boolean; state: string | null; stateCode: string;
  legalName: string | null; tradeName: string | null;
  status: string | null; filerRating: string | null;
  constitution: string | null; taxpayerType: string | null; registrationDate: string | null;
  address: string | null; city: string | null; pincode: string | null;
  source: "format" | "api"; proRequired?: boolean; lookupUnavailable?: boolean;
};

function Suppliers() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const checkGstin = useServerFn(verifyGstin);
  const [open, setOpen] = useState(false);
  const [extraFor, setExtraFor] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ name: "", gstin: "", contact: "", address: "", state_code: "", city: "", pincode: "", gst_status: "", gst_filer_rating: "", gst_legal_name: "", gst_constitution: "", gst_taxpayer_type: "", gst_registration_date: "" });
  const [gst, setGst] = useState<GstInfo | null>(null);
  const [gstChecking, setGstChecking] = useState(false);
  const [flash, triggerFlash] = useFlash();
  const gstinRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const g = form.gstin.trim().toUpperCase();
    if (g.length !== 15) { setGst(null); return; }
    const timer = setTimeout(async () => {
      setGstChecking(true);
      try {
        const info = await checkGstin({ data: { gstin: g } }) as GstInfo;
        setGst(info);
        setForm(f => {
          const apiName = info.tradeName || info.legalName;
          return {
            ...f,
            name: apiName && !f.name.trim() ? apiName : f.name,
            address: info.address && !f.address.trim() ? info.address : f.address,
            state_code: info.stateCode || f.state_code,
            city: info.city && !f.city.trim() ? info.city : f.city,
            pincode: info.pincode && !f.pincode.trim() ? info.pincode : f.pincode,
            gst_status: info.status ?? "",
            gst_filer_rating: info.filerRating ?? "",
            gst_legal_name: info.legalName ?? "",
            gst_constitution: info.constitution ?? "",
            gst_taxpayer_type: info.taxpayerType ?? "",
            gst_registration_date: info.registrationDate ?? "",
          };
        });
        if (info.valid) triggerFlash();
      } catch { setGst(null); }
      finally { setGstChecking(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [form.gstin, checkGstin]);

  const { data } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      // Named rather than "*" so the `extra` blob is not fetched for every
      // supplier just to be shown on none of them — it is read per record.
      const { data, error } = await supabase.from("suppliers")
        .select("id, name, gstin, contact, address, city, state_code, gst_filer_rating, has_extra").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Live payables from the ledger view (purchases − payments + opening).
  const { data: balanceRows } = useQuery({
    queryKey: ["party_balances", "supplier"],
    queryFn: async () => {
      const { data } = await supabase.from("party_balances")
        .select("party_id, balance").eq("party_type", "supplier");
      return data ?? [];
    },
  });
  const balances = new Map(balanceRows?.map(b => [b.party_id, Number(b.balance ?? 0)]));

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { orgId } = await getOrg();
      // Duplicate guard: by GSTIN when present, else by name (case-insensitive).
      const gstin = form.gstin.trim();
      let dupQ = supabase.from("suppliers").select("id").eq("org_id", orgId).limit(1);
      dupQ = gstin ? dupQ.eq("gstin", gstin) : dupQ.ilike("name", form.name.trim());
      const { data: dup } = await dupQ;
      if (dup && dup.length > 0) {
        toast.error(gstin ? t("A supplier with this GSTIN already exists") : t("A supplier with this name already exists"));
        return;
      }
      const { error } = await supabase.from("suppliers").insert({
        org_id: orgId,
        name: form.name, gstin: form.gstin || null, contact: form.contact || null, address: form.address || null,
        state_code: form.state_code || null, city: form.city || null, pincode: form.pincode || null,
        gst_status: form.gst_status || null, gst_filer_rating: form.gst_filer_rating || null,
        gst_legal_name: form.gst_legal_name || null, gst_constitution: form.gst_constitution || null,
        gst_taxpayer_type: form.gst_taxpayer_type || null, gst_registration_date: form.gst_registration_date || null,
      });
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          toast.error(gstin ? t("A supplier with this GSTIN already exists") : t("A supplier with this name already exists"));
          return;
        }
        throw error;
      }
      toast.success(t("Supplier added"));
      setOpen(false);
      setForm({ name: "", gstin: "", contact: "", address: "", state_code: "", city: "", pincode: "", gst_status: "", gst_filer_rating: "", gst_legal_name: "", gst_constitution: "", gst_taxpayer_type: "", gst_registration_date: "" });
      setGst(null);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) { toast.error(describeError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Suppliers")}</h1>
          <p className="text-muted-foreground mt-1">{t("Manufacturers and distributors you buy from.")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> {t("New supplier")}</Button></DialogTrigger>
          <DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); gstinRef.current?.focus(); }}>
            <DialogHeader><DialogTitle>{t("Add supplier")}</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (form.name && gst?.valid && !gstChecking && !saving) submit(); }}>
              <GstHint show={!form.gstin.trim()} />
              <Input className={cn(flash && "field-flash")} placeholder={t("Name")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <div>
                <Input ref={gstinRef} className={cn(!form.gstin.trim() && "gstin-attract")} placeholder={t("GSTIN *")} value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
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
              <GstFilerField flash={flash} status={form.gst_status} rating={form.gst_filer_rating} taxpayerType={form.gst_taxpayer_type} />
              <Input placeholder={t("Contact")} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
              <Input className={cn(flash && "field-flash")} placeholder={t("Address")} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <div className="grid grid-cols-3 gap-3">
                <Input className={cn(flash && "field-flash")} placeholder={t("City / town")} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
                <Input className={cn(flash && "field-flash")} placeholder={t("6-digit PIN")} value={form.pincode} onChange={e => setForm({ ...form, pincode: e.target.value })} />
                <Input className={cn(flash && "field-flash")} placeholder={t("State code")} value={form.state_code} onChange={e => setForm({ ...form, state_code: e.target.value })} />
              </div>
              <DialogFooter className="items-center">
                {!gst?.valid && form.gstin.trim().length > 0 && !gstChecking && (
                  <span className="mr-auto text-xs text-destructive">{t("Enter a valid GSTIN to save")}</span>
                )}
                <Button type="submit" loading={saving} disabled={!form.name || gstChecking || !gst?.valid}
                  title={!gst?.valid ? t("A valid GSTIN is required") : undefined}>{saving ? t("Saving…") : t("Save")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("Suppliers ({{n}})", { n: data?.length ?? 0 })}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Name")}</TableHead><TableHead>{t("GSTIN")}</TableHead>
              <TableHead>{t("GST filer")}</TableHead>
              <TableHead>{t("Contact")}</TableHead><TableHead>{t("Address")}</TableHead>
              <TableHead className="text-right">{t("Payable")}</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.gstin ?? "—"}</TableCell>
                  <TableCell><FilerBadge rating={s.gst_filer_rating} /></TableCell>
                  <TableCell>{s.contact}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[s.address, [s.city, s.state_code].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">₹ {(balances.get(s.id) ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right">
                    {/* Only on the rows that actually carry something. The flag
                        is a generated boolean, so knowing this costs a byte
                        rather than fetching every supplier's blob. */}
                    {s.has_extra && (
                      <Button size="sm" variant="ghost" title={t("From your old system")}
                        onClick={() => setExtraFor(s)}>
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Link to="/statement" search={{ party: "supplier", id: s.id }}>
                      <Button size="sm" variant="ghost" title={t("Account statement")}><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("No suppliers yet.")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Suppliers have no edit screen, so without this the fields carried
          over from their old software would be stored and never seen — which
          is worse than dropping them, because the operator believes they still
          have them. */}
      <Dialog open={!!extraFor} onOpenChange={o => !o && setExtraFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{extraFor?.name}</DialogTitle></DialogHeader>
          <ExtraInfo table="suppliers" id={extraFor?.id} />
        </DialogContent>
      </Dialog>
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
