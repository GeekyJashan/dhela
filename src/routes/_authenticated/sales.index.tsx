import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({ meta: [{ title: "Sales invoices — Ledgerly" }] }),
  component: SalesList,
});

function SalesList() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["sales_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_invoices")
        .select("id, invoice_number, invoice_date, grand_total, total_profit, status, payment_status, retailer:retailers(name)")
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const statusColor = (s: string) =>
    s === "issued" ? "bg-primary/15 text-primary"
    : s === "paid" ? "bg-success/20 text-success"
    : s === "cancelled" ? "bg-destructive/20 text-destructive"
    : "bg-muted text-muted-foreground";

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">{t("Sales invoices")}</h1>
          <p className="text-muted-foreground mt-1">{t("Bill retailers, track GST and profit in real time.")}</p>
        </div>
        <Link to="/sales/new"><Button size="lg"><Plus className="h-4 w-4 mr-2" /> {t("New sales invoice")}</Button></Link>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Invoice #")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Retailer")}</TableHead>
              <TableHead className="text-right">{t("Total")}</TableHead>
              <TableHead className="text-right">{t("Profit")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Payment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((i) => {
              const r = i.retailer as { name: string } | null;
              return (
                <TableRow key={i.id} className="cursor-pointer">
                  <TableCell>
                    <Link to="/sales/$id" params={{ id: i.id }} className="font-medium hover:underline">
                      {i.invoice_number}
                    </Link>
                  </TableCell>
                  <TableCell>{i.invoice_date}</TableCell>
                  <TableCell>{r?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {Number(i.grand_total ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">₹ {Number(i.total_profit ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell><Badge className={statusColor(i.status)} variant="secondary">{t(i.status)}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{t(i.payment_status)}</Badge></TableCell>
                </TableRow>
              );
            })}
            {!data?.length && (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                {t("No sales invoices yet. Add retailers and products first, then create your first invoice.")}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
