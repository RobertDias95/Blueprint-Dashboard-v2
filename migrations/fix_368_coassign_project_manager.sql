-- ===========================================================================
-- fix-368 — some people's manager depends on the PROJECT, not on them
-- ===========================================================================
--
-- APPLIED to prod (eibnmwthkcuumyclyxoe) on 2026-08-20 via MCP apply_migration
-- as `fix_368_coassign_project_manager`, which records the provenance row AND
-- the full statement text. This file is the repo-of-record copy.
--
-- ★★★ THE BACKFILL IS NOT HERE AND IS NOT APPLIED. It is a data change and
-- needs Bobby's approval on the ROWS, not just the rule — see
-- migrations/fix_368_backfill_PENDING_APPROVAL.sql and the PR body.
--
-- ---------------------------------------------------------------------------
-- Why this exists — and it is NOT the gap it looked like
-- ---------------------------------------------------------------------------
-- fix-346 co-assigns a design associate's tasks to their design manager, keyed
-- on dm_da_groups. Cam and Shire have no row there, and the obvious reading was
-- that the table was incomplete.
--
-- ★★★ IT ISN'T. Bobby: "Their manager group would be dependent upon the permit
-- they are working on… they work across multiple different projects… so we
-- would just co-assign their tasks to the design manager of that project."
--
-- MEASURED on prod 2026-08-20, and it settles it:
--     Cam    14 open tasks   4 projects   ★ Brittani, Jade AND Lindsay
--     Shire   6 open tasks   1 project      Brittani
-- A single dm_da_groups row for Cam would have mis-filed two thirds of his
-- work. All 20 sit on a project that HAS a design manager.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE ROLE GATE IS LOAD-BEARING, AND HERE IS THE NUMBER
-- ---------------------------------------------------------------------------
-- The fallback applies ONLY to people who are active design associates. Applied
-- to every unmapped assignee it would have co-assigned a design manager to
-- 127 MORE open tasks, every one of them wrong:
--
--     'Entitlements' (a role token)   48    Miles   (ent lead)   40
--     Briana        (ent lead)        22    Bobby   (ent lead)    7
--     'Design Manager' (role token)    6    Derry   (a DM!)       2
--     'Schematic Team' (role token)    1    Ana     (schematic)   1
--
-- An entitlement lead does not report to a design manager, and Derry would have
-- become a co-assignee on a project another DM runs. So "unmapped" is not the
-- test; "unmapped AND a design associate" is.

-- ---------------------------------------------------------------------------
-- ★★ 1. A THIRD source value — the project-derived row is a different FACT
-- ---------------------------------------------------------------------------
-- ★ Named for what it is. Somebody will eventually want to keep one kind and
-- drop the other, and that is impossible if they share a label.
ALTER TABLE public.permit_task_assignees
  DROP CONSTRAINT IF EXISTS permit_task_assignees_source_check;
ALTER TABLE public.permit_task_assignees
  ADD CONSTRAINT permit_task_assignees_source_check
  CHECK (source IN ('manual', 'dm_of_da', 'dm_of_project'));

COMMENT ON COLUMN public.permit_task_assignees.source IS
  'manual = a person put this name here (the default, and what every pre-fix-346 row is); dm_of_da = fix-346, the assignee is a DA mapped in dm_da_groups; dm_of_project = fix-368, the assignee is an UNMAPPED design associate and this is the design manager of the task''s project. Only the two dm_of_* kinds are ever withdrawn automatically.';

-- ---------------------------------------------------------------------------
-- ★★ 2. Is this assignee an unmapped active design associate?
-- ---------------------------------------------------------------------------
-- ★ THE ORDER OF THE TWO TESTS IS THE RULE, and it is why this returns false
-- for a mapped DA: Ahmadi, Marc, Fisk and the rest genuinely belong to a
-- manager whatever project they are on, and the fallback must never override
-- that. dm_da_groups wins; this only speaks when it is silent.
--
-- ★ A ROLE IS NOT A PERSON (fix-346 rule 2): 'Entitlements', 'Design Manager'
-- and 'Schematic Team' are not roster names, so they fail the roster test and
-- get nothing — which is the 55 role-token tasks above, correctly skipped.
CREATE OR REPLACE FUNCTION public.bp_is_unmapped_active_da(p_assignee text, p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(btrim(p_assignee), '') <> ''
     AND public.bp_dm_for_da(p_assignee, p_tenant) IS NULL
     AND EXISTS (
       SELECT 1 FROM public.team_members m
       WHERE m.tenant_id = p_tenant
         AND lower(btrim(m.name)) = lower(btrim(p_assignee))
         AND m.role = 'da'
         AND COALESCE(m.active, true)
         AND NOT COALESCE(m.former, false)
     );
$function$;

REVOKE ALL ON FUNCTION public.bp_is_unmapped_active_da(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_is_unmapped_active_da(text, uuid)
  TO authenticated, service_role;

-- ★ The project's design manager, for a task's permit. One hop the trigger
-- would otherwise spell out twice.
CREATE OR REPLACE FUNCTION public.bp_project_dm_for_permit(p_permit_id integer, p_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(btrim(pr.design_manager), '')
  FROM public.permits p
  JOIN public.projects pr ON pr.id = p.project_id
  WHERE p.id = p_permit_id AND pr.tenant_id = p_tenant;
$function$;

REVOKE ALL ON FUNCTION public.bp_project_dm_for_permit(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_project_dm_for_permit(integer, uuid)
  TO authenticated, service_role;

-- ★★★ THE ONE RULE, in one place, returning the manager AND which fact it came
-- from. Both triggers below call this, so they cannot disagree.
CREATE OR REPLACE FUNCTION public.bp_coassign_for_task(
  p_assignee text, p_permit_id integer, p_tenant uuid)
RETURNS TABLE (manager text, src text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dm text;
BEGIN
  -- 1. The person-derived answer. fix-346, unchanged, and it WINS.
  v_dm := public.bp_dm_for_da(p_assignee, p_tenant);
  IF v_dm IS NOT NULL THEN
    manager := v_dm; src := 'dm_of_da'; RETURN NEXT; RETURN;
  END IF;

  -- 2. The project-derived answer, for an unmapped design associate only.
  IF public.bp_is_unmapped_active_da(p_assignee, p_tenant) THEN
    v_dm := public.bp_project_dm_for_permit(p_permit_id, p_tenant);
    IF v_dm IS NOT NULL THEN
      manager := v_dm; src := 'dm_of_project'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- 3. Nobody. ★ 20 of 161 active projects have no design_manager, and a task
  -- there co-assigns to nobody — which is correct: there genuinely is no one to
  -- tell. bp_coassign_gap_report() below makes that a number somebody can see.
  manager := NULL; src := NULL; RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_coassign_for_task(text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_coassign_for_task(text, integer, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★★ 3. The task trigger — fix-346's, taught the fallback
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_task_coassign_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_da  text := NULLIF(btrim(COALESCE(NEW.assigned_to, '')), '');
  v_manager text;
  v_src     text;
BEGIN
  -- ★ fix-346's guard, unchanged: "UPDATE OF assigned_to" fires whenever the
  -- column is in the SET list even when the value is identical, and
  -- bp_upsert_permit_task* always set it. Without this, editing a due date
  -- would resurrect a manager the user deliberately removed.
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NULL;
  END IF;

  SELECT c.manager, c.src INTO v_manager, v_src
  FROM public.bp_coassign_for_task(v_new_da, NEW.permit_id, NEW.tenant_id) c;

  -- ★★ WITHDRAW ANY AUTO ROW THAT IS NOT THE CURRENT ANSWER. fix-346 computed
  -- the OLD assignee's manager and deleted that specific name; this is the same
  -- rule stated as an invariant instead, which also cleans up a row left stale
  -- by a project reassignment. `manual` is untouched — a name a person chose is
  -- never withdrawn by a machine, which is fix-346's promise and this ticket's
  -- §4.
  DELETE FROM public.permit_task_assignees
   WHERE task_id = NEW.id
     AND source IN ('dm_of_da', 'dm_of_project')
     AND assignee IS DISTINCT FROM v_manager;

  -- ★ Never co-assign somebody to their own task (fix-346 rule 4). A design
  -- manager working on her own project would otherwise be added as her own
  -- co-assignee — the same rule with a new way to trip it.
  IF v_manager IS NOT NULL
     AND lower(btrim(v_manager)) <> lower(COALESCE(v_new_da, '')) THEN
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
    VALUES (NEW.tenant_id, NEW.id, v_manager, v_src)
    ON CONFLICT (task_id, assignee) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_task_coassign_dm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_task_coassign_dm()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS permit_tasks_coassign_dm ON public.permit_tasks;
CREATE TRIGGER permit_tasks_coassign_dm
  AFTER INSERT OR UPDATE OF assigned_to ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_task_coassign_dm();

-- ---------------------------------------------------------------------------
-- ★★★ 4. §2 — THE PROJECT'S MANAGER CHANGES, and that is new
-- ---------------------------------------------------------------------------
-- ★★ fix-346's answer depended only on the TASK, so one trigger on
-- permit_tasks.assigned_to was the whole story. This answer depends on a field
-- on ANOTHER TABLE: reassign a project to a different design manager and every
-- project-derived co-assignee on it is wrong, with nothing to fire that
-- trigger. So the second table gets its own.
--
-- ★★ ONLY THE PROJECT-DERIVED ROWS MOVE. A `manual` co-assignee somebody added
-- by hand is not touched by a project reassignment, ever — and neither is a
-- `dm_of_da` row, whose manager does not depend on the project at all.
--
-- ★ LIVE TASKS ONLY. Adding a manager to work that closed months ago is the
-- noise fix-355 spent a ticket removing; withdrawing a stale one is done
-- everywhere, because a wrong name is wrong whatever the task's status.
CREATE OR REPLACE FUNCTION public.bp_trg_project_dm_coassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dm text := NULLIF(btrim(COALESCE(NEW.design_manager, '')), '');
BEGIN
  IF NEW.design_manager IS NOT DISTINCT FROM OLD.design_manager THEN
    RETURN NULL;
  END IF;

  -- 4a. Withdraw every project-derived row on this project that is no longer
  --     the right answer. This is what stops a stale manager surviving.
  DELETE FROM public.permit_task_assignees a
   USING public.permit_tasks t, public.permits p
   WHERE a.task_id = t.id
     AND t.permit_id = p.id
     AND p.project_id = NEW.id
     AND a.source = 'dm_of_project'
     AND a.assignee IS DISTINCT FROM v_dm;

  -- 4b. Add the new one wherever the rule says so.
  IF v_dm IS NOT NULL THEN
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
    SELECT t.tenant_id, t.id, v_dm, 'dm_of_project'
      FROM public.permit_tasks t
      JOIN public.permits p ON p.id = t.permit_id
     WHERE p.project_id = NEW.id
       AND t.completion_status NOT IN ('Resolved', 'Cancelled')
       AND public.bp_is_unmapped_active_da(t.assigned_to, t.tenant_id)
       AND lower(btrim(COALESCE(t.assigned_to, ''))) <> lower(v_dm)
    ON CONFLICT (task_id, assignee) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_project_dm_coassign() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_project_dm_coassign()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS projects_dm_coassign ON public.projects;
CREATE TRIGGER projects_dm_coassign
  AFTER UPDATE OF design_manager ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_project_dm_coassign();

-- ---------------------------------------------------------------------------
-- ★★ 5. §3 — when there is nobody, say so
-- ---------------------------------------------------------------------------
-- ★ A task on a project with no design_manager co-assigns to nobody, which is
-- correct. But it must not be SILENT: the same reasoning as fix-352 — the
-- silence is the thing that hides. This makes "nobody was told" a number.
CREATE OR REPLACE FUNCTION public.bp_coassign_gap_report()
RETURNS TABLE (
  assignee text,
  address text,
  open_tasks integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.assigned_to,
         pr.address,
         count(*)::integer
  FROM public.permit_tasks t
  JOIN public.permits p  ON p.id = t.permit_id
  JOIN public.projects pr ON pr.id = p.project_id
  WHERE pr.tenant_id = ANY (public.auth_tenant_ids())
    AND t.completion_status NOT IN ('Resolved', 'Cancelled')
    AND public.bp_is_unmapped_active_da(t.assigned_to, t.tenant_id)
    AND NULLIF(btrim(COALESCE(pr.design_manager, '')), '') IS NULL
  GROUP BY 1, 2
  ORDER BY 3 DESC, 1, 2;
$$;

COMMENT ON FUNCTION public.bp_coassign_gap_report() IS
  'fix-368 §3: open tasks whose assignee is an unmapped design associate on a project with NO design_manager — the work that reaches nobody. Zero rows today; it is here so the silence is a number rather than an absence.';

REVOKE ALL ON FUNCTION public.bp_coassign_gap_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_coassign_gap_report() TO authenticated, service_role;
