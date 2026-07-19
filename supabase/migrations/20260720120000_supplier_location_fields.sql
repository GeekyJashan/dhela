-- Give suppliers the same GST-auto-filled location fields as retailers, so a
-- GSTIN lookup can populate state / city / pincode on the supplier form too.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;
