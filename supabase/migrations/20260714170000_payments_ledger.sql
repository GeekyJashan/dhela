-- =====================================================================
-- PAYMENTS + PARTY LEDGER (account statements, receivables/payables)
-- =====================================================================

ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE TYPE public.payment_mode AS ENUM ('cash','upi','bank','cheque','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('retailer','supplier')),
  retailer_id UUID REFERENCES public.retailers(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  -- settlement discount ("chhoot") credited to the party on top of the amount
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  mode public.payment_mode NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (party_type = 'retailer' AND retailer_id IS NOT NULL AND supplier_id IS NULL) OR
    (party_type = 'supplier' AND supplier_id IS NOT NULL AND retailer_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  sales_invoice_id UUID REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  purchase_invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((sales_invoice_id IS NOT NULL)::int + (purchase_invoice_id IS NOT NULL)::int = 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments, public.payment_allocations TO authenticated;
GRANT ALL ON public.payments, public.payment_allocations TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org members manage payment allocations" ON public.payment_allocations
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_payments_org_party ON public.payments(org_id, party_type, retailer_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(org_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_sales ON public.payment_allocations(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_purchase ON public.payment_allocations(purchase_invoice_id);

CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- Unified party ledger: every document/payment as one debit/credit row.
-- Retailer: invoice = debit (they owe more); payment/discount = credit.
-- Supplier: their invoice = credit (we owe more); our payment = debit.
-- security_invoker so the underlying tables' RLS applies to readers.
-- ---------------------------------------------------------------------
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

-- Net balance per party. Positive = retailer owes us / we owe supplier.
CREATE OR REPLACE VIEW public.party_balances
WITH (security_invoker = on) AS
SELECT r.org_id, 'retailer'::text AS party_type, r.id AS party_id, r.name,
       r.opening_balance + COALESCE(SUM(l.debit - l.credit), 0) AS balance
  FROM public.retailers r
  LEFT JOIN public.party_ledger l
    ON l.party_type = 'retailer' AND l.party_id = r.id
 GROUP BY r.org_id, r.id, r.name, r.opening_balance
UNION ALL
SELECT s.org_id, 'supplier', s.id, s.name,
       s.opening_balance + COALESCE(SUM(l.credit - l.debit), 0)
  FROM public.suppliers s
  LEFT JOIN public.party_ledger l
    ON l.party_type = 'supplier' AND l.party_id = s.id
 GROUP BY s.org_id, s.id, s.name, s.opening_balance;

GRANT SELECT ON public.party_ledger, public.party_balances TO authenticated;
GRANT SELECT ON public.party_ledger, public.party_balances TO service_role;
