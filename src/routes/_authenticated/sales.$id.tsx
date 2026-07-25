import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { updateOrgInvoiceProfile } from "@/lib/org.functions";
import { amountInWords } from "@/lib/pricing";
import { EwayBillButton, EwayBillStamp, type EwayInvoice } from "@/components/eway-bill";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Printer, ArrowLeft, Undo2, Pencil, Landmark, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/sales/$id")({
  head: () => ({ meta: [{ title: "Sales invoice — Dhela" }] }),
  component: SalesInvoiceView,
});

type Org = {
  id?: string; name?: string; gstin?: string; address?: string; phone?: string;
  email?: string; state_code?: string;
  bank_name?: string; bank_account_no?: string; bank_ifsc?: string; bank_branch?: string; upi_id?: string;
  signatory_name?: string; signature_image?: string;
};

function SalesInvoiceView() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveProfile = useServerFn(updateOrgInvoiceProfile);

  const { data } = useQuery({
    queryKey: ["sales_invoice", id],
    queryFn: async () => {
      const [invRes, linesRes] = await Promise.all([
        supabase.from("sales_invoices").select("*, retailer:retailers(*), org:organizations(id, name, gstin, address, phone, email, state_code, bank_name, bank_account_no, bank_ifsc, bank_branch, upi_id, signatory_name, signature_image)").eq("id", id).single(),
        supabase.from("sales_invoice_lines").select("*").eq("sales_invoice_id", id).order("line_no"),
      ]);
      if (invRes.error) throw invRes.error;
      if (linesRes.error) throw linesRes.error;
      return { inv: invRes.data, lines: linesRes.data };
    },
  });

  const [bankOpen, setBankOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [bank, setBank] = useState({ bank_name: "", bank_account_no: "", bank_ifsc: "", bank_branch: "", upi_id: "" });
  const [sign, setSign] = useState({ signatory_name: "", signature_image: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  if (!data) return <div className="p-8 text-muted-foreground">{t("Loading…")}</div>;
  const { inv, lines } = data;
  const org = (inv.org ?? {}) as Org;
  const r = inv.retailer as { name?: string; gstin?: string; address?: string; state_code?: string; phone?: string; city?: string; pincode?: string };

  const hasBank = !!(org.bank_name || org.bank_account_no || org.upi_id);
  const hasSign = !!(org.signature_image || org.signatory_name);

  const openBank = () => {
    setBank({
      bank_name: org.bank_name ?? "", bank_account_no: org.bank_account_no ?? "",
      bank_ifsc: org.bank_ifsc ?? "", bank_branch: org.bank_branch ?? "", upi_id: org.upi_id ?? "",
    });
    setBankOpen(true);
  };
  const openSign = () => {
    setSign({ signatory_name: org.signatory_name ?? "", signature_image: org.signature_image ?? "" });
    setSignOpen(true);
  };

  const persist = async (patch: Record<string, string>, close: () => void) => {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await saveProfile({ data: patch });
      toast.success(t("Saved"));
      close();
      qc.invalidateQueries({ queryKey: ["sales_invoice", id] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingProfile(false); }
  };

  const onSignatureFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 300_000) { toast.error(t("Image too large — use a smaller PNG (< 300 KB)")); return; }
    const reader = new FileReader();
    reader.onload = () => setSign(s => ({ ...s, signature_image: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/sales" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("Back to sales")}
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openBank}><Landmark className="h-4 w-4 mr-2" /> {hasBank ? t("Edit bank details") : t("Add bank details")}</Button>
          <Button variant="outline" onClick={openSign}><PenLine className="h-4 w-4 mr-2" /> {hasSign ? t("Edit signature") : t("Add signature")}</Button>
          <Button variant="outline" onClick={() => navigate({ to: "/sales/new", search: { edit: id } })}>
            <Pencil className="h-4 w-4 mr-2" /> {t("Edit")}
          </Button>
          <EwayBillButton invoice={inv as unknown as EwayInvoice}
            onSaved={() => qc.invalidateQueries({ queryKey: ["sales_invoice", id] })} />
          {(inv.status === "issued" || inv.status === "paid") && (
            <Link to="/returns" search={{ invoiceId: id }}>
              <Button variant="outline"><Undo2 className="h-4 w-4 mr-2" /> {t("Return items")}</Button>
            </Link>
          )}
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> {t("Print / Save PDF")}</Button>
        </div>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardContent className="p-10 space-y-8 print:p-0">
          <div className="flex items-start justify-between border-b pb-6">
            <div>
              <h2 className="text-2xl font-bold">{org?.name ?? "Your Company"}</h2>
              {org?.address && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{org.address}</p>}
              <p className="text-sm mt-1">
                {org?.gstin && <>GSTIN: <span className="font-mono">{org.gstin}</span> · </>}
                {org?.state_code && <>State: {org.state_code} · </>}
                {org?.phone}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("Tax Invoice")}</p>
              <p className="text-xl font-bold">{inv.invoice_number}</p>
              <p className="text-sm">{t("Date")}: {inv.invoice_date}</p>
              {inv.due_date && <p className="text-sm">{t("Due")}: {inv.due_date}</p>}
              <Badge className="mt-2">{t(inv.status)}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("Bill To")}</p>
              <p className="font-semibold">{r?.name}</p>
              {r?.address && <p className="text-sm whitespace-pre-line">{r.address}</p>}
              <p className="text-sm">{[r?.city, r?.pincode].filter(Boolean).join(" - ")}</p>
              {r?.state_code && <p className="text-sm">{t("State")}: {r.state_code}</p>}
              {r?.gstin && <p className="text-sm">GSTIN: <span className="font-mono">{r.gstin}</span></p>}
              {r?.phone && <p className="text-sm">{t("Phone")}: {r.phone}</p>}
            </div>
            <div className="text-sm">
              <p><span className="text-muted-foreground">{t("Place of supply")}:</span> {inv.place_of_supply ?? "—"}</p>
              <p><span className="text-muted-foreground">{t("Tax type")}:</span> {inv.is_interstate ? t("IGST (inter-state)") : t("CGST + SGST (intra-state)")}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40">
              <tr className="text-left">
                <th className="p-2">#</th>
                <th className="p-2">{t("Description")}</th>
                <th className="p-2">{t("HSN")}</th>
                <th className="p-2">{t("Batch")}</th>
                <th className="p-2 text-right">{t("Qty")}</th>
                <th className="p-2 text-right">{t("Rate")}</th>
                <th className="p-2 text-right">{t("Disc%")}</th>
                <th className="p-2 text-right">{t("Taxable")}</th>
                <th className="p-2 text-right">{t("GST%")}</th>
                <th className="p-2 text-right">{t("Tax")}</th>
                <th className="p-2 text-right">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2">{l.line_no}</td>
                  <td className="p-2">{l.description}{l.expiry_date ? <div className="text-xs text-muted-foreground">{t("Exp")}: {l.expiry_date}</div> : null}</td>
                  <td className="p-2 font-mono text-xs">{l.hsn ?? "—"}</td>
                  <td className="p-2">{l.batch ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.quantity).toString()}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.rate).toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.discount_pct ?? 0).toFixed(1)}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.taxable_value).toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.gst_rate ?? 0).toFixed(1)}</td>
                  <td className="p-2 text-right tabular-nums">{Number(l.tax_amount).toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{Number(l.line_total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-80 text-sm space-y-1">
              <Row label={t("Subtotal")} v={inv.subtotal} />
              <Row label={t("Discount")} v={-Number(inv.discount_total ?? 0)} />
              {inv.is_interstate
                ? <Row label={t("IGST")} v={inv.igst_total} />
                : <><Row label={t("CGST")} v={inv.cgst_total} /><Row label={t("SGST")} v={inv.sgst_total} /></>}
              <Row label={t("Round off")} v={inv.round_off} />
              <div className="flex justify-between text-lg font-semibold border-t pt-2">
                <span>{t("Grand total")}</span>
                <span className="tabular-nums">₹ {Number(inv.grand_total).toLocaleString("en-IN")}</span>
              </div>
              <p className="text-xs italic text-muted-foreground pt-1">{amountInWords(Number(inv.grand_total))}</p>
            </div>
          </div>

          {inv.notes && (
            <div className="border-t pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("Notes")}</p>
              <p className="text-sm whitespace-pre-line">{inv.notes}</p>
            </div>
          )}

          {(inv as unknown as EwayInvoice).ewb_no && (
            <div className="max-w-xs"><EwayBillStamp invoice={inv as unknown as EwayInvoice} /></div>
          )}

          {/* Bank details + authorized signatory */}
          <div className="border-t pt-6 grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("Bank details")}</p>
              {hasBank ? (
                <div className="text-sm space-y-0.5">
                  {org.bank_name && <p>{org.bank_name}{org.bank_branch ? `, ${org.bank_branch}` : ""}</p>}
                  {org.bank_account_no && <p>{t("A/C")}: <span className="font-mono">{org.bank_account_no}</span></p>}
                  {org.bank_ifsc && <p>{t("IFSC")}: <span className="font-mono">{org.bank_ifsc}</span></p>}
                  {org.upi_id && <p>{t("UPI")}: <span className="font-mono">{org.upi_id}</span></p>}
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={openBank} className="print:hidden">
                  <Landmark className="h-3.5 w-3.5 mr-1.5" /> {t("Add bank details")}
                </Button>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm">{t("For")} {org?.name}</p>
              {org.signature_image ? (
                <img src={org.signature_image} alt="signature" className="inline-block h-16 my-1 object-contain" />
              ) : (
                <div className="h-16 my-1 flex items-center justify-end print:hidden">
                  <Button variant="outline" size="sm" onClick={openSign}>
                    <PenLine className="h-3.5 w-3.5 mr-1.5" /> {t("Add signature")}
                  </Button>
                </div>
              )}
              <p className="text-sm border-t inline-block pt-1 mt-1 min-w-[160px]">
                {org.signatory_name || ""}<br />
                <span className="text-xs text-muted-foreground">{t("Authorised Signatory")}</span>
              </p>
            </div>
          </div>

          <div className="border-t pt-4 grid grid-cols-2 gap-8 text-sm print:hidden">
            <div className="text-muted-foreground">{t("Cost of goods")}: ₹ {Number(inv.total_cost ?? 0).toLocaleString("en-IN")}</div>
            <div className="text-success text-right font-medium">{t("Profit")}: ₹ {Number(inv.total_profit ?? 0).toLocaleString("en-IN")}</div>
          </div>
        </CardContent>
      </Card>

      {/* Bank details dialog */}
      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Bank details")}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); persist(bank, () => setBankOpen(false)); }}>
            <div><Label>{t("Bank name")}</Label><Input value={bank.bank_name} onChange={e => setBank({ ...bank, bank_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("Account number")}</Label><Input value={bank.bank_account_no} onChange={e => setBank({ ...bank, bank_account_no: e.target.value })} /></div>
              <div><Label>{t("IFSC")}</Label><Input value={bank.bank_ifsc} onChange={e => setBank({ ...bank, bank_ifsc: e.target.value.toUpperCase() })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("Branch")}</Label><Input value={bank.bank_branch} onChange={e => setBank({ ...bank, bank_branch: e.target.value })} /></div>
              <div><Label>{t("UPI ID")}</Label><Input value={bank.upi_id} onChange={e => setBank({ ...bank, upi_id: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">{t("Saved on your organization — shown on every invoice.")}</p>
            <DialogFooter><Button type="submit" loading={savingProfile}>{savingProfile ? t("Saving…") : t("Save")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Signature dialog */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Authorized signature")}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); persist(sign, () => setSignOpen(false)); }}>
            <div><Label>{t("Signatory name")}</Label><Input placeholder={t("e.g. Proprietor / Director name")} value={sign.signatory_name} onChange={e => setSign({ ...sign, signatory_name: e.target.value })} /></div>
            <div>
              <Label>{sign.signature_image ? t("Replace signature image (PNG)") : t("Signature image (PNG)")}</Label>
              <Input type="file" accept="image/png,image/jpeg" onChange={e => onSignatureFile(e.target.files?.[0] ?? null)} />
              {sign.signature_image && <img src={sign.signature_image} alt="preview" className="h-16 mt-2 object-contain border rounded" />}
            </div>
            <p className="text-xs text-muted-foreground">{t("Upload a scan/photo of the signature on white background. Saved on your organization.")}</p>
            <DialogFooter className="items-center gap-3">
              {sign.signature_image && (
                <Button type="button" variant="ghost" className="mr-auto text-destructive"
                  onClick={() => setSign({ ...sign, signature_image: "" })}>{t("Remove image")}</Button>
              )}
              <Button type="submit" loading={savingProfile}>{savingProfile ? t("Saving…") : t("Save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, v }: { label: string; v: number | string | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">₹ {Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
