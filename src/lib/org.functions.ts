import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Save the org's bank details + authorized signature for printed invoices. */
export const updateOrgInvoiceProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      bank_name: z.string().nullish(),
      bank_account_no: z.string().nullish(),
      bank_ifsc: z.string().nullish(),
      bank_branch: z.string().nullish(),
      upi_id: z.string().nullish(),
      signatory_name: z.string().nullish(),
      signature_image: z.string().nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    if (data.signature_image && data.signature_image.length > 400_000) {
      throw new Error("Signature image too large — use a smaller/cropped PNG");
    }
    const { error } = await supabase.from("organizations").update({
      bank_name: data.bank_name ?? null,
      bank_account_no: data.bank_account_no ?? null,
      bank_ifsc: data.bank_ifsc ?? null,
      bank_branch: data.bank_branch ?? null,
      upi_id: data.upi_id ?? null,
      signatory_name: data.signatory_name ?? null,
      signature_image: data.signature_image ?? null,
    }).eq("id", mem.org_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCurrentOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("memberships")
      .select("org_id, role, organizations(id, name, gstin)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("No organization for user");
    return {
      orgId: data.org_id as string,
      role: data.role as "admin" | "operator" | "accountant",
      org: data.organizations as { id: string; name: string; gstin: string | null },
    };
  });
