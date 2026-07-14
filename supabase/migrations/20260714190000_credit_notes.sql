-- =====================================================================
-- CREDIT NOTES (sales returns) — credit the retailer, optionally restock
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL REFERENCES public.retailers(id),
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE SET NULL,
  credit_note_number TEXT NOT NULL,
  credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL DEFAULT 'other'
    CHECK (reason IN ('damaged','expired','wrong_item','rate_adjustment','other')),
  restock BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, credit_note_number)
);

CREATE TABLE IF NOT EXISTS public.credit_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_note_id UUID NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  description TEXT NOT NULL,
  hsn TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_notes, public.credit_note_lines TO authenticated;
GRANT ALL ON public.credit_notes, public.credit_note_lines TO service_role;
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage credit notes" ON public.credit_notes
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org members manage credit note lines" ON public.credit_note_lines
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_credit_notes_org ON public.credit_notes(org_id, credit_date);
CREATE INDEX IF NOT EXISTS idx_credit_notes_retailer ON public.credit_notes(retailer_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_lines_note ON public.credit_note_lines(credit_note_id);

CREATE TRIGGER credit_notes_touch BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.next_credit_note_number(_org UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(credit_note_number, '^CN-' || yr || '-', ''), '')::INTEGER), 0) + 1
    INTO next_seq
    FROM public.credit_notes
   WHERE org_id = _org
     AND credit_note_number LIKE 'CN-' || yr || '-%';
  RETURN 'CN-' || yr || '-' || lpad(next_seq::TEXT, 4, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.next_credit_note_number(UUID) TO authenticated;

-- Credit notes post as retailer credits in the ledger.
CREATE OR REPLACE VIEW public.party_ledger
WITH (security_invoker = on) AS
SELECT org_id, 'retailer'::text AS party_type, retailer_id AS party_id,
       invoice_date AS tx_date, created_at, 'invoice'::text AS kind,
       invoice_number AS ref, COALESCE(grand_total, 0) AS debit,
       0::numeric AS credit, id AS source_id
  FROM public.sales_invoices
 WHERE status IN ('issued', 'paid')
UNION ALL
SELECT org_id, 'retailer', retailer_id, payment_date, created_at, 'payment',
       COALESCE(NULLIF(reference, ''), initcap(mode::text)),
       0, amount + discount_amount, id
  FROM public.payments
 WHERE party_type = 'retailer'
UNION ALL
SELECT org_id, 'retailer', retailer_id, credit_date, created_at, 'credit_note',
       credit_note_number, 0, COALESCE(grand_total, 0), id
  FROM public.credit_notes
UNION ALL
SELECT org_id, 'supplier', supplier_id,
       COALESCE(invoice_date, created_at::date), created_at, 'invoice',
       COALESCE(NULLIF(invoice_number, ''), 'Purchase'),
       0, COALESCE(grand_total, 0), id
  FROM public.invoices
 WHERE status = 'approved' AND supplier_id IS NOT NULL
UNION ALL
SELECT org_id, 'supplier', supplier_id, payment_date, created_at, 'payment',
       COALESCE(NULLIF(reference, ''), initcap(mode::text)),
       amount + discount_amount, 0, id
  FROM public.payments
 WHERE party_type = 'supplier';
