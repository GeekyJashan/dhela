import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("admin.functions");

// platform_admin lives in app_metadata, which only the service-role key can
// set and which Supabase embeds in the signed JWT — so this check can't be
// spoofed from the client.
function assertPlatformAdmin(claims: Record<string, unknown>) {
  const meta = claims.app_metadata as { platform_admin?: boolean } | undefined;
  if (meta?.platform_admin !== true) throw new Error("Forbidden: admin only");
}

export const listAppUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: usersData, error }, { data: memberships }] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 500 }),
      supabaseAdmin.from("memberships").select("user_id, organization:organizations(name)"),
    ]);
    if (error) throw new Error(error.message);

    const orgByUser = new Map(
      (memberships ?? []).map(m => [m.user_id, (m.organization as { name: string } | null)?.name ?? null]),
    );

    return usersData.users.map(u => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: !!u.email_confirmed_at,
      org: orgByUser.get(u.id) ?? null,
      platform_admin: (u.app_metadata as { platform_admin?: boolean })?.platform_admin === true,
    }));
  });

export const generateUserMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    log.info("magic_link:generated", { for: data.email, by: context.userId });
    return { action_link: link.properties.action_link };
  });
