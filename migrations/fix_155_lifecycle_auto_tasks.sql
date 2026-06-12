-- fix-155 (2026-06-12): Lifecycle auto-tasks engine (Phase B of scraper-driven
-- lifecycle automation).
--
-- The scraper (separate repo, Phase C — NOT this PR) will soon auto-write
-- lifecycle transitions (intake submitted -> accepted -> corrections issued ->
-- resubmitted) and fire a verification task at each one. Tasks are how the team
-- double-checks what the scraper read; they are NEVER auto-completed — a human
-- closes them. This migration builds the engine those events call into.
--
-- Surfaces (all additive / idempotent — safe to re-run):
--   1. permit_tasks.auto_event              — which lifecycle event spawned the task
--   2. partial unique index                 — one auto-task per (event, cycle) per permit, ever
--   3. app_sweeps                           — per-tenant once-a-day sweep guard
--   4. bp_create_lifecycle_task(...)        — the creator (called by app + eventually scraper)
--   5. bp_generate_number_entry_tasks(...)  — the daily numberless-permit sweep
--   6. bp_list_tasks / bp_list_permit_tasks — thread is_auto_generated + auto_event to the UI
--
-- IMPORTANT: items 6 are CREATE OR REPLACE of EXISTING functions. The bodies
-- below are the LIVE production definitions (pulled via pg_get_functiondef on
-- 2026-06-12) with two fields added — NOT the stale committed fix_78/fix_79
-- text, which predates fix-138's assigned_to/priority/waiting_on/notes/due_date
-- additions. Re-deriving from the committed files would regress prod.
--
-- Schema head start (verified in prod 2026-06-12): permit_tasks already has
-- is_auto_generated, city_acceptance_check, cycle_idx, parent_task_id,
-- assigned_to, priority, waiting_on, co_assignees, bucket, stage. 0 prod rows
-- have is_auto_generated = true.

-- ============================================================================
-- 1. auto_event column
-- ============================================================================
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS auto_event text;

COMMENT ON COLUMN public.permit_tasks.auto_event IS
  'fix-155: lifecycle event that spawned this auto-task (intake_submitted | intake_accepted | corr_issued | resubmitted | number_entry). NULL for human-created tasks.';

-- ============================================================================
-- 2. Idempotency: one auto-task per event per cycle per permit, ever.
--    Re-opening a closed auto-task is a human call; the scraper firing the same
--    event twice must be a no-op. cycle_idx is NULL for non-cyclic events
--    (intake_*, number_entry), so COALESCE(-1) collapses them to a single slot.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS permit_tasks_auto_event_uniq
  ON public.permit_tasks (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
  WHERE is_auto_generated = true;

-- ============================================================================
-- 3. Sweep guard. app_config's PK is (key) alone — not per-tenant — so it can't
--    hold a per-tenant last-run date. A dedicated table keyed (tenant_id,
--    sweep_name) is the clean fit. Touched only by the SECURITY DEFINER sweep
--    below, which bypasses RLS; RLS-on / no-policy denies direct client access.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_sweeps (
  tenant_id     uuid        NOT NULL,
  sweep_name    text        NOT NULL,
  last_swept_on date        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sweep_name)
);
ALTER TABLE public.app_sweeps ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. bp_create_lifecycle_task — the single creator every lifecycle event calls.
--    p_tenant_id is explicit because the eventual caller is the scraper on
--    service-role (no auth context). From an app session it is validated
--    against auth_tenant_ids(). Returns the new task id, or NULL when the
--    partial unique index suppresses a duplicate fire.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(
  p_tenant_id uuid,
  p_permit_id integer,
  p_event     text,
  p_cycle_idx integer DEFAULT NULL,
  p_context   jsonb   DEFAULT '{}'::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_tenants uuid[];
  v_permit         public.permits%ROWTYPE;
  v_project_ent    text;
  v_project_addr   text;
  v_assignee       text;
  v_num_label      text;
  v_cycle_label    text;
  v_title          text;
  v_bucket         text := 'pm';   -- auto-tasks are permitting-phase verification
  v_city_check     boolean := false;
  v_priority       boolean := false;
  v_notes          text;
  v_new_id         uuid;
BEGIN
  -- Validate the event up front (unknown event raises).
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  -- Tenant guard. App sessions carry a JWT, so auth_tenant_ids() is non-empty
  -- and the target tenant must be in scope. The scraper runs on service-role
  -- with no JWT (auth_tenant_ids() empty) and is trusted to pass the right
  -- tenant explicitly — so the check is skipped only when there is no auth
  -- context at all.
  v_caller_tenants := public.auth_tenant_ids();
  IF array_length(v_caller_tenants, 1) IS NOT NULL
     AND NOT (p_tenant_id = ANY (v_caller_tenants))
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  -- Load the permit; it must belong to the target tenant.
  SELECT * INTO v_permit
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: permit % not found in tenant %',
      p_permit_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Project address + project-level ent fallback in one read.
  SELECT NULLIF(btrim(entitlement_lead), ''), address
    INTO v_project_ent, v_project_addr
  FROM public.projects
  WHERE id = v_permit.project_id;

  -- Assignee: permit.ent_lead -> project.entitlement_lead -> NULL (unassigned).
  v_assignee := COALESCE(NULLIF(btrim(v_permit.ent_lead), ''), v_project_ent);

  v_num_label   := COALESCE(NULLIF(btrim(v_permit.num), ''), 'no number yet');
  v_cycle_label := COALESCE(p_cycle_idx::text, '?');

  -- Title + per-event flags. Em-dash matches existing task copy ("BP — …").
  CASE p_event
    WHEN 'intake_submitted' THEN
      v_title := 'Verify: intake submitted / fees paid — ' || v_num_label;
      v_city_check := true;  -- "did the city take it?" check
    WHEN 'intake_accepted' THEN
      v_title := 'Verify: intake accepted — reviews starting — ' || v_num_label;
    WHEN 'corr_issued' THEN
      v_title := 'Corrections issued (cycle ' || v_cycle_label
                 || ') — send to consultants — ' || v_num_label;
      v_priority := true;
    WHEN 'resubmitted' THEN
      v_title := 'Verify: city accepted resubmission (cycle ' || v_cycle_label
                 || ') — ' || v_num_label;
      v_city_check := true;  -- "did the city take it?" check
    WHEN 'number_entry' THEN
      -- Numberless permit; key off type @ project instead of a number.
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project');
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  -- Insert, deduped against the partial unique index. ON CONFLICT inference
  -- repeats the index expression + predicate verbatim.
  INSERT INTO public.permit_tasks (
    tenant_id, permit_id, text, discipline, bucket, stage,
    completion_status, done, is_auto_generated, auto_event, cycle_idx,
    city_acceptance_check, priority, assigned_to, notes, sort_order
  ) VALUES (
    p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
    'Open', false, true, p_event, p_cycle_idx,
    v_city_check, v_priority, v_assignee, v_notes, 0
  )
  ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
    WHERE is_auto_generated = true
  DO NOTHING
  RETURNING id INTO v_new_id;

  RETURN v_new_id;  -- NULL when a duplicate fire was suppressed
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_create_lifecycle_task(uuid, integer, text, integer, jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- 5. bp_generate_number_entry_tasks — the daily sweep. For every active permit
--    with no number whose target_submit has arrived (and which isn't terminal),
--    fire a number_entry task. Self-guards to once per tenant per day via
--    app_sweeps. Returns the count actually created (dedupe-aware).
--
--    Post-submit-number jurisdictions (Kirkland / MPB style) don't get a number
--    until after the team submits. When target_submit arrives, this nudges the
--    team to enter the number — closing that loop is what unlocks scraping.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_generate_number_entry_tasks(
  p_tenant_id uuid DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[];
  v_today   date := current_date;
  v_count   integer := 0;
  v_tenant  uuid;
  v_permit  record;
  v_made    uuid;
BEGIN
  -- Explicit tenant (scraper/service-role) wins; else sweep the caller's scope.
  IF p_tenant_id IS NOT NULL THEN
    v_tenants := ARRAY[p_tenant_id];
  ELSE
    v_tenants := public.auth_tenant_ids();
  END IF;
  IF v_tenants IS NULL OR array_length(v_tenants, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    -- Once-a-day guard: skip a tenant already swept today.
    IF EXISTS (
      SELECT 1 FROM public.app_sweeps
      WHERE tenant_id = v_tenant
        AND sweep_name = 'number_entry'
        AND last_swept_on >= v_today
    ) THEN
      CONTINUE;
    END IF;

    FOR v_permit IN
      SELECT p.id
      FROM public.permits p
      WHERE p.tenant_id = v_tenant
        AND (p.num IS NULL OR btrim(p.num) = '')
        AND p.target_submit IS NOT NULL
        AND p.target_submit <= v_today
        -- Not terminal: don't nag a permit the city has finished with or that
        -- was withdrawn. Mirrors permitTerminalStatus.ts TERMINAL_POSITIVE_*
        -- plus the dead/done states present in prod.
        AND COALESCE(btrim(p.status), '') NOT IN (
          'Conceptually Approved','Approved','Issued','Completed','Closed',
          'Ready for Issuance','Ready To Issue','Finaled','Withdrawn'
        )
    LOOP
      v_made := public.bp_create_lifecycle_task(
        v_tenant, v_permit.id, 'number_entry', NULL, '{}'::jsonb
      );
      IF v_made IS NOT NULL THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;

    -- Mark this tenant swept today (records even when 0 created, so re-runs
    -- this day no-op as specified).
    INSERT INTO public.app_sweeps (tenant_id, sweep_name, last_swept_on, updated_at)
    VALUES (v_tenant, 'number_entry', v_today, now())
    ON CONFLICT (tenant_id, sweep_name)
    DO UPDATE SET last_swept_on = EXCLUDED.last_swept_on, updated_at = now();
  END LOOP;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_generate_number_entry_tasks(uuid)
  TO authenticated, service_role;

-- ============================================================================
-- 6. Thread is_auto_generated + auto_event through the read RPCs so the UI can
--    render the BOT badge and filter on it. Bodies are the LIVE prod defs with
--    two added jsonb keys — see header note.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_list_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_result  jsonb;
BEGIN
  SELECT COALESCE(
           jsonb_agg(obj ORDER BY project_address, permit_id, sort_order, created_at),
           '[]'::jsonb
         )
    INTO v_result
  FROM (
    SELECT
      pr.address AS project_address,
      t.permit_id,
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id',              t.id,
        'permit_id',       t.permit_id,
        'project_id',      p.project_id,
        'project_address', pr.address,
        'permit_type',     p.type,
        'parent_task_id',  t.parent_task_id,
        'discipline',      COALESCE(t.discipline, 'ent'),
        'bucket',          t.bucket,
        'text',            t.text,
        'status',          t.completion_status,
        'start_date',      t.start_date,
        'target_date',     t.target_date,
        'due_date',        t.due_date,
        'done_at',         t.done_at,
        'sort_order',      t.sort_order,
        'assigned_to',     t.assigned_to,
        'waiting_on',      t.waiting_on,
        'priority',        COALESCE(t.priority, false),
        'notes',           t.notes,
        'is_auto_generated', COALESCE(t.is_auto_generated, false),
        'auto_event',      t.auto_event,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch'
               THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id)
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits  p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bp_list_permit_tasks(p_permit_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_da      text;
  v_ent     text;
  v_result  jsonb;
BEGIN
  SELECT da, ent_lead INTO v_da, v_ent
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = ANY (v_tenants);

  SELECT COALESCE(jsonb_agg(task_obj ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'permit_id', t.permit_id,
        'parent_task_id', t.parent_task_id,
        'discipline', COALESCE(t.discipline, 'ent'),
        'bucket', t.bucket,
        'text', t.text,
        'status', t.completion_status,
        'start_date', t.start_date,
        'target_date', t.target_date,
        'due_date', t.due_date,
        'done_at', t.done_at,
        'sort_order', t.sort_order,
        'assigned_to', t.assigned_to,
        'waiting_on', t.waiting_on,
        'priority', COALESCE(t.priority, false),
        'notes', t.notes,
        'is_auto_generated', COALESCE(t.is_auto_generated, false),
        'auto_event', t.auto_event,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch' THEN v_da ELSE v_ent END,
        'co_assignees', public.bp_task_co_assignees(t.id),
        'subtasks', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'permit_id', s.permit_id,
              'parent_task_id', s.parent_task_id,
              'discipline', COALESCE(s.discipline, COALESCE(t.discipline,'ent')),
              'bucket', s.bucket,
              'text', s.text,
              'status', s.completion_status,
              'start_date', s.start_date,
              'target_date', s.target_date,
              'due_date', s.due_date,
              'done_at', s.done_at,
              'sort_order', s.sort_order,
              'assigned_to', s.assigned_to,
              'waiting_on', s.waiting_on,
              'priority', COALESCE(s.priority, false),
              'notes', s.notes,
              'is_auto_generated', COALESCE(s.is_auto_generated, false),
              'auto_event', s.auto_event,
              'primary_assignee',
                CASE WHEN COALESCE(s.discipline, COALESCE(t.discipline,'ent')) = 'arch'
                     THEN v_da ELSE v_ent END,
              'co_assignees', public.bp_task_co_assignees(s.id)
            )
            ORDER BY s.sort_order, s.created_at
          )
          FROM public.permit_tasks s
          WHERE s.parent_task_id = t.id AND s.tenant_id = ANY (v_tenants)
        ), '[]'::jsonb)
      ) AS task_obj
    FROM public.permit_tasks t
    WHERE t.permit_id = p_permit_id
      AND t.tenant_id = ANY (v_tenants)
      AND t.parent_task_id IS NULL
  ) ranked;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
