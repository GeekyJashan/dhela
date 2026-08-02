-- Sales pipeline: prospects, their fit score, and where each one has got to.
--
-- Scores and the reasoning behind them come from the public GST registry, so
-- they can be recomputed at any time. Contact details cannot: the registry
-- returns an address but never a phone number or an email, so those are typed
-- in from wherever the name was sourced and are the one part of a lead that is
-- genuinely personal data. They live here so the pipeline is usable, and
-- nowhere else.

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

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
  -- updates is worse than no pipeline, and five stages is already optimistic
  -- for a founder selling between support calls.
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'interested', 'won', 'lost')),
  notes TEXT,
  next_action_on DATE,
  source TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per business per workspace; re-importing a list must update rather
-- than duplicate, or the pipeline fills with the same shop three times.
CREATE UNIQUE INDEX leads_unique_gstin ON public.leads(org_id, gstin) WHERE gstin IS NOT NULL;
CREATE INDEX idx_leads_org_score ON public.leads(org_id, status, score DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read leads" ON public.leads
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members write leads" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org members update leads" ON public.leads
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org members delete leads" ON public.leads
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));
