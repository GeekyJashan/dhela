-- =====================================================================
-- STOCK GROUPS (auto-created per HSN, hold tiered discounts A/B/C)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hsn_code TEXT,                              -- the HSN this group represents (unique per org)
  discount_a NUMERIC(6,2) NOT NULL DEFAULT 0, -- discount % for category-A retailers
  discount_b NUMERIC(6,2) NOT NULL DEFAULT 0,
  discount_c NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, hsn_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_groups TO authenticated;
GRANT ALL ON public.stock_groups TO service_role;
ALTER TABLE public.stock_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage stock groups" ON public.stock_groups
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE TRIGGER stock_groups_touch BEFORE UPDATE ON public.stock_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_group_id UUID REFERENCES public.stock_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_stock_group ON public.products(stock_group_id);

-- Auto-assign a product to the stock group matching its HSN; create the
-- group on first use. Group name comes from the hsn_codes reference when known.
CREATE OR REPLACE FUNCTION public.tg_assign_stock_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp_id UUID;
  grp_name TEXT;
BEGIN
  IF NEW.hsn IS NULL OR btrim(NEW.hsn) = '' THEN
    NEW.stock_group_id := NULL;
    RETURN NEW;
  END IF;

  SELECT id INTO grp_id FROM public.stock_groups
   WHERE org_id = NEW.org_id AND hsn_code = NEW.hsn;

  IF grp_id IS NULL THEN
    SELECT description INTO grp_name FROM public.hsn_codes WHERE code = NEW.hsn;
    IF grp_name IS NULL THEN
      -- fall back to the longest known prefix (chapter/heading)
      SELECT description INTO grp_name FROM public.hsn_codes
       WHERE NEW.hsn LIKE code || '%' ORDER BY length(code) DESC LIMIT 1;
    END IF;
    INSERT INTO public.stock_groups(org_id, name, hsn_code)
    VALUES (NEW.org_id, COALESCE(grp_name, 'HSN ' || NEW.hsn), NEW.hsn)
    ON CONFLICT (org_id, hsn_code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO grp_id;
  END IF;

  NEW.stock_group_id := grp_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_assign_stock_group ON public.products;
CREATE TRIGGER products_assign_stock_group
  BEFORE INSERT OR UPDATE OF hsn ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_stock_group();

-- Backfill existing products into groups.
UPDATE public.products SET hsn = hsn WHERE hsn IS NOT NULL AND btrim(hsn) <> '';

-- =====================================================================
-- RETAILER CATEGORY (A / B / C) — drives stock-group discount tier
-- =====================================================================
ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'C'
  CHECK (category IN ('A','B','C'));

-- Migrate any legacy a/b/c price tiers.
UPDATE public.retailers SET category = upper(price_tier)
 WHERE lower(coalesce(price_tier, '')) IN ('a','b','c');

-- =====================================================================
-- ORDERS (retailer purchase orders → later fulfilled by sales invoices)
-- =====================================================================
DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM ('pending','partial','fulfilled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL REFERENCES public.retailers(id),
  order_number TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status public.order_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, order_number)
);

CREATE TABLE IF NOT EXISTS public.order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC(14,3) NOT NULL,
  fulfilled_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders, public.order_lines TO authenticated;
GRANT ALL ON public.orders, public.order_lines TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org members manage order lines" ON public.order_lines
  FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_orders_org_status ON public.orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON public.order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_product ON public.order_lines(product_id);

CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.next_order_number(_org UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '^ORD-' || yr || '-', ''), '')::INTEGER), 0) + 1
    INTO next_seq
    FROM public.orders
   WHERE org_id = _org
     AND order_number LIKE 'ORD-' || yr || '-%';
  RETURN 'ORD-' || yr || '-' || lpad(next_seq::TEXT, 4, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.next_order_number(UUID) TO authenticated;

-- Sales invoices can be issued against an order.
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;
