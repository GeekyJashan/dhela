-- Sales pipeline: prospects for selling Dhela itself, their fit score, and
-- where each one has got to.
--
-- NOT org-scoped. Every other table here belongs to a distributor's workspace;
-- this one belongs to whoever sells the product. Scoping it to an org would
-- mean the pipeline vanished the moment an admin signed into a different
-- workspace to debug a customer's problem, and there is only ever one list.
--
-- Scores and the reasoning behind them come from the public GST registry, so
-- they can be recomputed at any time. Contact details cannot: the registry
-- returns an address but never a phone number or an email, so those are typed
-- in from wherever the name was sourced and are the one part of a lead that is
-- genuinely personal data.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  -- platform_admin is set in app_metadata with the service-role key and signed
  -- into the JWT by Supabase, so a client cannot claim it for itself.
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'platform_admin')::BOOLEAN,
    FALSE
  );
$$;

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  gstin TEXT,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,

  -- Typed in, not looked up. See the note above.
  contact_person TEXT,
  phone TEXT,
  email TEXT,

  -- From the registry, recomputable.
  score INT DEFAULT 0,
  why TEXT,
  activity TEXT,
  constitution TEXT,
  taxpayer_type TEXT,
  registration_date TEXT,

  -- Where this one has got to. Deliberately few stages: a pipeline nobody
  -- updates is worse than no pipeline, and five is already optimistic for a
  -- founder selling between support calls.
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'interested', 'won', 'lost')),
  notes TEXT,
  next_action_on DATE,
  source TEXT,

  -- Which admin added it. Useful the day there is more than one.
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per business, full stop. Re-importing a list must refresh rather
-- than duplicate, or the pipeline fills with the same shop three times.
CREATE UNIQUE INDEX leads_unique_gstin ON public.leads(gstin) WHERE gstin IS NOT NULL;
CREATE INDEX idx_leads_status_score ON public.leads(status, score DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- One rule, four verbs: platform admins only. A distributor holds no row here
-- and can read none, whatever workspace they are in.
CREATE POLICY "platform admins read leads" ON public.leads
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "platform admins add leads" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins update leads" ON public.leads
  FOR UPDATE TO authenticated USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins delete leads" ON public.leads
  FOR DELETE TO authenticated USING (public.is_platform_admin());
