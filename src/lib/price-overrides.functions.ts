import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid(),
  retailer_id: z.string().uuid().nullable(),
  selling_rate: z.number(),
  discount_pct: z.number().default(0),
  notes: z.string().nullable().optional(),
});

export const upsertPriceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const payload = { ...data, org_id: mem.org_id };
    const { data: row, error } = data.id
      ? await supabase.from("product_price_overrides").update(payload).eq("id", data.id).select().single()
      : await supabase.from("product_price_overrides").upsert(payload, { onConflict: "product_id,retailer_id" }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deletePriceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("product_price_overrides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
