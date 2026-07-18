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
