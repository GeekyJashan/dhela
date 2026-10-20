-- Talking to everyone at once: mass email, and a banner across the app.
--
-- Both are platform-admin tools for reaching Dhela's own audience. Neither is
-- anything a distributor can see or use, so everything here is closed to the
-- authenticated role and reached only through server functions running on the
-- service key, which check platform_admin first.

-- One composed message and who it was aimed at.
CREATE TABLE public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,

  -- The audience as it was chosen: which sources, plus the addresses that were
  -- explicitly ticked back in or struck out. Kept as sent rather than
  -- recomputed, because "who did this actually go to" must stay answerable
  -- after the user list has moved on.
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  -- Why a send stopped, in words, when status is 'failed'.
  error TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- One row per address per campaign.
--
-- This is the part that makes a second attempt safe. A send that dies halfway
-- through, on a rate limit or a bad key, has already put real mail in real
-- inboxes. Without a record of which ones, the only options are to send again
-- and double-mail everybody, or not send and leave half the list out.
CREATE TABLE public.email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  -- 'user', 'lead' or 'retailer'. Worth keeping: if a complaint ever arrives,
  -- the first question is where that address came from.
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (campaign_id, email)
);

CREATE INDEX idx_email_recipients_campaign ON public.email_recipients(campaign_id, status);

-- Anyone who has asked not to hear from us again.
--
-- Checked on every send, for every source, with no way to override it from the
-- compose screen. An unsubscribe that a later campaign can tick back on is not
-- an unsubscribe.
CREATE TABLE public.email_optouts (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A line across the top of the app for everyone signed in.
--
-- Many rows, at most one showing: the newest active one whose window covers
-- now. Keeping the old rows means a banner can be brought back without being
-- retyped, and that what was announced when stays on the record.
CREATE TABLE public.site_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  -- Decides the colour only. 'info' is the default, 'warning' for something
  -- that needs attention, 'success' for good news like a price drop.
  tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'warning', 'success')),
  -- Optional call to action rendered as a link at the end of the line.
  link_url TEXT,
  link_label TEXT,

  active BOOLEAN NOT NULL DEFAULT true,
  -- Lets a banner be written now and appear later, or expire by itself.
  -- NULL on either side means no bound in that direction.
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  -- When false the reader cannot close it. Use sparingly.
  dismissible BOOLEAN NOT NULL DEFAULT true,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_announcements_active ON public.site_announcements(active, created_at DESC);

-- Service role only, all four. No GRANT to authenticated, and no RLS policies,
-- so even a leaked anon key reaches none of it. The banner that every signed-in
-- user does need to read is served by a server function that fetches it with
-- the service key and returns only the one line it should show.
GRANT ALL ON public.email_campaigns   TO service_role;
GRANT ALL ON public.email_recipients  TO service_role;
GRANT ALL ON public.email_optouts     TO service_role;
GRANT ALL ON public.site_announcements TO service_role;

ALTER TABLE public.email_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_recipients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_optouts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_announcements ENABLE ROW LEVEL SECURITY;
