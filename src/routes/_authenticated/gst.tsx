import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getGstReturns, type GstReturns, type Gstr1Row } from "@/lib/gst.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/gst")({
  head: () => ({ meta: [{ title: "GST returns — Dhela" }] }),
  component: GstPage,
});

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Excel opens CSV natively, which is what a CA will ask for. */
function downloadCsv(name: string, rows: Gstr1Row[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

function GstPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(thisMonth);
  const fetchReturns = useServerFn(getGstReturns);

  const { data, isFetching } = useQuery({
    queryKey: ["gst_returns", period],
    queryFn: async () => (await fetchReturns({ data: { period } })) as GstReturns,
  });

  const sections: { key: keyof GstReturns; label: string; hint: string }[] = [
    { key: "b2b", label: "B2B", hint: t("Sales to GST-registered retailers") },
    { key: "b2cl", label: "B2CL", hint: t("Interstate sales over ₹1,00,000 to unregistered buyers") },
    { key: "b2cs", label: "B2CS", hint: t("All other unregistered sales, summarised") },
    { key: "cdnr", label: "CDNR", hint: t("Credit notes against registered retailers") },
    { key: "cdnur", label: "CDNUR", hint: t("Credit notes against unregistered buyers") },
    { key: "hsnB2b", label: t("HSN — B2B"), hint: t("Table 12, B2B tab") },
    { key: "hsnB2c", label: t("HSN — B2C"), hint: t("Table 12, B2C tab — optional below ₹5 crore turnover") },
    { key: "docs", label: t("Documents"), hint: t("Table 13 — invoice series issued") },
  ];

  const downloadAll = () => {
    if (!data) return;
    let n = 0;
    for (const s of sections) {
      const rows = data[s.key] as Gstr1Row[];
      if (rows?.length) { downloadCsv(`gstr1-${data.period}-${String(s.label).toLowerCase().replace(/\s+/g, "-")}`, rows); n++; }
    }
    toast.success(n ? t("{{n}} file(s) downloaded", { n }) : t("Nothing to download for this month"));
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("GST returns")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("GSTR-1 and GSTR-3B working papers, built from your issued invoices and approved purchases.")}
        </p>
      </div>

      <Card className="border-amber-400/50 bg-warning/10">
        <CardContent className="pt-6 flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">{t("This is a working paper, not a filing.")}</p>
            <p className="text-muted-foreground mt-1">
              {t("Dhela does not file returns. Download these, have your accountant check them against your books, and file on the GST portal. Figures come from what you entered in Dhela — if a purchase was never approved, or an invoice is still a draft, it is not counted here.")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">{t("Period")}</CardTitle>
          <div className="flex gap-2">
            <Input type="month" value={period} max={thisMonth()}
              onChange={e => setPeriod(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={downloadAll} disabled={!data}>
              <Download className="h-4 w-4 mr-2" />{t("Download all")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isFetching && <p className="text-sm text-muted-foreground">{t("Working it out…")}</p>}
          {data && (
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <Stat label={t("Invoices in period")} value={String(data.counts.invoices)} />
              <Stat label={t("Credit notes")} value={String(data.counts.creditNotes)} />
              <Stat label={t("HSN digits expected")}
                value={t("{{n}} digit", { n: data.hsnDigits })} />
            </div>
          )}
          {data && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("HSN digit count is estimated by annualising this month's sales — confirm against your actual annual turnover, since the 6-digit rule starts at ₹5 crore.")}
            </p>
          )}
        </CardContent>
      </Card>

      {data && data.warnings.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("Check these first")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {data.warnings.map(w => <li key={w}>· {w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("GSTR-3B summary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("3.1(a) Outward taxable supplies")}
              </p>
              <div className="grid gap-3 sm:grid-cols-4 text-sm">
                <Stat label={t("Taxable value")} value={inr(data.gstr3b.outwardTaxable)} />
                <Stat label={t("IGST")} value={inr(data.gstr3b.outwardIgst)} />
                <Stat label={t("CGST")} value={inr(data.gstr3b.outwardCgst)} />
                <Stat label={t("SGST")} value={inr(data.gstr3b.outwardSgst)} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("4 Input tax credit (from approved purchases)")}
              </p>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <Stat label={t("Inward taxable value")} value={inr(data.gstr3b.inwardTaxable)} />
                <Stat label={t("ITC total")} value={inr(data.gstr3b.itcTotal)} />
                <Stat label={t("Credit notes")} value={inr(data.gstr3b.creditNoteTaxable)} />
              </div>
              {!data.gstr3b.itcSplitAvailable && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("Purchases record a single tax figure, not an IGST/CGST/SGST split — your accountant will need to apportion ITC.")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {data && sections.map(s => {
        const rows = data[s.key] as Gstr1Row[];
        return (
          <Card key={String(s.key)}>
            <CardHeader className="flex-row items-center justify-between gap-4 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">
                  {s.label} <span className="text-muted-foreground font-normal">({rows?.length ?? 0})</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{s.hint}</p>
              </div>
              <Button variant="ghost" size="sm" disabled={!rows?.length}
                onClick={() => downloadCsv(`gstr1-${data.period}-${String(s.label).toLowerCase().replace(/\s+/g, "-")}`, rows)}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />{t("CSV")}
              </Button>
            </CardHeader>
            <CardContent>
              {rows?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(rows[0]).map(c => <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 25).map((row, i) => (
                      <TableRow key={i}>
                        {Object.keys(rows[0]).map(c => (
                          <TableCell key={c} className="whitespace-nowrap tabular-nums">{row[c]}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-2">{t("Nothing in this section for this month.")}</p>
              )}
              {rows && rows.length > 25 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t("Showing first 25 of {{n}} — download the CSV for all.", { n: rows.length })}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}
