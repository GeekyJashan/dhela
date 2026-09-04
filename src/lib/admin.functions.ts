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
      supabaseAdmin.from("memberships")
        .select("user_id, organization:organizations(id, name, plan, plan_valid_till)"),
    ]);
    if (error) throw new Error(error.message);

    type OrgInfo = { id: string; name: string; plan: string; plan_valid_till: string | null };
    const orgByUser = new Map(
      (memberships ?? []).map(m => [m.user_id, m.organization as OrgInfo | null]),
    );

    return usersData.users.map(u => {
      const org = orgByUser.get(u.id) ?? null;
      return {
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        // Moves when the session is refreshed, which is what an app kept open
        // does all day. last_sign_in_at only moves when somebody actually
        // authenticates, so for a user who never signs out it freezes on the
        // day they last typed a password and reads as though they went quiet.
        updated_at: u.updated_at ?? null,
        confirmed: !!u.email_confirmed_at,
        org: org?.name ?? null,
        org_id: org?.id ?? null,
        plan: org?.plan ?? null,
        plan_valid_till: org?.plan_valid_till ?? null,
        platform_admin: (u.app_metadata as { platform_admin?: boolean })?.platform_admin === true,
      };
    });
  });

export const setOrgPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      orgId: z.string().uuid(),
      plan: z.enum(["free", "standard", "pro"]),
      validTill: z.string().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("organizations")
      .update({ plan: data.plan, plan_valid_till: data.validTill })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    log.info("setOrgPlan", { org: data.orgId, plan: data.plan, till: data.validTill, by: context.userId });
    return { ok: true };
  });

/**
 * Grant or revoke platform admin.
 *
 * Two things about this handler are worth knowing before changing it.
 *
 * First, `context.claims` comes from the signed JWT, which is minted at sign-in
 * and refreshed roughly hourly — so it says what was true when the token was
 * issued, not what is true now. Everywhere else in the app that is fine. Here
 * it is not: a just-demoted admin still holds a token that says otherwise, and
 * could use it to promote themselves straight back. So this one handler asks
 * the database whether the caller is *still* an admin instead of trusting the
 * token it arrived with.
 *
 * Second, the same staleness runs the other way and cannot be fixed from here.
 * Revoking someone does not reach their own token until it refreshes, so they
 * keep admin screens for up to an hour. supabase-js can only sign out a user
 * whose JWT you already hold (`admin.signOut(jwt)`), which we do not have for
 * someone else. The UI says this plainly rather than implying a switch that
 * takes effect at once.
 */
export const setPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The token claimed admin. Ask whether that is still true.
    const { data: caller } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const callerIsAdmin =
      (caller?.user?.app_metadata as { platform_admin?: boolean } | undefined)?.platform_admin === true;
    if (!callerIsAdmin) throw new Error("Forbidden: admin only");

    // The admin page is gated on this same flag, so taking it off yourself
    // closes the only door that could put it back — recovery would mean editing
    // raw JSON in the Supabase dashboard. Blocking it also guarantees the
    // platform never ends up with zero admins.
    if (data.userId === context.userId && !data.admin) {
      throw new Error("You can't remove your own admin access — ask another admin to do it.");
    }

    const { data: target, error: findErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (findErr || !target?.user) throw new Error("No such user");

    // updateUserById merges app_metadata keys rather than replacing the object,
    // so sending this one flag leaves provider and anything else in there alone.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      app_metadata: { platform_admin: data.admin },
    });
    if (error) throw new Error(error.message);

    // warn, not info: this is the line you want to be able to find later.
    log.warn("platform_admin:changed", {
      target: data.userId,
      email: target.user.email ?? null,
      admin: data.admin,
      by: context.userId,
    });
    return { ok: true, email: target.user.email ?? null };
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
