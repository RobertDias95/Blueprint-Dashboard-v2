-- ===========================================================================
-- fix-344 §1 — reassign the schematic designer, and move their work with them
-- fix-344 §2 — the three posts every new project starts with
-- ===========================================================================
--
-- ★★ §1 FOLLOWS fix-225's SHAPE rather than inventing a second one: an
-- admin-only ownership move in ONE transaction, recorded in a handoff ledger.
-- What differs is the entry point — reassigning a DA is a danger-zone act
-- (the draw-schedule board is involved), while changing a project's schematic
-- designer is routine, so it lives on the Settings field itself. Same
-- guarantees, ordinary door.
--
-- ★ MEASURED FIRST, so it is sized right: `projects.schematic_designer` is an
-- ARRAY that has never held more than one name (0 projects with 2+, 34 with
-- exactly 1, 119 with none), and SD-role people hold FOUR open tasks in total.
-- The task-moving half is tiny today; this earns its keep going forward.
--
-- ★ THE COLUMN TYPE IS NOT CHANGED. The UI treats it as single-select — see
-- the note in ProjectSettingsModal — and this RPC writes a one-element array
-- (or an empty one), which is exactly the shape every existing row already has.

-- ---------------------------------------------------------------------------
-- 1. project_sd_handoffs — the ledger, mirroring project_da_handoffs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_sd_handoffs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_sd    text,
  -- ★ NULLABLE, unlike fix-225's to_da: "a project can lose its SD without
  -- gaining one" is a real move, and the ledger has to be able to say so.
  to_sd      text,
  note       text,
  actor_uid  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_sd_handoffs_project
  ON public.project_sd_handoffs (project_id, created_at DESC);

ALTER TABLE public.project_sd_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_sd_handoffs_tenant_select ON public.project_sd_handoffs;
CREATE POLICY project_sd_handoffs_tenant_select ON public.project_sd_handoffs
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS project_sd_handoffs_admin_write ON public.project_sd_handoffs;
CREATE POLICY project_sd_handoffs_admin_write ON public.project_sd_handoffs
  FOR ALL TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

REVOKE ALL ON public.project_sd_handoffs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_sd_handoffs
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. bp_reassign_project_sd — the move, in one transaction
-- ---------------------------------------------------------------------------
--
-- ★★ WHAT MOVES, and what deliberately does not:
--
--   MOVES  · projects.schematic_designer                → the new SD (or none)
--          · open tasks with assigned_to = the OLD SD   → the new SD
--          · co-assignee rows naming the OLD SD         → the new SD
--
--   STAYS  · ★★★ a task assigned to the ROLE STRING 'Schematic Team'.
--            fix-238 resolves a role-valued assignee to whoever holds that role
--            ON THIS PROJECT, at read time — so such a task ALREADY follows the
--            new SD the moment the project's field changes, and rewriting it to
--            a person's name would freeze a dynamic assignment into a static
--            one. The reassignment is the thing that makes it point somewhere
--            new; touching the row would undo that. Asserted both ways.
--          · RESOLVED tasks. fix-225 moves open work only — history keeps the
--            name that did it, which is fix-308's rule.
--
-- ★ REASSIGNING TO NOBODY is a first-class case: the field is cleared, and the
-- old SD's open tasks are UNASSIGNED rather than left pointing at somebody who
-- is no longer on the project. An unset assignee falls back to the discipline's
-- default owner (fix-230), so the work lands with the DA / ent lead instead of
-- becoming an orphan nobody's board shows.
CREATE OR REPLACE FUNCTION public.bp_reassign_project_sd(
  p_project_id uuid,
  p_to_sd text,
  p_note text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, project_id uuid, from_sd text, to_sd text, note text,
  created_at timestamptz, tasks_moved integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_to      text   := NULLIF(btrim(COALESCE(p_to_sd, '')), '');
  v_from    text;
  v_moved   integer := 0;
  v_row     public.project_sd_handoffs;
BEGIN
  SELECT pr.tenant_id INTO v_tenant
  FROM public.projects pr
  WHERE pr.id = p_project_id AND pr.tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_reassign_project_sd: project % not in caller tenant', p_project_id
      USING ERRCODE = '42501';
  END IF;

  -- Admin gate (service_role/scraper exempt) — fix-220's pattern, same as the
  -- DA handoff this follows.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'reassigning the schematic designer is restricted to admins'
      USING ERRCODE = '42501';
  END IF;

  -- ★ The array has never held more than one name; the first element IS the
  -- schematic designer, and writing back a one-element array keeps the shape
  -- every existing row already has.
  SELECT NULLIF(btrim(COALESCE(pr.schematic_designer[1], '')), '')
    INTO v_from
  FROM public.projects pr WHERE pr.id = p_project_id;

  IF v_from IS NOT DISTINCT FROM v_to THEN
    -- Nothing to do, and no ledger row for a move that did not happen.
    RETURN;
  END IF;

  UPDATE public.projects
     SET schematic_designer =
           CASE WHEN v_to IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_to] END
   WHERE projects.id = p_project_id;

  IF v_from IS NOT NULL THEN
    -- 1. The old SD's own open tasks on this project.
    UPDATE public.permit_tasks t
       SET assigned_to = v_to
      FROM public.permits p
     WHERE p.id = t.permit_id
       AND p.project_id = p_project_id
       AND t.completion_status <> 'Resolved'
       AND t.assigned_to = v_from;
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    -- 2. …and where they were a CO-assignee, on the same open tasks.
    IF v_to IS NULL THEN
      DELETE FROM public.permit_task_assignees a
       USING public.permit_tasks t, public.permits p
       WHERE a.task_id = t.id AND t.permit_id = p.id
         AND p.project_id = p_project_id
         AND t.completion_status <> 'Resolved'
         AND a.assignee = v_from;
    ELSE
      INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
      SELECT a.tenant_id, a.task_id, v_to
        FROM public.permit_task_assignees a
        JOIN public.permit_tasks t ON t.id = a.task_id
        JOIN public.permits p ON p.id = t.permit_id
       WHERE p.project_id = p_project_id
         AND t.completion_status <> 'Resolved'
         AND a.assignee = v_from
      ON CONFLICT (task_id, assignee) DO NOTHING;

      DELETE FROM public.permit_task_assignees a
       USING public.permit_tasks t, public.permits p
       WHERE a.task_id = t.id AND t.permit_id = p.id
         AND p.project_id = p_project_id
         AND t.completion_status <> 'Resolved'
         AND a.assignee = v_from;
    END IF;
  END IF;

  INSERT INTO public.project_sd_handoffs
    (tenant_id, project_id, from_sd, to_sd, note, actor_uid)
  VALUES (v_tenant, p_project_id, v_from, v_to,
          NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.project_id, v_row.from_sd, v_row.to_sd,
                      v_row.note, v_row.created_at, v_moved;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_reassign_project_sd(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_reassign_project_sd(uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. ★★ §2 — the three posts every NEW project starts with
-- ---------------------------------------------------------------------------
--
-- Bobby: *"Anytime a project is created we kind of want to have the same three
-- threads created for every project in the chat."*
--
--   ACQ Questions           "anytime we're talking acquisitions"
--   Design Phase            "anything from design to intake"
--   Preliminary Assessment  "all of the initial comments that we get from the
--                            city based on what we're submitting"
--
-- ★★★ THE THIRD NAME IS THE DOCUMENT, NOT THE LOCAL PROCESS WORD. Seattle says
-- PAR, the Eastside says pre-sub; Bobby chose the term that needs no
-- translation on either side of the lake. It is NEVER re-rendered per
-- jurisdiction.
--
-- ★★ A TRIGGER ON projects, NOT AN EDIT TO bp_create_project_with_permits.
-- Three reasons, and the third is the one that decided it:
--   1. it covers EVERY creation path, including the redesign wizard and
--      anything added later, rather than the one path that exists today;
--   2. it fires once per inserted row, so the retry case is structurally
--      impossible rather than defended against;
--   3. ★ bp_create_project_with_permits is 14,000 characters, and CREATE OR
--      REPLACE means retyping all of it. fix-337 did exactly that to a smaller
--      function from a TRUNCATED read and silently narrowed its payload. Not
--      touching it is the safer engineering.
--
-- ★★ NEW PROJECTS ONLY — no backfill. 153 existing projects × 3 = 459 empty
-- threads, and an empty post is worse than no post: it makes the chat look
-- abandoned. Bobby's standing precedent is going-forward-only.
--
-- ★ ORDINARY POSTS. parent_message_id NULL, a title, a body; fix-334's rules
-- apply unchanged (admins create posts, anyone replies, newest activity wins).
-- The author is whoever created the project, so the thread has a real byline.
CREATE OR REPLACE FUNCTION public.bp_seed_project_posts(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_author uuid := auth.uid();
  v_made   integer := 0;
  v_seed   record;
BEGIN
  SELECT pr.tenant_id INTO v_tenant FROM public.projects pr WHERE pr.id = p_project_id;
  IF v_tenant IS NULL THEN RETURN 0; END IF;

  FOR v_seed IN
    SELECT * FROM (VALUES
      (1, 'ACQ Questions',
          'Anything acquisitions — questions for the ACQ team live here.'),
      (2, 'Design Phase',
          'Design through intake: drawings, consultants, and the submittal set.'),
      (3, 'Preliminary Assessment',
          'The city''s initial comments on what we are submitting.')
    ) AS s(ord, title, body)
    ORDER BY ord
  LOOP
    -- ★ Idempotent by existence, not by constraint: creating a project twice
    -- cannot produce six posts, and a project that already has one of these
    -- threads keeps the one it has.
    INSERT INTO public.project_messages
      (tenant_id, project_id, author_id, title, body, parent_message_id, created_at)
    SELECT v_tenant, p_project_id, v_author, v_seed.title, v_seed.body, NULL,
           now() + (v_seed.ord * interval '1 millisecond')
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_messages m
      WHERE m.project_id = p_project_id
        AND m.parent_message_id IS NULL
        AND m.title = v_seed.title
    );
    v_made := v_made + 1;
  END LOOP;

  RETURN v_made;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_seed_project_posts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_seed_project_posts(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bp_trg_seed_project_posts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.bp_seed_project_posts(NEW.id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_seed_project_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_seed_project_posts()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS projects_seed_posts ON public.projects;
CREATE TRIGGER projects_seed_posts
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_seed_project_posts();
