-- fix-253: phase-duration model. READ-ONLY — this migration changes no dates.
--
-- ============================================================================
-- THIS MIGRATION MUST NOT CHANGE ANY target_submit VALUE.
-- It adds two read-only functions and touches nothing else. It does not modify
-- bp_recompute_target_submits, bp_learn_target_submit_days, bp_learn_days, or
-- any trigger. Rewiring the engine is fix-254, gated on review of these
-- numbers. fix-249's bp_target_submit_benchmark is left untouched — this is
-- additive alongside it, not a replacement.
-- ============================================================================
--
-- THE MODEL
-- ---------
-- A permit's schedule is a chain of alternating phases, each with an OWNER,
-- measured per cycle:
--
--   target_submit --[CITY: review]--> corr_issued
--                 --[OURS: turnaround]--> resubmitted
--                 --[CITY: review]--> corr_issued --> ... --> approval
--
-- Both sides compress sharply each round, which a single flat per-type offset
-- cannot represent. Verified on prod 2026-07-28, Seattle Building Permits:
--
--   cycle 1: CITY 72 (n=81) | OURS 24 (n=76)
--   cycle 2: CITY 25 (n=63) | OURS 13 (n=60)
--   cycle 3: CITY 19 (n=18) | OURS  5 (n=12)
--
-- THE TWO RULES (kept strictly separate — see fix-254)
-- ----------------------------------------------------
--   CITY-owned phases -> OBSERVED REALITY. We do not control the city, so a
--   "policy" is meaningless. Resolution order is (1) the portal's published
--   permit_cycles.city_target for that cycle, (2) the learned median this
--   function returns, (3) a per-type default.
--
--   OURS-owned phases -> POLICY (the fix-249 rule, unchanged). A standard we
--   hold ourselves to, with the learned median shown alongside as the +/-
--   benchmark.
--
-- That resolves the apparent contradiction with fix-249: "policy always wins"
-- is right for OUR half of the chain, and the learner is right for the CITY's
-- half. They only appeared to fight because the engine does not yet
-- distinguish the two.
--
-- STRUCTURAL FACTS CONFIRMED ON PROD (2026-07-28)
-- ----------------------------------------------
--   * cycle_index 0 carries ONLY submitted + intake_accepted — zero
--     city_target / corr_issued / resubmitted rows across all 419 cycle-0
--     records. The review/turnaround chain therefore starts at cycle_index 1,
--     which is what these functions scan.
--   * Cycle 0's submitted -> intake_accepted span IS a real city-owned phase
--     (Seattle BP median 6d, n=74) but it is a different shape from the
--     review/turnaround pair and is deliberately NOT modelled here. Flagged
--     for fix-254, where it matters for the Demolition anchor.
--   * Exactly one negative city duration exists in the data, and no span
--     exceeds 730 days. Zero-day phases are real and common (25/305 city,
--     15/250 ours — same-day turnarounds) and are KEPT.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Per-cohort phase durations
-- ---------------------------------------------------------------------------
-- p_side:
--   'city' -> submitted   -> corr_issued   (the city reviewing our submittal)
--   'ours' -> corr_issued -> resubmitted   (us turning corrections around)
--
-- Returns n even when it is below the gate, so callers can say "not enough
-- history (n=2)" instead of printing a median built on one or two permits.
-- median_days is NULL in that case. NOTE this differs deliberately from
-- fix-249's bp_target_submit_benchmark, which nulls n as well; here the raw
-- count is the more useful signal.
CREATE OR REPLACE FUNCTION public.bp_phase_durations(
  p_type text,
  p_juris text,
  p_cycle_index integer,
  p_side text,
  p_recent_days integer DEFAULT 180
)
RETURNS TABLE (
  median_days        integer,
  n                  integer,
  min_days           integer,
  max_days           integer,
  recent_median_days integer,
  recent_n           integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_side NOT IN ('city', 'ours') THEN RETURN; END IF;
  -- The chain starts at cycle 1; cycle 0 is intake-only (see header).
  IF p_cycle_index IS NULL OR p_cycle_index < 1 THEN RETURN; END IF;

  -- Tenant guard, matching the other read RPCs.
  IF COALESCE(array_length(auth_tenant_ids(), 1), 0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH src AS (
    SELECT
      CASE p_side
        WHEN 'city' THEN (pc.corr_issued  - pc.submitted)
        WHEN 'ours' THEN (pc.resubmitted  - pc.corr_issued)
      END AS days,
      -- The date the phase ENDED — what "recent" is measured against.
      CASE p_side
        WHEN 'city' THEN pc.corr_issued
        WHEN 'ours' THEN pc.resubmitted
      END AS ended_on
    FROM permit_cycles pc
    JOIN permits  p  ON p.id  = pc.permit_id
    JOIN projects pr ON pr.id = p.project_id
    WHERE p.type = p_type
      AND pr.juris = p_juris
      AND pc.cycle_index = p_cycle_index
      AND p.tenant_id = ANY (auth_tenant_ids())
  ),
  ok AS (
    -- Same shape of guard the existing learners use: drop NULL endpoints,
    -- negative spans (data errors — one exists on prod today) and absurd
    -- durations. Zero-day spans are legitimate same-day activity and stay.
    SELECT days, ended_on
    FROM src
    WHERE days IS NOT NULL
      AND days >= 0
      AND days <= 730
  )
  SELECT
    CASE WHEN COUNT(*) >= 3
         THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::numeric)::integer
    END,
    COUNT(*)::integer,
    CASE WHEN COUNT(*) >= 3 THEN MIN(days)::integer END,
    CASE WHEN COUNT(*) >= 3 THEN MAX(days)::integer END,
    CASE WHEN COUNT(*) FILTER (
             WHERE ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
           ) >= 3
         THEN round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY days
              ) FILTER (
                WHERE ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
              )::numeric)::integer
    END,
    COUNT(*) FILTER (
      WHERE ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
    )::integer
  FROM ok;
END;
$function$;

COMMENT ON FUNCTION public.bp_phase_durations(text, text, integer, text, integer) IS
  'fix-253: learned duration of one schedule phase for a (type, jurisdiction, '
  'cycle_index, side) cohort. side=city is submitted->corr_issued, side=ours is '
  'corr_issued->resubmitted. MEDIAN via percentile_cont cast to numeric (round '
  'on double precision is banker''s rounding — fix-249 hit exactly that and it '
  'silently turned 99 into 98). median_days is NULL below n=3; n is always '
  'returned. recent_* repeat the stat over a trailing window so trend is '
  'answerable. READ-ONLY: never feeds a date.';

REVOKE ALL ON FUNCTION public.bp_phase_durations(text, text, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_phase_durations(text, text, integer, text, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B. The whole grid in one call
-- ---------------------------------------------------------------------------
-- Every (type, jurisdiction, cycle_index, side) cohort clearing the n>=3 gate,
-- so a report renders in a single round-trip instead of one call per cell.
CREATE OR REPLACE FUNCTION public.bp_phase_duration_grid(
  p_recent_days integer DEFAULT 180
)
RETURNS TABLE (
  type               text,
  juris              text,
  cycle_index        integer,
  side               text,
  median_days        integer,
  n                  integer,
  min_days           integer,
  max_days           integer,
  recent_median_days integer,
  recent_n           integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(array_length(auth_tenant_ids(), 1), 0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH src AS (
    SELECT p.type AS ptype, pr.juris AS pjuris, pc.cycle_index AS ci,
           (pc.corr_issued - pc.submitted)  AS city_days,  pc.corr_issued AS city_end,
           (pc.resubmitted - pc.corr_issued) AS ours_days, pc.resubmitted AS ours_end
    FROM permit_cycles pc
    JOIN permits  p  ON p.id  = pc.permit_id
    JOIN projects pr ON pr.id = p.project_id
    WHERE pc.cycle_index >= 1
      AND p.tenant_id = ANY (auth_tenant_ids())
  ),
  unified AS (
    SELECT ptype, pjuris, ci, 'city'::text AS pside, city_days AS days, city_end AS ended_on
      FROM src WHERE city_days IS NOT NULL AND city_days BETWEEN 0 AND 730
    UNION ALL
    SELECT ptype, pjuris, ci, 'ours'::text, ours_days, ours_end
      FROM src WHERE ours_days IS NOT NULL AND ours_days BETWEEN 0 AND 730
  )
  SELECT u.ptype, u.pjuris, u.ci, u.pside,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY u.days)::numeric)::integer,
         COUNT(*)::integer,
         MIN(u.days)::integer,
         MAX(u.days)::integer,
         CASE WHEN COUNT(*) FILTER (
                  WHERE u.ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
                ) >= 3
              THEN round(percentile_cont(0.5) WITHIN GROUP (
                     ORDER BY u.days
                   ) FILTER (
                     WHERE u.ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
                   )::numeric)::integer
         END,
         COUNT(*) FILTER (
           WHERE u.ended_on >= CURRENT_DATE - COALESCE(p_recent_days, 180)
         )::integer
  FROM unified u
  GROUP BY u.ptype, u.pjuris, u.ci, u.pside
  HAVING COUNT(*) >= 3
  ORDER BY u.pjuris, u.ptype, u.ci, u.pside;
END;
$function$;

COMMENT ON FUNCTION public.bp_phase_duration_grid(integer) IS
  'fix-253: every (type, jurisdiction, cycle_index, side) phase cohort with '
  'n>=3, for the phase-duration report. READ-ONLY: never feeds a date.';

REVOKE ALL ON FUNCTION public.bp_phase_duration_grid(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_phase_duration_grid(integer)
  TO authenticated, service_role;

COMMIT;
