import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";
import { effectivePlan } from "./plans";

const log = createLogger("gstin.functions");

// GST state code → state name (used for interstate/intrastate + display).
const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory",
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Official GSTIN check-digit (mod-36, alternating weights 1/2). */
function checksumValid(gstin: string): boolean {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(gstin[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return CHARS[check] === gstin[14];
}

/** Map a GST API compliance/filing signal to a friendly filer rating. */
function deriveFilerRating(status: string | null, api: Record<string, unknown> | null): string {
  if (status && status.toLowerCase() !== "active") return "Defaulter";
  if (!api) return "Unrated";
  const rating = String(api.compliance_rating ?? api.complianceRating ?? "").trim();
  if (rating && /^[0-9.]+$/.test(rating)) {
    const n = Number(rating);
    return n >= 7 ? "Good" : n >= 4 ? "Average" : "Poor";
  }
  // Fall back to filing recency if the provider returns a returns list.
  const filings = (api.filing ?? api.returns ?? api.filingStatus) as unknown;
  if (Array.isArray(filings) && filings.length) {
    const late = filings.filter((f) => {
      const s = String((f as Record<string, unknown>)?.status ?? "").toLowerCase();
      return s.includes("not filed") || s.includes("delayed") || s.includes("late");
    }).length;
    const ratio = late / filings.length;
    return ratio === 0 ? "Good" : ratio <= 0.25 ? "Average" : "Poor";
  }
  return "Unrated";
}

type Taxpayer = {
  legalName: string | null; tradeName: string | null; status: string | null;
  constitution: string | null; taxpayerType: string | null; registrationDate: string | null;
  address: string | null; city: string | null; pincode: string | null; filerRating: string | null;
};

/** Extract taxpayer fields from a provider response (Appyflow/GSP shapes). */
function extractTaxpayer(json: Record<string, unknown>): Taxpayer {
  const info = (json.taxpayerInfo ?? {}) as Record<string, unknown>;
  const wrap = (json.data ?? json.result ?? {}) as Record<string, unknown>;
  const d = { ...json, ...wrap, ...info } as Record<string, unknown>;

  const pradr = (d.pradr ?? {}) as Record<string, unknown>;
  const addr = (pradr.addr ?? d.addr ?? {}) as Record<string, string>;
  const parts = [addr.bno, addr.flno, addr.bnm, addr.st, addr.loc, addr.landMark]
    .map(x => (x ?? "").trim()).filter(Boolean);
  const status = (d.status ?? d.sts ?? d.gstin_status ?? null) as string | null;

  return {
    legalName: (d.legal_name ?? d.lgnm ?? d.legalName ?? d.name ?? null) as string | null,
    tradeName: (d.trade_name ?? d.tradeNam ?? d.tradeName ?? null) as string | null,
    status,
    constitution: (d.ctb ?? d.constitution ?? d.constitutionOfBusiness ?? null) as string | null,
    taxpayerType: (d.dty ?? d.taxpayerType ?? d.taxPayerType ?? null) as string | null,
    registrationDate: (d.rgdt ?? d.registrationDate ?? d.rgdate ?? null) as string | null,
    address: parts.length ? parts.join(", ") : null,
    city: ((addr.city || addr.dst) ?? null) as string | null,
    pincode: (addr.pncd ?? null) as string | null,
    filerRating: deriveFilerRating(status, d),
  };
}

export const verifyGstin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ gstin: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const gstin = data.gstin.trim().toUpperCase();
    const formatOk = GSTIN_RE.test(gstin);
    const checksumOk = formatOk && checksumValid(gstin);
    const stateCode = gstin.slice(0, 2);
    const base = {
      gstin,
      valid: checksumOk,
      formatOk,
      stateCode,
      state: STATE_CODES[stateCode] ?? null,
      legalName: null as string | null,
      tradeName: null as string | null,
      status: null as string | null,
      filerRating: null as string | null,
      constitution: null as string | null,
      taxpayerType: null as string | null,
      registrationDate: null as string | null,
      address: null as string | null,
      city: null as string | null,
      pincode: null as string | null,
      source: "format" as "format" | "api",
      proRequired: false,
      lookupUnavailable: false,  // Pro, but the API couldn't return real data (no credits / bad key)
    };
    if (!checksumOk) return base;

    // Live business-name + filer lookup is a Pro-plan feature.
    const { data: mem } = await supabase.from("memberships")
      .select("organization:organizations(plan, plan_valid_till)")
      .eq("user_id", userId).limit(1).maybeSingle();
    const orgPlan = mem?.organization as { plan?: string; plan_valid_till?: string } | null;
    const plan = effectivePlan(orgPlan?.plan, orgPlan?.plan_valid_till);
    if (plan !== "pro") return { ...base, proRequired: true };

    // Live lookup. Default provider is Appyflow (key_secret param). A generic
    // Bearer provider can be used instead by setting GST_API_URL.
    const apiKey = process.env.GST_API_KEY;
    if (!apiKey) return { ...base, lookupUnavailable: true };
    const genericUrl = process.env.GST_API_URL;

    // Serve from the shared cache if we looked this GSTIN up recently.
    const CACHE_TTL_DAYS = 30;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cached } = await supabaseAdmin.from("gstin_cache")
      .select("legal_name, trade_name, status, filer_rating, constitution, taxpayer_type, registration_date, address, city, pincode, fetched_at")
      .eq("gstin", gstin).maybeSingle();
    if (cached) {
      const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86_400_000;
      if (ageDays < CACHE_TTL_DAYS) {
        return {
          ...base,
          legalName: cached.legal_name, tradeName: cached.trade_name, status: cached.status,
          filerRating: cached.filer_rating, constitution: cached.constitution,
          taxpayerType: cached.taxpayer_type, registrationDate: cached.registration_date,
          address: cached.address, city: cached.city, pincode: cached.pincode,
          source: "api" as const,
        };
      }
    }

    try {
      let json: Record<string, unknown>;
      if (genericUrl) {
        const url = genericUrl.includes("{gstin}") ? genericUrl.replace("{gstin}", gstin) : `${genericUrl}${gstin}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey, "Content-Type": "application/json" },
        });
        if (!resp.ok) { log.error("verifyGstin:api_error", { status: resp.status }); return { ...base, lookupUnavailable: true }; }
        json = await resp.json();
      } else {
        // Appyflow: https://appyflow.in/api/verifyGST?gstNo=..&key_secret=..
        const url = `https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url);
        if (!resp.ok) { log.error("verifyGstin:appyflow_http", { status: resp.status }); return { ...base, lookupUnavailable: true }; }
        json = await resp.json();
        if (json.error) { log.info("verifyGstin:appyflow_error", { msg: String(json.message ?? json.error) }); return { ...base, lookupUnavailable: true }; }
      }

      // Guard: if the provider echoes a GSTIN that isn't the one we asked for,
      // it's a demo/unauthenticated response (invalid key) — never trust it.
      const merged = { ...json, ...(json.data ?? {}), ...(json.taxpayerInfo ?? {}) } as Record<string, unknown>;
      const returned = String(merged.gstin ?? merged.gstno ?? merged.gstNo ?? "").toUpperCase();
      if (returned && returned !== gstin) {
        log.error("verifyGstin:gstin_mismatch", { asked: gstin, got: returned });
        return { ...base, lookupUnavailable: true };
      }

      const tp = extractTaxpayer(json);

      // Cache the result so future lookups of this GSTIN are free.
      await supabaseAdmin.from("gstin_cache").upsert({
        gstin, legal_name: tp.legalName, trade_name: tp.tradeName, status: tp.status,
        filer_rating: tp.filerRating, constitution: tp.constitution, taxpayer_type: tp.taxpayerType,
        registration_date: tp.registrationDate, address: tp.address, city: tp.city, pincode: tp.pincode,
        raw: json as never, fetched_at: new Date().toISOString(),
      }, { onConflict: "gstin" });

      return { ...base, ...tp, source: "api" as const };
    } catch (e) {
      log.error("verifyGstin:fetch_failed", { err: (e as Error).message });
      return { ...base, lookupUnavailable: true };
    }
  });
