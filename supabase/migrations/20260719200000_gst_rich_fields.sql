-- Rich GST taxpayer details captured from the verification API.
ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS gst_constitution TEXT,       -- Proprietorship / Partnership / …
  ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,      -- Regular / Composition / …
  ADD COLUMN IF NOT EXISTS gst_registration_date TEXT;  -- as returned (dd/mm/yyyy)

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS gst_constitution TEXT,
  ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,
  ADD COLUMN IF NOT EXISTS gst_registration_date TEXT;

-- Cache the composed address bits too so a cache hit can auto-fill them.
ALTER TABLE public.gstin_cache
  ADD COLUMN IF NOT EXISTS constitution TEXT,
  ADD COLUMN IF NOT EXISTS taxpayer_type TEXT,
  ADD COLUMN IF NOT EXISTS registration_date TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;
