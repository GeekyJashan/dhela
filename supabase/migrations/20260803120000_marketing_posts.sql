-- Marketing posts: drafted in the app, published to LinkedIn or X.
--
-- Stored rather than generated-and-forgotten because the thing that actually
-- goes wrong with automated posting is publishing the same thing twice. The
-- local posting skill carries three separate guards against it; a button in a
-- web app needs the same memory, and memory needs a table.
--
-- Platform admins only, like leads: this is the account that sells Dhela, not
-- anything belonging to a distributor's workspace.

CREATE TABLE public.marketing_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  channel TEXT NOT NULL CHECK (channel IN ('linkedin', 'twitter')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'pa')),
  body TEXT NOT NULL,
  topic TEXT,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'failed')),
  published_at TIMESTAMPTZ,
  -- The platform's own id, so a post can be found again and never re-sent.
  external_id TEXT,
  external_url TEXT,
  error TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_status ON public.marketing_posts(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_posts TO authenticated;
GRANT ALL ON public.marketing_posts TO service_role;
ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read posts" ON public.marketing_posts
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "platform admins add posts" ON public.marketing_posts
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins update posts" ON public.marketing_posts
  FOR UPDATE TO authenticated USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
CREATE POLICY "platform admins delete posts" ON public.marketing_posts
  FOR DELETE TO authenticated USING (public.is_platform_admin());
