-- Assistant chat history. Doubles as the usage meter: one question counts
-- as one AI extraction against the plan quota.
CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read assistant messages" ON public.assistant_messages
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members write assistant messages" ON public.assistant_messages
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));

CREATE INDEX IF NOT EXISTS idx_assistant_messages_org ON public.assistant_messages(org_id, created_at);
