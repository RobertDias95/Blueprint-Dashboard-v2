-- fix-680 (P-318 #7, fix-679 census tickets 1 + 2): Target Submit learns from
-- our own recent history, and ANY permit type gets one.
--
-- ★★★ THIS REVERSES fix-249 ("policy beats learner"). That is intended.
--   Bobby, 2026-10-15: "lets make it smart, lets see what our average is ...
--   using a rolling average". Shown the data (most types have 0–1 submittals a
--   quarter; one odd project swings an average) he chose the MEDIAN OF THE 5
--   MOST RECENT submittals, per type + jurisdiction (fewer if that is all there
--   is). The Settings number (target_submit_formulas) is now only the STARTING
--   NUMBER, used while a type has no history in that city.
--   Before this, a formula row returned before any history was read, so no
--   Target Submit learned at all (census finding 1).
--
-- §A  permit_types.ts_anchor: which date each type's Target Submit counts
--     from, stored ONCE. bp_recompute_target_submits' two hard-coded
--     `CASE v_permit.type` blocks read it now, and so does the frontend
--     (anchorFor() is deleted). A new type defaults to 'go_date'.
--     Anchors kept exactly as they were for the 13 dated types; the four
--     undated ones per Bobby's 10-15 rulings: STFI = go_date, PPR = created
--     (the day the PPR row was made in the Bridge), Vault + WAC = none.
--     The hard-coded `CASE p_type ... THEN 21/37/10/...` last resort in
--     bp_learn_target_submit_days is gone: no formula row and no history now
--     means NULL (no automatic target), never a number from code.
--
-- §B  bp_target_submit_observations: the ONE list of observations. The
--     learner and the benchmark both read it, so they cannot drift.
--       - that type + jurisdiction, c0.submitted and the anchor both present
--       - |submitted − anchor| <= 730 (unchanged)
--       - hold days subtracted exactly as fix-668 does
--       - for 'created' only, submitted BEFORE created is a backfill
--         (entered after the fact) and is excluded
--     bp_learn_target_submit_days = median of the 5 most recent (by
--     c0.submitted, ties by permit id), rounded half away from zero; else the
--     starting number (jurisdiction row, then the type row); else NULL.
--
-- §C  bp_recompute_target_submits: unchanged apart from the anchor lookup and
--     'created' support. Manual targets untouched; fix-621/624's finished-
--     permit rule untouched; the Building Permit block untouched apart from
--     calling the new learner.
--
-- Schema + functions only. The one-off recompute that moves today's dates is
-- run separately, after Bobby approved the rolled-back preview (§D).

-- ===========================================================================
-- §A — one anchor per type
-- ===========================================================================
ALTER TABLE public.permit_types
  ADD COLUMN IF NOT EXISTS ts_anchor text NOT NULL DEFAULT 'go_date';

ALTER TABLE public.permit_types
  DROP CONSTRAINT IF EXISTS permit_types_ts_anchor_check;
ALTER TABLE public.permit_types
  ADD CONSTRAINT permit_types_ts_anchor_check CHECK (ts_anchor IN (
    'dd_end', 'go_date', 'bp_c0_intake', 'bp_c1_resub',
    'bp_actual_issue', 'mirror_bp', 'created', 'none'
  ));

COMMENT ON COLUMN public.permit_types.ts_anchor IS
  'fix-680: the date this type''s Target Submit counts from. dd_end = end of design; go_date = project GO date; bp_c0_intake / bp_c1_resub / bp_actual_issue = the project''s Building Permit intake / 1st resubmittal / issue; mirror_bp = copy the Building Permit''s target; created = the day this permit row was created; none = no automatic target.';

-- The backfill is today's CASE, type for type (a test pins it), plus the four
-- rulings for the types the CASE had no branch for.
UPDATE public.permit_types SET ts_anchor = CASE name
    WHEN 'Building Permit'    THEN 'dd_end'
    WHEN 'Demolition'         THEN 'bp_c0_intake'
    WHEN 'IPR'                THEN 'bp_c1_resub'
    WHEN 'ULS'                THEN 'bp_c1_resub'
    WHEN 'Condo'              THEN 'bp_actual_issue'
    WHEN 'Grading / Clearing' THEN 'mirror_bp'
    WHEN 'LSM'                THEN 'mirror_bp'
    WHEN 'ECA Waiver'         THEN 'go_date'
    WHEN 'LBA'                THEN 'go_date'
    WHEN 'Short Plat'         THEN 'go_date'
    WHEN 'SIP'                THEN 'go_date'
    WHEN 'PAR/Pre-Sub'        THEN 'go_date'
    WHEN 'SDOT Tree'          THEN 'go_date'
    WHEN 'TRAO'               THEN 'go_date'
    WHEN 'STFI'               THEN 'go_date'
    WHEN 'PPR'                THEN 'created'
    WHEN 'Vault'              THEN 'none'
    WHEN 'WAC'                THEN 'none'
    ELSE ts_anchor
  END
WHERE name IN (
  'Building Permit', 'Demolition', 'IPR', 'ULS', 'Condo', 'Grading / Clearing',
  'LSM', 'ECA Waiver', 'LBA', 'Short Plat', 'SIP', 'PAR/Pre-Sub', 'SDOT Tree',
  'TRAO', 'STFI', 'PPR', 'Vault', 'WAC'
);

-- ===========================================================================
-- §B — the one observation list, the learner, the benchmark
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.bp_target_submit_observations(
  p_type text, p_juris text, p_anchor text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS TABLE(permit_id integer, submitted date, days integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.pid,
         s.sub_on,
         (s.sub_on - s.anchor_on
           - (CASE WHEN s.pid = ANY ((SELECT public.bp_held_permit_ids())::integer[])
                   THEN public.bp_held_days(s.pid, s.anchor_on, s.sub_on) ELSE 0 END))::integer
    FROM (
      SELECT p.id AS pid,
             c0.submitted AS sub_on,
             (CASE p_anchor
                WHEN 'dd_end'          THEN p.dd_end
                WHEN 'go_date'         THEN pr.go_date
                WHEN 'bp_c0_intake'    THEN bp_c0.intake_accepted
                WHEN 'bp_c1_resub'     THEN bp_c1.resubmitted
                WHEN 'bp_actual_issue' THEN bp.actual_issue
                WHEN 'created'         THEN (p.created_at AT TIME ZONE 'America/Los_Angeles')::date
              END) AS anchor_on
        FROM permits p
        JOIN projects pr ON pr.id = p.project_id
        JOIN permit_cycles c0 ON c0.permit_id = p.id AND c0.cycle_index = 0
        LEFT JOIN LATERAL (
          SELECT b.id, b.actual_issue
            FROM permits b
           WHERE b.project_id = p.project_id
             AND b.type = 'Building Permit'
             AND (p_anchor <> 'bp_actual_issue' OR b.actual_issue IS NOT NULL)
           ORDER BY b.id ASC LIMIT 1
        ) bp ON p_anchor IN ('bp_c0_intake', 'bp_c1_resub', 'bp_actual_issue')
        LEFT JOIN permit_cycles bp_c0 ON bp_c0.permit_id = bp.id AND bp_c0.cycle_index = 0
        LEFT JOIN permit_cycles bp_c1 ON bp_c1.permit_id = bp.id AND bp_c1.cycle_index = 1
       WHERE p.type = p_type
         AND pr.juris = p_juris
         AND c0.submitted IS NOT NULL
         AND (p_tenant IS NULL OR p.tenant_id = p_tenant)
    ) s
   WHERE s.anchor_on IS NOT NULL
     AND ABS(s.sub_on - s.anchor_on) <= 730
     -- ★ 'created': a permit submitted BEFORE its row existed was entered
     --   after the fact (a backfill). Its gap says nothing about lead time.
     AND (p_anchor <> 'created' OR s.sub_on >= s.anchor_on);
$function$;

COMMENT ON FUNCTION public.bp_target_submit_observations(text, text, text, uuid) IS
  'fix-680: every (permit, submitted, days anchor->submitted net of hold days) observation for a type + jurisdiction. The ONE list the Target Submit learner and benchmark both read.';

REVOKE ALL ON FUNCTION public.bp_target_submit_observations(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_target_submit_observations(text, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bp_learn_target_submit_days(p_type text, p_juris text, p_anchor text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_learned integer;
BEGIN
  -- mirror_bp / none / anything unknown: no learner, no number.
  IF p_anchor IS NULL OR p_anchor NOT IN (
    'dd_end','go_date','bp_c0_intake','bp_c1_resub','bp_actual_issue','created'
  ) THEN RETURN NULL; END IF;

  -- fix-680: history FIRST — the median of the 5 most recent submittals.
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.days)::numeric)::integer
    INTO v_learned
    FROM (
      SELECT o.days
        FROM public.bp_target_submit_observations(p_type, p_juris, p_anchor, p_tenant) o
       ORDER BY o.submitted DESC, o.permit_id DESC
       LIMIT 5
    ) r;
  IF v_learned IS NOT NULL THEN RETURN v_learned; END IF;

  -- No history yet: the starting number from Settings (city row, then the
  -- type row). No row → NULL. There is no number in code any more.
  RETURN public.bp_target_submit_offset(p_type, p_juris, p_tenant);
END;
$function$;

-- Same signature, same columns as fix-249, so the grant and every caller
-- survive. What the columns MEAN now:
--   window_label 'learned'  → median_days = median of the n (<= 5) most recent
--                             submittals; min/max over those n
--   window_label 'starting' → no history: median_days = the Settings starting
--                             number, n = 0
--   window_label 'none'     → no history and no starting number
--   total_samples           → every observation on record for the cohort
CREATE OR REPLACE FUNCTION public.bp_target_submit_benchmark(p_type text, p_juris text, p_anchor text)
 RETURNS TABLE(median_days integer, n integer, min_days integer, max_days integer, window_label text, total_samples integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant   uuid;
  v_total    integer;
  v_starting integer;
BEGIN
  IF p_anchor IS NULL OR p_anchor NOT IN (
    'dd_end','go_date','bp_c0_intake','bp_c1_resub','bp_actual_issue','created'
  ) THEN RETURN; END IF;

  IF COALESCE(array_length(auth_tenant_ids(), 1), 0) = 0 THEN RETURN; END IF;
  SELECT t INTO v_tenant FROM unnest(auth_tenant_ids()) t ORDER BY t LIMIT 1;

  SELECT COUNT(*)::integer INTO v_total
    FROM public.bp_target_submit_observations(p_type, p_juris, p_anchor, v_tenant);

  IF v_total > 0 THEN
    RETURN QUERY
      SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.days)::numeric)::integer,
             COUNT(*)::integer,
             MIN(r.days)::integer,
             MAX(r.days)::integer,
             'learned'::text,
             v_total
        FROM (
          SELECT o.days
            FROM public.bp_target_submit_observations(p_type, p_juris, p_anchor, v_tenant) o
           ORDER BY o.submitted DESC, o.permit_id DESC
           LIMIT 5
        ) r;
    RETURN;
  END IF;

  v_starting := public.bp_target_submit_offset(p_type, p_juris, v_tenant);
  IF v_starting IS NOT NULL THEN
    RETURN QUERY SELECT v_starting, 0, NULL::integer, NULL::integer, 'starting'::text, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::integer, NULL::integer, 'none'::text, 0;
END;
$function$;

-- ===========================================================================
-- §C — the recompute reads the anchor
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.bp_recompute_target_submits(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev_depth        integer;
  v_go                date;
  v_juris             text;
  v_tenant            uuid;
  v_bp_id             integer;
  v_bp_dd_end         date;
  v_bp_actual         date;
  v_bp_approval       date;  -- fix-621
  v_bp_target         date;
  v_bp_is_manual      boolean;
  v_bp_c0_intake      date;
  v_bp_c0_submitted   date;
  v_bp_c1_resub       date;
  v_proj_intake       date;
  v_proj_c1_resub     date;
  v_proj_issue        date;
  v_intake_projected  boolean := false;
  v_c1_projected      boolean := false;
  v_issue_projected   boolean := false;
  v_projected         boolean;
  v_permit            RECORD;
  v_candidate         date;
  v_anchor_on         date;  -- fix-680
  v_offset            integer;
  v_updated           integer := 0;
BEGIN
  IF p_project_id IS NULL THEN RETURN 0; END IF;
  v_prev_depth := COALESCE(NULLIF(current_setting('bp.target_submit_engine_depth', true), '')::int, 0);
  PERFORM set_config('bp.target_submit_engine_depth', (v_prev_depth + 1)::text, true);

  SELECT go_date, juris, tenant_id
    INTO v_go, v_juris, v_tenant
    FROM projects WHERE id = p_project_id;

  SELECT id, dd_end, actual_issue, approval_date, target_submit, target_submit_is_manual
    INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_approval, v_bp_target, v_bp_is_manual
    FROM permits WHERE project_id = p_project_id AND type = 'Building Permit' ORDER BY id ASC LIMIT 1;
  IF v_bp_id IS NOT NULL THEN
    SELECT intake_accepted, submitted INTO v_bp_c0_intake, v_bp_c0_submitted FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 0;
    SELECT resubmitted INTO v_bp_c1_resub FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 1;
  END IF;

  -- fix-621: a FINISHED Building Permit keeps its target. v_bp_target then
  --   stays the value read from the row above, so the G&C / LSM mirrors below
  --   still follow the BP's real, historical target rather than a freshly
  --   recomputed one.
  -- fix-624: ...unless it has NO target yet. A blank is not history, so it is
  --   filled. The block below can only be entered by a finished BP when
  --   v_bp_target IS NULL, so it can only ever fill, never overwrite.
  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false)
     AND (NOT public.bp_permit_is_finished(v_bp_approval, v_bp_actual)
          OR v_bp_target IS NULL) THEN
    IF v_bp_dd_end IS NOT NULL THEN
      v_offset := bp_learn_target_submit_days('Building Permit', v_juris, 'dd_end', v_tenant);
      v_candidate := v_bp_dd_end + COALESCE(v_offset, 21);
    ELSE
      v_candidate := NULL;
    END IF;
    IF v_candidate IS NOT NULL AND v_candidate IS DISTINCT FROM v_bp_target THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_bp_id;
      v_updated := v_updated + 1;
    END IF;
    v_bp_target := v_candidate;
  END IF;

  FOR v_permit IN
    SELECT id, dd_end, target_submit, target_submit_is_manual, approval_date, actual_issue
    FROM permits WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;
    -- fix-621: done is done, for the Building Permit too. This skips the
    --   target_submit_is_projected := false write below as well, which is a
    --   no-op either way: measured 2026-10-03, ZERO Building Permits carry that
    --   flag true, and this loop is the only thing that writes it for a BP.
    -- fix-624: and "done" now means done AND RECORDED. A finished BP with no
    --   target yet is filled; one that has a target is left exactly as it was.
    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue)
       AND v_permit.target_submit IS NOT NULL THEN CONTINUE; END IF;
    IF v_permit.dd_end IS NOT NULL THEN
      v_offset := bp_learn_target_submit_days('Building Permit', v_juris, 'dd_end', v_tenant);
      v_candidate := v_permit.dd_end + COALESCE(v_offset, 21);
    ELSE
      v_candidate := NULL;
    END IF;
    IF v_candidate IS NOT NULL AND v_candidate IS DISTINCT FROM v_permit.target_submit THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_permit.id;
      v_updated := v_updated + 1;
    END IF;
    UPDATE permits SET target_submit_is_projected = false
      WHERE id = v_permit.id AND target_submit_is_projected IS DISTINCT FROM false;
  END LOOP;

  v_proj_intake := COALESCE(v_bp_c0_intake, v_bp_target);
  v_intake_projected := (v_bp_c0_intake IS NULL AND v_bp_target IS NOT NULL);

  IF v_proj_intake IS NOT NULL THEN
    v_proj_c1_resub := COALESCE(
      v_bp_c1_resub,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'c1_resub_offset', v_tenant)
    );
    v_c1_projected := (v_bp_c1_resub IS NULL);
    v_proj_issue := COALESCE(
      v_bp_actual,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'intake_to_approval', v_tenant)
    );
    v_issue_projected := (v_bp_actual IS NULL);
  ELSE
    v_proj_c1_resub := v_bp_c1_resub;
    v_proj_issue    := v_bp_actual;
    v_c1_projected  := false;
    v_issue_projected := false;
  END IF;

  v_c1_projected    := v_c1_projected    OR v_intake_projected;
  v_issue_projected := v_issue_projected OR v_intake_projected;

  FOR v_permit IN
    SELECT p.id, p.type, p.target_submit, p.target_submit_is_manual,
           p.target_submit_is_projected, c0.submitted AS c0_submitted, p.approval_date, p.actual_issue,
           p.dd_end,
           (p.created_at AT TIME ZONE 'America/Los_Angeles')::date AS created_on,
           -- fix-680: the anchor is a column now. A type with no catalogue
           --   row (permits.type is free text) gets no automatic target, as
           --   the old CASE's ELSE NULL did.
           COALESCE(pt.ts_anchor, 'none') AS ts_anchor
    FROM permits p
    LEFT JOIN permit_cycles c0 ON c0.permit_id = p.id AND c0.cycle_index = 0
    LEFT JOIN permit_types pt ON pt.name = p.type
    WHERE p.project_id = p_project_id AND p.type <> 'Building Permit'
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;
    -- fix-585: done is done. An approved or issued permit's target is history.
    -- fix-621 swapped the inline test for the shared predicate so this and the
    --   BP guard above cannot drift. The rule is unchanged.
    -- fix-624 NARROWS it rather than reversing it: a target that was never set
    --   is not history, so it is filled. A recorded one is still untouchable.
    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue)
       AND v_permit.target_submit IS NOT NULL THEN CONTINUE; END IF;
    IF v_permit.c0_submitted IS NOT NULL THEN
      v_candidate := v_permit.c0_submitted;
      v_projected := false;
    ELSIF v_permit.ts_anchor = 'mirror_bp' THEN
      v_candidate := v_bp_target;
      v_projected := false;
    ELSE
      -- fix-680: one lookup replaces the two hard-coded CASE blocks.
      v_anchor_on := CASE v_permit.ts_anchor
        WHEN 'dd_end'          THEN v_permit.dd_end
        WHEN 'go_date'         THEN v_go
        WHEN 'bp_c0_intake'    THEN v_proj_intake
        WHEN 'bp_c1_resub'     THEN v_proj_c1_resub
        WHEN 'bp_actual_issue' THEN v_proj_issue
        WHEN 'created'         THEN v_permit.created_on
        ELSE NULL  -- 'none'
      END;
      IF v_anchor_on IS NOT NULL THEN
        v_candidate := v_anchor_on + bp_learn_target_submit_days(v_permit.type, v_juris, v_permit.ts_anchor, v_tenant);
      ELSE
        v_candidate := NULL;
      END IF;

      v_projected := CASE v_permit.ts_anchor
        WHEN 'bp_c0_intake'    THEN v_intake_projected
        WHEN 'bp_c1_resub'     THEN v_c1_projected
        WHEN 'bp_actual_issue' THEN v_issue_projected
        ELSE false
      END;
    END IF;

    IF v_candidate IS NOT NULL AND v_candidate IS DISTINCT FROM v_permit.target_submit THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_permit.id;
      v_updated := v_updated + 1;
    END IF;
    IF v_candidate IS NOT NULL
       AND COALESCE(v_projected, false) IS DISTINCT FROM COALESCE(v_permit.target_submit_is_projected, false) THEN
      UPDATE permits SET target_submit_is_projected = COALESCE(v_projected, false)
        WHERE id = v_permit.id;
    END IF;
  END LOOP;

  PERFORM set_config('bp.target_submit_engine_depth', v_prev_depth::text, true);
  RETURN v_updated;
END;
$function$;
