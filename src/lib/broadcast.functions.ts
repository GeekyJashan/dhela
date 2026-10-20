/**
 * Mass email and the site-wide banner. Platform admins only.
 *
 * Every handler here runs on the service key, so the platform_admin check is
 * the only thing between a signed-in distributor and the whole user list. It is
 * repeated in each one on purpose rather than hidden in a wrapper: this is the
 * file where a missing guard would be worst, so the guard should be visible in
 * every function without scrolling anywhere.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("broadcast.functions");

function assertPlatformAdmin(claims: Record<string, unknown>) {
  const meta = claims.app_metadata as { platform_admin?: boolean } | undefined;
  if (meta?.platform_admin !== true) throw new Error("Forbidden: admin only");
}

/* ----------------------------- audience ----------------------------- */

export type AudienceSource = "users" | "leads" | "retailers";

export type Recipient = {
  email: string;
  name: string | null;
  source: AudienceSource;
  /** Set when the address will not be mailed, with the reason in `note`. */
  excluded?: boolean;
  note?: string;
};

const audienceInput = z.object({
  sources: z.array(z.enum(["users", "leads", "retailers"])).default(["users"]),
  /** Addresses struck out by hand on the compose screen. */
  exclude: z.array(z.string()).default([]),
  /** Extra addresses typed in by hand, not from any source. */
  include: z.array(z.string()).default([]),
});

const clean = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
const isEmail = (e: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e);

/**
 * Work out who a campaign would actually reach.
 *
 * Resolution order matters and is the whole value of this function:
 *   1. pull every address from the chosen sources
 *   2. add hand-typed ones
 *   3. fold duplicates, keeping the first source that supplied the address
 *   4. drop anything opted out, and anything struck out by hand
 *
 * Opt-outs are applied last and cannot be undone by `include`. Someone who has
 * unsubscribed stays unsubscribed even if their address is typed in by hand.
 */
async function resolveAudience(input: z.infer<typeof audienceInput>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const found: Recipient[] = [];

  if (input.sources.includes("users")) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
      const email = clean(u.email);
      // An unconfirmed address has never been proven to belong to anyone.
      // Mailing it is how a typo in somebody else's domain becomes a complaint.
      if (email && isEmail(email) && u.email_confirmed_at) {
        found.push({ email, name: null, source: "users" });
      }
    }
  }

  if (input.sources.includes("leads")) {
    const { data } = await supabaseAdmin.from("leads").select("name, email").not("email", "is", null);
    for (const l of data ?? []) {
      const email = clean(l.email);
      if (email && isEmail(email)) found.push({ email, name: l.name ?? null, source: "leads" });
    }
  }

  if (input.sources.includes("retailers")) {
    const { data } = await supabaseAdmin.from("retailers").select("name, email").not("email", "is", null);
    for (const r of data ?? []) {
      const email = clean(r.email);
      if (email && isEmail(email)) found.push({ email, name: r.name ?? null, source: "retailers" });
    }
  }

  for (const raw of input.include) {
    const email = clean(raw);
    if (email && isEmail(email)) found.push({ email, name: null, source: "users" });
  }

  // Fold duplicates. The same person is often a user and a lead.
  const byEmail = new Map<string, Recipient>();
  for (const r of found) if (!byEmail.has(r.email)) byEmail.set(r.email, r);

  const { data: optouts } = await supabaseAdmin.from("email_optouts").select("email");
  const optedOut = new Set((optouts ?? []).map(o => clean(o.email)));
  const struck = new Set(input.exclude.map(clean));

  const all = [...byEmail.values()].map(r => {
    if (optedOut.has(r.email)) return { ...r, excluded: true, note: "unsubscribed" };
    if (struck.has(r.email)) return { ...r, excluded: true, note: "removed by you" };
    return r;
  });

  all.sort((a, b) => a.email.localeCompare(b.email));
  return all;
}

/** Who would receive this, without sending anything. */
export const previewAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => audienceInput.parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { emailConfigured } = await import("./email.server");
    const recipients = await resolveAudience(data);
    return {
      recipients,
      willSend: recipients.filter(r => !r.excluded).length,
      excluded: recipients.filter(r => r.excluded).length,
      /** False means the compose screen should refuse to send and say why. */
      configured: emailConfigured(),
    };
  });

/* ------------------------------- send ------------------------------- */

export const sendCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    audienceInput.extend({
      subject: z.string().min(1, "A subject is required").max(200),
      body: z.string().min(1, "The message is empty"),
      /** Strip the branding so it reads as a personal note. */
      plain: z.boolean().default(false),
      /** Must be true. A send is not something to trigger by accident. */
      confirm: z.literal(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendBatch, unsubscribeUrl, emailConfigured } = await import("./email.server");

    if (!emailConfigured()) {
      throw new Error("RESEND_API_KEY is not set, so nothing can be sent yet.");
    }

    const recipients = (await resolveAudience(data)).filter(r => !r.excluded);
    if (!recipients.length) throw new Error("That audience has nobody in it.");

    const { data: campaign, error: cErr } = await supabaseAdmin.from("email_campaigns").insert({
      subject: data.subject,
      body: data.body,
      audience: { sources: data.sources, include: data.include, exclude: data.exclude, plain: data.plain },
      status: "sending",
      created_by: context.userId,
    }).select("id").single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Could not start the campaign");

    // Written before a single mail goes out, so a crash mid-send still leaves a
    // record of who was in scope.
    await supabaseAdmin.from("email_recipients").insert(
      recipients.map(r => ({
        campaign_id: campaign.id, email: r.email, name: r.name, source: r.source,
      })),
    );

    log.warn("campaign:sending", {
      campaign: campaign.id, count: recipients.length,
      sources: data.sources, by: context.userId,
    });

    const results = await sendBatch(recipients.map(r => ({
      to: r.email,
      subject: data.subject,
      body: data.body,
      unsubscribe: unsubscribeUrl(r.email),
      plain: data.plain,
    })));

    let sent = 0, failed = 0;
    for (const r of results) {
      if (r.ok) sent++; else failed++;
      await supabaseAdmin.from("email_recipients")
        .update({
          status: r.ok ? "sent" : "failed",
          error: r.error ?? null,
          sent_at: r.ok ? new Date().toISOString() : null,
        })
        .eq("campaign_id", campaign.id).eq("email", r.email);
    }

    await supabaseAdmin.from("email_campaigns").update({
      status: failed && !sent ? "failed" : "sent",
      sent_count: sent, failed_count: failed,
      sent_at: new Date().toISOString(),
      error: failed && !sent ? (results[0]?.error ?? "every message failed") : null,
    }).eq("id", campaign.id);

    log.warn("campaign:sent", { campaign: campaign.id, sent, failed });
    return { ok: true, campaignId: campaign.id, sent, failed };
  });

export const listCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("email_campaigns")
      .select("id, subject, status, sent_count, failed_count, created_at, sent_at, audience")
      .order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

/* ---------------------------- announcements --------------------------- */

export type Announcement = {
  id: string;
  message: string;
  tone: "info" | "warning" | "success";
  link_url: string | null;
  link_label: string | null;
  dismissible: boolean;
};

/**
 * The banner to show right now, for any signed-in user.
 *
 * The only handler in this file without an admin check, because every user has
 * to be able to read it. It returns one row and only the fields that get
 * rendered, so being able to call it reveals nothing beyond the banner itself.
 */
export const getActiveAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<Announcement | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin.from("site_announcements")
      .select("id, message, tone, link_url, link_label, dismissible, starts_at, ends_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);

    // Windows are filtered here rather than in the query: two optional bounds
    // with NULL meaning "no bound" is a knot of or() clauses in PostgREST and
    // perfectly clear in three lines of JavaScript.
    const live = (data ?? []).find(a =>
      (!a.starts_at || a.starts_at <= now) && (!a.ends_at || a.ends_at >= now));
    if (!live) return null;

    return {
      id: live.id, message: live.message,
      tone: live.tone as Announcement["tone"],
      link_url: live.link_url, link_label: live.link_label,
      dismissible: live.dismissible,
    };
  });

export const listAnnouncements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("site_announcements")
      .select("*").order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

export const saveAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      message: z.string().min(1).max(300),
      tone: z.enum(["info", "warning", "success"]).default("info"),
      link_url: z.string().nullish(),
      link_label: z.string().nullish(),
      dismissible: z.boolean().default(true),
      ends_at: z.string().nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // One banner at a time. Publishing a new one retires the old rather than
    // leaving two active and letting ordering decide which wins.
    await supabaseAdmin.from("site_announcements").update({ active: false }).eq("active", true);

    const { data: row, error } = await supabaseAdmin.from("site_announcements").insert({
      message: data.message,
      tone: data.tone,
      link_url: data.link_url || null,
      link_label: data.link_label || null,
      dismissible: data.dismissible,
      ends_at: data.ends_at || null,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);

    log.warn("announcement:published", { id: row?.id, by: context.userId });
    return { ok: true, id: row?.id };
  });

/** Take the banner down. Leaves the row, so it can be put back up. */
export const clearAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims as Record<string, unknown>);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("site_announcements").update({ active: false }).eq("active", true);
    log.warn("announcement:cleared", { by: context.userId });
    return { ok: true };
  });
