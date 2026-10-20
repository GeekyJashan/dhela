/**
 * Subscription plans.
 *
 * Three tiers, and the middle one is the one being sold. Free proves it works,
 * Standard is the price on the poster, Pro is for whoever wants the assistant
 * talking back at them all day.
 *
 * PRICES
 *
 *   Free      ₹0
 *   Standard  ₹899 a year, about ₹75 a month
 *   Pro       ₹1,799 a year, about ₹150 a month
 *
 * Standard used to be ₹3,999 and Pro ₹7,999, and nobody ever chose Standard:
 * of 28 workspaces, 23 sat on Free and 5 on Pro. That was not a pricing
 * problem so much as a shape problem. Old Standard was Pro with less of the
 * same thing, and a tier that is only "less" is a tier to read past. These
 * three differ in kind: Free has no registry lookup at all, Standard has the
 * lookup and a taste of voice, Pro has voice properly.
 *
 * ₹899 is the number on the poster because a distributor deciding alone, out
 * of his own pocket, stops comparing somewhere under ₹1,000 and simply tries
 * it. Above that he asks his accountant, and that conversation is where
 * software purchases go to die.
 *
 * The reason underneath all of it: the businesses that most need stock and
 * GST handled properly are usually the ones least able to put ₹4,000 on
 * software before they know it works. We would rather earn less per
 * distributor and have far more of them keeping their books straight. The
 * margins below are a decision, not a consequence.
 *
 * WHAT EACH ONE COSTS US, HONESTLY
 *
 * A bill read is roughly ₹0.12. Live voice is about ₹0.90 a minute and bills
 * while nobody is talking, because the microphone streams for as long as the
 * session is open. Net of 18% GST:
 *
 *   Standard  ₹899/yr  = ₹63/month net
 *             200 reads ≈ ₹24, 30 seconds of voice ≈ ₹0.45
 *             → about ₹39 left at the worst case the caps allow
 *
 *   Pro       ₹1,799/yr = ₹127/month net
 *             400 reads ≈ ₹48, 30 minutes of voice ≈ ₹27
 *             → about ₹52 left
 *
 * Pro's price is set by its voice allowance and almost nothing else. An hour
 * a month costs ₹54 and forced Pro to ₹2,400 to clear 26%. Half an hour costs
 * ₹27, which pays for a ₹1,799 Pro at a healthier 41% and is still more voice
 * than anybody has ever used. Doubling Standard's price is also an easier step
 * for a customer to take than tripling it.
 *
 * Standard's thirty seconds is deliberate and is worth about forty-five paise
 * a month. It is not a usable allowance and is not meant to be one: it is the
 * only honest way to let somebody hear the feature before paying for it.
 *
 * RAISING IT LATER
 *
 * Published as founding prices, held for as long as a customer stays
 * subscribed. That is a promise to the people who back us early, and it is
 * also the only honest way to put numbers this low in writing: it lets the
 * price rise for whoever comes next without anybody feeling cheated.
 */
export type PlanId = "free" | "standard" | "pro";

export const PLANS: Record<PlanId, {
  name: string;
  priceYearly: number;          // ₹, incl. GST
  /** Rounded, for the "about ₹x a month" line. priceYearly is what is charged. */
  priceMonthly: number;
  aiExtractionsPerMonth: number;
  /**
   * Seconds, not minutes.
   *
   * Standard's allowance is thirty seconds, which has no honest expression in
   * whole minutes, and 0.5 in a field called "minutes" is the kind of thing
   * that gets multiplied by sixty twice.
   */
  liveVoiceSecondsPerMonth: number;
  /** Government registry lookup when adding a supplier or retailer. */
  gstinLookup: boolean;
}> = {
  free: {
    name: "Free",
    priceYearly: 0,
    priceMonthly: 0,
    aiExtractionsPerMonth: 15,
    liveVoiceSecondsPerMonth: 0,
    gstinLookup: false,
  },
  standard: {
    name: "Standard",
    priceYearly: 899,
    priceMonthly: 75,
    aiExtractionsPerMonth: 200,
    // Half a minute a month is not a feature, it is a demonstration: enough to
    // hear the thing answer out loud once and understand what Pro is for.
    liveVoiceSecondsPerMonth: 30,
    gstinLookup: true,
  },
  pro: {
    name: "Pro",
    priceYearly: 1799,
    priceMonthly: 150,
    aiExtractionsPerMonth: 400,
    // Thirty minutes, which at a minute a day is unlimited for anybody
    // actually working: live voice has run for nine minutes in the life of
    // the product, across every workspace. A literally uncapped allowance is
    // not possible on a feature billed by the minute that bills while nobody
    // is talking, and an hour of it is what made Pro cost ₹2,400.
    liveVoiceSecondsPerMonth: 30 * 60,
    gstinLookup: true,
  },
};

/**
 * The launch offer: pay for twelve months, get fourteen.
 *
 * Kept separate from the price rather than folded into it, because a discount
 * that moves the headline number teaches people to wait for the next one. The
 * price is ₹899. For a few weeks it buys more time, and then it does not.
 *
 * Past the date this is simply ignored, so nothing has to be remembered on the
 * day it expires.
 */
export const LAUNCH_OFFER = {
  /** Extra months granted on top of the year. */
  bonusMonths: 2,
  /** Last day it applies, inclusive. */
  until: "2026-11-30",
};

export function launchOfferLive(today = new Date().toISOString().slice(0, 10)): boolean {
  return today <= LAUNCH_OFFER.until;
}

/** Hard ceiling on one conversation, so a forgotten tab has a bounded cost. */
export const LIVE_MAX_SESSION_SECONDS = 600;

/** Silence after which a session closes itself — nobody is there. */
export const LIVE_IDLE_TIMEOUT_SECONDS = 60;

/** Paid plans lapse to free the day after plan_valid_till. */
export function effectivePlan(
  plan: string | null | undefined,
  validTill: string | null | undefined,
): PlanId {
  if (plan === "standard" || plan === "pro") {
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
