/**
 * Subscription plans. The billed meter is AI extractions per month — that's
 * the only per-use cost we carry (Gemini); OCR and everything else is
 * unlimited on every plan.
 */
export type PlanId = "free" | "standard" | "pro";

export const PLANS: Record<PlanId, {
  name: string;
  priceYearly: number;          // ₹, incl. GST
  aiExtractionsPerMonth: number;
}> = {
  free: { name: "Free", priceYearly: 0, aiExtractionsPerMonth: 15 },
  standard: { name: "Standard", priceYearly: 3999, aiExtractionsPerMonth: 150 },
  pro: { name: "Pro", priceYearly: 7999, aiExtractionsPerMonth: 500 },
};

/** Paid plans lapse to free the day after plan_valid_till. */
export function effectivePlan(plan: string | null | undefined, validTill: string | null | undefined): PlanId {
  if ((plan === "standard" || plan === "pro")) {
    if (!validTill) return plan; // no expiry set = manually granted, honour it
    const today = new Date().toISOString().slice(0, 10);
    if (validTill >= today) return plan;
  }
  return "free";
}

export function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
