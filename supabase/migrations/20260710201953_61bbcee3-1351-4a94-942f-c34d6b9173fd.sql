
-- =====================================================================
-- ORGANIZATIONS & PRODUCTS EXTENSIONS
-- =====================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS default_margin_pct NUMERIC(6,2) DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_margin_pct NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS current_stock NUMERIC(14,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_rate NUMERIC(14,4);

-- =====================================================================
-- RETAILERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.retailers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gstin TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state_code TEXT,        -- 2-digit GST state code, e.g. '27' for Maharashtra
  pincode TEXT,
  price_tier TEXT DEFAULT 'standard',   -- e.g. 'a', 'b', 'c', 'standard'
  default_discount_pct NUMERIC(6,2) DEFAULT 0,
  credit_limit NUMERIC(14,2) DEFAULT 0,
  outstanding_balance NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retailers TO authenticated;
GRANT ALL ON public.retailers TO service_role;
ALTER TABLE public.retailers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage retailers" ON public.retailers
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_retailers_org ON public.retailers(org_id);
CREATE TRIGGER trg_retailers_updated_at BEFORE UPDATE ON public.retailers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- PRODUCT PRICE OVERRIDES
-- retailer_id NULL  => product-level custom rate (applies to everyone)
-- retailer_id SET   => rate only for that retailer (dealer/tier pricing)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.product_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  retailer_id UUID REFERENCES public.retailers(id) ON DELETE CASCADE,
  selling_rate NUMERIC(14,4) NOT NULL,
  discount_pct NUMERIC(6,2) DEFAULT 0,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, retailer_id)  -- one active override per (product, retailer)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_overrides TO authenticated;
GRANT ALL ON public.product_price_overrides TO service_role;
ALTER TABLE public.product_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage price overrides" ON public.product_price_overrides
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_ppo_lookup
  ON public.product_price_overrides(org_id, product_id, retailer_id);
CREATE TRIGGER trg_ppo_updated_at BEFORE UPDATE ON public.product_price_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- SALES INVOICES
-- =====================================================================
DO $$ BEGIN
  CREATE TYPE public.sales_invoice_status AS ENUM ('draft','issued','paid','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('unpaid','partial','paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL REFERENCES public.retailers(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  place_of_supply TEXT,               -- state code of buyer
  is_interstate BOOLEAN DEFAULT false,
  subtotal NUMERIC(14,2) DEFAULT 0,   -- sum of taxable_value
  discount_total NUMERIC(14,2) DEFAULT 0,
  cgst_total NUMERIC(14,2) DEFAULT 0,
  sgst_total NUMERIC(14,2) DEFAULT 0,
  igst_total NUMERIC(14,2) DEFAULT 0,
  tax_total NUMERIC(14,2) DEFAULT 0,
  round_off NUMERIC(6,2) DEFAULT 0,
  grand_total NUMERIC(14,2) DEFAULT 0,
  total_cost NUMERIC(14,2) DEFAULT 0, -- sum of cost snapshot
  total_profit NUMERIC(14,2) DEFAULT 0,
  amount_paid NUMERIC(14,2) DEFAULT 0,
  status public.sales_invoice_status NOT NULL DEFAULT 'draft',
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoices TO authenticated;
GRANT ALL ON public.sales_invoices TO service_role;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage sales invoices" ON public.sales_invoices
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_sales_invoices_org ON public.sales_invoices(org_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_retailer ON public.sales_invoices(retailer_id);
CREATE TRIGGER trg_sales_invoices_updated_at BEFORE UPDATE ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- SALES INVOICE LINES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.sales_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_invoice_id UUID NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  line_no INTEGER,
  description TEXT NOT NULL,
  hsn TEXT,
  batch TEXT,
  expiry_date DATE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  free_quantity NUMERIC(14,3) DEFAULT 0,
  unit TEXT,
  mrp NUMERIC(14,4),
  rate NUMERIC(14,4) NOT NULL DEFAULT 0,          -- selling rate before tax
  discount_pct NUMERIC(6,2) DEFAULT 0,
  discount_amount NUMERIC(14,2) DEFAULT 0,
  taxable_value NUMERIC(14,2) DEFAULT 0,          -- qty*rate - discount
  gst_rate NUMERIC(6,2) DEFAULT 0,
  cgst_amount NUMERIC(14,2) DEFAULT 0,
  sgst_amount NUMERIC(14,2) DEFAULT 0,
  igst_amount NUMERIC(14,2) DEFAULT 0,
  tax_amount NUMERIC(14,2) DEFAULT 0,
  line_total NUMERIC(14,2) DEFAULT 0,
  cost_price NUMERIC(14,4),                       -- snapshot of purchase rate
  profit NUMERIC(14,2),                           -- (rate - cost) * qty - discount
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_invoice_lines TO authenticated;
GRANT ALL ON public.sales_invoice_lines TO service_role;
ALTER TABLE public.sales_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage sales invoice lines" ON public.sales_invoice_lines
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_inv ON public.sales_invoice_lines(sales_invoice_id);

-- =====================================================================
-- HSN CODES REFERENCE (shared, read-only for authenticated)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.hsn_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  gst_rate NUMERIC(6,2) NOT NULL,
  category TEXT,
  search_tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(description,'') || ' ' || coalesce(category,'') || ' ' || code)
  ) STORED
);

GRANT SELECT ON public.hsn_codes TO authenticated;
GRANT ALL ON public.hsn_codes TO service_role;
ALTER TABLE public.hsn_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hsn readable by authenticated" ON public.hsn_codes
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_hsn_tsv ON public.hsn_codes USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_hsn_code_prefix ON public.hsn_codes(code text_pattern_ops);

-- Seed a curated list of common India HSN/SAC codes.
INSERT INTO public.hsn_codes(code, description, gst_rate, category) VALUES
  ('1006','Rice',5,'Grocery'),
  ('1101','Wheat flour (atta)',5,'Grocery'),
  ('1701','Sugar',5,'Grocery'),
  ('0401','Milk and cream',5,'Dairy'),
  ('0406','Cheese and curd',12,'Dairy'),
  ('0409','Natural honey',5,'Grocery'),
  ('0902','Tea',5,'Beverages'),
  ('0901','Coffee',5,'Beverages'),
  ('1507','Edible oils',5,'Grocery'),
  ('1905','Biscuits, bread, pastry',18,'FMCG'),
  ('2103','Sauces, ketchup, pickles',12,'FMCG'),
  ('2106','Food preparations n.e.s.',18,'FMCG'),
  ('2201','Packaged drinking water',18,'Beverages'),
  ('2202','Aerated waters, soft drinks',28,'Beverages'),
  ('2402','Cigarettes / cigars',28,'Tobacco'),
  ('3004','Medicaments (allopathic)',12,'Pharma'),
  ('3003','Bulk medicaments',12,'Pharma'),
  ('3006','Pharmaceutical goods',12,'Pharma'),
  ('3005','Wadding, gauze, bandages',12,'Pharma'),
  ('9018','Medical / surgical instruments',12,'Pharma'),
  ('3401','Soap',18,'FMCG'),
  ('3402','Detergents, washing powders',18,'FMCG'),
  ('3305','Shampoos, hair oil',18,'FMCG'),
  ('3306','Toothpaste, oral care',18,'FMCG'),
  ('3307','Deodorants, shaving preparations',18,'FMCG'),
  ('4818','Toilet paper, tissues, diapers',18,'FMCG'),
  ('4820','Registers, notebooks, stationery',18,'Stationery'),
  ('9608','Pens',18,'Stationery'),
  ('8501','Electric motors',18,'Electrical'),
  ('8504','Transformers, inverters, chargers',18,'Electrical'),
  ('8536','Switches, sockets, MCBs',18,'Electrical'),
  ('8544','Insulated wires and cables',18,'Electrical'),
  ('9405','LED lamps, luminaires',12,'Electrical'),
  ('8539','Filament / discharge lamps',18,'Electrical'),
  ('8414','Fans, blowers, compressors',18,'Electrical'),
  ('8415','Air conditioners',28,'Electrical'),
  ('8418','Refrigerators, freezers',18,'Electrical'),
  ('8450','Washing machines',18,'Electrical'),
  ('8471','Laptops, computers',18,'Electronics'),
  ('8517','Mobile phones',18,'Electronics'),
  ('8523','Storage media, USB drives',18,'Electronics'),
  ('7318','Screws, nuts, bolts',18,'Hardware'),
  ('8203','Files, pliers, cutters',18,'Hardware'),
  ('8205','Hand tools',18,'Hardware'),
  ('8481','Taps, cocks, valves',18,'Hardware'),
  ('3208','Paints and varnishes',18,'Hardware'),
  ('3214','Putty, sealants, fillers',18,'Hardware'),
  ('2523','Cement',28,'Construction'),
  ('7213','Iron / steel rods (rebar)',18,'Construction'),
  ('6802','Marble, granite tiles',18,'Construction'),
  ('6907','Ceramic tiles',18,'Construction'),
  ('6109','T-shirts',5,'Textile'),
  ('6203','Mens suits, trousers',5,'Textile'),
  ('6204','Womens suits, dresses',5,'Textile'),
  ('6403','Leather footwear',18,'Footwear'),
  ('9503','Toys',12,'Toys'),
  ('9504','Board games, video games',18,'Toys'),
  ('4901','Books',0,'Books'),
  ('4902','Newspapers, journals',0,'Books'),
  ('998314','IT consulting services (SAC)',18,'Services'),
  ('998399','Other professional services (SAC)',18,'Services'),
  ('996511','Road transport of goods (SAC)',5,'Services'),
  ('9971','Financial services (SAC)',18,'Services')
ON CONFLICT (code) DO NOTHING;

-- =====================================================================
-- SALES INVOICE NUMBER GENERATOR (per org, per year)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.next_sales_invoice_number(_org UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
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

GRANT EXECUTE ON FUNCTION public.next_sales_invoice_number(UUID) TO authenticated;
