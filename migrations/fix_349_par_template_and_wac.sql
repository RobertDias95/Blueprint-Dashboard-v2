-- fix-349: a template task that duplicates a bot, a bot task that records the
-- wrong date, and a permit the tool models as a checkbox.
--
-- ★ THREE CHANGES, TWO OF THEM DATA, BOTH APPROVED BY NAME IN THE BRIEF:
--     §1  DELETE one task_templates row (approved)
--     §2  bp_create_lifecycle_task: start_date from the CITY's date (code)
--     §3  INSERT one permit_types row: 'WAC' (approved)
--   Nothing else is written. In particular NO backfill of start_date on the
--   existing bot tasks, and NO WAC permit on any existing project — both
--   explicitly out of scope, both counted and reported instead.
--
-- Idempotent throughout: the DELETE is keyed on the semantic tuple, the INSERT
-- is ON CONFLICT DO NOTHING, and the function is CREATE OR REPLACE.
--
-- No explicit BEGIN/COMMIT: apply_migration runs the whole file in one
-- transaction, which is the convention fix-337 and fix-344 follow.

-- ===========================================================================
-- ★★★ §1 — DELETE "Review Results and send out" from the Seattle PAR template
-- ===========================================================================
--
-- Bobby: *"There is a manual task that's part of the template that says review
-- results and send out. I want to delete that task for that permit… review
-- results and send out is more of a permitting task that gets issued versus a
-- design and engineering task."*
--
-- ★★ THE AUTOMATION ALREADY EXISTS AND IT OVERLAPS. Measured on prod
-- 2026-08-19, the bot writes the same job twice over:
--
--     'Permit approved — send out results — <num>'              25 tasks
--     'Permit issued — send out approved plans / results — …'  107 tasks
--
-- and `003976-26PA` carries BOTH `Review Results and send out` (this template
-- row) and `Permit approved — send out results — 003976-26PA` (the bot). One
-- permit, one job, two tasks — which is the whole complaint.
--
-- ★ The row is deleted; the SIX permit_tasks rows it has already produced
-- (three still open) are NOT touched. A template row is a recipe, and deleting
-- the recipe does not un-cook the meal — those three are somebody's live work
-- and closing them would be a data change nobody approved.
--
-- ★ Keyed on (permit_type, jurisdiction, text) rather than the uuid so this
-- reads as the rule it is, and so a re-run is a no-op rather than an error.
DELETE FROM public.task_templates
 WHERE permit_type  = 'PAR/Pre-Sub'
   AND jurisdiction = 'Seattle'
   AND text         = 'Review Results and send out';

-- ★★ THE OTHER ENTITLEMENTS ROW — 'Review WAC and send out' — IS DELIBERATELY
-- LEFT IN PLACE. See §3: WAC becomes a permit type in this same migration, but
-- no WAC permit exists yet on any project, so nothing else on the board is
-- tracking the WAC. Deleting this row today would remove the only trace of a
-- required permit rather than move it, which is the failure the brief names.
-- The condition for deleting it is stated in §3 and is not met yet.

-- ===========================================================================
-- ★★★ §2 — A BOT TASK STARTS WHEN THE CITY ACTED, NOT WHEN WE NOTICED
-- ===========================================================================
--
-- Bobby: *"That would have a start date of today. So if we got corrections
-- today, then a task would get created today, and then that would have a start
-- date of today."*
--
-- ★★ HE IS DESCRIBING THE DAY THE CITY ACTED. The tool records the day the
-- SCRAPER NOTICED. Usually the same day — and then a backlog run makes a permit
-- approved three weeks ago produce a task that starts today.
--
-- ★ MEASURED ON PROD 2026-08-19, over ALL 560 bot tasks — not just the two
-- `results_ready` variants the brief sampled:
--
--     event              tasks   no start   right   wrong   no city date
--     results_ready        132         42      13      77             0
--     corr_issued           96         58      13      23             8
--     resubmitted           66         40      10      16             2
--     intake_submitted      42          8       0      20            21
--     intake_accepted       29         10       0      19             0
--     scrape_reconcile     145         75       0       0           145  ★
--     number_entry          50         13       0       0            50  ★
--                        ─────      ─────   ─────   ─────
--                          560        246      36     155
--
-- ★★ 246 carry NO start date and 155 carry one that disagrees with the city's
-- own date — 401 of 560. Only 36 are right. (The two ★ rows have no city date
-- by definition and are correct as they stand; the 31 others with none are
-- cycles whose own field is null.)
--
-- ★ They are COUNTED AND LEFT ALONE. Backfilling is not approved, and the brief
-- is right that a wrong date somebody can see beats a wrong date this migration
-- invented. A test asserts this file contains no UPDATE of start_date.
--
-- ★★ WHY A THIRD OF THEM HAVE NO START DATE AT ALL, since it is not obvious:
-- fix-268's `bp_trg_task_start_date` stamps `current_date` only on a transition
-- INTO 'In Progress' or 'Resolved'. A bot task is inserted 'Open', so the
-- trigger correctly does nothing, and fix-292 then set the columns explicitly
-- at creation — for rows created BEFORE fix-292 there was nothing to set them.
-- That rule is unchanged here and must be: it is the right behaviour for a
-- human's task. What changes is only the VALUE fix-292 supplies.
--
-- ★★★ EVERY EVENT, NOT JUST THE TWO IN THE MEASUREMENT. The rule is "the date
-- the city acted", and five of the seven events have such a date. Fixing only
-- `results_ready` would leave the identical bug in four other places, including
-- `corr_issued` — which is the event Bobby's own sentence is about.
--
--     intake_submitted   cycle.submitted
--     intake_accepted    cycle.intake_accepted
--     corr_issued        cycle.corr_issued
--     resubmitted        cycle.resubmitted
--     results_ready      permits.approval_date (basis 'approved')
--                        permits.actual_issue  (basis 'issued')
--     number_entry       ★ none — "was this submitted?" is a question ABOUT a
--                        missing date, so there is nothing to read
--     scrape_reconcile   ★ none — a portal/dashboard mismatch is noticed now,
--                        by definition
--
-- The last two keep `current_date`, which is the honest answer for them.
--
-- ★ The cycle read is safe and exact: measured on prod, all four cycle-scoped
-- events carry `cycle_idx` on 100% of their rows (42/42, 29/29, 96/96, 66/66)
-- and the three non-cycle events carry it on none. So the lookup is guarded on
-- `p_cycle_idx IS NOT NULL` and never guesses a cycle.
--
-- ★★ TWO GUARDS, both because a date is worse than no date when it is wrong:
--   * LEAST(…, current_date) — a city date in the future never becomes a start
--     date in the future. `start_date` means "the clock started"; it cannot
--     start tomorrow.
--   * COALESCE(…, current_date) — a bot task ALWAYS carries a start date. The
--     brief asks for that in as many words, and it is what stops this change
--     from turning "wrong date" into "no date".
--
-- ★★★ AND `target_date` STAYS ANCHORED TO TODAY — this is the deliberate half.
-- fix-292 set `target = start + 1`. Now that `start` can be weeks in the past,
-- keeping that formula would create tasks that are ALREADY past due at the
-- moment they are born — and post-fix-348 those land straight in the blended
-- Past due bucket. You cannot be late for work you did not know about. So:
--
--     start_date   = when the city acted        (the clock)
--     target_date  = current_date + 1           (when we can act)
--
-- The gap between the two IS the scraper's lag, made visible on the row rather
-- than charged to the team as lateness.
--
-- Re-emitted from migrations/fix_337_stale_work.sql:175 — the LATEST full
-- definition — with only the date derivation changed. ★ Not from
-- pg_get_functiondef: that comes back TRUNCATED through the MCP tool, and
-- rebuilding a function from a truncated read is exactly how fix-337 silently
-- narrowed bp_list_permit_tasks's payload.
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(p_tenant_id uuid, p_permit_id integer, p_event text, p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
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

  -- ★★★ fix-349: the city's own date for THIS event. See the header for why
  -- number_entry and scrape_reconcile deliberately have none.
  IF p_cycle_idx IS NOT NULL
     AND p_event IN ('intake_submitted','intake_accepted','corr_issued','resubmitted')
  THEN
    SELECT * INTO v_cycle
    FROM public.permit_cycles
    WHERE permit_id = p_permit_id AND cycle_index = p_cycle_idx;
  END IF;

  v_city_date := CASE p_event
    WHEN 'intake_submitted' THEN v_cycle.submitted
    WHEN 'intake_accepted'  THEN v_cycle.intake_accepted
    WHEN 'corr_issued'      THEN v_cycle.corr_issued
    WHEN 'resubmitted'      THEN v_cycle.resubmitted
    WHEN 'results_ready'    THEN
      CASE WHEN COALESCE(p_context->>'basis', 'issued') = 'approved'
           THEN v_permit.approval_date
           ELSE v_permit.actual_issue
      END
    ELSE NULL                       -- number_entry, scrape_reconcile
  END;

  -- Never in the future, never null.
  v_start  := COALESCE(LEAST(v_city_date, current_date), current_date);
  -- ★ Anchored to today, NOT to v_start — see the header. A task is not born
  -- overdue because the scraper was catching up.
  v_target := current_date + v_target_days;

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
      v_start, v_target                                          -- fix-349
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
      v_start, v_target                                          -- fix-349
    )
    ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
      WHERE is_auto_generated = true AND auto_event <> 'scrape_reconcile'
    DO NOTHING
    RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END;
$function$;

COMMENT ON FUNCTION public.bp_create_lifecycle_task(uuid, integer, text, integer, jsonb) IS
  'fix-349: start_date is the date the CITY acted (cycle.submitted / '
  'intake_accepted / corr_issued / resubmitted, or permits.approval_date / '
  'actual_issue for results_ready), never in the future and never null; '
  'number_entry and scrape_reconcile have no city date and keep current_date. '
  'target_date stays current_date + 1 so a task is never born overdue because '
  'the scraper was catching up. fix-337''s issued-permit guard unchanged.';

-- ===========================================================================
-- ★★★ §3 — WAC IS A PERMIT, AND THE TOOL MODELLED IT AS A CHECKBOX
-- ===========================================================================
--
-- Bobby: *"Technically, a WAC is a separate permit in Seattle, and generally
-- required every time. So generally speaking for Seattle, we always need a
-- building permit, PAR and WAC."*
--
-- ★★ Measured on prod 2026-08-19: 130 Seattle projects, ZERO WAC permits, and
-- no `WAC` in the 16-row `permit_types` catalogue. That is WHY it is a task —
-- somebody needed to track it, there was no type for it, so it became a
-- checkbox on the PAR template. A required permit with no dates, no city
-- status, and nothing on the pipeline.
--
-- ★ `is_builtin = false`, matching how Condo, SDOT Tree and STFI were added.
-- Builtin marks the original catalogue, not importance.
--
-- ★★★ NO BACKFILL. 130 Seattle projects would each need one, and Bobby's
-- standing precedent — set on PARs, in his words — is *"did not add to back
-- fill. only adding now as we move forward."* New projects only. A test asserts
-- this migration contains no INSERT INTO permits at all.
--
-- ★ AND `WAC` IS DELIBERATELY *NOT* ADDED TO NO_ISSUANCE_PERMIT_TYPES. That set
-- lives in TWO repos (src/lib/permitTypeTaxonomy.ts and the scraper's copy) and
-- fix-41's rule is that they stay identical; changing it here alone would break
-- the parity this repo has kept since May. Unknown types default to
-- issuance-bearing, which is also the right answer for a certificate the city
-- hands you — so WAC gets a 'Permit issued — send out approved plans' bot task
-- on `actual_issue`, exactly like every other issuing type, with no change.
INSERT INTO public.permit_types (name, is_builtin)
VALUES ('WAC', false)
ON CONFLICT (name) DO NOTHING;

-- ★★ WHAT BECOMES OF `Review WAC and send out` (Seattle PAR template, row 2):
-- IT STAYS, and here is the condition for removing it, so this is a decision
-- with an end rather than an omission.
--
-- The row is the ONLY thing tracking the WAC today. Adding the type does not
-- retroactively create WAC permits (see NO BACKFILL above), so on all 130
-- existing Seattle projects this checkbox remains the only record that a WAC is
-- required. Deleting it now would lose the tracking rather than move it.
--
-- ★ It becomes deletable the moment new Seattle projects carry a WAC permit of
-- their own: from then on the WAC raises its own bot tasks on its own flips,
-- like every other type, and the checkbox is the duplicate that §1 deleted its
-- sibling for being.
--
-- ★ ONE THING TO DECIDE, FLAGGED NOT CHANGED: the row's bucket is `de` (Design
-- & Engineering) while its default_team is `Entitlements` — the exact mismatch
-- Bobby described when he asked for row 1 to go ("more of a permitting task …
-- versus a design and engineering task"). Moving it to `pm` would be a THIRD
-- data change and the brief approved two, so it is reported, not done. Note the
-- two axes are separate: fix-244 already derives `discipline` from
-- `default_team`, so the seeded task is correctly an ENT task — it is only the
-- de/pm PHASE bucket that reads wrong.

-- ===========================================================================
-- ★ §4 — approved → issued: NOTHING IS BUILT, AND THAT IS THE FINDING
-- ===========================================================================
--
-- Bobby: *"If it quickly flips from approved to issued, then we would almost
-- discard the approved one and go forward with the issued one."*
--
-- The brief asks whether fix-337's trigger already catches the approved bot
-- task. It does not — `bp_clear_tasks_for_issued_permit` excludes
-- `auto_event = 'results_ready'` by name. ★ But the case it would be catching
-- CANNOT ARISE, so closing it would be a fix for nothing and a hazard for
-- something else.
--
-- `bp_permit_results_ready_autotask` (fix-181) is MUTUALLY EXCLUSIVE by permit
-- type, not a race between two events:
--
--     no-issuance types (SDOT Tree, PAR/Pre-Sub, ECA Waiver, ULS)
--         fire on approval_date only            → basis 'approved'
--     every other type
--         fire on actual_issue only             → basis 'issued'
--
-- So an issuing permit NEVER gets an approved task to discard — it gets the
-- issued one and only the issued one — and a no-issuance permit never gets an
-- issued task, because for those types approval IS the end.
--
-- ★ Confirmed on prod: of 132 `results_ready` tasks, permits carrying BOTH
-- variants: ZERO. Exactly one approved task is open on a permit that also has
-- an actual_issue — `003976-26PA`, a PAR/Pre-Sub approved and "issued" the same
-- day (a no-issuance type that the scraper wrote an actual_issue onto). For
-- THAT permit the approved task is the right task and the only one: closing it
-- on issuance would delete the sole "send out results" prompt on the permit.
--
-- ★★ Which is why fix-337's carve-out is left exactly as it is. Nothing built.
