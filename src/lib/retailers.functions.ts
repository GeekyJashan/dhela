import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("retailers.functions");

const RetailerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  gstin: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  state_code: z.string().nullish(),
  pincode: z.string().nullish(),
  price_tier: z.string().nullish(),
  category: z.enum(["A", "B", "C"]).default("C"),
  default_discount_pct: z.number().nullish(),
  credit_limit: z.number().nullish(),
  notes: z.string().nullish(),
  gst_status: z.string().nullish(),
  gst_filer_rating: z.string().nullish(),
});

export const upsertRetailer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RetailerInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    log.info("upsert:start", { id: data.id, name: data.name });
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    const payload = { ...data, org_id: mem.org_id, created_by: userId };
    const { data: row, error } = data.id
      ? await supabase.from("retailers").update(payload).eq("id", data.id).select().single()
      : await supabase.from("retailers").insert(payload).select().single();
    if (error) {
      log.error("upsert:failed", { err: error });
      throw new Error(error.message);
    }
    log.info("upsert:done", { id: row.id });
    return row;
  });

export const deleteRetailer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("retailers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
