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
    // Partial update: only touch fields that were actually sent. This lets the
    // bank dialog and the signature dialog save independently — saving one must
    // never wipe the other. `undefined` = leave as-is; "" = explicit clear → null.
    const fields = [
      "bank_name", "bank_account_no", "bank_ifsc", "bank_branch", "upi_id",
      "signatory_name", "signature_image",
    ] as const;
    const update: Partial<Record<(typeof fields)[number], string | null>> = {};
    for (const f of fields) {
      const v = data[f];
      if (v !== undefined) update[f] = v === "" ? null : v;
    }
    if (Object.keys(update).length === 0) return { ok: true };
    const { error } = await supabase.from("organizations").update(update).eq("id", mem.org_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Zod's default error is a JSON dump of every issue, and server-fn errors are
 * shown to the user as a toast — so a bad GSTIN rendered a wall of JSON.
 * Surface the first human-readable message instead.
 */
function firstIssue<T>(schema: z.ZodType<T>, d: unknown): T {
  const r = schema.safeParse(d);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
  return r.data;
}

/**
 * The workspace's own business details — the ones that print on every invoice
 * and drive GST returns. Until now these could only be set at signup (name) or
 * not at all (GSTIN, address, state), so invoices went out without a GSTIN.
 */
export const updateOrgProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    firstIssue(z.object({
      name: z.string().trim().min(1, "Workspace name is required"),
      gstin: z.string().trim().nullish(),
      address: z.string().nullish(),
      state_code: z.string().nullish(),
      phone: z.string().nullish(),
      email: z.string().nullish(),
    }), d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id, role").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    if (mem.role !== "admin") throw new Error("Only an admin can change business details");

    const gstin = (data.gstin ?? "").trim().toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
      throw new Error("That doesn't look like a valid GSTIN");
    }
    // GSTIN's first two digits are the state code — keep them consistent rather
    // than letting the two fields drift apart and land in a GST return.
    const stateFromGstin = gstin ? gstin.slice(0, 2) : null;

    const blank = (v: string | null | undefined) => {
      const s = (v ?? "").trim();
      return s === "" ? null : s;
    };
    const { error } = await supabase.from("organizations").update({
      name: data.name.trim(),
      gstin: gstin || null,
      // organizations has no city/pincode columns — the full postal address
      // lives in `address`, which is what prints on an invoice anyway.
      address: blank(data.address),
      state_code: stateFromGstin ?? blank(data.state_code),
      phone: blank(data.phone),
      email: blank(data.email),
    }).eq("id", mem.org_id);
    if (error) throw new Error(error.message);
    return { ok: true, stateCode: stateFromGstin ?? blank(data.state_code) };
  });

/** Tables wiped by clearOrgData, children before parents. */
const CLEARABLE = [
  "payment_allocations", "payments",
  "credit_note_lines", "credit_notes",
  "sales_invoice_lines", "sales_invoices",
  "order_lines", "orders",
  "invoice_lines", "invoices",
  "product_price_overrides", "products",
  "retailers", "suppliers", "stock_groups",
  "assistant_messages",
] as const;

/**
 * Wipe every business record in the workspace, keeping the workspace itself,
 * its members and its business details so nobody locks themselves out.
 *
 * Irreversible and unrecoverable — there are no backups of an org's rows — so
 * the caller must retype the workspace name and the server checks it again
 * rather than trusting the client. Admins only.
 */
export const clearOrgData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => firstIssue(z.object({ confirmName: z.string() }), d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: mem } = await supabase.from("memberships")
      .select("org_id, role, organizations(name)").eq("user_id", userId).limit(1).maybeSingle();
    if (!mem) throw new Error("No organization");
    if (mem.role !== "admin") throw new Error("Only an admin can clear the workspace");

    const orgName = (mem.organizations as { name: string } | null)?.name ?? "";
    if (data.confirmName.trim() !== orgName.trim()) {
      throw new Error("The name you typed doesn't match the workspace name");
    }

    const cleared: Record<string, boolean> = {};
    for (const t of CLEARABLE) {
      const { error } = await supabase.from(t).delete().eq("org_id", mem.org_id);
      if (error) throw new Error(`Failed clearing ${t}: ${error.message}`);
      cleared[t] = true;
    }
    return { ok: true, tables: Object.keys(cleared).length };
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
