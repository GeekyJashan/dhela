-- Subscription plans per organization. AI extraction quota is derived from
-- the invoices table (extraction_engine='ai' this month), so no counters.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','standard','pro'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_valid_till DATE;
