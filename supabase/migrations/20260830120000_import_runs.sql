-- What each import did, so it can be looked at afterwards and taken back.
--
-- An import writes hundreds of rows at once from a file somebody exported five
-- minutes ago. The dry run is what stops a bad mapping landing, but it cannot
-- stop a bad file, and "I imported the wrong export" has no answer if nothing
-- remembers what the import touched.
--
-- Two different things are remembered, because undoing them is two different
-- problems. A row this import CREATED can be deleted — unless something has
-- since been billed against it, in which case it must stay. A row this import
-- UPDATED can only be put back if the value is still the one the import left;
-- if somebody has edited it since, restoring would quietly throw their work
-- away. So both the before and the after are kept, and undo compares.

CREATE TABLE public.import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('products', 'suppliers', 'retailers')),
  -- What the operator saw on the mapping screen, so the history can say which
  -- of their columns went where without keeping the file itself.
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  -- The rows this run inserted. Deleting these is the whole of undo for them.
  created_ids UUID[] NOT NULL DEFAULT '{}',
  -- [{ id, before: {...}, after: {...} }] for rows this run changed.
  updated_rows JSONB NOT NULL DEFAULT '[]'::jsonb,

  undone_at TIMESTAMPTZ,
  -- What undo could not do, in the operator's words: rows kept because they
  -- are already billed against, fields left because someone edited them since.
  undo_note TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_runs_org ON public.import_runs(org_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.import_runs TO authenticated;
GRANT ALL ON public.import_runs TO service_role;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read their imports" ON public.import_runs
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members record their imports" ON public.import_runs
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org members mark their imports undone" ON public.import_runs
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

-- Deliberately no DELETE policy. The history of what was written is not
-- something a workspace should be able to quietly erase.
