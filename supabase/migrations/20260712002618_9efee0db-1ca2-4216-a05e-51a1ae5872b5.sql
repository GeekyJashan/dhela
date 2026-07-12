ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'queued';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS extraction_engine text;

CREATE INDEX IF NOT EXISTS invoices_status_created_idx
  ON public.invoices (status, created_at);