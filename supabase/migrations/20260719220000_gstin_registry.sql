-- Turn the GSTIN cache into a permanent platform-wide registry: no expiry,
-- with usage tracking so it becomes our own growing dataset.
ALTER TABLE public.gstin_cache
  ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

-- Atomic hit counter (avoids read-modify-write races on popular GSTINs).
CREATE OR REPLACE FUNCTION public.bump_gstin_hit(_gstin TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.gstin_cache
     SET hit_count = hit_count + 1, last_accessed_at = now()
   WHERE gstin = _gstin;
$$;

GRANT EXECUTE ON FUNCTION public.bump_gstin_hit(TEXT) TO service_role;
