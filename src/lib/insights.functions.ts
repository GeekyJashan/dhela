import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeInsights } from "./insights";

export type { Action } from "./insights";

/**
 * The dashboard's view of the business. The computation itself lives in
 * ./insights so the assistant can answer "how is the business going" from the
 * same numbers rather than a second implementation that drifts.
 */
export const businessInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => computeInsights(context.supabase as never));
