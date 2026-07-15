import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileUp, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Ledgerly" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data: invoices } = useQuery({
    queryKey: ["invoices", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("id, supplier_name, invoice_number, invoice_date, grand_total, status, confidence, created_at")
        .order("created_at", { ascending: false }).limit(8);
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("status, confidence, grand_total");
      if (error) throw error;
      const total = data.length;
      const pending = data.filter(d => d.status === "review" || d.status === "processing").length;
      const approved = data.filter(d => d.status === "approved").length;
      const failed = data.filter(d => d.status === "failed").length;
      const avgConf = data.filter(d => d.confidence).reduce((s, d) => s + Number(d.confidence), 0) / Math.max(1, data.filter(d => d.confidence).length);
      const value = data.filter(d => d.status === "approved").reduce((s, d) => s + Number(d.grand_total ?? 0), 0);
      return { total, pending, approved, failed, avgConf, value };
    },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Purchase automation")}</h1>
          <p className="text-muted-foreground mt-1">{t("Every invoice, read and reconciled by AI.")}</p>
        </div>
        <Link to="/upload"><Button size="lg"><FileUp className="h-4 w-4 mr-2" /> {t("Upload invoice")}</Button></Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label={t("Total invoices")} value={stats?.total ?? 0} />
        <StatCard label={t("Pending review")} value={stats?.pending ?? 0} icon={<Clock className="h-4 w-4 text-warning" />} />
        <StatCard label={t("Approved")} value={stats?.approved ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
        <StatCard label={t("Avg. confidence")} value={stats?.avgConf ? `${stats.avgConf.toFixed(0)}%` : "—"} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("Recent invoices")}</CardTitle>
          <Link to="/invoices" className="text-sm text-primary hover:underline">{t("View all")}</Link>
        </CardHeader>
        <CardContent>
          {!invoices?.length ? (
            <div className="text-center py-16 border-2 border-dashed rounded-lg">
              <FileUp className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">{t("No invoices yet.")}</p>
              <Link to="/upload"><Button className="mt-4" size="sm">{t("Upload your first invoice")}</Button></Link>
            </div>
          ) : (
            <div className="divide-y">
              {invoices.map(inv => (
                <Link key={inv.id} to="/invoices/$id" params={{ id: inv.id }}
                  className="flex items-center justify-between py-3 hover:bg-muted/40 px-2 rounded">
                  <div>
                    <p className="font-medium">{inv.supplier_name ?? t("Unknown supplier")}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.invoice_number ?? "—"} · {inv.invoice_date ?? new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm tabular-nums">₹ {Number(inv.grand_total ?? 0).toLocaleString("en-IN")}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {icon}
        </div>
        <p className="font-display text-3xl mt-2 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; cls: string }> = {
    uploaded: { label: "Uploaded", cls: "bg-muted text-muted-foreground" },
    processing: { label: "Processing", cls: "bg-warning/20 text-warning-foreground" },
    review: { label: "Needs review", cls: "bg-accent/30 text-accent-foreground" },
    approved: { label: "Approved", cls: "bg-success/20 text-success" },
    rejected: { label: "Rejected", cls: "bg-destructive/20 text-destructive" },
    failed: { label: "Failed", cls: "bg-destructive/20 text-destructive" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted" };
  return <Badge className={m.cls} variant="secondary">{status === "failed" && <AlertTriangle className="h-3 w-3 mr-1" />}{t(m.label)}</Badge>;
}
