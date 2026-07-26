import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { getBillingInfo, type BillingInfo } from "@/lib/billing.functions";
import { PLANS, type PlanId } from "@/lib/plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, MessageCircle, Sparkles, ScanLine, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { whatsappLink, supportPhoneDisplay, supportPhoneDigits, FOUNDER_EMAIL } from "@/lib/support";

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {planOrder.map(id => {
          const p = PLANS[id];
          const current = billing?.plan === id;
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
                  {id === "pro" && (
                    <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      {t("Live GSTIN lookup — auto-fill business name + GST filer/defaulter rating for retailers & suppliers")}</li>
                  )}
                </ul>
                {!current && id !== "free" && (
                  <Button className="w-full" onClick={() => setPayPlan(id)}>
                    <ScanLine className="h-4 w-4 mr-2" />{t("Upgrade now")}
                  </Button>
                )}
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
                <div className="mx-auto flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center">
                  <ScanLine className="h-6 w-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {t("QR unavailable — please pay to the UPI number below.")}
                  </p>
                </div>
              ) : (
                <div className="mx-auto rounded-xl border bg-white p-3">
                  <img src="/upi-qr.png" alt={t("UPI QR code")} width={220} height={220}
                    onError={() => setQrBroken(true)}
                    className="h-[220px] w-[220px] object-contain" />
                </div>
              )}

              <div className="rounded-lg bg-muted/60 px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground">{t("Or pay to this UPI number")}</p>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(supportPhoneDigits().replace(/^91/, ""));
                    toast.success(t("Number copied"));
                  }}
                  className="mt-0.5 inline-flex items-center gap-1.5 font-medium hover:text-primary transition-colors">
                  {supportPhoneDisplay()} <Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                {t("The QR doesn't carry the amount — type {{amt}} yourself before paying.", { amt: inr(PLANS[payPlan].priceYearly) })}
              </p>

              <a href={upgradeHref(payPlan)} target="_blank" rel="noreferrer" className="block">
                <Button className="w-full">
                  <MessageCircle className="h-4 w-4 mr-2" />{t("I've paid — send screenshot")}
                </Button>
              </a>
              <p className="text-xs text-muted-foreground text-center">
                {t("Send the screenshot and your plan is activated the same day.")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("How to upgrade")}</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <p>1. {t("Tap \"Upgrade now\" on a plan and scan the UPI QR.")}</p>
          <p>2. {t("Pay by UPI or bank transfer.")}</p>
          <p>
            3. {t("Send the transaction screenshot to WhatsApp")}{" "}
            <a href={whatsappLink(t("Hi Jashan! Here is my payment screenshot for the Dhela upgrade."))}
              target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              {supportPhoneDisplay()}
            </a>{" "}
            {t("or email")}{" "}
            <a href={`mailto:${FOUNDER_EMAIL}`} className="font-medium text-primary hover:underline">{FOUNDER_EMAIL}</a>
            {" — "}{t("your plan is activated the same day.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
