-- Cache of GST-API lookups so repeated verifications of the same GSTIN don't
-- spend a paid call. GST data is public and identical for everyone, so this is
-- shared across the whole platform (not org-scoped). Server-side only.
CREATE TABLE IF NOT EXISTS public.gstin_cache (
  gstin TEXT PRIMARY KEY,
  legal_name TEXT,
  trade_name TEXT,
  status TEXT,
  filer_rating TEXT,
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.gstin_cache TO service_role;
ALTER TABLE public.gstin_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role key (used by the verify server fn) reads/writes.
