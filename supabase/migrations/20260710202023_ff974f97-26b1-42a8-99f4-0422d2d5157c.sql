
CREATE OR REPLACE FUNCTION public.next_sales_invoice_number(_org UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '^INV-' || yr || '-', ''), '')::INTEGER), 0) + 1
    INTO next_seq
    FROM public.sales_invoices
   WHERE org_id = _org
     AND invoice_number LIKE 'INV-' || yr || '-%';
  RETURN 'INV-' || yr || '-' || lpad(next_seq::TEXT, 4, '0');
END $$;
