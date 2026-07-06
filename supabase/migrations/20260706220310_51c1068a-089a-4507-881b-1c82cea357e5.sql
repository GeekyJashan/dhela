
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin','operator','accountant');
CREATE TYPE public.invoice_status AS ENUM ('uploaded','processing','review','approved','rejected','failed');

-- Organizations (tenants)
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  gstin TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Memberships
CREATE TABLE public.memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Security definer helpers
CREATE OR REPLACE FUNCTION public.is_org_member(_org UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.memberships WHERE org_id=_org AND user_id=auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.memberships WHERE org_id=_org AND user_id=auth.uid() AND role=_role);
$$;

-- Org policies
CREATE POLICY "members read org" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "user creates org" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "admins update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id,'admin'));

-- Membership policies
CREATE POLICY "read own memberships" ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(org_id,'admin'));
CREATE POLICY "self insert membership" ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_org_role(org_id,'admin'));
CREATE POLICY "admins manage members" ON public.memberships FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id,'admin'));
CREATE POLICY "admins delete members" ON public.memberships FOR DELETE TO authenticated
  USING (public.has_org_role(org_id,'admin'));

-- Suppliers
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gstin TEXT,
  address TEXT,
  contact TEXT,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members access suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- Products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  brand TEXT,
  category TEXT,
  hsn TEXT,
  gst_rate NUMERIC(5,2),
  mrp NUMERIC(12,2),
  purchase_rate NUMERIC(12,2),
  selling_rate NUMERIC(12,2),
  unit TEXT,
  pack_size TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.products(org_id);
CREATE INDEX ON public.products USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(sku,'')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members access products" ON public.products FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id),
  supplier_name TEXT,
  supplier_gstin TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  status invoice_status NOT NULL DEFAULT 'uploaded',
  subtotal NUMERIC(14,2),
  tax_total NUMERIC(14,2),
  grand_total NUMERIC(14,2),
  confidence NUMERIC(5,2),
  raw_extraction JSONB,
  error_message TEXT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.invoices(org_id, status);
CREATE UNIQUE INDEX invoices_unique_number ON public.invoices(org_id, supplier_gstin, invoice_number)
  WHERE invoice_number IS NOT NULL AND supplier_gstin IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members access invoices" ON public.invoices FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- Invoice lines
CREATE TABLE public.invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  line_no INT,
  raw_description TEXT,
  matched_product_id UUID REFERENCES public.products(id),
  match_confidence NUMERIC(5,2),
  hsn TEXT,
  quantity NUMERIC(14,3),
  free_quantity NUMERIC(14,3),
  unit TEXT,
  rate NUMERIC(14,4),
  mrp NUMERIC(14,2),
  discount_pct NUMERIC(6,2),
  gst_rate NUMERIC(5,2),
  taxable_value NUMERIC(14,2),
  tax_amount NUMERIC(14,2),
  line_total NUMERIC(14,2),
  batch TEXT,
  mfg_date DATE,
  expiry_date DATE,
  field_confidence JSONB,
  needs_review BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.invoice_lines(invoice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lines TO authenticated;
GRANT ALL ON public.invoice_lines TO service_role;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members access invoice_lines" ON public.invoice_lines FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_log(org_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read audit" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "org members write audit" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Auto-create org + admin membership on first sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE new_org_id UUID;
BEGIN
  INSERT INTO public.organizations(name, created_by)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'org_name', split_part(NEW.email,'@',1) || '''s Workspace'), NEW.id)
  RETURNING id INTO new_org_id;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (new_org_id, NEW.id, 'admin');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage policies for invoices bucket (path convention: org_id/filename)
CREATE POLICY "org members read invoice files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='invoices' AND public.is_org_member((storage.foldername(name))[1]::uuid));
CREATE POLICY "org members upload invoice files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='invoices' AND public.is_org_member((storage.foldername(name))[1]::uuid));
CREATE POLICY "org members delete invoice files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='invoices' AND public.is_org_member((storage.foldername(name))[1]::uuid));
