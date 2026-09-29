import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLANS, effectivePlan, firstOfMonthISO, type PlanId } from "./plans";

export type BillingInfo = {
  plan: PlanId;
  planValidTill: string | null;
  aiUsedThisMonth: number;
  aiLimitPerMonth: number;
};

export async function getOrgBilling(
  supabase: { from: (t: string) => any },
  orgId: string,
): Promise<BillingInfo> {
  // Usage = AI-engine extractions + assistant questions this month.
  const [{ data: org }, { count: aiCount }, { count: askCount }] = await Promise.all([
    supabase.from("organizations").select("plan, plan_valid_till").eq("id", orgId).single(),
    supabase.from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("extraction_engine", "ai")
      .gte("created_at", firstOfMonthISO()),
    supabase.from("assistant_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("created_at", firstOfMonthISO()),
  ]);
  const plan = effectivePlan(org?.plan, org?.plan_valid_till);
  return {
    plan,
    planValidTill: org?.plan_valid_till ?? null,
    aiUsedThisMonth: (aiCount ?? 0) + (askCount ?? 0),
    aiLimitPerMonth: PLANS[plan].aiExtractionsPerMonth,
  };
}

export const getBillingInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingInfo> => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    return getOrgBilling(supabase, mem.org_id);
  });

/**
 * A plan change this person has not been told about yet.
 *
 * Asked on a poll rather than pushed. The change is made on the admin screen
 * while the customer is somewhere else entirely, so what matters is not
 * delivering it the instant it happens but having it waiting whenever they next
 * look. React Query refetches on window focus, which covers the common case of
 * a distributor who has the tab open and is refreshing it hopefully after
 * sending the payment screenshot.
 */
export type PlanNotice = {
  plan: PlanId;
  /** Always present: a change we cannot name the origin of is not announced. */
  previousPlan: PlanId;
  /** Upgrade is celebrated; a downgrade is told plainly. */
  direction: "upgrade" | "downgrade";
  planValidTill: string | null;
  aiPerMonth: number;
  voiceMinutesPerMonth: number;
  changedAt: string;
};

const PLAN_RANK: Record<PlanId, number> = { free: 0, standard: 1, pro: 2 };

export const getPlanNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlanNotice | null> => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) return null;

    const [{ data: org }, { data: ack }] = await Promise.all([
      supabase.from("organizations")
        .select("plan, plan_valid_till, plan_previous, plan_changed_at")
        .eq("id", mem.org_id).single(),
      supabase.from("plan_change_acks")
        .select("acknowledged_change_at")
        .eq("org_id", mem.org_id).eq("user_id", userId).maybeSingle(),
    ]);

    // No change ever recorded — every workspace that predates this feature.
    if (!org?.plan_changed_at) return null;
    // Told already. Compared rather than flagged so a later change notifies again.
    if (ack?.acknowledged_change_at && ack.acknowledged_change_at >= org.plan_changed_at) return null;

    const plan = effectivePlan(org.plan, org.plan_valid_till);
    const previousPlan = (org.plan_previous ?? null) as PlanId | null;
    // Nothing worth saying, in two shapes. A stamp with no previous plan can
    // only come from a hand-edited row, and without it the dialog cannot tell
    // an upgrade from a downgrade — it would cheerfully congratulate somebody
    // on dropping to Free. And a change whose effective plan matches what they
    // were on is not news: setOrgPlan will not create one, but a plan that
    // lapsed between the stamp and this read can.
    if (!previousPlan || previousPlan === plan) return null;

    return {
      plan,
      previousPlan,
      direction: PLAN_RANK[plan] > PLAN_RANK[previousPlan] ? "upgrade" : "downgrade",
      planValidTill: org.plan_valid_till ?? null,
      aiPerMonth: PLANS[plan].aiExtractionsPerMonth,
      voiceMinutesPerMonth: PLANS[plan].liveVoiceMinutesPerMonth,
      changedAt: org.plan_changed_at,
    };
  });

/**
 * Mark the current plan change as seen by this user.
 *
 * Stamps the organization's own plan_changed_at rather than now(), so a change
 * made while the dialog was open is not swallowed: the next poll sees a newer
 * timestamp and tells them about that one too.
 */
export const dismissPlanNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) return { ok: true };

    const { data: org } = await supabase.from("organizations")
      .select("plan_changed_at").eq("id", mem.org_id).single();
    if (!org?.plan_changed_at) return { ok: true };

    const { error } = await supabase.from("plan_change_acks").upsert({
      org_id: mem.org_id,
      user_id: userId,
      acknowledged_change_at: org.plan_changed_at,
    }, { onConflict: "org_id,user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
