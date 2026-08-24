-- ===========================================================================
-- fix-395 — THE CHASE IS A PROMPT NOBODY OWNS. MAKE IT A TASK.
-- ===========================================================================
--
-- Register #fix-305b: the 7-day chase task, never built. The incident that
-- makes it real: BLD2026-0770 sat 41 days with nobody answering the city.
--
-- fix-305 built the ladder — cityTargetChaseable (the city's target plus one
-- BUSINESS day of grace) and the board's "blocked on you, go chase" section.
-- A prompt is something you LOOK AT, and the person who needed to look was not
-- looking. This mints a real task with a real owner instead.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY A SWEEP AND NOT A TRIGGER
-- ---------------------------------------------------------------------------
--
-- Every other lifecycle task is minted by a CITY EVENT: corrections land, the
-- intake is accepted, the permit issues. This one is minted by TIME PASSING —
-- nothing happens on day 7, which is precisely the problem it exists to solve.
-- There is no row to hang a trigger on, so it takes the shape the engine
-- already has for time-based work: bp_generate_number_entry_tasks, a sweep with
-- an app_sweeps once-per-tenant-per-day guard, fired from the client on
-- Dashboard mount. No new concept, no cron, no new infrastructure.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE 7-DAY CLOCK IS DERIVED. THERE IS NOTHING TO STORE.
-- ---------------------------------------------------------------------------
--
-- "Continuously chaseable for 7 days" sounds like it needs a state table. It
-- does not: cityTargetChaseable(target, t) is `t >= nextBusinessDay(target)`,
-- which is MONOTONIC in t. Once true for a given target it can never go false
-- again while that target stands, so the only thing that can break continuity
-- is the target CHANGING — and the anchor keys on exactly that. The day the
-- clock started is nextBusinessDay(city_target), computable from the target
-- alone, with no history to keep in sync.
--
-- ★★ The 7 rides ON TOP of the ladder: it is AGING_LADDER.task, applied to the
-- CHASEABLE clock rather than to the target date. The two differ by the grace —
-- a Friday target is chaseable on Monday, so day 7 chaseable is day 10 after
-- the target. The grace/weekend arithmetic is NOT restated here; the SQL walks
-- the same rule the TS `nextBusinessDay` walks and a test pins them together.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE ANCHOR — fix-298'S PATTERN, FINALLY ON permit_tasks
-- ---------------------------------------------------------------------------
--
-- The brief asks for "one open chase task per permit per city_target VALUE".
-- The existing bot anchor is the partial unique index
--   (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
-- which has no slot for a target date. cycle_idx ALMOST works — a resubmit
-- opens a new cycle, so "a new target after a resubmit may mint again" would
-- fall out for free — but it silently loses the case the auto-clear creates:
-- the city MOVES its target inside one cycle, the task auto-closes as
-- superseded_target_changed, the new target lapses, and nothing ever mints
-- again because the slot is occupied.
--
-- So `auto_anchor text` is added, which is fix-298's own `anchor` column
-- (permit_milestone_acks) applied to tasks — the pattern the brief names.
--
-- ★★ NULLABLE, AND NULL MEANS NOT RECORDED (fix-386's rule). Every one of the
-- 713 existing bot tasks keeps NULL and keeps its old index; nothing is
-- backfilled and no row is written.
--
-- ★★★ THE HUMAN-RESOLVE CONTRACT COMES FROM THE INDEX HAVING NO STATUS IN ITS
-- PREDICATE. A Resolved chase task still occupies its (tenant, permit, event,
-- anchor) slot forever, so ON CONFLICT DO NOTHING returns NULL on the re-fire
-- and a human's "no, I already called them" sticks for that target. This is the
-- same shape as permit_tasks_auto_event_uniq and deliberately NOT the
-- scrape_reconcile shape, which re-mints after resolution.
--
-- ---------------------------------------------------------------------------
-- ★★★ §4 — THE BACKFILL IS NOT APPLIED, BY CONSTRUCTION
-- ---------------------------------------------------------------------------
--
-- Measured on prod 2026-08-24: 20 permits are chaseable 7+ days TODAY and clear
-- every silence gate. 16 of them are Miles's. A first sweep run would mint all
-- 20 at once, which is fix-337's wall of red re-served as a to-do list.
--
-- The sweep therefore carries CITY_CHASE_EPOCH and mints only where the target
-- FIRST became chaseable strictly after it. That is not a new idea — it is
-- boardAging's own AGING_DEPLOY_EPOCH / mayCreateTask ("nothing auto-creates a
-- task retroactively"), one rung further along. The engine ships LIVE FOR NEW
-- CROSSINGS ONLY; the 20 are reported to Bobby and minted by nobody.
--
-- ★ NO ROW IS WRITTEN BY THIS MIGRATION. It is DDL plus function bodies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE ANCHOR COLUMN
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS auto_anchor text;

COMMENT ON COLUMN public.permit_tasks.auto_anchor IS
  'fix-395: the value a bot task is anchored to, so "one open task per permit '
  'per <thing>" can key on something other than the cycle. Today only '
  'city_target_chase uses it (the city_target date as text). NULL means NOT '
  'RECORDED — every pre-fix-395 bot task keeps NULL and keeps anchoring on '
  '(auto_event, cycle_idx). fix-298''s anchor pattern, applied to tasks.';

-- ---------------------------------------------------------------------------
-- 2 · THE INDEXES
-- ---------------------------------------------------------------------------
--
-- ★★ The existing index must stop covering the chase event, or it would
-- collapse every chase task for a permit into ONE slot regardless of anchor —
-- exactly the bug the anchor exists to prevent. Re-created with the event
-- excluded, the same way fix-159 excluded scrape_reconcile.

DROP INDEX IF EXISTS public.permit_tasks_auto_event_uniq;
CREATE UNIQUE INDEX permit_tasks_auto_event_uniq
  ON public.permit_tasks (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
  WHERE is_auto_generated = true
    AND auto_event NOT IN ('scrape_reconcile', 'city_target_chase');

-- ★★★ One chase task per permit per TARGET, ever — Resolved rows included, so a
-- human's resolve is permanent for that target.
CREATE UNIQUE INDEX IF NOT EXISTS permit_tasks_city_chase_uniq
  ON public.permit_tasks (tenant_id, permit_id, auto_anchor)
  WHERE is_auto_generated = true AND auto_event = 'city_target_chase';

-- ---------------------------------------------------------------------------
-- 3 · THE CLOSE-REASON VOCABULARY (fix-364 §1 grows by two)
-- ---------------------------------------------------------------------------

ALTER TABLE public.permit_tasks
  DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check;
ALTER TABLE public.permit_tasks
  ADD CONSTRAINT permit_tasks_auto_closed_reason_check
  CHECK (auto_closed_reason IS NULL OR auto_closed_reason IN (
    'permit_issued',
    'superseded_by_intake_acceptance',
    'superseded_next_cycle',
    'superseded_resubmitted',
    'superseded_status_matched',
    'superseded_number_present',
    -- fix-395: the chase task's own two deaths.
    'superseded_city_responded',
    'superseded_target_changed'
  ));

-- ---------------------------------------------------------------------------
-- 4 · THE STATUS TWIN
-- ---------------------------------------------------------------------------
--
-- ★★★ SQL TWIN OF `cityOwesReview` IN src/lib/cityChase.ts. Keep the two in
-- lockstep — a test asserts both lists match, the way fix-354's
-- bp_auto_close_recipient is pinned to resolvePrimaryAssignee.
--
-- ★★ ENUMERATED CLOSED SETS, NEVER A SUBSTRING TEST (fix-388's rule). Every
-- value was read off prod on 2026-08-24 with its unissued-with-a-target count.
--
-- ★★★ AND THE ASYMMETRY IS THE OPPOSITE OF fix-388'S, ON PURPOSE. fix-388 erred
-- toward NOISE because a false chip is annoying while a killed true chip is
-- invisible. A TASK IS NOT A CHIP — it lands on a named person's list and
-- competes with 212 already-overdue tasks. So here, WHEN UNSURE, DO NOT MINT.
-- Nothing is hidden by that: fix-305's ladder prompt still shows every one of
-- these on the board, ranked by age. Withholding the escalation is not
-- withholding the information.

CREATE OR REPLACE FUNCTION public.bp_city_owes_review(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_status, '')), '') IS NULL THEN true
    WHEN btrim(p_status) IN (
      -- The city has already produced its answer for this round.
      'Corrections Required', 'Awaiting Information', 'Awaiting Corrections',
      'Additional Info Requested',
      'Reviews Completed', 'Final Reviews Completed', 'Ready To Issue',
      'Approved - Additional Information',
      'Published', 'Ready for Publication',
      'Document Required',
      'Application Withdrawn', 'Finaled',
      -- Terminal-positive + terminal-negative (permitTerminalStatus.ts).
      'Conceptually Approved', 'Approved', 'Issued', 'Completed', 'Closed',
      'Ready for Issuance', 'Withdrawn',
      -- The set never went in, so a city target on the row is contradictory.
      'Pre-Submittal — GO', 'Pre-Submittal — Kickoff',
      'Ready for Intake', 'Scheduled', 'Initiated'
    ) THEN false
    ELSE true
  END;
$function$;

COMMENT ON FUNCTION public.bp_city_owes_review(text) IS
  'fix-395: does the city still owe us a review at this status? SQL twin of '
  'cityOwesReview in src/lib/cityChase.ts; keep the two in lockstep.';

-- ---------------------------------------------------------------------------
-- 4b · THE GATE
-- ---------------------------------------------------------------------------
--
-- ★★★ SQL TWIN OF `chaseDecision()` IN src/lib/cityChase.ts, minus the epoch.
--
-- ★★ THE EPOCH DELIBERATELY IS NOT HERE. It is a deployment policy about the
-- FIRST RUN ("new crossings only", §4), not a property of whether this permit
-- deserves chasing. Keeping it in the sweep alone means that if Bobby ever
-- approves the backfill, one constant moves and this function needs no change.
--
-- ★★★ AND THE ORDER OF THE GATES IS THE RULE, cheapest-and-most-certain first,
-- so the reason a caller reads back is the most informative one. The silence
-- gates sit BELOW "is there anything to chase at all": a held permit with no
-- target was never a candidate, and calling it `held` would overstate what the
-- hold is doing.

CREATE OR REPLACE FUNCTION public.bp_chase_blocked_reason(
  p_permit_id integer, p_cycle_idx integer, p_today date DEFAULT current_date)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p public.permits%ROWTYPE;
  v_c public.permit_cycles%ROWTYPE;
  v_since date;
BEGIN
  SELECT * INTO v_p FROM public.permits WHERE id = p_permit_id;
  IF NOT FOUND THEN RETURN 'no_permit'; END IF;
  SELECT * INTO v_c FROM public.permit_cycles
   WHERE permit_id = p_permit_id AND cycle_index = p_cycle_idx;

  -- The chase task IS its target. No target, nothing to anchor on.
  IF v_c.city_target IS NULL THEN RETURN 'no_target'; END IF;

  -- nextBusinessDay(): one BUSINESS day of grace. Fri +3, Sat +2, Sun +1 —
  -- the closed form of the TS loop in boardAging.ts, pinned to it by a test.
  v_since := v_c.city_target + CASE extract(isodow FROM v_c.city_target)::int
               WHEN 5 THEN 3 WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 1 END;
  IF p_today < v_since THEN RETURN 'not_yet_chaseable'; END IF;
  IF (p_today - v_since) < 7 THEN RETURN 'below_ladder'; END IF;   -- the rung

  IF v_p.actual_issue IS NOT NULL THEN RETURN 'issued'; END IF;
  -- ★★ The city has answered — by DATE first, then by status. fix-388's lesson:
  -- the scraper already wrote the answer into permits.status and the board was
  -- not reading it.
  IF v_p.approval_date IS NOT NULL THEN RETURN 'city_responded'; END IF;
  IF v_c.corr_issued IS NOT NULL THEN RETURN 'city_responded'; END IF;
  IF NOT public.bp_city_owes_review(v_p.status) THEN RETURN 'city_responded'; END IF;
  -- ★ Whatever the ladder does: buildAging skips sub-permits, so this does too.
  IF v_p.parent_permit_id IS NOT NULL THEN RETURN 'sub_permit'; END IF;

  -- ★★★ THE SILENCE GATES COMPOSE. A paused or dead permit is not chaseable —
  -- you cannot be late for work that is deliberately stopped.
  IF EXISTS (SELECT 1 FROM public.permit_holds h
              WHERE h.permit_id = v_p.id AND h.hold_end IS NULL) THEN
    RETURN 'held';                                          -- fix-390
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_holds h
              WHERE h.project_id = v_p.project_id AND h.hold_end IS NULL
                AND h.kind = 'hold') THEN
    RETURN 'held';                                          -- fix-391, project scope
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_holds h
              WHERE h.project_id = v_p.project_id AND h.hold_end IS NULL
                AND h.kind = 'cancelled') THEN
    RETURN 'cancelled';                                     -- fix-262
  END IF;
  -- ★ fix-386: nullable means NOT RECORDED. Only an explicit true suppresses.
  IF EXISTS (SELECT 1 FROM public.projects pr
              WHERE pr.id = v_p.project_id AND pr.is_backfill IS TRUE) THEN
    RETURN 'backfill';
  END IF;

  RETURN NULL;   -- nothing blocks it
END;
$function$;

COMMENT ON FUNCTION public.bp_chase_blocked_reason(integer, integer, date) IS
  'fix-395: why this permit may NOT get a chase task, or NULL if it may. SQL '
  'twin of chaseDecision() in src/lib/cityChase.ts (minus the epoch, which is '
  'the sweep''s deployment policy). Every silence gate composes here: fix-390/391 '
  'holds at either scope, fix-262 cancel, fix-386 backfill, fix-388 terminal, '
  'sub-permits.';

REVOKE ALL ON FUNCTION public.bp_chase_blocked_reason(integer, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_chase_blocked_reason(integer, integer, date)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5 · THE MINTER — re-emitted whole from the LIVE body (fix-364 §2)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(
  p_tenant_id uuid,
  p_permit_id integer,
  p_event text,
  p_cycle_idx integer DEFAULT NULL::integer,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_permit         public.permits%ROWTYPE;
  v_cycle          public.permit_cycles%ROWTYPE;
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
  -- fix-349: the date the CITY acted, filled in below per event. NULL until
  -- then; COALESCE'd to current_date at the point of use so it is never null.
  v_city_date      date;
  v_start          date;
  v_target         date;
  -- ★★ fix-364 §2 (EDIT 1): which of the siblings this is. NULL unless the
  -- permit actually HAS a same-type sibling — 484 of 542 permits are the only
  -- one of their type, and a discriminator on those is noise on hundreds of
  -- rows to serve the 58 that need it.
  v_siblings       integer;
  v_discriminator  text;
  -- ★★★ fix-395: the idempotency anchor. NULL for every event but the chase.
  v_anchor         text;
BEGIN
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry','scrape_reconcile','results_ready','city_target_chase')
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

  -- ★★★ fix-349: the city's own date for THIS event.
  IF p_cycle_idx IS NOT NULL
     AND p_event IN ('intake_submitted','intake_accepted','corr_issued','resubmitted','city_target_chase')
  THEN
    SELECT * INTO v_cycle
    FROM public.permit_cycles
    WHERE permit_id = p_permit_id AND cycle_index = p_cycle_idx;
  END IF;

  -- ★★★ fix-395: EVERY CHASE GATE, IN ONE PLACE, FOR EVERY CALLER.
  --
  -- The rolled-back prod probe found why this cannot live in the sweep alone:
  -- calling this RPC directly on a permit whose current cycle already carries
  -- corr_issued minted a chase task that the auto-clear closed in the same
  -- breath. The sweep would never have offered that permit — but the sweep is
  -- not the only caller, because the scraper holds service_role on this RPC.
  --
  -- ★★★ THE RULE: a task that would immediately auto-close must never be
  -- minted. The mint gate and the clear condition are the SAME predicate,
  -- negated, so the two cannot drift apart.
  IF p_event = 'city_target_chase'
     AND public.bp_chase_blocked_reason(p_permit_id, p_cycle_idx) IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_city_date := CASE p_event
    WHEN 'intake_submitted' THEN v_cycle.submitted
    WHEN 'intake_accepted'  THEN v_cycle.intake_accepted
    WHEN 'corr_issued'      THEN v_cycle.corr_issued
    WHEN 'resubmitted'      THEN v_cycle.resubmitted
    -- ★ fix-395: the day the CITY said it would answer. Weeks in the past by
    -- construction, which is exactly what fix-349's LEAST guard is for.
    WHEN 'city_target_chase' THEN v_cycle.city_target
    WHEN 'results_ready'    THEN
      CASE WHEN COALESCE(p_context->>'basis', 'issued') = 'approved'
           THEN v_permit.approval_date
           ELSE v_permit.actual_issue
      END
    ELSE NULL                       -- number_entry, scrape_reconcile
  END;

  v_start  := COALESCE(LEAST(v_city_date, current_date), current_date);
  v_target := current_date + v_target_days;

  -- ★★★ fix-364 §2 (EDIT 2). MEASURED: of the 58 permits sharing a project AND
  -- a type with a sibling, 54 carry struct_address ("Cottage 1".."Cottage 4" at
  -- this very address), 51 carry a number, and NONE of the 542 permits carries
  -- a nickname. So struct_address is the working answer, nickname outranks it
  -- if anybody ever fills it in, and the permit id is the honest last resort.
  --
  -- ★★ EVERY CANDIDATE IS A STORED FIELD OR AN IMMUTABLE ID. Nothing is derived
  -- from position or count: "the 2nd of 4" renumbers the moment a sibling is
  -- deleted, and a label that changes under a person is worse than a duplicate.
  -- The TS mirror is src/lib/permitDiscriminator.ts.
  SELECT count(*) INTO v_siblings
  FROM public.permits p
  WHERE p.project_id = v_permit.project_id
    AND lower(btrim(COALESCE(p.type, ''))) = lower(btrim(COALESCE(v_permit.type, '')));

  IF COALESCE(v_siblings, 0) > 1 THEN
    v_discriminator := COALESCE(
      NULLIF(btrim(v_permit.nickname), ''),
      NULLIF(btrim(v_permit.struct_address), ''),
      NULLIF(btrim(v_permit.num), ''),
      'Permit #' || v_permit.id::text);
  END IF;

  -- ★★ AND IT FIXES EVERY EVENT, not only number_entry. v_num_label falls back
  -- to 'no number yet', so four numberless siblings produced four identical
  -- "Verify: intake submitted / fees paid — no number yet" rows too. Naming the
  -- permit here fixes the whole family in one place.
  v_num_label   := COALESCE(
    NULLIF(btrim(v_permit.num), ''),
    CASE WHEN v_discriminator IS NOT NULL
         THEN 'no number yet — ' || v_discriminator
         ELSE 'no number yet' END);
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
    -- ★ fix-395 lands here: chasing the city is permitting work.
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
      -- ★ fix-364 §2 (EDIT 3). This event's title names the TYPE and the
      -- ADDRESS rather than v_num_label, because the missing number is the
      -- subject of the task. The discriminator is appended, so four cottages
      -- read as four rows.
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project')
                 || COALESCE(' — ' || v_discriminator, '');
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
    WHEN 'city_target_chase' THEN
      -- ★ TS twin: chaseTaskTitle() in src/lib/cityChase.ts. "N days ago"
      -- counts from the TARGET, not from the chaseable day — it is ordinary
      -- English about the date it names.
      v_title := 'Chase the city — target was ' || v_cycle.city_target::text
                 || ', ' || (current_date - v_cycle.city_target)::text
                 || CASE WHEN (current_date - v_cycle.city_target) = 1
                         THEN ' day ago — ' ELSE ' days ago — ' END
                 || v_num_label;
      -- ★★ It IS a city-acceptance check: the whole task is "go ask the city".
      v_city_check := true;
      -- ★★★ NOT priority. fix-305's ladder already has a `priority` rung at 21
      -- days and this fires at 7; marking every chase urgent would flatten that
      -- distinction and put 7-day and 100-day chases on the same line.
      v_anchor := v_cycle.city_target::text;
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  IF p_event = 'scrape_reconcile' THEN
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date, auto_anchor
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_target, v_anchor                                -- fix-349/395
    )
    ON CONFLICT (tenant_id, permit_id)
      WHERE is_auto_generated = true
        AND auto_event = 'scrape_reconcile'
        AND completion_status <> 'Resolved'
    DO NOTHING
    RETURNING id INTO v_new_id;
  ELSIF p_event = 'city_target_chase' THEN
    -- ★★★ fix-395: anchored on the TARGET, and with no status in the index
    -- predicate — so a human's Resolve holds that target's slot for good.
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date, auto_anchor
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_target, v_anchor
    )
    ON CONFLICT (tenant_id, permit_id, auto_anchor)
      WHERE is_auto_generated = true AND auto_event = 'city_target_chase'
    DO NOTHING
    RETURNING id INTO v_new_id;
  ELSE
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date, auto_anchor
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_target, v_anchor
    )
    ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
      WHERE is_auto_generated = true
        AND auto_event NOT IN ('scrape_reconcile', 'city_target_chase')
    DO NOTHING
    RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6 · THE AUTO-CLEAR — re-emitted whole from the LIVE body (fix-364)
-- ---------------------------------------------------------------------------
--
-- ★★ Two new rules, both on CITY-PRODUCED evidence like the five before them.
-- ★★★ The person guard is untouched: bp_task_touched_by_person still stops the
-- bot closing anything a human has picked up, and start_date is still NOT a
-- touch signal (fix-355 — the engine sets it at birth).

CREATE OR REPLACE FUNCTION public.bp_supersede_stale_bot_tasks(p_permit_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := 0;
  v_now   timestamptz := now();
BEGIN
  WITH candidate AS (
    SELECT t.id,
           t.tenant_id,
           t.permit_id,
           t.assigned_to,
           t.auto_event,
           t.cycle_idx,
           t.text,
           t.created_at,
           t.auto_anchor,                        -- fix-395
           p.num,
           p.status,
           p.updated_at    AS permit_updated_at,
           p.approval_date,
           p.actual_issue,
           c.intake_accepted,
           c.resubmitted,
           c.corr_issued,                        -- fix-395
           c.city_target   AS cycle_city_target,  -- fix-395
           (SELECT count(*) FROM public.permit_cycles n
             WHERE n.permit_id = t.permit_id
               AND n.cycle_index > t.cycle_idx
               AND (n.submitted IS NOT NULL
                    OR n.corr_issued IS NOT NULL
                    OR n.intake_accepted IS NOT NULL)) AS later_city_cycle
      FROM public.permit_tasks t
      JOIN public.permits p ON p.id = t.permit_id
      LEFT JOIN public.permit_cycles c
             ON c.permit_id = t.permit_id AND c.cycle_index = t.cycle_idx
     WHERE t.permit_id = p_permit_id
       AND t.auto_event IS NOT NULL
       AND t.completion_status <> 'Resolved'
       AND COALESCE(t.done, false) = false
       AND NOT public.bp_task_touched_by_person(t.id)
  ),
  ruled AS (
    SELECT c.*,
           CASE
             WHEN c.auto_event = 'corr_issued' AND c.resubmitted IS NOT NULL
               THEN 'superseded_resubmitted'
             WHEN c.auto_event = 'resubmitted' AND c.later_city_cycle > 0
               THEN 'superseded_next_cycle'
             WHEN c.auto_event = 'intake_submitted'
              AND c.intake_accepted IS NOT NULL
              AND (c.later_city_cycle > 0
                   OR c.approval_date IS NOT NULL
                   OR c.actual_issue IS NOT NULL)
               THEN 'superseded_by_intake_acceptance'
             WHEN c.auto_event = 'scrape_reconcile'
              AND lower(COALESCE(c.status, '')) =
                  lower(COALESCE(btrim(substring(c.text from 'portal shows (.*?) — dashboard shows')), ''))
              AND c.permit_updated_at > c.created_at
               THEN 'superseded_status_matched'
             WHEN c.auto_event = 'number_entry'
              AND NULLIF(btrim(c.num), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.permit_cycles z
                           WHERE z.permit_id = c.permit_id AND z.submitted IS NOT NULL)
               THEN 'superseded_number_present'
             -- ★★★ fix-395: THE CITY ANSWERED. Ordered BEFORE the target rule
             -- because when both are true, "they came back to us" is the more
             -- useful explanation than "the date moved".
             WHEN c.auto_event = 'city_target_chase'
              AND (c.approval_date IS NOT NULL
                   OR c.actual_issue IS NOT NULL
                   OR c.corr_issued IS NOT NULL
                   OR NOT public.bp_city_owes_review(c.status))
               THEN 'superseded_city_responded'
             -- ★★★ fix-395: THE TARGET MOVED, so the question this task asked
             -- no longer exists. A NULL target counts as moved — the city
             -- withdrew its promise. Compared AS TEXT so a malformed anchor can
             -- never raise a cast error inside a trigger.
             WHEN c.auto_event = 'city_target_chase'
              AND c.cycle_city_target::text IS DISTINCT FROM c.auto_anchor
               THEN 'superseded_target_changed'
             ELSE NULL
           END AS rule
      FROM candidate c
  ),
  explained AS (
    SELECT r.*,
           CASE r.rule
             WHEN 'superseded_resubmitted' THEN
               'the city recorded a resubmission on ' || r.resubmitted::text
             WHEN 'superseded_next_cycle' THEN
               'the permit has moved to a later review cycle'
             WHEN 'superseded_by_intake_acceptance' THEN
               'the city accepted the intake on ' || r.intake_accepted::text
             WHEN 'superseded_status_matched' THEN
               'the dashboard now shows what the portal showed (' ||
               COALESCE(btrim(substring(r.text from 'portal shows (.*?) — dashboard shows')), '?') || ')'
             WHEN 'superseded_number_present' THEN
               'the permit number ' || COALESCE(btrim(r.num), '') || ' is on file'
             WHEN 'superseded_city_responded' THEN
               'the city responded (' || COALESCE(NULLIF(btrim(r.status), ''), 'status unrecorded') || ')'
             WHEN 'superseded_target_changed' THEN
               'the city moved its review target to ' ||
               COALESCE(r.cycle_city_target::text, 'no date')
             ELSE NULL
           END AS clause
      FROM ruled r
     WHERE r.rule IS NOT NULL
  ),
  closed AS (
    UPDATE public.permit_tasks t
       SET completion_status = 'Resolved',
           auto_closed_reason = e.rule
      FROM explained e
     WHERE t.id = e.id
    RETURNING t.id, e.tenant_id, e.permit_id, e.assigned_to, e.rule, e.clause
  ),
  routed AS (
    SELECT cl.id,
           cl.tenant_id,
           cl.permit_id,
           public.bp_auto_close_recipient(cl.assigned_to, cl.permit_id) AS recipient,
           cl.rule,
           cl.clause
      FROM closed cl
  ),
  ids AS (
    SELECT tenant_id, permit_id, recipient, array_agg(id) AS task_ids
      FROM routed
     WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient
  ),
  per_rule AS (
    SELECT tenant_id, permit_id, recipient, rule,
           max(clause) AS clause,
           count(*)::integer AS n
      FROM routed
     WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient, rule
  ),
  grouped AS (
    SELECT tenant_id,
           permit_id,
           recipient,
           sum(n)::integer AS task_count,
           string_agg(clause, '; ' ORDER BY clause) AS detail
      FROM per_rule
     GROUP BY tenant_id, permit_id, recipient
  ),
  logged AS (
    INSERT INTO public.permit_task_auto_closures
      (tenant_id, permit_id, reason, recipient, task_count, closed_at, detail,
       task_ids)
    SELECT g.tenant_id, g.permit_id, 'superseded', g.recipient, g.task_count,
           v_now, 'Closed because ' || g.detail || '.', i.task_ids
      FROM grouped g
      JOIN ids i
        ON i.tenant_id = g.tenant_id
       AND i.permit_id = g.permit_id
       AND i.recipient = g.recipient
    RETURNING 1
  )
  SELECT COALESCE((SELECT sum(task_count) FROM grouped), 0)::integer INTO v_count;

  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7 · THE TRIGGERS THAT FIRE THE AUTO-CLEAR
-- ---------------------------------------------------------------------------
--
-- ★★ `city_target` was not in the cycle trigger's column list, so a moved
-- target would never have reached superseded_target_changed. `approval_date`
-- was not in the permits list either — approval fires the results_ready trigger
-- but nothing that supersedes. Both are added; every other bot rule is
-- unaffected, because the rules are keyed on auto_event and simply evaluate
-- more often.

DROP TRIGGER IF EXISTS permit_cycles_supersede_tasks ON public.permit_cycles;
CREATE TRIGGER permit_cycles_supersede_tasks
  AFTER INSERT OR UPDATE OF submitted, intake_accepted, corr_issued, resubmitted, city_target
  ON public.permit_cycles
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_supersede_on_cycle();

DROP TRIGGER IF EXISTS permits_supersede_tasks ON public.permits;
CREATE TRIGGER permits_supersede_tasks
  AFTER UPDATE OF status, num, approval_date ON public.permits
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        OR NEW.num IS DISTINCT FROM OLD.num
        OR NEW.approval_date IS DISTINCT FROM OLD.approval_date)
  EXECUTE FUNCTION public.bp_trg_supersede_on_permit();

-- ---------------------------------------------------------------------------
-- 8 · THE SWEEP
-- ---------------------------------------------------------------------------
--
-- ★★ bp_generate_number_entry_tasks's shape, verbatim where it can be: the same
-- tenant-scope guard, the same app_sweeps once-per-day gate, the same
-- count-only-what-was-actually-made return.

CREATE OR REPLACE FUNCTION public.bp_generate_city_chase_tasks(p_tenant_id uuid DEFAULT NULL::uuid)
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
  v_row     record;
  v_made    uuid;
  -- ★★★ fix-395 §4: NEW CROSSINGS ONLY. A target that first became chaseable
  -- on or before this date belongs to the pre-existing population — 20 permits
  -- on 2026-08-24, 16 of them Miles's — which is REPORTED, not minted.
  -- TS twin: CITY_CHASE_EPOCH in src/lib/cityChase.ts.
  v_epoch   constant date := DATE '2026-08-24';
  -- ★ fix-305's AGING_LADDER.task. Named, not inlined.
  v_rung    constant integer := 7;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    -- fix-157: an explicit tenant is the scraper/service path; a non-service
    -- caller may only target a tenant it belongs to.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
    THEN
      RAISE EXCEPTION 'bp_generate_city_chase_tasks: tenant % not in caller scope', p_tenant_id
        USING ERRCODE = '42501';
    END IF;
    v_tenants := ARRAY[p_tenant_id];
  ELSE
    v_tenants := public.auth_tenant_ids();
  END IF;
  IF v_tenants IS NULL OR array_length(v_tenants, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    IF EXISTS (
      SELECT 1 FROM public.app_sweeps
      WHERE tenant_id = v_tenant AND sweep_name = 'city_target_chase' AND last_swept_on >= v_today
    ) THEN
      CONTINUE;
    END IF;

    FOR v_row IN
      WITH latest AS (
        -- ★★ fix-337's rule: the permit's CURRENT cycle, never the newest row
        -- that happens to carry a date.
        SELECT DISTINCT ON (c.permit_id)
               c.permit_id, c.cycle_index, c.city_target, c.corr_issued
          FROM public.permit_cycles c
         WHERE c.tenant_id = v_tenant
         ORDER BY c.permit_id, c.cycle_index DESC
      ),
      chaseable AS (
        SELECT l.*,
               -- ★★★ nextBusinessDay(city_target): one BUSINESS day of grace.
               -- Fri +3, Sat +2, Sun +1, Mon-Thu +1 — the closed form of the
               -- TS loop in boardAging.ts, pinned to it by a test.
               l.city_target + CASE extract(isodow FROM l.city_target)::int
                 WHEN 5 THEN 3 WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 1 END
                 AS chaseable_since
          FROM latest l
         WHERE l.city_target IS NOT NULL
      )
      SELECT p.id, ch.cycle_index
        FROM chaseable ch
        JOIN public.permits p  ON p.id = ch.permit_id AND p.tenant_id = v_tenant
        JOIN public.projects pr ON pr.id = p.project_id
       WHERE (v_today - ch.chaseable_since) >= v_rung          -- the 7-day rung
         AND ch.chaseable_since > v_epoch                      -- §4: new only
         AND p.actual_issue IS NULL                            -- issued is done
         AND p.approval_date IS NULL                           -- the city answered
         AND ch.corr_issued IS NULL                            -- ...and so is this
         AND public.bp_city_owes_review(p.status)              -- ...and this
         AND p.parent_permit_id IS NULL                        -- ladder skips subs
         AND COALESCE(pr.is_backfill, false) = false           -- fix-386
         -- ★★★ fix-390/391: held at EITHER scope, and fix-262 cancelled. One
         -- NOT EXISTS covers both kinds because an open project_holds row of
         -- either kind means the permit is not live work.
         AND NOT EXISTS (SELECT 1 FROM public.project_holds h
                          WHERE h.project_id = p.project_id AND h.hold_end IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.permit_holds h
                          WHERE h.permit_id = p.id AND h.hold_end IS NULL)
    LOOP
      v_made := public.bp_create_lifecycle_task(
        v_tenant, v_row.id, 'city_target_chase', v_row.cycle_index, '{}'::jsonb);
      IF v_made IS NOT NULL THEN v_count := v_count + 1; END IF;
    END LOOP;

    INSERT INTO public.app_sweeps (tenant_id, sweep_name, last_swept_on, updated_at)
    VALUES (v_tenant, 'city_target_chase', v_today, now())
    ON CONFLICT (tenant_id, sweep_name)
    DO UPDATE SET last_swept_on = EXCLUDED.last_swept_on, updated_at = now();
  END LOOP;

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.bp_generate_city_chase_tasks(uuid) IS
  'fix-395: mints a chase task on every permit chaseable for 7+ days that '
  'clears the silence gates. NEW CROSSINGS ONLY — targets already chaseable at '
  'the epoch are reported, never minted. Once per tenant per day via app_sweeps.';

-- fix-157 posture: no PUBLIC/anon execute on a SECURITY DEFINER writer.
REVOKE ALL ON FUNCTION public.bp_generate_city_chase_tasks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_generate_city_chase_tasks(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_city_owes_review(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_city_owes_review(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9 · PROVE IT, rather than assuming the DDL did what it says
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_problem text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='permit_tasks'
                    AND column_name='auto_anchor') THEN
    v_problem := 'auto_anchor column missing';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname='public' AND indexname='permit_tasks_city_chase_uniq') THEN
    v_problem := 'chase anchor index missing';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname='public' AND indexname='permit_tasks_auto_event_uniq'
                       AND indexdef LIKE '%city_target_chase%') THEN
    v_problem := 'the old index still covers the chase event';
  ELSIF public.bp_city_owes_review('Corrections Required') THEN
    v_problem := 'bp_city_owes_review says the city still owes a corrections permit';
  ELSIF NOT public.bp_city_owes_review('Reviews In Process') THEN
    v_problem := 'bp_city_owes_review refuses a permit the city IS reviewing';
  END IF;

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'fix-395: %', v_problem;
  END IF;
END
$verify$;
