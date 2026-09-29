-- Telling the customer their plan changed.
--
-- A plan change is not something the workspace does to itself. It happens on
-- the admin screen, minutes or hours after the customer paid by UPI and sent
-- the screenshot on WhatsApp. So at the moment it happens the person who has
-- been waiting for it is almost never looking at Dhela, and a toast fired into
-- their browser would be a notification nobody was there to receive.
--
-- What is remembered here is therefore the change itself, not the delivery of
-- it. The app asks "is there a plan change this person has not been told about
-- yet", which is answerable whether they open Dhela ten seconds later or next
-- Tuesday on a different phone.
--
-- plan_changed_at is NULL for every workspace that exists today, and that is
-- the point: nobody gets an upgrade notice on deploy day for a plan they have
-- been on since March.

ALTER TABLE public.organizations
  -- What they were on before, so the notice can tell an upgrade from a
  -- downgrade and say the right thing. NULL means no change has been recorded.
  ADD COLUMN plan_previous TEXT,
  ADD COLUMN plan_changed_at TIMESTAMPTZ;

-- Acknowledged per person, not per workspace.
--
-- An owner and an operator share one organization row, and both of them want
-- to know the workspace is on Pro now. If the acknowledgement lived on the
-- organization, whoever opened the app first would absorb the news on behalf
-- of everybody else, and the others would never see it.
--
-- It also has to live somewhere the customer can actually write to. Only the
-- admin role may UPDATE organizations ("admins update org"), so an operator
-- dismissing a notice stored there would be refused by RLS and shown the same
-- dialog on every poll, forever.
CREATE TABLE public.plan_change_acks (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The organizations.plan_changed_at this person has seen. Compared rather
  -- than flagged, so a second change later is a second notice.
  acknowledged_change_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.plan_change_acks TO authenticated;
GRANT ALL ON public.plan_change_acks TO service_role;
ALTER TABLE public.plan_change_acks ENABLE ROW LEVEL SECURITY;

-- Yours and only yours, in a workspace you are actually in.
CREATE POLICY "read own plan acks" ON public.plan_change_acks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(org_id));
CREATE POLICY "record own plan ack" ON public.plan_change_acks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(org_id));
CREATE POLICY "update own plan ack" ON public.plan_change_acks
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(org_id))
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(org_id));

-- No DELETE policy: there is nothing to gain from letting a client remove the
-- record that it was told, and plenty to lose if it did.
