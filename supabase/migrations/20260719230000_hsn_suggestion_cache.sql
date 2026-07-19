-- Permanent, platform-wide cache of AI HSN classifications keyed by product
-- name. Once the AI classifies a product name we store it here so future
-- lookups of the same name are instant and free (no FastAPI/AI call) — the
-- dataset grows across the whole platform, same idea as the GSTIN registry.
CREATE TABLE IF NOT EXISTS public.hsn_suggestions (
  name_key TEXT PRIMARY KEY,            -- normalized product name (+ context)
  name TEXT NOT NULL,                   -- original example that produced this
  hsn TEXT,
  gst_rate NUMERIC(6,2),
  description TEXT,
  confidence NUMERIC(6,3),
  hit_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);

-- Service-role only (platform-wide, not org-scoped), like gstin_cache.
GRANT ALL ON public.hsn_suggestions TO service_role;
ALTER TABLE public.hsn_suggestions ENABLE ROW LEVEL SECURITY;

-- Atomic hit counter (avoids read-modify-write races on popular names).
CREATE OR REPLACE FUNCTION public.bump_hsn_suggestion_hit(_name_key TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.hsn_suggestions
     SET hit_count = hit_count + 1, last_accessed_at = now()
   WHERE name_key = _name_key;
$$;

GRANT EXECUTE ON FUNCTION public.bump_hsn_suggestion_hit(TEXT) TO service_role;
