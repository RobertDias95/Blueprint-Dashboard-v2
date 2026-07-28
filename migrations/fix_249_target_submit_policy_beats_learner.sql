-- fix-249: target_submit — POLICY beats the learner; learner becomes display-only.
--
-- THE BUG (verified on prod 2026-07-28)
-- ------------------------------------
-- bp_learn_target_submit_days() resolved in this order:
--   1. learned AVG over recency windows [90, 180, 365, all-time] — first
--      window with ANY data wins (no minimum sample size)
--   2. bp_target_submit_offset()  ← the configured policy table
--   3. hardcoded default
-- Because step 1 fired whenever a single row existed, step 2 was dead code.
-- Every one of the 14 per-type offsets configured on 2026-06-10 has been
-- silently ignored since. bp_learn_days() had the identical shape.
--
-- SECOND BUG — found while implementing, NOT in the original brief
-- ---------------------------------------------------------------
-- bp_target_submit_offset() filters `tenant_id = ANY (auth_tenant_ids())`,
-- and auth_tenant_ids() derives from auth.uid(). bp_recompute_target_submits
-- is SECURITY DEFINER, but SECURITY DEFINER does NOT synthesise a JWT — when
-- the scraper (service_role) or a direct SQL session drives the recompute,
-- auth.uid() is NULL, auth_tenant_ids() returns '{}', and the policy lookup
-- returns NULL *even when the row exists*.
--   Verified on prod:  bp_target_submit_offset('TRAO','Seattle') -> NULL
--                      target_submit_formulas TRAO offset_days   -> 3
-- So flipping precedence alone would have been a no-op on the scraper path —
-- the policy would still resolve NULL and fall straight through to the
-- learner. The fix therefore threads the *project's* tenant_id down into the
-- policy lookups instead of relying on the caller's auth context.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1a. bp_learn_target_submit_days: policy lookup moved to the TOP.
--   1b. bp_learn_days: same flip (permit_type_defaults before the learner).
--   1c. bp_target_submit_benchmark: NEW read-only display function —
--       MEDIAN (not avg), minimum sample size 3, SECURITY INVOKER.
--   1d. Anchors are NOT touched. The CASE block in bp_recompute_target_submits
--       is byte-for-byte the same set of anchors it had before.
--   1e. permits.target_submit_is_projected — surfaces the case where the
--       target hangs off an event (BP cycle-1 resubmit / intake / issue) that
--       has not actually happened yet.
--
-- NOTE: no data moves when this migration is applied. target_submit is only
-- rewritten when bp_recompute_target_submits runs (explicitly or via the four
-- triggers). The backfill is a separate, gated step.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Projection flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.permits
  ADD COLUMN IF NOT EXISTS target_submit_is_projected boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.permits.target_submit_is_projected IS
  'fix-249: true when target_submit was derived from a projected anchor — an '
  'event (BP cycle-1 resubmit / BP intake / BP issue) that has not occurred '
  'yet. The UI marks these as projections rather than firm dates.';

-- ---------------------------------------------------------------------------
-- 1. Policy lookup, tenant-explicit
-- ---------------------------------------------------------------------------
-- The 2-arg form is kept for backwards compatibility (auth-scoped callers).
-- The 3-arg form takes an explicit tenant so engine paths that run without a
-- JWT (scraper / service_role / cron) still see the configured policy.
CREATE OR REPLACE FUNCTION public.bp_target_submit_offset(
  p_type text,
  p_jurisdiction text,
  p_tenant uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_offset integer;
BEGIN
  SELECT offset_days INTO v_offset
  FROM public.target_submit_formulas
  WHERE type = p_type
    AND (
      CASE WHEN p_tenant IS NOT NULL
           THEN tenant_id = p_tenant
           ELSE tenant_id = ANY (auth_tenant_ids())
      END
    )
    AND (jurisdiction = v_juris OR jurisdiction IS NULL)
  -- Per-jurisdiction override wins over the Base (jurisdiction IS NULL) row.
  ORDER BY (jurisdiction IS NULL), tenant_id
  LIMIT 1;
  RETURN v_offset;
END;
$function$;

-- Existing 2-arg signature delegates to the new one with no explicit tenant.
CREATE OR REPLACE FUNCTION public.bp_target_submit_offset(
  p_type text,
  p_jurisdiction text
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.bp_target_submit_offset(p_type, p_jurisdiction, NULL::uuid);
$function$;

-- ---------------------------------------------------------------------------
-- 1a. bp_learn_target_submit_days — POLICY FIRST
-- ---------------------------------------------------------------------------
-- Signature gains a trailing p_tenant DEFAULT NULL. The old 3-arg form must be
-- dropped first: keeping both would make a 3-arg call ambiguous.
DROP FUNCTION IF EXISTS public.bp_learn_target_submit_days(text, text, text);

CREATE OR REPLACE FUNCTION public.bp_learn_target_submit_days(
  p_type text,
  p_juris text,
  p_anchor text,
  p_tenant uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy  integer;
  v_avg     integer;
  v_default integer;
  v_windows integer[] := ARRAY[90, 180, 365, NULL]::integer[];
  v_w       integer;
BEGIN
  IF p_anchor NOT IN (
    'dd_end','go_date','bp_c0_intake','bp_c1_resub','bp_actual_issue'
  ) THEN RETURN NULL; END IF;

  -- ==== TIER 1 (fix-249): configured policy ALWAYS wins. ====
  -- Was tier 2, below the learner, which made it unreachable for any
  -- (type, juris) cohort with even one historical permit.
  v_policy := bp_target_submit_offset(p_type, p_juris, p_tenant);
  IF v_policy IS NOT NULL THEN RETURN v_policy; END IF;

  -- ==== TIER 2: learner — only fills gaps where no policy row exists. ====
  -- Intentionally unchanged (still AVG, still no minimum sample size). This
  -- path is now reachable only for a (type, juris) with NO configured offset;
  -- the display-only benchmark below is the one that got the median + n>=3
  -- treatment. Left as-is to keep this migration's behaviour change to
  -- exactly the precedence flip.
  FOREACH v_w IN ARRAY v_windows LOOP

    IF p_anchor = 'dd_end' THEN
      SELECT AVG(c0.submitted - p.dd_end)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND p.dd_end IS NOT NULL
        AND ABS(c0.submitted - p.dd_end) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'go_date' THEN
      SELECT AVG(c0.submitted - pr.go_date)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND pr.go_date IS NOT NULL
        AND ABS(c0.submitted - pr.go_date) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_c0_intake' THEN
      SELECT AVG(c0.submitted - bp_c0.intake_accepted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      JOIN permit_cycles bp_c0
        ON bp_c0.permit_id = bp.id AND bp_c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp_c0.intake_accepted IS NOT NULL
        AND ABS(c0.submitted - bp_c0.intake_accepted) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_c1_resub' THEN
      SELECT AVG(c0.submitted - bp_c1.resubmitted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      JOIN permit_cycles bp_c1
        ON bp_c1.permit_id = bp.id AND bp_c1.cycle_index = 1
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp_c1.resubmitted IS NOT NULL
        AND ABS(c0.submitted - bp_c1.resubmitted) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_actual_issue' THEN
      SELECT AVG(c0.submitted - bp.actual_issue)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id, bp.actual_issue
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
          AND bp.actual_issue IS NOT NULL
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp.actual_issue IS NOT NULL
        AND ABS(c0.submitted - bp.actual_issue) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));
    END IF;

    IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;
  END LOOP;

  -- ==== TIER 3: hardcoded ultimate fallback. ====
  v_default := CASE p_type
    WHEN 'Building Permit' THEN 21
    WHEN 'Demolition'      THEN 37
    WHEN 'ECA Waiver'      THEN 10
    WHEN 'IPR'             THEN 7
    WHEN 'ULS'             THEN 7
    WHEN 'LBA'             THEN 37
    WHEN 'Short Plat'      THEN 37
    WHEN 'SIP'             THEN 37
    WHEN 'PAR/Pre-Sub'     THEN 10
    WHEN 'SDOT Tree'       THEN 10
    WHEN 'TRAO'            THEN 10
    WHEN 'Condo'           THEN 129
    ELSE NULL
  END;
  RETURN v_default;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1b. bp_learn_days — POLICY FIRST
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.bp_learn_days(text, text, text);

CREATE OR REPLACE FUNCTION public.bp_learn_days(
  p_type text,
  p_juris text,
  p_milestone text,
  p_tenant uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_avg              integer;
  v_default          integer;
  v_tenant_default   integer;
  v_tenant_c1_offset integer;
  v_windows          integer[] := ARRAY[90, 180, 365, NULL]::integer[];
  v_w                integer;
BEGIN
  IF p_milestone NOT IN ('intake_to_approval', 'c1_resub_offset') THEN
    RETURN NULL;
  END IF;

  -- ==== TIER 1 (fix-249): tenant policy table beats the learner. ====
  -- Was tier 5, below the recency cascade, therefore unreachable.
  -- Tenant resolved explicitly when supplied so the no-JWT engine paths
  -- (scraper / service_role) see the same policy a logged-in user does.
  SELECT intake_to_approval_days, c1_resub_offset_days
    INTO v_tenant_default, v_tenant_c1_offset
    FROM permit_type_defaults
    WHERE type = p_type
      AND (
        CASE WHEN p_tenant IS NOT NULL
             THEN tenant_id = p_tenant
             ELSE tenant_id = ANY (auth_tenant_ids())
        END
      )
    ORDER BY tenant_id
    LIMIT 1;

  IF p_milestone = 'c1_resub_offset' THEN
    IF v_tenant_c1_offset IS NOT NULL THEN RETURN v_tenant_c1_offset; END IF;
    -- NOTE: c1_resub_offset_days is NULL for every type today, so this hop is
    -- unpoliced and lands on intake_to_approval_days / 3 (=70 for a BP). That
    -- derived value is what fabricates the "BP cycle-1 resubmit" anchor for
    -- IPR / ULS. fix-249 exposes c1_resub_offset_days in Settings so it can be
    -- set explicitly; until it is, the /3 heuristic stands and the resulting
    -- target is flagged target_submit_is_projected.
    IF v_tenant_default IS NOT NULL THEN RETURN v_tenant_default / 3; END IF;
  ELSIF v_tenant_default IS NOT NULL THEN
    RETURN v_tenant_default;
  END IF;

  -- ==== TIER 2: learner — gap filler only. ====
  FOREACH v_w IN ARRAY v_windows LOOP
    IF p_milestone = 'intake_to_approval' THEN
      SELECT AVG(p.approval_date - c0.intake_accepted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND p.approval_date IS NOT NULL
        AND c0.intake_accepted IS NOT NULL
        AND p.approval_date >= c0.intake_accepted
        AND (v_w IS NULL OR p.approval_date >= (CURRENT_DATE - v_w));
    ELSE
      SELECT AVG(c1.resubmitted - c0.intake_accepted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN permit_cycles c1
        ON c1.permit_id = p.id AND c1.cycle_index = 1
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.intake_accepted IS NOT NULL
        AND c1.resubmitted IS NOT NULL
        AND c1.resubmitted >= c0.intake_accepted
        AND (v_w IS NULL OR c1.resubmitted >= (CURRENT_DATE - v_w));
    END IF;
    IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;
  END LOOP;

  -- ==== TIER 3: hardcoded ultimate fallback. ====
  v_default := CASE p_type
    WHEN 'Building Permit'    THEN 210
    WHEN 'Demolition'         THEN 60
    WHEN 'ULS'                THEN 90
    WHEN 'IPR'                THEN 30
    WHEN 'LBA'                THEN 120
    WHEN 'Condo'              THEN 180
    WHEN 'Short Plat'         THEN 180
    WHEN 'SIP'                THEN 60
    WHEN 'SDOT Tree'          THEN 45
    WHEN 'TRAO'               THEN 30
    WHEN 'PAR/Pre-Sub'        THEN 30
    ELSE 210
  END;
  IF p_milestone = 'c1_resub_offset' THEN
    RETURN v_default / 3;
  END IF;
  RETURN v_default;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1c. bp_target_submit_benchmark — display-only, MEDIAN, min sample 3
-- ---------------------------------------------------------------------------
-- Read-only. Never feeds a date. SECURITY INVOKER so the caller's RLS applies
-- to permits/projects, plus an explicit auth_tenant_ids() guard mirroring the
-- other read RPCs.
--
-- percentile_cont(0.5) is cast to numeric BEFORE round() on purpose:
-- round(double precision) uses rint() = banker's rounding, which would turn
-- the 8-sample TRAO median 98.5 into 98. round(numeric) rounds half away from
-- zero -> 99. The tests pin this.
CREATE OR REPLACE FUNCTION public.bp_target_submit_benchmark(
  p_type text,
  p_juris text,
  p_anchor text
)
RETURNS TABLE (
  median_days   integer,
  n             integer,
  min_days      integer,
  max_days      integer,
  window_label  text,
  total_samples integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_windows integer[] := ARRAY[90, 180, 365, NULL]::integer[];
  v_w       integer;
  v_total   integer := 0;
  v_days    integer[];
BEGIN
  IF p_anchor NOT IN (
    'dd_end','go_date','bp_c0_intake','bp_c1_resub','bp_actual_issue'
  ) THEN RETURN; END IF;

  -- Tenant guard: a caller with no tenant membership sees nothing.
  IF COALESCE(array_length(auth_tenant_ids(), 1), 0) = 0 THEN RETURN; END IF;

  FOREACH v_w IN ARRAY v_windows LOOP
    SELECT array_agg(s.days) INTO v_days FROM (
      SELECT (c0.submitted - (
                CASE p_anchor
                  WHEN 'dd_end'          THEN p.dd_end
                  WHEN 'go_date'         THEN pr.go_date
                  WHEN 'bp_c0_intake'    THEN bp_c0.intake_accepted
                  WHEN 'bp_c1_resub'     THEN bp_c1.resubmitted
                  WHEN 'bp_actual_issue' THEN bp.actual_issue
                END
             )) AS days
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      LEFT JOIN LATERAL (
        SELECT b.id, b.actual_issue
        FROM permits b
        WHERE b.project_id = p.project_id
          AND b.type = 'Building Permit'
          AND (p_anchor <> 'bp_actual_issue' OR b.actual_issue IS NOT NULL)
        ORDER BY b.id ASC LIMIT 1
      ) bp ON p_anchor IN ('bp_c0_intake','bp_c1_resub','bp_actual_issue')
      LEFT JOIN permit_cycles bp_c0
        ON bp_c0.permit_id = bp.id AND bp_c0.cycle_index = 0
      LEFT JOIN permit_cycles bp_c1
        ON bp_c1.permit_id = bp.id AND bp_c1.cycle_index = 1
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND p.tenant_id = ANY (auth_tenant_ids())
        AND c0.submitted IS NOT NULL
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w))
    ) s
    WHERE s.days IS NOT NULL
      -- Same symmetric outlier cap the learner uses.
      AND ABS(s.days) <= 730;

    IF v_w IS NULL THEN
      v_total := COALESCE(array_length(v_days, 1), 0);
    END IF;

    -- Minimum sample size 3 — a window built on one or two permits is noise,
    -- and showing it as a number implies a precision that isn't there.
    IF COALESCE(array_length(v_days, 1), 0) >= 3 THEN
      RETURN QUERY
        SELECT round(
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY d)::numeric
               )::integer,
               COUNT(*)::integer,
               MIN(d)::integer,
               MAX(d)::integer,
               CASE WHEN v_w IS NULL THEN 'all_time'
                    ELSE 'last_' || v_w || 'd' END,
               GREATEST(v_total, COUNT(*)::integer)
        FROM unnest(v_days) AS d;
      RETURN;
    END IF;
  END LOOP;

  -- Nothing reached n>=3: NULL median/n so the UI says "not enough history"
  -- instead of printing a number derived from one or two permits.
  RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::integer,
                      NULL::integer, 'insufficient'::text, v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_target_submit_benchmark(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_target_submit_benchmark(text, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1d/1e. bp_recompute_target_submits — tenant threading + projection flag
-- ---------------------------------------------------------------------------
-- ANCHORS ARE UNCHANGED. The CASE block below is the same mapping as before:
--   Grading / Clearing, LSM -> BP.target_submit  (mirror)
--   Demolition              -> bp_c0_intake
--   IPR, ULS                -> bp_c1_resub       (explicitly kept — Bobby was
--                                                 asked and chose to keep the
--                                                 BP cycle-1 resubmit anchor)
--   ECA Waiver, LBA, Short Plat, SIP,
--   PAR/Pre-Sub, SDOT Tree, TRAO -> go_date
--   Condo                   -> bp_actual_issue
-- The only changes are (a) the tenant argument passed to the learn helpers and
-- (b) tracking whether the anchor used was itself a projection.
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
  v_bp_target         date;
  v_bp_is_manual      boolean;
  v_bp_c0_intake      date;
  v_bp_c0_submitted   date;
  v_bp_c1_resub       date;
  v_proj_intake       date;
  v_proj_c1_resub     date;
  v_proj_issue        date;
  -- fix-249: does the derived anchor stand on an event that hasn't happened?
  v_intake_projected  boolean := false;
  v_c1_projected      boolean := false;
  v_issue_projected   boolean := false;
  v_projected         boolean;
  v_permit            RECORD;
  v_candidate         date;
  v_offset            integer;
  v_updated           integer := 0;
BEGIN
  IF p_project_id IS NULL THEN RETURN 0; END IF;
  v_prev_depth := COALESCE(NULLIF(current_setting('bp.target_submit_engine_depth', true), '')::int, 0);
  PERFORM set_config('bp.target_submit_engine_depth', (v_prev_depth + 1)::text, true);

  -- fix-249: tenant read from the project, not from auth.uid(). The engine
  -- runs under service_role from the scraper, where auth.uid() is NULL.
  SELECT go_date, juris, tenant_id
    INTO v_go, v_juris, v_tenant
    FROM projects WHERE id = p_project_id;

  SELECT id, dd_end, actual_issue, target_submit, target_submit_is_manual
    INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_target, v_bp_is_manual
    FROM permits WHERE project_id = p_project_id AND type = 'Building Permit' ORDER BY id ASC LIMIT 1;
  IF v_bp_id IS NOT NULL THEN
    SELECT intake_accepted, submitted INTO v_bp_c0_intake, v_bp_c0_submitted FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 0;
    SELECT resubmitted INTO v_bp_c1_resub FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 1;
  END IF;

  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false) THEN
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
    SELECT id, dd_end, target_submit, target_submit_is_manual
    FROM permits WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;
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
    -- A BP target hangs off its own real dd_end — never a projection.
    UPDATE permits SET target_submit_is_projected = false
      WHERE id = v_permit.id AND target_submit_is_projected IS DISTINCT FROM false;
  END LOOP;

  -- Derived anchors. Each COALESCE that falls to its right-hand side is
  -- standing on an event that has not occurred yet.
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

  -- A projected intake poisons everything downstream of it.
  v_c1_projected    := v_c1_projected    OR v_intake_projected;
  v_issue_projected := v_issue_projected OR v_intake_projected;

  FOR v_permit IN
    SELECT p.id, p.type, p.target_submit, p.target_submit_is_manual,
           p.target_submit_is_projected, c0.submitted AS c0_submitted
    FROM permits p LEFT JOIN permit_cycles c0 ON c0.permit_id = p.id AND c0.cycle_index = 0
    WHERE p.project_id = p_project_id AND p.type <> 'Building Permit'
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;
    IF v_permit.c0_submitted IS NOT NULL THEN
      -- Already submitted: the "target" is the actual date. Never projected.
      v_candidate := v_permit.c0_submitted;
      v_projected := false;
    ELSE
      v_candidate := CASE v_permit.type
        WHEN 'Grading / Clearing' THEN v_bp_target
        WHEN 'LSM' THEN v_bp_target
        WHEN 'Demolition' THEN CASE WHEN v_proj_intake IS NOT NULL THEN v_proj_intake + COALESCE(bp_learn_target_submit_days('Demolition', v_juris, 'bp_c0_intake', v_tenant), 37) ELSE NULL END
        WHEN 'ECA Waiver' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('ECA Waiver', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'IPR' THEN CASE WHEN v_proj_c1_resub IS NOT NULL THEN v_proj_c1_resub + COALESCE(bp_learn_target_submit_days('IPR', v_juris, 'bp_c1_resub', v_tenant), 7) ELSE NULL END
        WHEN 'ULS' THEN CASE WHEN v_proj_c1_resub IS NOT NULL THEN v_proj_c1_resub + COALESCE(bp_learn_target_submit_days('ULS', v_juris, 'bp_c1_resub', v_tenant), 7) ELSE NULL END
        WHEN 'LBA' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('LBA', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'Short Plat' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('Short Plat', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'SIP' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('SIP', v_juris, 'go_date', v_tenant), 37) ELSE NULL END
        WHEN 'PAR/Pre-Sub' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('PAR/Pre-Sub', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'SDOT Tree' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('SDOT Tree', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'TRAO' THEN CASE WHEN v_go IS NOT NULL THEN v_go + COALESCE(bp_learn_target_submit_days('TRAO', v_juris, 'go_date', v_tenant), 10) ELSE NULL END
        WHEN 'Condo' THEN CASE WHEN v_proj_issue IS NOT NULL THEN v_proj_issue + COALESCE(bp_learn_target_submit_days('Condo', v_juris, 'bp_actual_issue', v_tenant), 129) ELSE NULL END
        ELSE NULL
      END;

      -- Projection follows the anchor the type actually used.
      v_projected := CASE v_permit.type
        WHEN 'Grading / Clearing' THEN false
        WHEN 'LSM'                THEN false
        WHEN 'Demolition'         THEN v_intake_projected
        WHEN 'IPR'                THEN v_c1_projected
        WHEN 'ULS'                THEN v_c1_projected
        WHEN 'Condo'              THEN v_issue_projected
        ELSE false  -- go_date-anchored types stand on a real, recorded GO date
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

COMMIT;
