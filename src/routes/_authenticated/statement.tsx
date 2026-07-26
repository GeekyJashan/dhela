import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/statement")({
  head: () => ({ meta: [{ title: "Account statement — Dhela" }] }),
  validateSearch: (s: Record<string, unknown>): { party: "retailer" | "supplier"; id: string } => ({
    party: s.party === "supplier" ? "supplier" : "retailer",
    id: typeof s.id === "string" ? s.id : "",
  }),
  component: StatementPage,
});

type LedgerRow = {
  tx_date: string; created_at: string; kind: string; ref: string;
  debit: number; credit: number; source_id: string;
};

const inr = (n: number) =>
  Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const today = () => new Date().toISOString().slice(0, 10);

function StatementPage() {
  const { t } = useTranslation();
  const { party, id } = Route.useSearch();
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const { data: partyInfo } = useQuery({
    queryKey: ["statement_party", party, id],
    enabled: !!id,
    queryFn: async () => {
      if (party === "retailer") {
        const { data } = await supabase.from("retailers")
          .select("name, phone, city, gstin, opening_balance").eq("id", id).single();
        return data;
      }
      const { data } = await supabase.from("suppliers")
        .select("name, contact, gstin, opening_balance").eq("id", id).single();
      return data ? { ...data, phone: data.contact, city: null } : null;
    },
  });

  const { data: ledger } = useQuery({
    queryKey: ["statement_ledger", party, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("party_ledger")
        .select("tx_date, created_at, kind, ref, debit, credit, source_id")
        .eq("party_type", party).eq("party_id", id)
        .order("tx_date").order("created_at");
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });

  // For suppliers the "they're owed" side is credit; normalize so the math
  // below always reads debit = balance up, credit = balance down.
  const normalized = (ledger ?? []).map(r =>
    party === "retailer"
      ? r
      : { ...r, debit: Number(r.credit), credit: Number(r.debit) });

  const openingBase = Number(partyInfo?.opening_balance ?? 0);
  const openingForRange = openingBase + normalized
    .filter(r => r.tx_date < from)
    .reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);

  const inRange = normalized.filter(r => r.tx_date >= from && r.tx_date <= to);
  let running = openingForRange;
  const rows = inRange.map(r => {
    running += Number(r.debit) - Number(r.credit);
    return { ...r, balance: running };
  });
  const closing = running;
  const totalDebit = inRange.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = inRange.reduce((s, r) => s + Number(r.credit), 0);

  const owesLabel = party === "retailer" ? t("receivable") : t("payable");
  const particulars = (r: LedgerRow) => {
    if (r.kind === "invoice") return party === "retailer" ? t("Invoice {{n}}", { n: r.ref }) : t("Purchase {{n}}", { n: r.ref });
    if (r.kind === "credit_note") return t("Credit note {{n}} (return)", { n: r.ref });
    return party === "retailer" ? t("Payment received ({{n}})", { n: r.ref }) : t("Payment made ({{n}})", { n: r.ref });
  };

  const waText = encodeURIComponent(
    `${t("Account statement")} — ${partyInfo?.name ?? ""}\n` +
    `${t("Period")}: ${from} ${t("to")} ${to}\n` +
    `${t("Opening balance")}: ₹${inr(openingForRange)}\n` +
    `${party === "retailer" ? t("Total billed") : t("Total purchased")}: ₹${inr(totalDebit)}\n` +
    `${party === "retailer" ? t("Total paid") : t("Total settled")}: ₹${inr(totalCredit)}\n` +
    `${t("Closing balance")}: ₹${inr(closing)} ${owesLabel}`,
  );
  const waPhone = (partyInfo?.phone ?? "").replace(/\D/g, "");
  const waHref = waPhone
    ? `https://wa.me/${waPhone.length === 10 ? "91" + waPhone : waPhone}?text=${waText}`
    : `https://wa.me/?text=${waText}`;

  if (!id) {
    return <div className="p-4 sm:p-8 text-muted-foreground">{t("No party selected. Open a statement from the Retailers, Suppliers, or Payments page.")}</div>;
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="font-display text-4xl">{t("Account statement")}</h1>
          <p className="text-muted-foreground mt-1">
            {partyInfo?.name} · {party === "retailer" ? t("Customer ledger") : t("Supplier ledger")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />{t("Print / PDF")}</Button>
          <a href={waHref} target="_blank" rel="noreferrer">
            <Button><MessageCircle className="h-4 w-4 mr-2" />{t("Share on WhatsApp")}</Button>
          </a>
        </div>
      </div>

      <div className="flex gap-3 items-end print:hidden">
        <div>
          <Label>{t("From")}</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>{t("To")}</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardHeader>
          <div className="hidden print:block mb-2">
            <div className="text-2xl font-semibold">{t("Account statement")}</div>
            <div className="text-sm">{partyInfo?.name}{partyInfo?.gstin ? ` · GSTIN ${partyInfo.gstin}` : ""}</div>
            <div className="text-sm text-muted-foreground">{t("Period")} {from} {t("to")} {to}</div>
          </div>
          <CardTitle className="print:hidden">
            {from} — {to}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Particulars")}</TableHead>
              <TableHead className="text-right">{party === "retailer" ? t("Debit (billed)") : t("Purchases")}</TableHead>
              <TableHead className="text-right">{party === "retailer" ? t("Credit (paid)") : t("Payments")}</TableHead>
              <TableHead className="text-right">{t("Balance")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell>{from}</TableCell>
                <TableCell className="font-medium">{t("Opening balance")}</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right tabular-nums font-medium">₹ {inr(openingForRange)}</TableCell>
              </TableRow>
              {rows.map(r => (
                <TableRow key={`${r.kind}-${r.source_id}`}>
                  <TableCell>{r.tx_date}</TableCell>
                  <TableCell>{particulars(r)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.debit) ? `₹ ${inr(r.debit)}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.credit) ? `₹ ${inr(r.credit)}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {inr(r.balance)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t("No transactions in this period.")}
                </TableCell></TableRow>
              )}
              <TableRow className="border-t-2">
                <TableCell></TableCell>
                <TableCell className="font-semibold">{t("Closing balance")}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">₹ {inr(totalDebit)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">₹ {inr(totalCredit)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">₹ {inr(closing)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            {t("Closing balance is")} {owesLabel}: {party === "retailer"
              ? t("the amount this retailer owes you")
              : t("the amount you owe this supplier")}
            {closing < 0 ? ` ${t("(negative = advance)")}` : ""}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
