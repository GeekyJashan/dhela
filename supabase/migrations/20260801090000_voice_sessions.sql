-- Metering for realtime voice.
--
-- The Live API bills per minute of audio in *and* out, and our client streams
-- the microphone continuously for as long as a session is open — so an
-- abandoned tab costs money while nothing is happening. That makes a usage
-- ledger a cost control, not a reporting nicety.
--
-- One row per session. started_at is written when the token is minted;
-- seconds is written when the client reports the session closed. A row that
-- never gets its seconds is counted at max_seconds when totalling the month,
-- so walking away from a session cannot hide its cost.

CREATE TABLE public.voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  -- Reported by the client when the session closes. NULL means still open, or
  -- never reported; both are charged at max_seconds until proven otherwise.
  seconds INT,
  -- The cap this session was minted under, so old rows keep their own terms if
  -- the plan's limits change later.
  max_seconds INT NOT NULL DEFAULT 600,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_org_month
  ON public.voice_sessions(org_id, started_at);

GRANT SELECT, INSERT, UPDATE ON public.voice_sessions TO authenticated;
GRANT ALL ON public.voice_sessions TO service_role;
ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read voice sessions" ON public.voice_sessions
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members write voice sessions" ON public.voice_sessions
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
-- Update is how a session reports its own duration. Deliberately no DELETE
-- policy: usage is not something a workspace gets to erase.
CREATE POLICY "org members close voice sessions" ON public.voice_sessions
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));
