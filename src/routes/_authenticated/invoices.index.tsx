import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { deletePurchaseInvoice } from "@/lib/invoices.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "./dashboard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExtractionAccuracy, ExtractionAccuracyLabel } from "@/components/extraction-accuracy";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Purchase bills - Dhela" }] }),
  component: InvoicesList,
});

function InvoicesList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const removeInvoice = useServerFn(deletePurchaseInvoice);
  const del = async (id: string, approved: boolean) => {
    if (!confirm(approved ? t("Delete this approved purchase? The stock it added will be reversed.") : t("Delete this purchase bill?"))) return;
    try { await removeInvoice({ data: { invoiceId: id } }); qc.invalidateQueries({ queryKey: ["invoices"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  const { data } = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("id, supplier_name, invoice_number, invoice_date, grand_total, status, confidence, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{t("Purchases")}</h1>
        <Link to="/upload"><Button><FileUp className="h-4 w-4 mr-2" /> {t("Upload")}</Button></Link>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Supplier")}</TableHead>
              <TableHead>{t("Bill #")}</TableHead>
              <TableHead>{t("Date")}</TableHead>
              <TableHead className="text-right">{t("Total")}</TableHead>
              <TableHead><ExtractionAccuracyLabel /></TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map(inv => (
              <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/40"
                onClick={() => navigate({ to: "/invoices/$id", params: { id: inv.id } })}>
                <TableCell className="font-medium">{inv.supplier_name ?? t("Unknown")}</TableCell>
                <TableCell>{inv.invoice_number ?? "—"}</TableCell>
                <TableCell>{inv.invoice_date ?? new Date(inv.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right tabular-nums">₹ {Number(inv.grand_total ?? 0).toLocaleString("en-IN")}</TableCell>
                <TableCell><ExtractionAccuracy value={inv.confidence} /></TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); del(inv.id, inv.status === "approved"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {!data?.length && (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">{t("No bills yet.")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
