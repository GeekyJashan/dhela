-- Async order uploads: an uploaded order becomes a row that a background
-- worker fills in (mirrors the invoice queue). upload_status is NULL for
-- manually-created orders and queued/processing/done/failed for uploads.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS extraction_engine TEXT,
  ADD COLUMN IF NOT EXISTS upload_status TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_upload_status
  ON public.orders(upload_status) WHERE upload_status IS NOT NULL;
