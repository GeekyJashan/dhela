import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "./dashboard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Invoices — Ledgerly" }] }),
  component: InvoicesList,
});

function InvoicesList() {
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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">Invoices</h1>
        <Link to="/upload"><Button><FileUp className="h-4 w-4 mr-2" /> Upload</Button></Link>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map(inv => (
              <TableRow key={inv.id} className="cursor-pointer">
                <TableCell>
                  <Link to="/invoices/$id" params={{ id: inv.id }} className="font-medium hover:underline">
                    {inv.supplier_name ?? "Unknown"}
                  </Link>
                </TableCell>
                <TableCell>{inv.invoice_number ?? "—"}</TableCell>
                <TableCell>{inv.invoice_date ?? new Date(inv.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right tabular-nums">₹ {Number(inv.grand_total ?? 0).toLocaleString("en-IN")}</TableCell>
                <TableCell>{inv.confidence ? `${Number(inv.confidence).toFixed(0)}%` : "—"}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
              </TableRow>
            ))}
            {!data?.length && (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No invoices yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
