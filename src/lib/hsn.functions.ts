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

export const suggestHsn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(2),
      context: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }): Promise<HsnSuggestion> => {
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
      return parsed;
    } catch (e) {
      log.error("suggestHsn:fail", { err: (e as Error).message });
      throw e;
    }
  });
