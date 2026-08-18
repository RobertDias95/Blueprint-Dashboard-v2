-- ===========================================================================
-- fix-337 §2 — work that no longer applies stops being on people's lists
-- ===========================================================================
--
-- Bobby: *"it's creating milestones for us to go manually check off for
-- projects that are already done… if it doesn't currently apply, let's make
-- sure that whatever we are currently displaying is currently visible."*
--
-- §1 (the milestone prompts) is a DERIVATION fix and lives in lib/myBoard.ts —
-- no rows, no acks. This file is §2: the open tasks.
--
-- ★★★ ONE APPROVED CLEARING OF EXISTING ROWS, and it is the only data change
-- in this ticket. Bobby chose "mark them done" after being shown the counts,
-- and it is verified safe: nothing in this codebase measures task completion —
-- perfTrends, phaseDurations and projectedApproval all key off PERMIT dates and
-- contain zero references to done_at.
--
-- ★★★ A CLEAR WITHOUT A RULE REBUILDS WITHIN WEEKS, because the scraper's
-- lifecycle sweep that created most of these is still running. So this
-- migration is BOTH: the one-time clear, and the standing rule that keeps it
-- clear. Neither ships alone.
--
-- ---------------------------------------------------------------------------
-- ★★ WHAT IS CLEARED, AND WHAT IS DELIBERATELY NOT
-- ---------------------------------------------------------------------------
-- Measured on prod 2026-08-19 — 145 open tasks on issued permits:
--
--     57  results_ready     ← NOT CLEARED. "Permit issued — send out the
--                             approved plans" exists BECAUSE the permit
--                             issued. It is the one task on this list that
--                             plainly still applies, and clearing it would
--                             have destroyed live work on 57 permits.
--     31  human-authored    cleared (12 of them carry an assignee)
--     24  scrape_reconcile  cleared — a portal/dashboard mismatch on a
--                             finished permit is a chore about history
--     20  intake_submitted  cleared
--      5  corr_issued       cleared
--      5  resubmitted       cleared
--      2  intake_accepted   cleared
--      1  number_entry      cleared
--     ──
--     88  cleared
--
-- ★ The brief counted 135 three days earlier; the population grew to 145 while
-- work continued. 88 is what the rule actually clears, and the difference is
-- the 57 results_ready tasks — a narrowing of the approved change, in the safe
-- direction, stated rather than assumed.
--
-- ★ The 55 (now 60) open tasks on APPROVED-BUT-NOT-ISSUED permits are NOT
-- touched. Judged by the same rule they still apply: an approved permit has
-- fees to pay and a permit to collect — the board raises a `fees` milestone for
-- exactly that window, and it would be incoherent to prompt for the milestone
-- while closing the tasks underneath it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. ★★ ATTRIBUTION — a person can tell the system closed it
-- ---------------------------------------------------------------------------
--
-- ★ NOT `auto_event`. That column records why a task was CREATED (fix-155), it
-- drives the BOT badge and boardFlips matches on it — overloading it with a
-- closure reason would corrupt both. Closure gets its own column, NULL for
-- every human tick, which is also what makes "show me what the system closed"
-- a query rather than an archaeology exercise.
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS auto_closed_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.permit_tasks'::regclass
      AND conname = 'permit_tasks_auto_closed_reason_check'
  ) THEN
    ALTER TABLE public.permit_tasks
      ADD CONSTRAINT permit_tasks_auto_closed_reason_check
      CHECK (auto_closed_reason IS NULL OR auto_closed_reason IN ('permit_issued'));
  END IF;
END $$;

COMMENT ON COLUMN public.permit_tasks.auto_closed_reason IS
  'fix-337: why the SYSTEM closed this task. NULL means a person did. Distinct from auto_event, which says why it was created.';

-- ---------------------------------------------------------------------------
-- 2. The rule, as one function — used by the clear AND by the trigger
-- ---------------------------------------------------------------------------
--
-- ★ ONE DEFINITION. The one-time clear and the standing rule must not be two
-- opinions about what "no longer applies" means, or the backlog drifts back in
-- the gap between them.
CREATE OR REPLACE FUNCTION public.bp_clear_tasks_for_issued_permit(p_permit_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.permit_tasks t
     SET completion_status = 'Resolved',
         auto_closed_reason = 'permit_issued'
   WHERE t.permit_id = p_permit_id
     AND t.completion_status <> 'Resolved'
     AND COALESCE(t.done, false) = false
     -- ★ The exception that makes the rule honest: this task EXISTS because
     -- the permit issued.
     AND t.auto_event IS DISTINCT FROM 'results_ready'
     AND EXISTS (
       SELECT 1 FROM public.permits p
       WHERE p.id = t.permit_id AND p.actual_issue IS NOT NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_clear_tasks_for_issued_permit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_clear_tasks_for_issued_permit(integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. ★★★ THE STANDING RULE — the moment a permit issues, its stale work closes
-- ---------------------------------------------------------------------------
--
-- ★ AT THE TRANSITION, not on a sweep. The permit becoming issued is the event
-- that makes the work moot, so that is when it closes — no daily job to fail
-- quietly, and no window in which somebody is shown a task the system is about
-- to withdraw.
--
-- ★ `results_ready` is created AFTER this fires (the scraper sets the date,
-- then asks for the task), so it is never in scope — and it is excluded by name
-- as well, because relying on ordering for correctness is how ordering changes
-- become bugs.
CREATE OR REPLACE FUNCTION public.bp_trg_permit_issued_clear_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.bp_clear_tasks_for_issued_permit(NEW.id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_permit_issued_clear_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_permit_issued_clear_tasks()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS permits_issued_clear_tasks ON public.permits;
CREATE TRIGGER permits_issued_clear_tasks
  AFTER UPDATE OF actual_issue ON public.permits
  FOR EACH ROW
  WHEN (NEW.actual_issue IS NOT NULL AND OLD.actual_issue IS DISTINCT FROM NEW.actual_issue)
  EXECUTE FUNCTION public.bp_trg_permit_issued_clear_tasks();

-- ---------------------------------------------------------------------------
-- 4. …and the other half of the standing rule: stop CREATING them
-- ---------------------------------------------------------------------------
--
-- ★★ THE REBUILD PATH. `bp_create_lifecycle_task` never asked what state the
-- permit was in, so a backfill scrape of a permit issued last year still
-- created "Verify: intake submitted", "Corrections issued — send to
-- consultants" and "Reconcile: portal shows…". 52 of the 88 rows this migration
-- clears came from exactly that. Closing them without closing this door would
-- have rebuilt the pile within weeks — the brief's "both, or neither".
--
-- ★ ONE EVENT STAYS LEGAL ON AN ISSUED PERMIT: results_ready, which is the
-- task the issuance itself creates. Everything else is verification of a stage
-- the permit has already left.
--
-- ★ It returns NULL rather than raising: the caller (the scraper) already
-- treats NULL as "nothing to create", which is exactly what happened.
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
  v_target_days    constant integer := 1;   -- fix-292
  v_start          date := current_date;    -- fix-292
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

  -- ★★ fix-337: a verification task for a stage the permit has already left is
  -- work that no longer applies. Only the issuance's own task survives here.
  IF v_permit.actual_issue IS NOT NULL AND p_event <> 'results_ready' THEN
    RETURN NULL;
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
      start_date, target_date
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_start + v_target_days
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
      start_date, target_date
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_start + v_target_days
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
-- 5. ★★★ THE ONE-TIME CLEAR — the approved data change, and the only one
-- ---------------------------------------------------------------------------
--
-- ★ It runs through the SAME function the trigger uses, so what was cleared
-- once and what is cleared from now on cannot differ.
DO $$
DECLARE
  v_permit record;
  v_total integer := 0;
BEGIN
  FOR v_permit IN
    SELECT DISTINCT p.id
    FROM public.permits p
    JOIN public.permit_tasks t ON t.permit_id = p.id
    WHERE p.actual_issue IS NOT NULL
      AND t.completion_status <> 'Resolved'
      AND COALESCE(t.done, false) = false
  LOOP
    v_total := v_total + public.bp_clear_tasks_for_issued_permit(v_permit.id);
  END LOOP;
  RAISE NOTICE 'fix-337: cleared % open tasks on issued permits', v_total;
END $$;


-- ===========================================================================
-- Applied as two follow-ups (same ticket, same session):
--
--   fix_337_expose_auto_closed_reason
--     bp_list_permit_tasks + bp_list_tasks name the new key, because both build
--     EXPLICIT jsonb and a new column reaches nobody until it is listed.
--     bp_my_tasks is left alone: it does not carry `auto_event` either, so
--     neither badge renders there and adding one without the other would be the
--     odd half.
--
--   fix_337_restore_subtask_payload
--     ★ A CORRECTION TO MY OWN WORK, recorded rather than quietly fixed. The
--     first of those two rebuilt bp_list_permit_tasks from a TRUNCATED read of
--     the live definition and sourced subtasks from `task_subtasks` (the legacy
--     table) with four keys — where the real one nests FULL task objects from
--     permit_tasks by parent_task_id. The permit bar renders a subtask through
--     the same component as its parent, so that shape would have shown subtasks
--     with no status, no dates and no assignee. Restored from fix-155's copy
--     (an exact match for the live parent key list) with `auto_closed_reason`
--     added to the parent AND the subtask.
--
--     ★ The lesson, for the next person: `pg_get_functiondef` output arrives
--     TRUNCATED through this tool. Read the whole thing before replacing a
--     function, or reconstruct from migrations/ and diff.
-- ===========================================================================
