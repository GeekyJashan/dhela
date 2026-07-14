import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { amountInWords } from "@/lib/pricing";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, ArrowLeft, Undo2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sales/$id")({
  head: () => ({ meta: [{ title: "Sales invoice — Ledgerly" }] }),
  component: SalesInvoiceView,
});

function SalesInvoiceView() {
  const { id } = Route.useParams();

  const { data } = useQuery({
    queryKey: ["sales_invoice", id],
    queryFn: async () => {
      const [invRes, linesRes] = await Promise.all([
        supabase.from("sales_invoices").select("*, retailer:retailers(*), org:organizations(name, gstin, address, phone, email, state_code)").eq("id", id).single(),
        supabase.from("sales_invoice_lines").select("*").eq("sales_invoice_id", id).order("line_no"),
      ]);
      if (invRes.error) throw invRes.error;
      if (linesRes.error) throw linesRes.error;
      return { inv: invRes.data, lines: linesRes.data };
    },
  });

  if (!data) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const { inv, lines } = data;
  const org = inv.org as { name?: string; gstin?: string; address?: string; phone?: string; email?: string; state_code?: string };
  const r = inv.retailer as { name?: string; gstin?: string; address?: string; state_code?: string; phone?: string; city?: string; pincode?: string };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/sales" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to sales
        </Link>
        <div className="flex gap-2">
          {(inv.status === "issued" || inv.status === "paid") && (
            <Link to="/returns" search={{ invoiceId: id }}>
              <Button variant="outline"><Undo2 className="h-4 w-4 mr-2" /> Return items</Button>
            </Link>
          )}
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Print / Save PDF</Button>
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
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Tax Invoice</p>
              <p className="text-xl font-bold">{inv.invoice_number}</p>
              <p className="text-sm">Date: {inv.invoice_date}</p>
              {inv.due_date && <p className="text-sm">Due: {inv.due_date}</p>}
              <Badge className="mt-2">{inv.status}</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Bill To</p>
              <p className="font-semibold">{r?.name}</p>
              {r?.address && <p className="text-sm whitespace-pre-line">{r.address}</p>}
              <p className="text-sm">{[r?.city, r?.pincode].filter(Boolean).join(" - ")}</p>
              {r?.gstin && <p className="text-sm">GSTIN: <span className="font-mono">{r.gstin}</span></p>}
              {r?.phone && <p className="text-sm">Phone: {r.phone}</p>}
            </div>
            <div className="text-sm">
              <p><span className="text-muted-foreground">Place of supply:</span> {inv.place_of_supply ?? "—"}</p>
              <p><span className="text-muted-foreground">Tax type:</span> {inv.is_interstate ? "IGST (inter-state)" : "CGST + SGST (intra-state)"}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40">
              <tr className="text-left">
                <th className="p-2">#</th>
                <th className="p-2">Description</th>
                <th className="p-2">HSN</th>
                <th className="p-2">Batch</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Rate</th>
                <th className="p-2 text-right">Disc%</th>
                <th className="p-2 text-right">Taxable</th>
                <th className="p-2 text-right">GST%</th>
                <th className="p-2 text-right">Tax</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2">{l.line_no}</td>
                  <td className="p-2">{l.description}{l.expiry_date ? <div className="text-xs text-muted-foreground">Exp: {l.expiry_date}</div> : null}</td>
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
              <Row label="Subtotal" v={inv.subtotal} />
              <Row label="Discount" v={-Number(inv.discount_total ?? 0)} />
              {inv.is_interstate
                ? <Row label="IGST" v={inv.igst_total} />
                : <><Row label="CGST" v={inv.cgst_total} /><Row label="SGST" v={inv.sgst_total} /></>}
              <Row label="Round off" v={inv.round_off} />
              <div className="flex justify-between text-lg font-semibold border-t pt-2">
                <span>Grand total</span>
                <span className="tabular-nums">₹ {Number(inv.grand_total).toLocaleString("en-IN")}</span>
              </div>
              <p className="text-xs italic text-muted-foreground pt-1">{amountInWords(Number(inv.grand_total))}</p>
            </div>
          </div>

          {inv.notes && (
            <div className="border-t pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-line">{inv.notes}</p>
            </div>
          )}

          <div className="border-t pt-4 grid grid-cols-2 gap-8 text-sm print:hidden">
            <div className="text-muted-foreground">Cost of goods: ₹ {Number(inv.total_cost ?? 0).toLocaleString("en-IN")}</div>
            <div className="text-success text-right font-medium">Profit: ₹ {Number(inv.total_profit ?? 0).toLocaleString("en-IN")}</div>
          </div>
        </CardContent>
      </Card>
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
