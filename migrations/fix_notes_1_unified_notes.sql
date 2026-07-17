-- fix-notes-1 (2026-07-17): unified Notes system — foundation.
--
-- One `notes` table replaces the two single-text columns (projects.notes,
-- permits.notes) with a running, dated, completable log at two scopes:
--   * permit_id NULL      -> holistic PROJECT note
--   * permit_id NOT NULL  -> per-PERMIT note
-- The dashboard card and the Weekly Updates report will later read/write this
-- same table, so it is deliberately scope-generic (project_id always set).
--
-- SCHEMA DEVIATIONS from the brief (reconciled against the LIVE schema):
--   * permit_id is integer, not uuid — permits.id is an integer identity.
--   * created_by is stamped by a BEFORE INSERT trigger only when the caller
--     has a profiles row (a bare DEFAULT auth.uid() would FK-fail for any
--     authenticated user missing a profiles row; service-role writes leave
--     it NULL).
--
-- Author display: profiles RLS is read-own-or-admin, so the client cannot
-- join profiles. Reads go through bp_list_project_notes (SECURITY DEFINER,
-- explicit tenant filter — the fix-70 bp_list_permit_tasks pattern) which
-- returns author_name resolved from profiles. Writes are direct table DML
-- under tenant RLS (the permit_task_assignees pattern).
--
-- The old projects.notes / permits.notes columns are NOT dropped (safety);
-- the app stops writing them as of this fix. Backfill below migrates every
-- non-empty value into one note row.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- NULL = holistic project note; set = per-permit note.
  permit_id    integer REFERENCES public.permits(id) ON DELETE CASCADE,
  body         text NOT NULL,
  completed    boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_project_idx ON public.notes(project_id);
CREATE INDEX IF NOT EXISTS notes_permit_idx
  ON public.notes(permit_id) WHERE permit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_project_completed_idx
  ON public.notes(project_id, completed);

-- ---------------------------------------------------------------------------
-- 2. Triggers: default tenant (mirror permit_task_assignees), author stamp,
--    completed_at sync (mirror bp_trg_task_done_at), updated_at.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS notes_default_tenant ON public.notes;
CREATE TRIGGER notes_default_tenant
  BEFORE INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

CREATE OR REPLACE FUNCTION public.bp_trg_note_author()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    -- Stamp only when the caller actually has a profiles row so the FK can't
    -- fail; service-role / backfill inserts (auth.uid() NULL) stay NULL.
    SELECT p.id INTO NEW.created_by
    FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notes_author ON public.notes;
CREATE TRIGGER notes_author
  BEFORE INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_note_author();

CREATE OR REPLACE FUNCTION public.bp_trg_note_completed_at()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.completed AND (OLD IS NULL OR NOT OLD.completed) THEN
    NEW.completed_at := now();
  ELSIF NOT NEW.completed THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notes_completed_at ON public.notes;
CREATE TRIGGER notes_completed_at
  BEFORE INSERT OR UPDATE OF completed ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_note_completed_at();

DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.bp_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS + grants (fix-157 model: no anon, authenticated under tenant RLS).
-- ---------------------------------------------------------------------------
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_tenant_select ON public.notes;
CREATE POLICY notes_tenant_select ON public.notes
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS notes_tenant_insert ON public.notes;
CREATE POLICY notes_tenant_insert ON public.notes
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS notes_tenant_update ON public.notes;
CREATE POLICY notes_tenant_update ON public.notes
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
  WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS notes_tenant_delete ON public.notes;
CREATE POLICY notes_tenant_delete ON public.notes
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

REVOKE ALL ON TABLE public.notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Read RPC with author join (profiles is read-own-only under RLS).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_list_project_notes(p_project_id uuid)
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    permit_id integer,
    body text,
    completed boolean,
    completed_at timestamptz,
    created_by uuid,
    author_name text,
    created_at timestamptz,
    updated_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT n.id, n.project_id, n.permit_id, n.body, n.completed, n.completed_at,
         n.created_by,
         COALESCE(NULLIF(TRIM(pr.name), ''), NULLIF(TRIM(pr.full_name), ''), pr.email) AS author_name,
         n.created_at, n.updated_at
  FROM public.notes n
  LEFT JOIN public.profiles pr ON pr.id = n.created_by
  WHERE n.project_id = p_project_id
    AND n.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY n.created_at DESC, n.id DESC;
$$;

REVOKE ALL ON FUNCTION public.bp_list_project_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_project_notes(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Realtime: notes changes invalidate the client cache live (client maps
--    the table in REALTIME_TABLES).
-- ---------------------------------------------------------------------------
DO $pub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;
END
$pub$;

-- ---------------------------------------------------------------------------
-- 6. Data migration: every non-empty legacy notes value becomes ONE note row.
--    Idempotent: skips when an identical-body note already exists at the same
--    scope (so re-running the migration can't duplicate).
-- ---------------------------------------------------------------------------
INSERT INTO public.notes (tenant_id, project_id, permit_id, body)
SELECT p.tenant_id, p.id, NULL, TRIM(p.notes)
FROM public.projects p
WHERE COALESCE(TRIM(p.notes), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.project_id = p.id AND n.permit_id IS NULL AND n.body = TRIM(p.notes)
  );

INSERT INTO public.notes (tenant_id, project_id, permit_id, body)
SELECT pm.tenant_id, pm.project_id, pm.id, TRIM(pm.notes)
FROM public.permits pm
WHERE COALESCE(TRIM(pm.notes), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.permit_id = pm.id AND n.body = TRIM(pm.notes)
  );
