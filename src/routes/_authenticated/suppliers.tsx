import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentOrg } from "@/lib/org.functions";
import { verifyGstin } from "@/lib/gstin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Ledgerly" }] }),
  component: Suppliers,
});

type GstInfo = {
  valid: boolean; formatOk: boolean; state: string | null; stateCode: string;
  legalName: string | null; tradeName: string | null;
  status: string | null; filerRating: string | null; source: "format" | "api"; proRequired?: boolean;
};

function Suppliers() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const checkGstin = useServerFn(verifyGstin);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", gstin: "", contact: "", address: "", gst_status: "", gst_filer_rating: "" });
  const [gst, setGst] = useState<GstInfo | null>(null);
  const [gstChecking, setGstChecking] = useState(false);

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
            gst_status: info.status ?? "",
            gst_filer_rating: info.filerRating ?? "",
          };
        });
      } catch { setGst(null); }
      finally { setGstChecking(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [form.gstin, checkGstin]);

  const { data } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
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
    try {
      const { orgId } = await getOrg();
      const { error } = await supabase.from("suppliers").insert({
        org_id: orgId,
        name: form.name, gstin: form.gstin || null, contact: form.contact || null, address: form.address || null,
        gst_status: form.gst_status || null, gst_filer_rating: form.gst_filer_rating || null,
      });
      if (error) throw error;
      toast.success(t("Supplier added"));
      setOpen(false);
      setForm({ name: "", gstin: "", contact: "", address: "", gst_status: "", gst_filer_rating: "" });
      setGst(null);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Suppliers")}</h1>
          <p className="text-muted-foreground mt-1">{t("Manufacturers and distributors you buy from.")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> {t("New supplier")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("Add supplier")}</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (form.name) submit(); }}>
              <Input placeholder={t("Name")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <div>
                <Input placeholder="GSTIN" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
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
                        </span>
                      </>
                    ) : (
                      <><XCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{t("Invalid GSTIN (check digits)")}</span></>
                    )
                  ) : null}
                </div>
              </div>
              <Input placeholder={t("Contact")} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
              <Input placeholder={t("Address")} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <DialogFooter><Button type="submit" disabled={!form.name}>{t("Save")}</Button></DialogFooter>
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
                  <TableCell className="text-muted-foreground">{s.address}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {(balances.get(s.id) ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right">
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
