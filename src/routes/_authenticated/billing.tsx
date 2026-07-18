import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBillingInfo, type BillingInfo } from "@/lib/billing.functions";
import { PLANS, type PlanId } from "@/lib/plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, MessageCircle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Ledgerly" }] }),
  component: BillingPage,
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function BillingPage() {
  const { t } = useTranslation();
  const fetchBilling = useServerFn(getBillingInfo);

  const { data: billing } = useQuery({
    queryKey: ["billing_info"],
    queryFn: async () => (await fetchBilling()) as BillingInfo,
  });

  const usedPct = billing
    ? Math.min(100, Math.round((billing.aiUsedThisMonth / Math.max(1, billing.aiLimitPerMonth)) * 100))
    : 0;

  const supportPhone = (import.meta.env.VITE_SUPPORT_PHONE ?? "").replace(/\D/g, "");
  const upgradeHref = (plan: PlanId) => {
    const message = `Hi! I want to upgrade my Ledgerly workspace to the ${PLANS[plan].name} plan (${inr(PLANS[plan].priceYearly)}/year).`;
    const text = encodeURIComponent(message);
    return supportPhone
      ? `https://wa.me/${supportPhone.length === 10 ? "91" + supportPhone : supportPhone}?text=${text}`
      : `mailto:jsehgal2003@gmail.com?subject=${encodeURIComponent("Ledgerly upgrade")}&body=${text}`;
  };

  const planOrder: PlanId[] = ["free", "standard", "pro"];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("Plan & billing")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("AI invoice reading is the only metered feature — billing, stock, payments, and statements are unlimited on every plan.")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("AI extractions this month")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("{{used}} of {{limit}} used", { used: billing?.aiUsedThisMonth ?? 0, limit: billing?.aiLimitPerMonth ?? 0 })}
            </span>
            <span className="font-medium">
              {t("Current plan:")} {billing ? PLANS[billing.plan].name : "…"}
              {billing?.planValidTill ? ` · ${t("valid till")} ${billing.planValidTill}` : ""}
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usedPct >= 90 ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("The counter resets on the 1st of each month. The free OCR engine never counts against it.")}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {planOrder.map(id => {
          const p = PLANS[id];
          const current = billing?.plan === id;
          const href = upgradeHref(id);
          return (
            <Card key={id} className={current ? "border-primary shadow-sm" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {current && (
                    <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      {t("Current")}
                    </span>
                  )}
                </CardTitle>
                <div className="pt-1">
                  <span className="text-3xl font-semibold">
                    {p.priceYearly ? inr(Math.round(p.priceYearly / 12)) : t("Free")}
                  </span>
                  {p.priceYearly > 0 && <span className="text-sm text-muted-foreground"> / {t("month")}</span>}
                  {p.priceYearly > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t("{{amt}} billed yearly", { amt: inr(p.priceYearly) })}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1.5 text-sm">
                  <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    {t("{{n}} AI extractions / month", { n: p.aiExtractionsPerMonth })}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    {t("Unlimited invoices, orders & payments")}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    {t("Unlimited free OCR extraction")}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    {t("WhatsApp statements & reminders")}</li>
                  {id !== "free" && (
                    <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      {t("Priority support")}</li>
                  )}
                  <li className="flex gap-2">
                    <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                    <span>
                      {t("AI assistant — ask anything about your invoices, retailers, products and orders: spot discrepancies, or get answers like profit on a product between any two dates. Each question uses 1 AI extraction.")}
                    </span>
                  </li>
                </ul>
                {!current && id !== "free" && (
                  <a href={href} target="_blank" rel="noreferrer" className="block">
                    <Button className="w-full"><MessageCircle className="h-4 w-4 mr-2" />{t("Upgrade now")}</Button>
                  </a>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("Payment is collected via UPI/bank transfer after you reach out — your plan is activated the same day.")}
      </p>
    </div>
  );
}
