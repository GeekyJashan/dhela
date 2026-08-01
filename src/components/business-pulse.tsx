import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, TrendingUp, Wallet, Boxes, Clock } from "lucide-react";
import { businessInsights } from "@/lib/insights.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The two questions an owner has that a list of invoices cannot answer: is the
 * money I have tied up earning anything, and what should I do about it today.
 *
 * Deliberately not a chart wall. Every row here is a rupee figure with one
 * place to go and act, ordered by how much money is at stake, because that is
 * the order a morning should be spent in.
 */

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

function Figure({ icon: Icon, label, value, hint, tone }: {
  icon: typeof Wallet; label: string; value: string; hint?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className={`mt-1.5 font-display text-2xl leading-none ${
        tone === "warn" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BusinessPulse() {
  const { t } = useTranslation();
  const run = useServerFn(businessInsights);
  const { data, isLoading } = useQuery({
    queryKey: ["business-insights"],
    queryFn: () => run({ data: undefined }),
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data) return null;
  const h = data.headline;
  const actions = data.actions ?? [];

  return (
    <div className="space-y-4">
      {!h.enoughToJudge && (
        <p className="text-xs text-muted-foreground">
          {t("Based on {{n}} sale(s) in the last {{d}} days — the ratios below need a bit more history before they mean much.",
             { n: h.salesCount, d: h.periodDays })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          icon={Wallet}
          label={t("Working capital locked")}
          value={inr(h.workingCapital)}
          hint={t("stock {{s}} + owed to you {{r}} − owed by you {{p}}", {
            s: inr(h.stockValue), r: inr(h.receivable), p: inr(h.payable),
          })}
        />
        <Figure
          icon={TrendingUp}
          label={t("Return on that capital")}
          value={h.capitalReturnPct == null ? "—" : `${h.capitalReturnPct}%`}
          // The benchmark distributors are held to. Below it, the business is
          // largely funding its own shelves.
          hint={t("a year at this rate · healthy is 12–16%")}
          tone={h.capitalReturnPct == null ? undefined : h.capitalReturnPct < 12 ? "warn" : "good"}
        />
        <Figure
          icon={Clock}
          label={t("Cash collection")}
          value={h.dsoDays == null ? "—" : t("{{n}} days", { n: h.dsoDays })}
          hint={t("from sale to money in the bank")}
        />
        <Figure
          icon={Boxes}
          label={t("Stock cover")}
          value={h.stockCoverDays == null ? "—" : t("{{n}} days", { n: h.stockCoverDays })}
          hint={t("at the last {{n}} days' rate", { n: h.periodDays })}
        />
      </div>

      {actions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("Worth doing this week")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {actions.slice(0, 4).map(a => (
              <Link key={a.kind} to={a.to}
                className="group block rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm group-hover:text-primary transition-colors">
                      {a.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                {a.items.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t pt-2.5">
                    {a.items.map((it, n) => (
                      <li key={n} className="flex justify-between gap-3 text-xs">
                        <span className="truncate text-muted-foreground">
                          {it.name}
                          {it.note && <span className="ml-1.5 opacity-70">· {it.note}</span>}
                        </span>
                        <span className="tabular-nums shrink-0">{inr(it.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
