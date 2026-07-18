-- GST verification metadata on retailers.
ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS gst_status TEXT,          -- Active / Cancelled / Suspended / …
  ADD COLUMN IF NOT EXISTS gst_filer_rating TEXT;    -- Good / Average / Poor / Defaulter / Unrated
