import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { scoreProspect, type Registry } from "./lead-score";
import { scoreDiscovered, searchPhrases, type Discovered } from "./lead-discovery";

/**
 * The sales pipeline: add prospects, score them from the public GST registry,
 * and track where each one got to.
 *
 * Qualification runs here rather than in a script so the whole thing is one
 * paste into a screen. The scoring itself lives in ./lead-score, shared with
 * the CLI, so a weight changed in one place cannot disagree with the other.
 */

const log = createLogger("leads");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

/**
 * Declared here because integrations/supabase/types.ts is generated from the
 * live schema and will not know this table until someone regenerates it.
 */
export type Lead = {
  id: string;
  gstin: string | null;
  name: string;
  city: string | null;
  state: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  score: number;
  why: string | null;
  activity: string | null;
  constitution: string | null;
  taxpayer_type: string | null;
  status: "new" | "contacted" | "interested" | "won" | "lost";
  notes: string | null;
  next_action_on: string | null;
  source: string | null;
};

/**
 * The prospect pipeline belongs to whoever sells Dhela, not to the
 * distributors who buy it. Hiding the nav item and redirecting the route are
 * both client-side; this is the check that actually holds, because a crafted
 * POST reaches these functions without ever loading a screen.
 *
 * platform_admin lives in app_metadata, which only the service-role key can
 * set and which Supabase embeds in the signed JWT, so it cannot be spoofed.
 */
function assertPlatformAdmin(claims: Record<string, unknown>) {
  const meta = claims.app_metadata as { platform_admin?: boolean } | undefined;
  if (meta?.platform_admin !== true) throw new Error("Forbidden: admin only");
}

const LOOKUP = "https://tallysolutions.com/wp-content/themes/tally/api/gstin-serach-api.php";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;

/** Same free tool the app uses to onboard suppliers. No key, so no new cost. */
async function lookupGstin(gstin: string): Promise<Registry | null> {
  try {
    const resp = await fetch(LOOKUP, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://tallysolutions.com/business-tools-templates/gstin-verification-search/",
      },
      body: `gstin=${encodeURIComponent(gstin)}`,
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (Number(json.status) !== 1) return null;
    return {
      legalName: json.legal_name ?? null,
      tradeName: json.trade_name ?? null,
      status: json.gstin_status ?? null,
      constitution: json.business_constitution ?? null,
      taxpayerType: json.registration_type ?? null,
      registrationDate: json.registration_date ?? null,
      activity: json.business_activity ?? null,
      city: json.city ?? null,
      state: json.state ?? null,
      stateCode: gstin.slice(0, 2),
    };
  } catch (e) {
    log.error("lookup_failed", { err: (e as Error).message });
    return null;
  }
}

export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const { data, error } = await db.from("leads")
      .select("*")
      // Open ones first, best fit at the top: the list is a call order.
      .order("status", { ascending: true })
      .order("score", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return { leads: (data ?? []) as Lead[] };
  });

/**
 * Add prospects in bulk. Accepts one per line, either a bare GSTIN or
 * `GSTIN, name, phone, contact person` — because a list copied off a WhatsApp
 * message or a market roster never arrives as clean CSV.
 */
export const addLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      text: z.string().min(1).max(200_000),
      source: z.string().max(120).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;

    const rows = data.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      // Tolerate a pasted header row.
      .filter(l => !/^gstin\b/i.test(l));

    let added = 0, updated = 0, failed = 0, skipped = 0;
    const problems: string[] = [];

    for (const line of rows.slice(0, 500)) {
      const cells = line.split(/[,\t;]/).map(c => c.trim());
      const gstin = (cells.find(c => GSTIN_RE.test(c.toUpperCase())) ?? "").toUpperCase();
      if (!gstin) {
        skipped++;
        if (problems.length < 5) problems.push(`no GSTIN found in "${line.slice(0, 40)}"`);
        continue;
      }
      // Whatever else is on the line: a name, a phone, a person. Taken
      // positionally would be brittle, so each is recognised by shape.
      const rest = cells.filter(c => c.toUpperCase() !== gstin);
      const phone = rest.find(c => /^[+]?[\d\s-]{10,15}$/.test(c)) ?? null;
      const email = rest.find(c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) ?? null;
      const words = rest.filter(c => c !== phone && c !== email && c.length > 1);

      const reg = await lookupGstin(gstin);
      if (!reg) {
        failed++;
        if (problems.length < 5) problems.push(`${gstin} — registry lookup failed`);
        continue;
      }
      const res = scoreProspect(reg);

      const row = {
        gstin,
        name: reg.tradeName || reg.legalName || words[0] || gstin,
        city: reg.city, state: reg.state,
        contact_person: words.length > 1 ? words[1] : null,
        phone, email,
        score: res.score, why: res.reasons.join("; "),
        activity: reg.activity, constitution: reg.constitution,
        taxpayer_type: reg.taxpayerType, registration_date: reg.registrationDate,
        source: data.source ?? null,
        added_by: context.userId,
        updated_at: new Date().toISOString(),
      };

      // Re-importing a list must refresh a lead, never duplicate it — but must
      // not wipe a phone number someone typed in with a null from the registry.
      const { data: existing } = await db.from("leads")
        .select("id, phone, email, contact_person").eq("gstin", gstin).maybeSingle();
      if (existing) {
        const { error } = await db.from("leads").update({
          ...row,
          phone: phone ?? existing.phone,
          email: email ?? existing.email,
          contact_person: row.contact_person ?? existing.contact_person,
        }).eq("id", existing.id);
        if (error) { failed++; continue; }
        updated++;
      } else {
        const { error } = await db.from("leads").insert(row);
        if (error) { failed++; if (problems.length < 5) problems.push(`${gstin} — ${error.message}`); continue; }
        added++;
      }
      // The registry is a free tool someone else pays for.
      await new Promise(r => setTimeout(r, 900));
    }

    log.info("addLeads", { added, updated, failed, skipped });
    return { added, updated, failed, skipped, problems, capped: rows.length > 500 };
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["new", "contacted", "interested", "won", "lost"]).optional(),
      phone: z.string().max(20).nullable().optional(),
      email: z.string().max(120).nullable().optional(),
      contact_person: z.string().max(120).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
      next_action_on: z.string().nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const { id, ...patch } = data;
    const { error } = await db.from("leads")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const { error } = await db.from("leads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


/**
 * Find prospects rather than qualify given ones.
 *
 * Needs GOOGLE_MAPS_API_KEY — a Maps Platform key, not the Gemini key. They
 * are different products on the same account and the Gemini one is rejected
 * here, which is worth saying plainly because the error Google returns
 * ("API keys are not supported by this API") sounds like the key is wrong
 * rather than the API being disabled.
 */
export const discoverLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      trade: z.string().min(2).max(60),   // "sanitary ware", "pharma", "FMCG"
      city: z.string().min(2).max(60),
      limit: z.number().int().min(1).max(60).default(20),
    }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      // "Not set" is the same message whether it was never added, added to the
      // wrong environment, or added and never redeployed — and those need
      // different fixes. Naming the other server-side variables that ARE
      // visible separates them: if none are, the function is not seeing the
      // environment at all; if the others are, this one specifically is
      // missing or the deployment predates it. Names only, never values.
      const visible = ["GOOGLE_API_KEY", "SUPABASE_URL", "ANTHROPIC_API_KEY", "EXTRACTION_API_URL"]
        .filter(k => !!process.env[k]);
      log.error("discover:no_key", { visible });
      throw new Error(
        "GOOGLE_MAPS_API_KEY is not set on this deployment. " +
        (visible.length
          ? `Other server variables are visible (${visible.join(", ")}), so add this one in Vercel → Settings → Environment Variables and redeploy — an existing deployment keeps the environment it was built with.`
          : "No server variables are visible at all, which points at the deployment rather than this one key.") +
        " It must be a Maps Platform key with Places API (New) enabled; the Gemini key is rejected by Places.",
      );
    }
    const db = context.supabase as unknown as Db;

    const seen = new Map<string, Discovered>();
    for (const query of searchPhrases(data.trade, data.city)) {
      if (seen.size >= data.limit) break;
      const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          // Billed per field group, so ask for exactly what is scored and no more.
          "X-Goog-FieldMask": [
            "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
            "places.websiteUri", "places.types", "places.userRatingCount", "places.businessStatus",
          ].join(","),
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 20, regionCode: "IN" }),
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200);
        log.error("discover:places", { status: resp.status, body });
        throw new Error(`Places API ${resp.status}: ${body}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await resp.json();
      for (const p of json.places ?? []) {
        const name = p.displayName?.text as string | undefined;
        if (!name) continue;
        // The same business comes back under several phrasings; keyed on name
        // and address rather than the Places id, because the id changes when a
        // listing is edited and a duplicate in a call list wastes a call.
        const key2 = `${name}|${p.formattedAddress ?? ""}`.toLowerCase();
        if (seen.has(key2)) continue;
        seen.set(key2, {
          name,
          address: p.formattedAddress ?? null,
          phone: p.nationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          types: p.types ?? [],
          reviews: Number(p.userRatingCount ?? 0),
          open: (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL",
        });
      }
    }

    let added = 0, already = 0, closed = 0;
    for (const d of [...seen.values()].slice(0, data.limit)) {
      const res = scoreDiscovered(d);
      if (res.score === 0) { closed++; continue; }

      // Matched on phone first, then name: a business found by discovery has
      // no GSTIN, so the unique index cannot do this for us.
      const { data: dupe } = await db.from("leads")
        .select("id")
        .or(d.phone ? `phone.eq.${d.phone},name.ilike.${d.name}` : `name.ilike.${d.name}`)
        .maybeSingle();
      if (dupe) { already++; continue; }

      const { error } = await db.from("leads").insert({
        name: d.name,
        city: data.city,
        phone: d.phone,
        score: res.score,
        why: res.reasons.join("; "),
        activity: d.types.slice(0, 4).join(", ") || null,
        source: `Places · ${data.trade} in ${data.city}`,
        added_by: context.userId,
      });
      if (!error) added++;
    }

    log.info("discover", { trade: data.trade, city: data.city, found: seen.size, added, already, closed });
    return { found: seen.size, added, already, closed };
  });
