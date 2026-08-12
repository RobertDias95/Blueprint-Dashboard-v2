-- fix-292: give auto-generated lifecycle tasks a start and target date.
--
-- ★ THE PROBLEM. Every bot task was created with start_date and target_date
-- NULL, so My Tasks had nothing to order them by. Measured in prod before this
-- ran: 420 bot tasks, 146 open, and ALL 146 open ones had both dates NULL —
-- 100%. (Manual tasks: 619 total, 355 open, 222 with no start date. Those are
-- a human's to fill in and are NOT touched here.)
--
-- WHY THE EXISTING TRIGGER DID NOT COVER THIS
-- -------------------------------------------
-- public.bp_trg_task_start_date already fires BEFORE INSERT on permit_tasks,
-- but it only stamps a date when completion_status is 'In Progress' or
-- 'Resolved':
--
--     IF NEW.completion_status IN ('In Progress','Resolved') AND (...)
--       THEN NEW.start_date := current_date;
--
-- bp_create_lifecycle_task inserts every bot task as 'Open', so the trigger
-- correctly did nothing — a task nobody has started has no start date under
-- that rule. This migration does not change that rule, and must not: it is the
-- right behaviour for a human's task. It sets the dates EXPLICITLY at creation
-- instead, which the trigger then leaves alone by its own first clause
-- ("Never argue with a date a human already entered" — an explicit value is
-- indistinguishable from a human's, which is exactly what we want here).
--
-- ONE INSERT POINT, SEVEN EVENTS
-- ------------------------------
-- All three lifecycle entry points funnel through bp_create_lifecycle_task:
-- bp_generate_number_entry_tasks and bp_permit_results_ready_autotask both CALL
-- it rather than inserting themselves (verified against prod). So the two
-- INSERT branches below are the only places a bot task is born, and all seven
-- auto_event types get the dates from one change.
--
-- ★ ONE DAY FOR ALL SEVEN, DELIBERATELY AND NOT SILENTLY. Most of these are a
-- check rather than real work ("Verify: intake accepted", "Enter permit
-- number"), so one day is the right default. It is applied UNIFORMLY — no event
-- is special-cased here.
--
-- For the record, because the number deserves to be argued with rather than
-- assumed: the median time actually taken to resolve a bot task, measured over
-- the 274 resolved ones, is nowhere near a day —
--
--     number_entry     17.2d    resubmitted      12.9d
--     intake_submitted 12.6d    intake_accepted  10.9d
--     scrape_reconcile  6.3d    corr_issued       6.3d
--     results_ready     3.0d
--
-- That is history from a queue with NO dates at all, in which nothing prompted
-- anyone — it measures the problem being fixed, not the time the work needs.
-- target_date is a TARGET, not a forecast, so setting it from that history
-- would bake the neglect in. If the team later wants targets that reflect
-- reality, `number_entry` is the one to argue about first: at a 17-day median
-- it is not a "check", it waits on somebody finding out whether a submittal
-- happened. Changing it is a one-line edit to v_target_days below.
--
-- due_date is NOT touched. permit_tasks carries both, and target_date is the
-- column My Tasks orders and the estimator reads.
--
-- migrations/ is partial; prod is canon. bp_create_lifecycle_task below is
-- re-emitted from the LIVE pg_get_functiondef with ONLY the date columns added
-- to the two INSERTs.
--
-- Idempotent: CREATE OR REPLACE, and the backfill only fills NULLs.

-- ---------------------------------------------------------------------------
-- 1. bp_create_lifecycle_task — set start_date and target_date on creation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(p_tenant_id uuid, p_permit_id integer, p_event text, p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_permit         public.permits%ROWTYPE;
  v_project_addr   text;
  v_num_label      text;
  v_cycle_label    text;
  v_title          text;
  v_bucket         text;
  v_city_check     boolean := false;
  v_priority       boolean := false;
  v_notes          text;
  v_new_id         uuid;
  -- fix-292: how long a bot task gets. One day, for every event — see the
  -- header for the measured durations this deliberately does NOT follow.
  v_target_days    constant integer := 1;
  v_start          date := current_date;
BEGIN
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry','scrape_reconcile','results_ready')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_permit
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: permit % not found in tenant %',
      p_permit_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT address INTO v_project_addr
  FROM public.projects WHERE id = v_permit.project_id;

  v_num_label   := COALESCE(NULLIF(btrim(v_permit.num), ''), 'no number yet');
  v_cycle_label := COALESCE(p_cycle_idx::text, '?');

  IF p_event = 'number_entry' THEN
    v_bucket := 'de';
  ELSIF p_event = 'scrape_reconcile' THEN
    SELECT CASE WHEN c.intake_accepted IS NOT NULL THEN 'pm' ELSE 'de' END
      INTO v_bucket
    FROM public.permit_cycles c
    WHERE c.permit_id = p_permit_id AND c.cycle_index = 0;
    v_bucket := COALESCE(v_bucket, 'de');
  ELSE
    v_bucket := 'pm';
  END IF;

  CASE p_event
    WHEN 'intake_submitted' THEN
      v_title := 'Verify: intake submitted / fees paid — ' || v_num_label;
      v_city_check := true;
    WHEN 'intake_accepted' THEN
      v_title := 'Verify: intake accepted — reviews starting — ' || v_num_label;
    WHEN 'corr_issued' THEN
      v_title := 'Corrections issued (cycle ' || v_cycle_label
                 || ') — send to consultants — ' || v_num_label;
      v_priority := true;
    WHEN 'resubmitted' THEN
      v_title := 'Verify: city accepted resubmission (cycle ' || v_cycle_label
                 || ') — ' || v_num_label;
      v_city_check := true;
    WHEN 'number_entry' THEN
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project');
    WHEN 'scrape_reconcile' THEN
      v_title := 'Reconcile: portal shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'observed_status'), 60), ''), '?')
                 || ' — dashboard shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'db_status'), 60), ''), '?')
                 || ' — ' || v_num_label;
      v_priority := true;
    WHEN 'results_ready' THEN
      IF COALESCE(p_context->>'basis', 'issued') = 'approved' THEN
        v_title := 'Permit approved — send out results — ' || v_num_label;
      ELSE
        v_title := 'Permit issued — send out approved plans / results — ' || v_num_label;
      END IF;
      v_priority := true;
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  IF p_event = 'scrape_reconcile' THEN
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date                                   -- fix-292
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_start + v_target_days                          -- fix-292
    )
    ON CONFLICT (tenant_id, permit_id)
      WHERE is_auto_generated = true
        AND auto_event = 'scrape_reconcile'
        AND completion_status <> 'Resolved'
    DO NOTHING
    RETURNING id INTO v_new_id;
  ELSE
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date                                   -- fix-292
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_start + v_target_days                          -- fix-292
    )
    ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
      WHERE is_auto_generated = true AND auto_event <> 'scrape_reconcile'
    DO NOTHING
    RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Backfill the OPEN bot tasks.
-- ---------------------------------------------------------------------------
-- ★ created_at, NOT today. The queue has to reflect when the work actually
-- appeared: 68 of the 146 are more than 30 days old, and stamping them all with
-- today's date would make a two-month-old reconcile task look as fresh as one
-- raised this morning — which is the opposite of being able to order the queue.
--
-- ★ COMPLETED BOT TASKS ARE LEFT ALONE (274 of them). Their dates would be
-- fiction, and nothing reads them.
--
-- COALESCE rather than a bare assignment, and a NULL-only WHERE: this can be
-- re-run, and it can never overwrite a date somebody entered by hand. Every one
-- of the 146 has both columns NULL today, so on this run the two are equivalent
-- — the point is that they stay equivalent on the next one.
--
-- created_at is timestamptz and the database runs in UTC, so ::date is the UTC
-- day — the same basis as current_date in the function above, which is what
-- keeps backfilled and newly-created rows consistent with each other. 8 of the
-- 146 fall on a different calendar day in Pacific time; a day either way on a
-- task that has been waiting weeks is not worth a timezone rule nothing else
-- in this schema applies.
UPDATE public.permit_tasks
   SET start_date  = COALESCE(start_date,  created_at::date),
       target_date = COALESCE(target_date, created_at::date + 1)
 WHERE is_auto_generated = true
   AND completion_status IS DISTINCT FROM 'Resolved'
   AND COALESCE(done, false) = false
   AND (start_date IS NULL OR target_date IS NULL);
