import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";

/**
 * Shared plumbing for specs that need to read or write rows directly.
 *
 * The service-role client bypasses RLS, so every query here sees EVERY
 * workspace in the database, not just the test one. A "select … limit 1" over
 * a shared table returns whatever row the database felt like returning, which
 * in practice has meant another customer's. Twice.
 *
 * So: resolve the org with e2eOrg() and filter by it. Anything that writes
 * must say whose workspace it means.
 */

function env(): Record<string, string> {
  return Object.fromEntries(
    fs.readFileSync(".env", "utf8").split("\n").filter(l => l.includes("=")).map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
  );
}

export function db(): SupabaseClient {
  const e = env();
  return createClient(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

/** The org behind E2E_EMAIL — the only one a test may touch. */
export async function e2eOrg(sb: SupabaseClient): Promise<string> {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  const user = data.users.find(u => u.email === process.env.E2E_EMAIL);
  if (!user) throw new Error(`No user for E2E_EMAIL=${process.env.E2E_EMAIL}`);
  const { data: mem } = await sb.from("memberships")
    .select("org_id").eq("user_id", user.id).limit(1).single();
  return (mem as { org_id: string }).org_id;
}
