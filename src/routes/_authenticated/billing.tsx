import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { getBillingInfo, type BillingInfo } from "@/lib/billing.functions";
import { PLANS, type PlanId } from "@/lib/plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, MessageCircle, Sparkles, ScanLine, Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { whatsappLink, supportPhoneDisplay, emailLink, UPI_VPA, upiPayLink, FOUNDER_EMAIL } from "@/lib/support";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Dhela" }] }),
  component: BillingPage,
});

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function BillingPage() {
  const { t } = useTranslation();
  const fetchBilling = useServerFn(getBillingInfo);
  const [payPlan, setPayPlan] = useState<PlanId | null>(null);
  const [qrBroken, setQrBroken] = useState(false);
  // The route is ssr:false, so touching navigator here is safe.
  const isMobile = typeof navigator !== "undefined"
    && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const { data: billing } = useQuery({
    queryKey: ["billing_info"],
    queryFn: async () => (await fetchBilling()) as BillingInfo,
  });

  const usedPct = billing
    ? Math.min(100, Math.round((billing.aiUsedThisMonth / Math.max(1, billing.aiLimitPerMonth)) * 100))
    : 0;

  const upgradeHref = (plan: PlanId) =>
    whatsappLink(`Hi! I want to upgrade my Dhela workspace to the ${PLANS[plan].name} plan (${inr(PLANS[plan].priceYearly)}/year).`);

  const planOrder: PlanId[] = ["free", "standard", "pro"];

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {planOrder.map(id => {
          const p = PLANS[id];
          const current = billing?.plan === id;
          const features = [
            t("{{n}} AI bill reads / month", { n: p.aiExtractionsPerMonth }),
            t("Unlimited invoices, orders & payments"),
            t("Unlimited free OCR extraction"),
            t("E-way bills, statements & receivables ageing"),
            t("Stock and true weighted-average cost"),
            t("English, हिंदी & ਪੰਜਾਬੀ"),
            ...(id !== "free" ? [t("Priority support")] : []),
            ...(id === "pro" ? [t("Live GSTIN lookup + GST filer rating")] : []),
          ];
          return (
            <Card key={id} className={cn("flex flex-col", current && "border-primary shadow-sm")}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base font-medium text-muted-foreground">
                  {p.name}
                  {current && (
                    <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      {t("Current")}
                    </span>
                  )}
                </CardTitle>
                <div className="pt-1">
                  <span className="font-display text-4xl">
                    {p.priceYearly ? inr(Math.round(p.priceYearly / 12)) : "₹0"}
                  </span>
                  <span className="text-sm text-muted-foreground"> / {t("month")}</span>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.priceYearly
                      ? t("{{amt}} billed yearly", { amt: inr(p.priceYearly) })
                      : t("Free forever")}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="space-y-2 text-sm">
                  {features.map(f => (
                    <li key={f} className="flex gap-2">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                  <li className="flex gap-2">
                    <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                    {t("AI assistant — 1 read per question")}
                  </li>
                </ul>

                <div className="mt-auto pt-1">
                  {current ? (
                    <Button variant="outline" className="w-full" disabled>
                      {t("Your current plan")}
                    </Button>
                  ) : id === "free" ? (
                    <p className="text-center text-xs text-muted-foreground py-2.5">
                      {t("No card, no expiry")}
                    </p>
                  ) : (
                    <Button className="w-full" onClick={() => setPayPlan(id)}>
                      <ScanLine className="h-4 w-4 mr-2" />{t("Upgrade now")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!payPlan} onOpenChange={o => !o && setPayPlan(null)}>
        <DialogContent className="max-w-sm">
          {payPlan && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Pay for {{plan}}", { plan: PLANS[payPlan].name })}</DialogTitle>
              </DialogHeader>

              <div className="text-center">
                <p className="text-sm text-muted-foreground">{t("Scan and pay")}</p>
                <p className="font-display text-4xl mt-1">{inr(PLANS[payPlan].priceYearly)}</p>
                <p className="text-xs text-muted-foreground">{t("for one year, incl. GST")}</p>
              </div>

              {/* Static QR exported from the founder's own UPI app — it
                  encodes the real VPA, which a phone number alone cannot. */}
              {qrBroken ? (
                <div className="mx-auto flex h-[230px] w-[230px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center">
                  <ScanLine className="h-6 w-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {t("QR unavailable — please pay to the UPI ID below.")}
                  </p>
                </div>
              ) : (
                <div className="mx-auto rounded-xl border bg-white p-3">
                  <img src="/upi-qr.png" alt={t("UPI QR code")} width={795} height={900}
                    onError={() => setQrBroken(true)}
                    className="w-[230px] h-auto" />
                </div>
              )}

              <div className="rounded-lg bg-muted/60 px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground">{t("UPI ID")}</p>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(UPI_VPA);
                    toast.success(t("UPI ID copied"));
                  }}
                  className="mt-0.5 inline-flex items-center gap-1.5 font-medium hover:text-primary transition-colors">
                  {UPI_VPA} <Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Deep link only does anything on a phone with a UPI app, so
                  the QR stays the desktop path. */}
              {isMobile ? (
                <a href={upiPayLink(PLANS[payPlan].priceYearly, `Dhela ${PLANS[payPlan].name} plan`)}
                  className="block">
                  <Button className="w-full" size="lg">
                    {t("Pay {{amt}} in your UPI app", { amt: inr(PLANS[payPlan].priceYearly) })}
                  </Button>
                </a>
              ) : (
                <p className="text-xs text-muted-foreground text-center">
                  {t("Scan with any UPI app and enter {{amt}}.", { amt: inr(PLANS[payPlan].priceYearly) })}
                </p>
              )}

              <div className="rounded-lg border border-dashed p-3 space-y-2">
                <p className="text-xs font-medium text-center">
                  {t("After paying, send the transaction screenshot")}
                </p>
                <div className="flex gap-2">
                  <a href={upgradeHref(payPlan)} target="_blank" rel="noreferrer" className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      <MessageCircle className="h-4 w-4 mr-1.5" />{t("WhatsApp")}
                    </Button>
                  </a>
                  <a
                    href={emailLink(
                      `Dhela ${PLANS[payPlan].name} plan payment`,
                      `Hi Jashan,\n\nI have paid ${inr(PLANS[payPlan].priceYearly)} for the ${PLANS[payPlan].name} plan. Screenshot attached.\n\nWorkspace: `,
                    )}
                    className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      <Mail className="h-4 w-4 mr-1.5" />{t("Email")}
                    </Button>
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  {supportPhoneDisplay()} · {FOUNDER_EMAIL}
                </p>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                {t("Your plan is activated the same day.")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <p className="text-center text-xs text-muted-foreground">
        {t("Questions about a plan?")}{" "}
        <a href={whatsappLink(t("Hi Jashan! I have a question about Dhela plans."))}
          target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
          {supportPhoneDisplay()}
        </a>{" · "}
        <a href={`mailto:${FOUNDER_EMAIL}`} className="font-medium text-primary hover:underline">
          {FOUNDER_EMAIL}
        </a>
      </p>
    </div>
  );
}
