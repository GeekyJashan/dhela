import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createLogger } from "./logger";

const log = createLogger("hsn.functions");

const SuggestionSchema = z.object({
  hsn: z.string().nullable().optional(),
  gst_rate: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  reasoning: z.string().nullable().optional(),
});

export type HsnSuggestion = z.infer<typeof SuggestionSchema>;

/** Normalize a product name (+ optional context) into a stable cache key. */
function suggestionKey(name: string, context?: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const base = norm(name);
  const ctx = context ? norm(context) : "";
  return ctx ? `${base}${ctx}` : base;
}

export const suggestHsn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(2),
      context: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }): Promise<HsnSuggestion> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = suggestionKey(data.name, data.context);

    // 1) Permanent, platform-wide cache. Once we've classified a product name
    //    we serve it forever — instant and free, no AI/FastAPI call.
    const { data: cached } = await supabaseAdmin.from("hsn_suggestions")
      .select("hsn, gst_rate, description, confidence")
      .eq("name_key", key).maybeSingle();
    if (cached && cached.hsn) {
      void supabaseAdmin.rpc("bump_hsn_suggestion_hit", { _name_key: key });
      log.info("suggestHsn:cache_hit", { hsn: cached.hsn, gst: cached.gst_rate });
      return {
        hsn: cached.hsn,
        gst_rate: cached.gst_rate,
        description: cached.description,
        confidence: cached.confidence,
        reasoning: null,
      };
    }

    // 2) First time we've seen this name — classify via the AI service.
    const apiUrl = process.env.EXTRACTION_API_URL ?? "http://localhost:8000";
    log.info("suggestHsn:start", { name: data.name, apiUrl });
    try {
      const resp = await fetch(`${apiUrl}/suggest-hsn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const body = await resp.text();
        log.error("suggestHsn:api_error", { status: resp.status, body: body.slice(0, 300) });
        throw new Error(`HSN service ${resp.status}: ${body.slice(0, 200)}`);
      }
      const json = await resp.json();
      const parsed = SuggestionSchema.parse(json);
      log.info("suggestHsn:ok", { hsn: parsed.hsn, gst: parsed.gst_rate });

      if (parsed.hsn && parsed.gst_rate != null) {
        // Cache the name → classification so this name is free next time.
        const { error: cacheErr } = await supabaseAdmin.from("hsn_suggestions").upsert(
          {
            name_key: key,
            name: data.name,
            hsn: parsed.hsn,
            gst_rate: parsed.gst_rate,
            description: parsed.description ?? null,
            confidence: parsed.confidence ?? null,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "name_key" },
        );
        if (cacheErr) log.error("suggestHsn:cache_failed", { err: cacheErr.message });

        // Also grow the searchable HSN reference — the seed list is a small
        // curated set, so codes the AI finds get added to the code table too.
        const { error: upsertErr } = await supabaseAdmin.from("hsn_codes").upsert(
          {
            code: parsed.hsn,
            description: parsed.description ?? data.name,
            gst_rate: parsed.gst_rate,
            category: null,
          },
          { onConflict: "code", ignoreDuplicates: true },
        );
        if (upsertErr) log.error("suggestHsn:upsert_failed", { err: upsertErr.message });
      }
      return parsed;
    } catch (e) {
      log.error("suggestHsn:fail", { err: (e as Error).message });
      throw e;
    }
  });
