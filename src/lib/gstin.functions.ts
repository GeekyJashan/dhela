import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

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

export const verifyGstin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ gstin: z.string() }).parse(d))
  .handler(async ({ data }) => {
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
      source: "format" as "format" | "api",
    };
    if (!checksumOk) return base;

    // Live lookup. Default provider is Appyflow (key_secret param). A generic
    // Bearer provider can be used instead by setting GST_API_URL.
    const apiKey = process.env.GST_API_KEY;
    if (!apiKey) return base;
    const genericUrl = process.env.GST_API_URL;

    // Serve from the shared cache if we looked this GSTIN up recently.
    const CACHE_TTL_DAYS = 30;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cached } = await supabaseAdmin.from("gstin_cache")
      .select("legal_name, trade_name, status, filer_rating, fetched_at")
      .eq("gstin", gstin).maybeSingle();
    if (cached) {
      const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86_400_000;
      if (ageDays < CACHE_TTL_DAYS) {
        return {
          ...base,
          legalName: cached.legal_name,
          tradeName: cached.trade_name,
          status: cached.status,
          filerRating: cached.filer_rating,
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
        if (!resp.ok) { log.error("verifyGstin:api_error", { status: resp.status }); return base; }
        json = await resp.json();
      } else {
        // Appyflow: https://appyflow.in/api/verifyGST?gstNo=..&key_secret=..
        const url = `https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url);
        if (!resp.ok) { log.error("verifyGstin:appyflow_http", { status: resp.status }); return base; }
        json = await resp.json();
        if (json.error) { log.info("verifyGstin:appyflow_error", { msg: String(json.message ?? json.error) }); return base; }
      }

      // Merge possible response wrappers so field lookup works across shapes.
      const info = (json.taxpayerInfo ?? {}) as Record<string, unknown>;
      const wrap = (json.data ?? json.result ?? {}) as Record<string, unknown>;
      const d = { ...json, ...wrap, ...info } as Record<string, unknown>;

      // Guard: if the provider echoes a GSTIN that isn't the one we asked for,
      // it's a demo/unauthenticated response (invalid key) — never trust it.
      const returned = String(d.gstin ?? d.gstno ?? d.gstNo ?? "").toUpperCase();
      if (returned && returned !== gstin) {
        log.error("verifyGstin:gstin_mismatch", { asked: gstin, got: returned });
        return base;
      }

      const legalName = (d.legal_name ?? d.lgnm ?? d.legalName ?? d.name ?? null) as string | null;
      const tradeName = (d.trade_name ?? d.tradeNam ?? d.tradeName ?? null) as string | null;
      const status = (d.status ?? d.sts ?? d.gstin_status ?? null) as string | null;
      const filerRating = deriveFilerRating(status, d);

      // Cache the result so future lookups of this GSTIN are free.
      await supabaseAdmin.from("gstin_cache").upsert({
        gstin, legal_name: legalName, trade_name: tradeName,
        status, filer_rating: filerRating, raw: json as never, fetched_at: new Date().toISOString(),
      }, { onConflict: "gstin" });

      return { ...base, legalName, tradeName, status, filerRating, source: "api" as const };
    } catch (e) {
      log.error("verifyGstin:fetch_failed", { err: (e as Error).message });
      return base;
    }
  });
