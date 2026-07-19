import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, AreaChart,
  PieChart, Pie, Cell, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, HandCoins, AlertTriangle, Clock,
  Target, Landmark, Trophy,
} from "lucide-react";

/* ------------------------------ helpers ------------------------------ */

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const inrCompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
};

const C = {
  in: "var(--success)",
  out: "var(--destructive)",
  primary: "var(--primary)",
  accent: "var(--accent)",
  warn: "var(--warning)",
  axis: "var(--muted-foreground)",
  grid: "var(--border)",
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const daysBetween = (a: number, b: number) => Math.floor((a - b) / 86_400_000);

/** Animate a number up to `target` with an ease-out curve. */
function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(begin + (target - begin) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return cur ? 100 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/* ------------------------------ KPI card ------------------------------ */

function Kpi({
  icon, label, value, sub, delta, goodWhenUp = true, tone = "primary", index = 0,
}: {
  icon: React.ReactNode; label: string; value: number; sub?: string;
  delta?: number | null; goodWhenUp?: boolean; tone?: "primary" | "success" | "warning" | "destructive"; index?: number;
}) {
  const shown = useCountUp(value);
  const toneBg: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-[oklch(0.45_0.09_75)]",
    destructive: "bg-destructive/10 text-destructive",
  };
  const up = (delta ?? 0) >= 0;
  const good = up === goodWhenUp;
  return (
    <Card className="relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
      style={{ animationDelay: `${index * 80}ms` }}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${toneBg[tone]}`}>{icon}</div>
          {delta != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5 ${good ? "text-success bg-success/10" : "text-destructive bg-destructive/10"}`}>
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{inr(shown)}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/80 mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* -------------------------- insight chip ---------------------------- */

function Insight({ icon, label, value, hint, tone = "primary" }: {
  icon: React.ReactNode; label: string; value: string; hint: string;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const ring: Record<string, string> = {
    primary: "text-primary", success: "text-success",
    warning: "text-[oklch(0.5_0.1_75)]", destructive: "text-destructive",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3.5">
      <div className={`mt-0.5 ${ring[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-xs text-muted-foreground/85 mt-0.5 leading-snug">{hint}</p>
      </div>
    </div>
  );
}

/* ------------------------------ main -------------------------------- */

export function PaymentsAnalytics() {
  const { t } = useTranslation();

  const { data: payments } = useQuery({
    queryKey: ["pa_payments"],
    queryFn: async () => (await supabase.from("payments")
      .select("payment_date, amount, discount_amount, party_type, mode")
      .order("payment_date", { ascending: false }).limit(2000)).data ?? [],
  });

  const { data: invoices } = useQuery({
    queryKey: ["pa_sales_invoices"],
    queryFn: async () => (await supabase.from("sales_invoices")
      .select("invoice_date, due_date, subtotal, grand_total, total_profit, amount_paid, status, payment_status, retailer_id, retailer:retailers(name)")
      .in("status", ["issued", "paid"]).limit(5000)).data ?? [],
  });

  const a = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString("en-IN", { month: "short" }) });
    }
    const curKey = monthKey(now);
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const series = new Map(months.map(m => [m.key, { month: m.label, sales: 0, profit: 0, cashIn: 0, cashOut: 0 }]));

    let salesCur = 0, salesPrev = 0, profitCur = 0, profitPrev = 0, collectedCur = 0, collectedPrev = 0;
    let sales90 = 0; const cut90 = now.getTime() - 90 * 86_400_000;

    for (const inv of invoices ?? []) {
      const dt = new Date(inv.invoice_date);
      const k = monthKey(dt);
      const s = Number(inv.subtotal ?? 0), p = Number(inv.total_profit ?? 0);
      const row = series.get(k); if (row) { row.sales += s; row.profit += p; }
      if (k === curKey) { salesCur += s; profitCur += p; }
      if (k === prevKey) { salesPrev += s; profitPrev += p; }
      if (dt.getTime() >= cut90) sales90 += s;
    }
    for (const pm of payments ?? []) {
      const dt = new Date(pm.payment_date);
      const k = monthKey(dt);
      const amt = Number(pm.amount ?? 0);
      const row = series.get(k);
      if (row) { if (pm.party_type === "retailer") row.cashIn += amt; else row.cashOut += amt; }
      if (pm.party_type === "retailer") {
        if (k === curKey) collectedCur += amt;
        if (k === prevKey) collectedPrev += amt;
      }
    }

    // Point-in-time receivables + ageing from open invoices.
    let outstanding = 0, overdue = 0, b0 = 0, b30 = 0, b60 = 0;
    const byRetailer = new Map<string, { name: string; due: number }>();
    let billed90 = 0, collected90 = 0;
    for (const inv of invoices ?? []) {
      const due = Number(inv.grand_total ?? 0) - Number(inv.amount_paid ?? 0);
      const dt = new Date(inv.invoice_date);
      if (dt.getTime() >= cut90) billed90 += Number(inv.grand_total ?? 0);
      if (due <= 0.5) continue;
      outstanding += due;
      const age = daysBetween(now.getTime(), dt.getTime());
      const isOverdue = inv.due_date ? now.getTime() > new Date(inv.due_date).getTime() : age > 30;
      if (isOverdue) overdue += due;
      if (age <= 30) b0 += due; else if (age <= 60) b30 += due; else b60 += due;
      const rid = inv.retailer_id ?? "?";
      const name = (inv.retailer as { name: string } | null)?.name ?? t("Unknown");
      const cur = byRetailer.get(rid) ?? { name, due: 0 };
      cur.due += due; byRetailer.set(rid, cur);
    }
    for (const pm of payments ?? []) {
      if (pm.party_type === "retailer" && new Date(pm.payment_date).getTime() >= cut90) collected90 += Number(pm.amount ?? 0);
    }

    const topDebtors = [...byRetailer.values()].sort((x, y) => y.due - x.due).slice(0, 5)
      .map(d => ({ name: d.name.length > 14 ? d.name.slice(0, 13) + "…" : d.name, due: Math.round(d.due) }));

    const ageing = [
      { name: t("0–30 days"), value: Math.round(b0), color: C.in },
      { name: t("31–60 days"), value: Math.round(b30), color: C.warn },
      { name: t("60+ days"), value: Math.round(b60), color: C.out },
    ].filter(x => x.value > 0);

    const dso = sales90 > 0 ? Math.round((outstanding / sales90) * 90) : 0;
    const collectionEff = billed90 > 0 ? Math.min(999, Math.round((collected90 / billed90) * 100)) : 0;
    const overduePct = outstanding > 0 ? Math.round((overdue / outstanding) * 100) : 0;
    const marginCur = salesCur > 0 ? (profitCur / salesCur) * 100 : 0;
    const bestMonth = [...series.values()].reduce((best, m) => m.sales > best.sales ? m : best, { month: "—", sales: 0 });
    const topDebtor = topDebtors[0];

    return {
      series: [...series.values()],
      salesCur, salesPrev, profitCur, profitPrev, collectedCur, collectedPrev,
      outstanding, overdue, ageing, topDebtors,
      dso, collectionEff, overduePct, marginCur, bestMonth, topDebtor,
      retailersOwing: byRetailer.size,
    };
  }, [payments, invoices, t]);

  const tooltipStyle = {
    contentStyle: {
      background: "var(--popover)", border: "1px solid var(--border)",
      borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
    },
    labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  };

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi index={0} tone="primary" icon={<TrendingUp className="h-5 w-5" />}
          label={t("Net sales this month")} value={a.salesCur}
          sub={t("ex-GST")} delta={pctChange(a.salesCur, a.salesPrev)} />
        <Kpi index={1} tone="success" icon={<Target className="h-5 w-5" />}
          label={t("Profit this month")} value={a.profitCur}
          sub={t("{{m}}% margin", { m: a.marginCur.toFixed(1) })} delta={pctChange(a.profitCur, a.profitPrev)} />
        <Kpi index={2} tone="primary" icon={<HandCoins className="h-5 w-5" />}
          label={t("Collected this month")} value={a.collectedCur}
          sub={t("Cash received from retailers")} delta={pctChange(a.collectedCur, a.collectedPrev)} />
        <Kpi index={3} tone={a.overdue > 0 ? "destructive" : "warning"} icon={<Wallet className="h-5 w-5" />}
          label={t("Outstanding to collect")} value={a.outstanding} goodWhenUp={false}
          sub={a.overdue > 0 ? t("{{amt}} overdue", { amt: inr(a.overdue) }) : t("Nothing overdue")} />
      </div>

      {/* Grow-your-business insight strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Insight icon={<Clock className="h-5 w-5" />} tone={a.dso > 45 ? "destructive" : a.dso > 25 ? "warning" : "success"}
          value={t("{{d}} days", { d: a.dso })} label={t("collection time (DSO)")}
          hint={a.dso > 45 ? t("Slow — money is stuck with retailers. Tighten credit terms.") : t("Healthy — cash comes back quickly.")} />
        <Insight icon={<Target className="h-5 w-5" />} tone={a.collectionEff >= 85 ? "success" : a.collectionEff >= 60 ? "warning" : "destructive"}
          value={`${a.collectionEff}%`} label={t("collection efficiency")}
          hint={t("Share of the last 90 days' billing you've already collected.")} />
        <Insight icon={<AlertTriangle className="h-5 w-5" />} tone={a.overduePct > 30 ? "destructive" : a.overduePct > 10 ? "warning" : "success"}
          value={`${a.overduePct}%`} label={t("of dues are overdue")}
          hint={a.topDebtor ? t("Chase {{name}} first — biggest outstanding.", { name: a.topDebtor.name }) : t("All dues are within terms.")} />
        <Insight icon={<Trophy className="h-5 w-5" />} tone="primary"
          value={a.bestMonth.month} label={t("best sales month")}
          hint={t("Peak was {{amt}} — aim to beat it.", { amt: inrCompact(a.bestMonth.sales) })} />
      </div>

      {/* Charts row 1: cash flow + ageing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" /> {t("Cash flow — money in vs out")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("Collections from retailers against payments to suppliers, last 6 months.")}</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={a.series} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="month" stroke={C.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={52} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => inr(v)} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cashIn" name={t("Money in")} fill={C.in} radius={[5, 5, 0, 0]} maxBarSize={26} />
                <Bar dataKey="cashOut" name={t("Money out")} fill={C.out} radius={[5, 5, 0, 0]} maxBarSize={26} />
                <Line dataKey="profit" name={t("Profit")} type="monotone" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> {t("Receivables ageing")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("How old your unpaid dues are.")}</p>
          </CardHeader>
          <CardContent>
            {a.ageing.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={a.ageing} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2} strokeWidth={0}>
                    {a.ageing.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(v: number) => inr(v)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground text-center">
                {t("No outstanding dues — everything's collected. 🎉")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: sales & profit trend + top debtors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> {t("Sales & profit trend")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("Net sales (ex-GST) and profit over the last 6 months.")}</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={a.series} margin={{ left: -8, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.in} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.in} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="month" stroke={C.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={52} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => inr(v)} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area dataKey="sales" name={t("Net sales")} type="monotone" stroke={C.primary} strokeWidth={2.5} fill="url(#gSales)" />
                <Area dataKey="profit" name={t("Profit")} type="monotone" stroke={C.in} strokeWidth={2.5} fill="url(#gProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" /> {t("Who owes you most")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("Top retailers by outstanding — chase these.")}</p>
          </CardHeader>
          <CardContent>
            {a.topDebtors.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={a.topDebtors} layout="vertical" margin={{ left: 8, right: 12, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                  <XAxis type="number" stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={inrCompact} />
                  <YAxis type="category" dataKey="name" stroke={C.axis} fontSize={12} tickLine={false} axisLine={false} width={92} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v: number) => inr(v)} />
                  <Bar dataKey="due" name={t("Outstanding")} fill={C.accent} radius={[0, 5, 5, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                {t("No dues outstanding.")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
