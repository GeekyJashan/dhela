import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, AreaChart,
  PieChart, Pie, Cell, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, HandCoins, AlertTriangle, Clock,
  Target, Landmark, Trophy, Activity, Users, FileText, ArrowLeftRight, Sparkles,
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
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const daysBetween = (a: number, b: number) => Math.floor((a - b) / 86_400_000);

const C = {
  in: "var(--success)",
  out: "var(--destructive)",
  primary: "var(--primary)",
  accent: "var(--accent)",
  warn: "var(--warning)",
  axis: "var(--muted-foreground)",
  grid: "var(--border)",
};
const MODE_COLORS: Record<string, string> = {
  cash: "var(--success)", upi: "var(--primary)", bank: "var(--accent)",
  cheque: "var(--warning)", other: "var(--muted-foreground)",
};

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

const tooltipStyle = {
  contentStyle: {
    background: "var(--popover)", border: "1px solid var(--border)",
    borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
  },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
};

/* --------------------------- primitives ----------------------------- */

function RadialGauge({ value, size = 118, stroke = 10, color, label, big }: {
  value: number; size?: number; stroke?: number; color: string; label?: string; big?: string;
}) {
  const v = useCountUp(clamp(value, 0, 100));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - v / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold tabular-nums leading-none" style={{ fontSize: size * 0.24 }}>
          {big ?? `${Math.round(v)}%`}
        </span>
        {label && <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{label}</span>}
      </div>
    </div>
  );
}

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={34}>
      <AreaChart data={rows} margin={{ top: 3, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area dataKey="v" type="monotone" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Kpi({
  icon, label, value, sub, delta, goodWhenUp = true, tone = "primary", index = 0,
  kind = "money", spark, sparkColor, sparkId,
}: {
  icon: React.ReactNode; label: string; value: number; sub?: string;
  delta?: number | null; goodWhenUp?: boolean; tone?: "primary" | "success" | "warning" | "destructive"; index?: number;
  kind?: "money" | "count"; spark?: number[]; sparkColor?: string; sparkId?: string;
}) {
  const shown = useCountUp(value);
  const toneBg: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/25 text-[oklch(0.45_0.09_75)]",
    destructive: "bg-destructive/10 text-destructive",
  };
  const up = (delta ?? 0) >= 0;
  const good = up === goodWhenUp;
  return (
    <Card className="relative overflow-hidden card-lift animate-pop-in" style={{ animationDelay: `${index * 70}ms` }}>
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
        <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
          {kind === "money" ? inr(shown) : Math.round(shown).toLocaleString("en-IN")}
        </div>
        <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/80 mt-1">{sub}</div>}
        {spark && spark.length > 1 && (
          <div className="-mx-1 mt-2 opacity-90"><Sparkline data={spark} color={sparkColor ?? C.primary} id={sparkId ?? label} /></div>
        )}
      </CardContent>
    </Card>
  );
}

function Insight({ icon, label, value, hint, tone = "primary", index = 0 }: {
  icon: React.ReactNode; label: string; value: string; hint: string;
  tone?: "primary" | "success" | "warning" | "destructive"; index?: number;
}) {
  const ring: Record<string, string> = {
    primary: "text-primary", success: "text-success",
    warning: "text-[oklch(0.5_0.1_75)]", destructive: "text-destructive",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-3.5 card-lift animate-pop-in" style={{ animationDelay: `${index * 70}ms` }}>
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

function Segmented<T extends string | number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { v: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
      {options.map(o => (
        <button key={String(o.v)} type="button" onClick={() => onChange(o.v)}
          className={cn("px-2.5 py-1 rounded-md transition-all",
            value === o.v ? "bg-card shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ main -------------------------------- */

export function PaymentsAnalytics() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<number>(6);

  const { data: payments } = useQuery({
    queryKey: ["pa_payments"],
    queryFn: async () => (await supabase.from("payments")
      .select("payment_date, amount, discount_amount, party_type, mode")
      .order("payment_date", { ascending: false }).limit(4000)).data ?? [],
  });

  const { data: invoices } = useQuery({
    queryKey: ["pa_sales_invoices"],
    queryFn: async () => (await supabase.from("sales_invoices")
      .select("invoice_date, due_date, subtotal, grand_total, total_profit, amount_paid, status, payment_status, retailer_id, retailer:retailers(name)")
      .in("status", ["issued", "paid"]).limit(8000)).data ?? [],
  });

  const a = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString("en-IN", { month: "short" }) });
    }
    const curKey = monthKey(now);
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const series = new Map(months.map(m => [m.key, { month: m.label, key: m.key, sales: 0, profit: 0, cashIn: 0, cashOut: 0 }]));

    let salesCur = 0, salesPrev = 0, profitCur = 0, profitPrev = 0;
    let collectedCur = 0, collectedPrev = 0, paidOutCur = 0, paidOutPrev = 0;
    let grandCur = 0, grandPrev = 0, countCur = 0, countPrev = 0;
    let sales90 = 0; const cut90 = now.getTime() - 90 * 86_400_000;
    const activeCur = new Set<string>();

    for (const inv of invoices ?? []) {
      const dt = new Date(inv.invoice_date);
      const k = monthKey(dt);
      const s = Number(inv.subtotal ?? 0), p = Number(inv.total_profit ?? 0), g = Number(inv.grand_total ?? 0);
      const row = series.get(k); if (row) { row.sales += s; row.profit += p; }
      if (k === curKey) { salesCur += s; profitCur += p; grandCur += g; countCur += 1; if (inv.retailer_id) activeCur.add(inv.retailer_id); }
      if (k === prevKey) { salesPrev += s; profitPrev += p; grandPrev += g; countPrev += 1; }
      if (dt.getTime() >= cut90) sales90 += s;
    }
    for (const pm of payments ?? []) {
      const dt = new Date(pm.payment_date);
      const k = monthKey(dt);
      const amt = Number(pm.amount ?? 0);
      const row = series.get(k);
      if (row) { if (pm.party_type === "retailer") row.cashIn += amt; else row.cashOut += amt; }
      if (pm.party_type === "retailer") { if (k === curKey) collectedCur += amt; if (k === prevKey) collectedPrev += amt; }
      else { if (k === curKey) paidOutCur += amt; if (k === prevKey) paidOutPrev += amt; }
    }

    // Point-in-time receivables + ageing.
    let outstanding = 0, overdue = 0, b0 = 0, b30 = 0, b60 = 0, billed90 = 0, collected90 = 0;
    const byRetailer = new Map<string, { name: string; due: number }>();
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
    const growth = pctChange(salesCur, salesPrev) ?? 0;
    const seriesArr = [...series.values()];
    const bestMonth = seriesArr.reduce((best, m) => m.sales > best.sales ? m : best, { month: "—", sales: 0 } as { month: string; sales: number });

    // Composite business-health score (0–100).
    const fCollection = clamp(collectionEff, 0, 100);
    const fMargin = clamp((marginCur / 25) * 100, 0, 100);
    const fOnTime = clamp(100 - overduePct, 0, 100);
    const fGrowth = clamp(50 + growth, 0, 100);
    const score = Math.round(fCollection * 0.3 + fMargin * 0.25 + fOnTime * 0.25 + fGrowth * 0.2);

    return {
      series: seriesArr,
      salesCur, salesPrev, profitCur, profitPrev, collectedCur, collectedPrev,
      netCur: collectedCur - paidOutCur, netPrev: collectedPrev - paidOutPrev,
      avgCur: countCur ? grandCur / countCur : 0, avgPrev: countPrev ? grandPrev / countPrev : 0,
      countCur, countPrev, activeCount: activeCur.size,
      outstanding, overdue, ageing, topDebtors,
      dso, collectionEff, overduePct, marginCur, growth, bestMonth, topDebtor: topDebtors[0],
      score, fCollection, fMargin, fOnTime,
    };
  }, [payments, invoices, t]);

  // Period-dependent slices (interactive).
  const view = useMemo(() => {
    const sliced = a.series.slice(-period);
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - period + 1, 1).getTime();
    const modeAgg = new Map<string, number>();
    for (const pm of payments ?? []) {
      if (pm.party_type !== "retailer") continue;
      if (new Date(pm.payment_date).getTime() < cutoff) continue;
      const m = (pm.mode as string) ?? "other";
      modeAgg.set(m, (modeAgg.get(m) ?? 0) + Number(pm.amount ?? 0));
    }
    const modeSplit = [...modeAgg.entries()]
      .map(([m, v]) => ({ name: m, value: Math.round(v), color: MODE_COLORS[m] ?? C.primary }))
      .sort((x, y) => y.value - x.value);
    const pSales = sliced.reduce((s, m) => s + m.sales, 0);
    const pProfit = sliced.reduce((s, m) => s + m.profit, 0);
    return { sliced, modeSplit, pSales, pProfit, pMargin: pSales ? (pProfit / pSales) * 100 : 0 };
  }, [a.series, payments, period]);

  const scoreColor = a.score >= 75 ? C.in : a.score >= 50 ? C.primary : a.score >= 30 ? C.warn : C.out;
  const verdict = a.score >= 75 ? t("Excellent") : a.score >= 50 ? t("Healthy") : a.score >= 30 ? t("Needs attention") : t("At risk");
  const spark = (key: "sales" | "profit" | "cashIn" | "net") =>
    a.series.slice(-6).map(m =>
      key === "net" ? m.cashIn - m.cashOut
      : key === "sales" ? m.sales
      : key === "profit" ? m.profit
      : m.cashIn);

  const periodOpts = [{ v: 3, label: t("3M") }, { v: 6, label: t("6M") }, { v: 12, label: t("12M") }];

  return (
    <div className="space-y-4">
      {/* Hero — business health */}
      <Card className="relative overflow-hidden border-0 text-primary-foreground animate-pop-in"
        style={{ background: "linear-gradient(135deg, var(--primary), oklch(0.32 0.07 200))" }}>
        <div className="hero-sheen pointer-events-none absolute inset-0" />
        <CardContent className="relative pt-6 pb-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex items-center gap-4">
              <div style={{ animation: "float-soft 6s ease-in-out infinite" }}>
                <RadialGauge value={a.score} size={128} stroke={11} color="var(--primary-foreground)" big={`${a.score}`} label={t("score")} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider opacity-80">
                  <Sparkles className="h-3.5 w-3.5" /> {t("Business health")}
                </div>
                <div className="text-3xl font-display leading-tight mt-1">{verdict}</div>
                <p className="text-sm opacity-80 mt-1 max-w-xs">
                  {t("A blend of collections, margin, overdue and growth.")}
                </p>
              </div>
            </div>
            <div className="md:ml-auto grid grid-cols-3 gap-5 md:gap-8">
              {[
                { label: t("Collections"), v: a.fCollection },
                { label: t("Margin"), v: a.fMargin },
                { label: t("On-time"), v: a.fOnTime },
              ].map((f, i) => (
                <div key={i} className="min-w-[84px]">
                  <div className="flex justify-between text-xs opacity-80"><span>{f.label}</span><span>{Math.round(f.v)}%</span></div>
                  <div className="h-1.5 rounded-full bg-white/20 mt-1.5 overflow-hidden">
                    <div className="h-full rounded-full bg-white/90 transition-all duration-1000"
                      style={{ width: `${clamp(f.v, 0, 100)}%`, transitionDelay: `${i * 120}ms` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI grid — 8 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi index={0} tone="primary" icon={<TrendingUp className="h-5 w-5" />} label={t("Net sales this month")}
          value={a.salesCur} sub={t("ex-GST")} delta={pctChange(a.salesCur, a.salesPrev)}
          spark={spark("sales")} sparkColor={C.primary} sparkId="sp-sales" />
        <Kpi index={1} tone="success" icon={<Target className="h-5 w-5" />} label={t("Profit this month")}
          value={a.profitCur} sub={t("{{m}}% margin", { m: a.marginCur.toFixed(1) })} delta={pctChange(a.profitCur, a.profitPrev)}
          spark={spark("profit")} sparkColor={C.in} sparkId="sp-profit" />
        <Kpi index={2} tone="primary" icon={<HandCoins className="h-5 w-5" />} label={t("Collected this month")}
          value={a.collectedCur} sub={t("Cash from retailers")} delta={pctChange(a.collectedCur, a.collectedPrev)}
          spark={spark("cashIn")} sparkColor={C.in} sparkId="sp-coll" />
        <Kpi index={3} tone={a.netCur >= 0 ? "success" : "destructive"} icon={<ArrowLeftRight className="h-5 w-5" />} label={t("Net cash flow")}
          value={a.netCur} sub={t("In minus out, this month")} delta={pctChange(a.netCur, a.netPrev)}
          spark={spark("net")} sparkColor={C.primary} sparkId="sp-net" />
        <Kpi index={4} tone={a.overdue > 0 ? "destructive" : "warning"} icon={<Wallet className="h-5 w-5" />} label={t("Outstanding to collect")}
          value={a.outstanding} goodWhenUp={false}
          sub={a.overdue > 0 ? t("{{amt}} overdue", { amt: inr(a.overdue) }) : t("Nothing overdue")} />
        <Kpi index={5} tone="primary" icon={<FileText className="h-5 w-5" />} label={t("Avg invoice value")}
          value={a.avgCur} sub={t("Per invoice, this month")} delta={pctChange(a.avgCur, a.avgPrev)} />
        <Kpi index={6} tone="primary" icon={<Activity className="h-5 w-5" />} label={t("Invoices this month")}
          value={a.countCur} kind="count" delta={pctChange(a.countCur, a.countPrev)} />
        <Kpi index={7} tone="success" icon={<Users className="h-5 w-5" />} label={t("Active retailers")}
          value={a.activeCount} kind="count" sub={t("Billed this month")} />
      </div>

      {/* Gauges + insight chips */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 card-lift animate-pop-in">
          <CardContent className="pt-5 grid grid-cols-3 gap-2 place-items-center">
            <div className="flex flex-col items-center gap-1">
              <RadialGauge value={a.collectionEff} size={92} color={a.collectionEff >= 85 ? C.in : a.collectionEff >= 60 ? C.warn : C.out} />
              <span className="text-xs text-muted-foreground text-center">{t("Collection")}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <RadialGauge value={a.marginCur} size={92} color={a.marginCur >= 15 ? C.in : a.marginCur >= 8 ? C.warn : C.out} big={`${a.marginCur.toFixed(0)}%`} />
              <span className="text-xs text-muted-foreground text-center">{t("Margin")}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <RadialGauge value={100 - a.overduePct} size={92} color={a.overduePct <= 10 ? C.in : a.overduePct <= 30 ? C.warn : C.out} />
              <span className="text-xs text-muted-foreground text-center">{t("On-time")}</span>
            </div>
          </CardContent>
        </Card>
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Insight index={0} icon={<Clock className="h-5 w-5" />} tone={a.dso > 45 ? "destructive" : a.dso > 25 ? "warning" : "success"}
            value={t("{{d}} days", { d: a.dso })} label={t("collection time")}
            hint={a.dso > 45 ? t("Slow — money is stuck with retailers.") : t("Healthy — cash returns quickly.")} />
          <Insight index={1} icon={<AlertTriangle className="h-5 w-5" />} tone={a.overduePct > 30 ? "destructive" : a.overduePct > 10 ? "warning" : "success"}
            value={`${a.overduePct}%`} label={t("dues overdue")}
            hint={a.topDebtor ? t("Chase {{name}} first.", { name: a.topDebtor.name }) : t("All dues within terms.")} />
          <Insight index={2} icon={<Trophy className="h-5 w-5" />} tone="primary"
            value={a.bestMonth.month} label={t("best month")}
            hint={t("Peak was {{amt}} — beat it.", { amt: inrCompact(a.bestMonth.sales) })} />
        </div>
      </div>

      {/* Period toggle + summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-sm text-muted-foreground">
          {t("Last {{n}} months:", { n: period })}{" "}
          <span className="font-medium text-foreground">{inrCompact(view.pSales)}</span> {t("sales")} ·{" "}
          <span className="font-medium text-foreground">{inrCompact(view.pProfit)}</span> {t("profit")} ·{" "}
          <span className="font-medium text-foreground">{view.pMargin.toFixed(1)}%</span> {t("margin")}
        </p>
        <Segmented value={period} onChange={setPeriod} options={periodOpts} />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 card-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" /> {t("Cash flow — money in vs out")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("Collections from retailers against payments to suppliers.")}</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={view.sliced} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="month" stroke={C.axis} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={52} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => inr(v)} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cashIn" name={t("Money in")} fill={C.in} radius={[5, 5, 0, 0]} maxBarSize={26} animationDuration={700} />
                <Bar dataKey="cashOut" name={t("Money out")} fill={C.out} radius={[5, 5, 0, 0]} maxBarSize={26} animationDuration={700} />
                <Line dataKey="profit" name={t("Profit")} type="monotone" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="card-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-primary" /> {t("How retailers pay")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("Payment mode split for the period.")}</p>
          </CardHeader>
          <CardContent>
            {view.modeSplit.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={view.modeSplit} dataKey="value" nameKey="name" innerRadius={54} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                    {view.modeSplit.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [inr(v), t(n)]} />
                  <Legend iconType="circle" formatter={(v: string) => t(v)} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">{t("No collections in this period.")}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 card-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> {t("Sales & profit trend")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("Net sales (ex-GST) and profit over time.")}</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={view.sliced} margin={{ left: -8, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.primary} stopOpacity={0.35} /><stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.in} stopOpacity={0.35} /><stop offset="100%" stopColor={C.in} stopOpacity={0.02} />
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

        <Card className="card-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-primary" /> {t("Who owes you most")}</CardTitle>
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
                  <Bar dataKey="due" name={t("Outstanding")} fill={C.accent} radius={[0, 5, 5, 0]} maxBarSize={22} animationDuration={700} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">{t("No dues outstanding.")}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
