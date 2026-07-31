/**
 * Subscription plans. The billed meter is AI extractions per month — that's
 * the only per-use cost we carry (Gemini); OCR and everything else is
 * unlimited on every plan.
 */
export type PlanId = "free" | "standard" | "pro";

/**
 * Realtime voice is the one feature that bills by the minute rather than by
 * the request, and it bills while nobody is talking: the microphone streams
 * for as long as the session is open, so an abandoned tab costs money.
 *
 * The arithmetic behind the allowance, at gemini-3.1-flash-live-preview's
 * published rates — $0.005/min of audio in, $0.018/min out. Input runs for the
 * whole session; the model speaks maybe a third of it. Call it $0.010/min,
 * about ₹0.90. Sixty minutes is therefore ~₹55–70 a month at full use, against
 * Pro's ₹7,999/year — roughly ₹565/month net of GST. Worst case one workspace
 * can burn about an eighth of what it pays. That is a margin, not a hole.
 *
 * Sixty minutes is two minutes a day, which is a lot of "how much does Sharma
 * owe me". It is set low on purpose: raising a limit is a pleasant email and
 * lowering one is a broken promise.
 *
 * Nothing hard-stops. Past the allowance voice still works — it drops to the
 * slower request/response mode, which is metered by AI credits like everything
 * else. Paying customers should never meet a locked door.
 */
export const PLANS: Record<PlanId, {
  name: string;
  priceYearly: number;          // ₹, incl. GST
  aiExtractionsPerMonth: number;
  liveVoiceMinutesPerMonth: number;
}> = {
  free: { name: "Free", priceYearly: 0, aiExtractionsPerMonth: 15, liveVoiceMinutesPerMonth: 0 },
  standard: { name: "Standard", priceYearly: 3999, aiExtractionsPerMonth: 150, liveVoiceMinutesPerMonth: 0 },
  pro: { name: "Pro", priceYearly: 7999, aiExtractionsPerMonth: 500, liveVoiceMinutesPerMonth: 60 },
};

/** Hard ceiling on one conversation, so a forgotten tab has a bounded cost. */
export const LIVE_MAX_SESSION_SECONDS = 600;

/** Silence after which a session closes itself — nobody is there. */
export const LIVE_IDLE_TIMEOUT_SECONDS = 60;

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
