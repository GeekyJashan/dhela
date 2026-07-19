-- Mirror the retailer GST fields on suppliers so GSTIN verification works there too.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gst_status TEXT,
  ADD COLUMN IF NOT EXISTS gst_filer_rating TEXT;
