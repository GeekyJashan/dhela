import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PaymentsAnalytics } from "@/components/payments-analytics";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({ meta: [{ title: "Insights — Dhela" }] }),
  component: InsightsPage,
});

function InsightsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("Insights")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("How money is moving — collections, ageing, and who your business actually depends on.")}
        </p>
      </div>
      <PaymentsAnalytics />
    </div>
  );
}
