import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveEwayBill, buildEwayBillJson, ewayNeeded, EWAY_THRESHOLD } from "@/lib/eway.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Truck, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export type EwayInvoice = {
  id: string; invoice_number: string; grand_total: number | null;
  ewb_no: string | null; ewb_date: string | null; ewb_valid_upto: string | null;
  ewb_vehicle_no: string | null; ewb_transport_mode: string | null; ewb_distance_km: number | null;
  ewb_transporter_id: string | null; ewb_transporter_name: string | null;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Days until validity expires (negative = expired). Null if no validity set. */
export function ewayExpiryDays(validUpto: string | null): number | null {
  if (!validUpto) return null;
  const d = new Date(validUpto); if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Action-bar button + dialog to manage the e-way bill for an invoice. */
export function EwayBillButton({ invoice, onSaved }: { invoice: EwayInvoice; onSaved: () => void }) {
  const { t } = useTranslation();
  const save = useServerFn(saveEwayBill);
  const buildJson = useServerFn(buildEwayBillJson);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [form, setForm] = useState({
    ewb_vehicle_no: invoice.ewb_vehicle_no ?? "",
    ewb_transport_mode: invoice.ewb_transport_mode ?? "road",
    ewb_distance_km: invoice.ewb_distance_km != null ? String(invoice.ewb_distance_km) : "",
    ewb_transporter_id: invoice.ewb_transporter_id ?? "",
    ewb_transporter_name: invoice.ewb_transporter_name ?? "",
    ewb_no: invoice.ewb_no ?? "",
    ewb_date: invoice.ewb_date ?? "",
    ewb_valid_upto: invoice.ewb_valid_upto ?? "",
  });

  const needed = ewayNeeded(invoice.grand_total);
  const hasEbn = !!invoice.ewb_no;

  const persist = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await save({ data: {
        invoiceId: invoice.id,
        ewb_vehicle_no: form.ewb_vehicle_no,
        ewb_transport_mode: form.ewb_transport_mode,
        ewb_distance_km: form.ewb_distance_km ? Number(form.ewb_distance_km) : null,
        ewb_transporter_id: form.ewb_transporter_id,
        ewb_transporter_name: form.ewb_transporter_name,
        ewb_no: form.ewb_no,
        ewb_date: form.ewb_date || null,
        ewb_valid_upto: form.ewb_valid_upto || null,
      }});
      toast.success(t("E-way bill details saved"));
      setOpen(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const downloadJson = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Save current transport details first so they're in the JSON.
      await save({ data: {
        invoiceId: invoice.id,
        ewb_vehicle_no: form.ewb_vehicle_no, ewb_transport_mode: form.ewb_transport_mode,
        ewb_distance_km: form.ewb_distance_km ? Number(form.ewb_distance_km) : null,
        ewb_transporter_id: form.ewb_transporter_id, ewb_transporter_name: form.ewb_transporter_name,
      }});
      const { json } = await buildJson({ data: { invoiceIds: [invoice.id] } });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `eway-${invoice.invoice_number}.json`;
      a.click(); URL.revokeObjectURL(url);
      onSaved();
      toast.success(t("NIC JSON downloaded — upload it on the e-way bill portal"));
    } catch (e) { toast.error((e as Error).message); }
    finally { setDownloading(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Truck className="h-4 w-4 mr-2" />
        {hasEbn ? t("E-way bill") : needed ? t("E-way bill needed") : t("E-way bill")}
        {needed && !hasEbn && <span className="ml-2 h-2 w-2 rounded-full bg-destructive inline-block" />}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("E-way bill")}</DialogTitle></DialogHeader>

          {/* Applicability */}
          <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${needed ? "border-amber-300 bg-amber-50 text-amber-900" : "border-green-300 bg-green-50 text-green-900"}`}>
            {needed ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>
              {needed
                ? t("This consignment is {{amt}} — above the {{thr}} threshold, so an e-way bill is required before dispatch.", { amt: inr(Number(invoice.grand_total ?? 0)), thr: inr(EWAY_THRESHOLD) })
                : t("This consignment is below {{thr}} — an e-way bill isn't required (some states differ for intra-state; check yours).", { thr: inr(EWAY_THRESHOLD) })}
            </span>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("Transport (Part B)")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("Vehicle number")}</Label>
                <Input placeholder="MH12AB1234" value={form.ewb_vehicle_no}
                  onChange={e => setForm({ ...form, ewb_vehicle_no: e.target.value.toUpperCase() })} /></div>
              <div><Label>{t("Distance (km)")}</Label>
                <Input type="number" placeholder="e.g. 120" value={form.ewb_distance_km}
                  onChange={e => setForm({ ...form, ewb_distance_km: e.target.value })} /></div>
              <div><Label>{t("Mode")}</Label>
                <Select value={form.ewb_transport_mode} onValueChange={v => setForm({ ...form, ewb_transport_mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="road">{t("Road")}</SelectItem>
                    <SelectItem value="rail">{t("Rail")}</SelectItem>
                    <SelectItem value="air">{t("Air")}</SelectItem>
                    <SelectItem value="ship">{t("Ship")}</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label>{t("Transporter ID (optional)")}</Label>
                <Input placeholder={t("Transporter GSTIN")} value={form.ewb_transporter_id}
                  onChange={e => setForm({ ...form, ewb_transporter_id: e.target.value.toUpperCase() })} /></div>
            </div>

            <Button variant="secondary" className="w-full" onClick={downloadJson} loading={downloading}>
              <Download className="h-4 w-4 mr-2" /> {t("Download NIC JSON (free — upload on the portal)")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("Upload the file on ewaybillgst.gov.in → Bulk Generation, then paste the returned 12-digit EBN below.")}
            </p>

            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">{t("E-way bill number")}</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3"><Label>{t("EBN (12 digits)")}</Label>
                <Input placeholder="1234 5678 9012" value={form.ewb_no}
                  onChange={e => setForm({ ...form, ewb_no: e.target.value })} /></div>
              <div><Label>{t("Generated on")}</Label>
                <Input type="date" value={form.ewb_date} onChange={e => setForm({ ...form, ewb_date: e.target.value })} /></div>
              <div className="col-span-2"><Label>{t("Valid until")}</Label>
                <Input type="date" value={form.ewb_valid_upto} onChange={e => setForm({ ...form, ewb_valid_upto: e.target.value })} /></div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={persist} loading={saving}>{t("Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Printed e-way bill stamp shown on the invoice when an EBN exists. */
export function EwayBillStamp({ invoice }: { invoice: EwayInvoice }) {
  const { t } = useTranslation();
  if (!invoice.ewb_no) return null;
  return (
    <div className="text-sm border rounded-md p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{t("E-Way Bill")}</p>
      <p><span className="font-mono font-medium">{invoice.ewb_no}</span></p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {invoice.ewb_vehicle_no ? `${t("Vehicle")}: ${invoice.ewb_vehicle_no}` : ""}
        {invoice.ewb_valid_upto ? `${invoice.ewb_vehicle_no ? " · " : ""}${t("Valid till")} ${invoice.ewb_valid_upto}` : ""}
      </p>
    </div>
  );
}
