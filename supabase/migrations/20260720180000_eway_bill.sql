-- E-way bill (Phase 1, free): capture transport details + the EBN a distributor
-- generates on the government portal (or via the NIC bulk tool), so it can be
-- stored, printed on the invoice, and tracked for expiry. Part A is derived
-- from the invoice itself; only Part B (vehicle) and the returned EBN are new.
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS ewb_no TEXT,                 -- 12-digit e-way bill number
  ADD COLUMN IF NOT EXISTS ewb_date DATE,               -- generated on
  ADD COLUMN IF NOT EXISTS ewb_valid_upto DATE,         -- validity (≈1 day / 200 km)
  ADD COLUMN IF NOT EXISTS ewb_vehicle_no TEXT,         -- Part B
  ADD COLUMN IF NOT EXISTS ewb_transport_mode TEXT,     -- road / rail / air / ship
  ADD COLUMN IF NOT EXISTS ewb_distance_km INTEGER,
  ADD COLUMN IF NOT EXISTS ewb_transporter_id TEXT,     -- optional transporter GSTIN
  ADD COLUMN IF NOT EXISTS ewb_transporter_name TEXT;
