import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { buildEwayBillJson, EWAY_THRESHOLD } from "@/lib/eway.functions";
import { ewayExpiryDays } from "@/components/eway-bill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, FileText, Truck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/eway")({
  head: () => ({ meta: [{ title: "E-way bills — Ledgerly" }] }),
  component: EwayPage,
});

type Row = {
  id: string; invoice_number: string; invoice_date: string; grand_total: number | null;
  ewb_no: string | null; ewb_valid_upto: string | null; ewb_vehicle_no: string | null;
  retailer: { name: string } | null;
};

const inr = (n: number) => `₹ ${Math.round(n).toLocaleString("en-IN")}`;

type StatusKey = "pending" | "generated" | "expiring" | "expired";
function statusOf(r: Row): StatusKey {
  if (!r.ewb_no) return "pending";
  const days = ewayExpiryDays(r.ewb_valid_upto);
  if (days == null) return "generated";
  if (days < 0) return "expired";
  if (days <= 1) return "expiring";
  return "generated";
}

function EwayPage() {
  const { t } = useTranslation();
  const buildJson = useServerFn(buildEwayBillJson);
  const [downloading, setDownloading] = useState(false);

  const { data } = useQuery({
    queryKey: ["eway_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_invoices")
        .select("id, invoice_number, invoice_date, grand_total, ewb_no, ewb_valid_upto, ewb_vehicle_no, retailer:retailers(name)")
        .in("status", ["issued", "paid"]).gte("grand_total", EWAY_THRESHOLD)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = data ?? [];
  const pending = rows.filter(r => statusOf(r) === "pending");
  const attention = rows.filter(r => ["expiring", "expired"].includes(statusOf(r)));
  const generated = rows.filter(r => statusOf(r) === "generated");

  const downloadPending = async () => {
    if (downloading || !pending.length) return;
    setDownloading(true);
    try {
      const { json, count } = await buildJson({ data: { invoiceIds: pending.map(r => r.id) } });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `eway-bulk-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success(t("{{n}} invoice(s) exported — upload on the e-way bill portal", { n: count }));
    } catch (e) { toast.error((e as Error).message); }
    finally { setDownloading(false); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("E-way bills")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("Dispatches over {{thr}} need an e-way bill. Export the ready-made NIC file, generate on the portal for free, then record the EBN.", { thr: inr(EWAY_THRESHOLD) })}
          </p>
        </div>
        <Button onClick={downloadPending} loading={downloading} disabled={!pending.length}>
          <Download className="h-4 w-4 mr-2" /> {t("Download NIC file ({{n}} pending)", { n: pending.length })}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat icon={<AlertTriangle className="h-5 w-5" />} tone="warning" label={t("Need e-way bill")} value={pending.length} />
        <Stat icon={<Clock className="h-5 w-5" />} tone="destructive" label={t("Expiring / expired")} value={attention.length} />
        <Stat icon={<CheckCircle2 className="h-5 w-5" />} tone="success" label={t("Generated")} value={generated.length} />
      </div>

      <Card>
        <CardHeader><CardTitle>{t("Consignments over {{thr}} ({{n}})", { thr: inr(EWAY_THRESHOLD), n: rows.length })}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Invoice #")}</TableHead><TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Retailer")}</TableHead><TableHead className="text-right">{t("Value")}</TableHead>
              <TableHead>{t("Vehicle")}</TableHead><TableHead>{t("EBN")}</TableHead>
              <TableHead>{t("Status")}</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => {
                const s = statusOf(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm font-medium">{r.invoice_number}</TableCell>
                    <TableCell>{r.invoice_date}</TableCell>
                    <TableCell>{r.retailer?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(Number(r.grand_total ?? 0))}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ewb_vehicle_no ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ewb_no ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={s} validUpto={r.ewb_valid_upto} /></TableCell>
                    <TableCell className="text-right">
                      <Link to="/sales/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="ghost" title={t("Open invoice")}><FileText className="h-3.5 w-3.5" /></Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  {t("No consignments above the threshold yet.")}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "warning" | "destructive" | "success" }) {
  const cls = { warning: "bg-warning/20 text-[oklch(0.45_0.09_75)]", destructive: "bg-destructive/10 text-destructive", success: "bg-success/15 text-success" }[tone];
  return (
    <Card><CardContent className="pt-6 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cls}`}>{icon}</div>
      <div><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div>
    </CardContent></Card>
  );
}

function StatusBadge({ status, validUpto }: { status: StatusKey; validUpto: string | null }) {
  const { t } = useTranslation();
  const map: Record<StatusKey, { label: string; cls: string }> = {
    pending: { label: t("Needs e-way bill"), cls: "bg-amber-100 text-amber-800" },
    generated: { label: t("Generated"), cls: "bg-green-100 text-green-800" },
    expiring: { label: t("Expires soon"), cls: "bg-orange-100 text-orange-800" },
    expired: { label: t("Expired"), cls: "bg-red-100 text-red-800" },
  };
  const m = map[status];
  return (
    <span title={validUpto ? `${t("Valid till")} ${validUpto}` : undefined}
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>{m.label}</span>
  );
}
