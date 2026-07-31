-- fix-262 (2026-07-31): CANCELLED projects — one mechanism, two kinds.
--
-- Bobby's model, verbatim: "A hold is still an ACTIVE project. A cancelled
-- project is no longer active. It is like the step after hold, but before
-- delete."  Lifecycle:  active -> hold -> cancelled -> (delete).
--
-- Cancel is an OUTCOME axis. It is deliberately NOT projects.archived (a hide
-- switch, client-only, zero rows on prod) and NOT draw_schedule.status (phase
-- states). It EXTENDS the fix-167 project_holds mechanism with a `kind`
-- discriminator, so both states share one table, one history, one audit trail,
-- and one set of date/reason/note semantics. Both are reversible.
--
-- Conventions mirrored from fix-167 (project_holds) exactly:
--   * RPCs SECURITY DEFINER, fix-163 tenant gate (service_role bypasses),
--     search_path pinned, audited into audit_log.
--   * Reason vocabulary in app_config, editable in Settings -> Projects.
--   * anon/PUBLIC revoked; authenticated + service_role granted.
--
-- Applied to prod via MCP. This file is the repo-of-record backstop.
--
-- ============================================================================
-- TWO DECISIONS WORTH READING BEFORE YOU EDIT THIS FILE
-- ============================================================================
-- 1. "A project cannot be both held and cancelled" is enforced by the EXISTING
--    partial unique index project_holds_one_active_per_project, which is
--    ON (project_id) WHERE hold_end IS NULL — i.e. kind-blind, at most one OPEN
--    row of ANY kind. That is exactly the rule we want, so the index is left
--    untouched. The plpgsql guards below are the friendly-error layer in front
--    of it.
--
-- 2. Because the lifecycle is active -> hold -> cancelled, cancelling a project
--    that is CURRENTLY ON HOLD closes the open hold (hold_end := cancel date)
--    and opens the cancel row, atomically. The hold's history is preserved, so
--    its days still count for accountableDays. bp_restore_project then returns
--    the project to ACTIVE (it closes the cancel row; it does not resurrect the
--    prior hold). Both behaviours are flagged in the PR body.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. project_holds.kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_holds
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hold';

-- Backfill is implicit via the DEFAULT for existing rows, but be explicit so
-- re-running against a table that somehow acquired NULLs is still correct.
UPDATE public.project_holds SET kind = 'hold' WHERE kind IS NULL OR btrim(kind) = '';

ALTER TABLE public.project_holds DROP CONSTRAINT IF EXISTS project_holds_kind_chk;
ALTER TABLE public.project_holds
  ADD CONSTRAINT project_holds_kind_chk CHECK (kind IN ('hold', 'cancelled'));

COMMENT ON COLUMN public.project_holds.kind IS
  'fix-262: ''hold'' (project is paused but still ACTIVE) or ''cancelled'' '
  '(project is no longer active — the step after hold, before delete). At most '
  'one OPEN row of either kind per project (project_holds_one_active_per_project).';

-- Index the discriminator for the open-row lookups every consumer does.
CREATE INDEX IF NOT EXISTS project_holds_kind_open_idx
  ON public.project_holds (kind, project_id) WHERE hold_end IS NULL;

-- ---------------------------------------------------------------------------
-- B. permit_tasks.prior_completion_status
-- ---------------------------------------------------------------------------
-- There is no task history table and no soft state on permit_tasks. done_at is
-- the only stored prior-state marker and bp_trg_task_done_at actively CLEARS it
-- on any non-Resolved status — so it cannot be used to reconstruct a task's
-- pre-cancel state. This column IS the restore mechanism.
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS prior_completion_status text;

COMMENT ON COLUMN public.permit_tasks.prior_completion_status IS
  'fix-262: the completion_status this task held immediately before a project '
  'cancel swept it to ''Cancelled''. NULL for every task not currently cancelled '
  'by a sweep. bp_restore_project reads it, restores it, then NULLs it.';

CREATE INDEX IF NOT EXISTS permit_tasks_cancelled_idx
  ON public.permit_tasks (permit_id)
  WHERE completion_status = 'Cancelled';

-- ---------------------------------------------------------------------------
-- C. Cancel reasons — a SEPARATE vocabulary from hold reasons
-- ---------------------------------------------------------------------------
-- Deliberately not reusing holdReasonOptions: "builder pulled out" and "waiting
-- on survey" are different vocabularies. Same app_config mechanism, same
-- Settings -> Projects editor, same dropdown-only treatment.
INSERT INTO public.app_config (tenant_id, key, value)
SELECT (SELECT id FROM public.tenants ORDER BY id LIMIT 1), 'cancelReasonOptions',
  '["Builder pulled out","Land deal fell through","Financing withdrawn","Zoning / code change made it infeasible","Replaced by a redesign","Sold to another party","No longer pursuing"]'::jsonb
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- D. bp_set_project_hold — kind-aware guard
-- ---------------------------------------------------------------------------
-- Re-emitted from the fix-167 definition with ONLY the guard + kind changed.
-- A project that is CANCELLED cannot be put on hold (it is not active); a
-- project already on hold still raises 23505 exactly as before.
CREATE OR REPLACE FUNCTION public.bp_set_project_hold(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_reason     text,
  p_note       text DEFAULT NULL,
  p_hold_start date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start date := COALESCE(p_hold_start, current_date);
  v_row   public.project_holds;
  v_open  public.project_holds;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_set_project_hold: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NULLIF(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'bp_set_project_hold: reason is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'bp_set_project_hold: project % not found in tenant %', p_project_id, p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  -- fix-262: kind-aware. A project can be neither double-held nor held-while-
  -- cancelled; the message names which state is in the way.
  SELECT * INTO v_open FROM public.project_holds
   WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND hold_end IS NULL;
  IF FOUND THEN
    IF v_open.kind = 'cancelled' THEN
      RAISE EXCEPTION 'bp_set_project_hold: project % is CANCELLED — restore it before putting it on hold', p_project_id
        USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'bp_set_project_hold: project % already has an active hold', p_project_id
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.project_holds (tenant_id, project_id, reason, note, hold_start, created_by, kind)
  VALUES (p_tenant_id, p_project_id, trim(p_reason), NULLIF(trim(COALESCE(p_note, '')), ''), v_start, auth.uid(), 'hold')
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_hold_set', 'project_holds', v_row.id::text,
    jsonb_build_object('project_id', p_project_id, 'reason', v_row.reason, 'hold_start', v_row.hold_start, 'kind', 'hold')
  );

  RETURN NEXT v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- E. bp_lift_project_hold — scoped to kind='hold'
-- ---------------------------------------------------------------------------
-- Lifting a HOLD and restoring a CANCEL are semantically distinct actions with
-- distinct audit rows. Scoping this to kind='hold' is behaviour-preserving:
-- every pre-fix-262 row is kind='hold'.
CREATE OR REPLACE FUNCTION public.bp_lift_project_hold(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_hold_end   date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_end date := COALESCE(p_hold_end, current_date);
  v_row public.project_holds;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_lift_project_hold: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_holds
  SET hold_end = GREATEST(v_end, hold_start), updated_at = now()
  WHERE project_id = p_project_id AND tenant_id = p_tenant_id
    AND hold_end IS NULL AND kind = 'hold'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_lift_project_hold: project % has no active hold', p_project_id;
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_hold_lifted', 'project_holds', v_row.id::text,
    jsonb_build_object('project_id', p_project_id, 'hold_end', v_row.hold_end)
  );

  RETURN NEXT v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- F. bp_set_project_cancel — cancel a project + sweep its live tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_set_project_cancel(
  p_tenant_id   uuid,
  p_project_id  uuid,
  p_reason      text,
  p_note        text DEFAULT NULL,
  p_cancel_date date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start  date := COALESCE(p_cancel_date, current_date);
  v_row    public.project_holds;
  v_open   public.project_holds;
  v_tasks  integer := 0;
  v_lifted uuid    := NULL;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_set_project_cancel: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NULLIF(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'bp_set_project_cancel: reason is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'bp_set_project_cancel: project % not found in tenant %', p_project_id, p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_open FROM public.project_holds
   WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND hold_end IS NULL;

  IF FOUND AND v_open.kind = 'cancelled' THEN
    RAISE EXCEPTION 'bp_set_project_cancel: project % is already cancelled', p_project_id
      USING ERRCODE = '23505';
  END IF;

  -- Lifecycle step hold -> cancelled: close the open hold at the cancel date so
  -- the two states never coexist, keeping the hold row as history (its days
  -- still count for accountableDays). GREATEST guards the dates CHECK when the
  -- cancel is backdated to before the hold started.
  IF FOUND THEN
    UPDATE public.project_holds
       SET hold_end = GREATEST(v_start, hold_start), updated_at = now()
     WHERE id = v_open.id
    RETURNING id INTO v_lifted;
  END IF;

  INSERT INTO public.project_holds (tenant_id, project_id, reason, note, hold_start, created_by, kind)
  VALUES (p_tenant_id, p_project_id, trim(p_reason), NULLIF(trim(COALESCE(p_note, '')), ''), v_start, auth.uid(), 'cancelled')
  RETURNING * INTO v_row;

  -- ── TASK SWEEP ──────────────────────────────────────────────────────────
  -- ONLY 'Open' and 'In Progress'. A Resolved task is already done: there is
  -- nothing to resurrect, and touching completion_status would fire
  -- bp_trg_task_done_at, which sets done := (status = 'Resolved') and CLEARS
  -- done_at for any other status — silently destroying the completion record.
  -- prior_completion_status is captured in the same statement so the restore is
  -- exact rather than reconstructed.
  UPDATE public.permit_tasks t
     SET prior_completion_status = t.completion_status,
         completion_status       = 'Cancelled'
    FROM public.permits p
   WHERE p.id = t.permit_id
     AND p.project_id = p_project_id
     AND t.tenant_id = p_tenant_id
     AND t.completion_status IN ('Open', 'In Progress');
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_cancelled', 'project_holds', v_row.id::text,
    jsonb_build_object(
      'project_id', p_project_id,
      'reason', v_row.reason,
      'cancel_date', v_row.hold_start,
      'tasks_cancelled', v_tasks,
      'hold_closed_id', v_lifted
    )
  );

  RETURN NEXT v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- G. bp_restore_project — "bring this back"
-- ---------------------------------------------------------------------------
-- The reverse of F. Closes the open cancel row and returns every swept task to
-- EXACTLY its prior state. Idempotent in both directions: a task with no stored
-- prior state is left alone, so re-running restores nothing twice.
CREATE OR REPLACE FUNCTION public.bp_restore_project(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_restore_date date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_end   date := COALESCE(p_restore_date, current_date);
  v_row   public.project_holds;
  v_tasks integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_restore_project: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_holds
     SET hold_end = GREATEST(v_end, hold_start), updated_at = now()
   WHERE project_id = p_project_id AND tenant_id = p_tenant_id
     AND hold_end IS NULL AND kind = 'cancelled'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_restore_project: project % is not cancelled', p_project_id;
  END IF;

  -- Restore each swept task to its exact prior state, then clear the marker.
  -- Guarded on prior_completion_status IS NOT NULL so a task somebody set to
  -- 'Cancelled' by hand (no stored prior) is never silently reopened.
  UPDATE public.permit_tasks t
     SET completion_status       = t.prior_completion_status,
         prior_completion_status = NULL
    FROM public.permits p
   WHERE p.id = t.permit_id
     AND p.project_id = p_project_id
     AND t.tenant_id = p_tenant_id
     AND t.completion_status = 'Cancelled'
     AND t.prior_completion_status IS NOT NULL;
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_restored', 'project_holds', v_row.id::text,
    jsonb_build_object(
      'project_id', p_project_id,
      'restored_on', v_row.hold_end,
      'tasks_restored', v_tasks
    )
  );

  RETURN NEXT v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- H. Server-side task lists must respect 'Cancelled'
-- ---------------------------------------------------------------------------
-- Every open-work predicate in this codebase was written as "<> 'Resolved'",
-- which reads a CANCELLED task as OPEN. The client-side surfaces now route
-- through taskStatus.isTaskLive; these two RPCs filter server-side and have to
-- be fixed here or a cancelled project keeps leaking tasks into live lists.
-- Both are re-emitted from their LIVE prod definitions with only the predicate
-- widened.

-- fix-140 / fix-197b: My Tasks "Waiting On". Was `IS DISTINCT FROM 'Resolved'`.
CREATE OR REPLACE FUNCTION public.bp_list_waiting_on_tasks(p_include_completed boolean DEFAULT false)
 RETURNS TABLE(task_id uuid, task_text text, bucket text, waiting_on text, firm_id uuid,
               firm_name text, firm_active boolean, project_id uuid, project_address text,
               project_juris text, permit_id integer, permit_type text, assigned_to text,
               priority boolean, start_date date, due_date date, target_date date,
               completion_status text, done boolean, done_at timestamp with time zone,
               notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
BEGIN
  RETURN QUERY
    SELECT
      pt.id, pt.text, pt.bucket, pt.waiting_on,
      NULL::uuid AS firm_id, NULL::text AS firm_name, NULL::boolean AS firm_active,
      p.id  AS project_id, p.address AS project_address, p.juris AS project_juris,
      pm.id AS permit_id, pm.type AS permit_type,
      pt.assigned_to, pt.priority, pt.start_date, pt.due_date, pt.target_date,
      pt.completion_status, pt.done, pt.done_at, pt.notes,
      pt.created_at, pt.updated_at
    FROM public.permit_tasks pt
    JOIN public.permits  pm ON pm.id = pt.permit_id
    JOIN public.projects p  ON p.id  = pm.project_id
    WHERE pt.tenant_id = ANY (v_tenants)
      AND pt.waiting_on IS NOT NULL
      -- fix-262: a cancelled task is never "waiting on" anybody. Unlike
      -- Resolved it is NOT revealed by p_include_completed either — it was
      -- abandoned, not completed.
      AND pt.completion_status IS DISTINCT FROM 'Cancelled'
      AND (p_include_completed OR pt.completion_status IS DISTINCT FROM 'Resolved')
    ORDER BY pt.waiting_on ASC, pt.due_date ASC NULLS LAST;
END;
$function$;

-- fix-notes-2 / fix-notes-5: the dashboard expanded-permit card's next-task
-- slots. This one gated on `done = false`, which is even more exposed: the
-- fix-235 trigger sets done := (status = 'Resolved'), so a Cancelled task
-- carries done=false and would keep showing as the permit's next ENT/ARCH task.
CREATE OR REPLACE FUNCTION public.bp_dashboard_permit_cards()
 RETURNS TABLE(permit_id integer, ent_task text, arch_task text, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ent AS (
    SELECT DISTINCT ON (t.permit_id) t.permit_id, t.text
    FROM public.permit_tasks t
    WHERE t.tenant_id = ANY (public.auth_tenant_ids())
      AND COALESCE(t.discipline, 'ent') = 'ent'
      AND t.done = false
      AND t.completion_status IS DISTINCT FROM 'Cancelled'   -- fix-262
    ORDER BY t.permit_id, t.target_date NULLS LAST, t.due_date NULLS LAST,
             t.sort_order, t.id
  ),
  arch AS (
    SELECT DISTINCT ON (t.permit_id) t.permit_id, t.text
    FROM public.permit_tasks t
    WHERE t.tenant_id = ANY (public.auth_tenant_ids())
      AND t.discipline = 'arch'
      AND t.done = false
      AND t.completion_status IS DISTINCT FROM 'Cancelled'   -- fix-262
    ORDER BY t.permit_id, t.target_date NULLS LAST, t.due_date NULLS LAST,
             t.sort_order, t.id
  ),
  nte AS (
    SELECT DISTINCT ON (n.permit_id) n.permit_id, left(n.body, 280) AS body
    FROM public.notes n
    WHERE n.tenant_id = ANY (public.auth_tenant_ids())
      AND n.permit_id IS NOT NULL
      AND n.completed = false
    ORDER BY n.permit_id, n.created_at DESC, n.id DESC
  ),
  ids AS (
    SELECT permit_id FROM ent
    UNION SELECT permit_id FROM arch
    UNION SELECT permit_id FROM nte
  )
  SELECT ids.permit_id, ent.text, arch.text, nte.body
  FROM ids
  LEFT JOIN ent  ON ent.permit_id  = ids.permit_id
  LEFT JOIN arch ON arch.permit_id = ids.permit_id
  LEFT JOIN nte  ON nte.permit_id  = ids.permit_id;
$function$;

-- NOT changed, deliberately:
--   * bp_my_tasks — has no status filter at all; the client filters, and
--     MyTasks.tsx now routes through isTaskLive.
--   * bp_list_permit_tasks — returns every status so the permit bar can render
--     a cancelled task read-only rather than making it vanish mid-project.
--   * bp_create_lifecycle_task — its scrape_reconcile dedupe treats a cancelled
--     reconcile task as still-open and suppresses new ones. Correct: a cancelled
--     project is out of the scrape entirely, and the task returns on restore.
--   * bp_reassign_project_da — re-points assignees on non-Resolved tasks. A
--     cancelled task getting the new DA is right; it comes back owned correctly.

-- ---------------------------------------------------------------------------
-- I. Grants (fix-157 model: anon/PUBLIC revoked, app-callable via authenticated)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.bp_set_project_cancel(uuid, uuid, text, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bp_restore_project(uuid, uuid, date)                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bp_set_project_cancel(uuid, uuid, text, text, date) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.bp_restore_project(uuid, uuid, date)                TO authenticated, service_role;

COMMIT;
