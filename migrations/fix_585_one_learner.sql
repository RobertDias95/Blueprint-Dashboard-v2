-- fix-585: ONE LEARNER, AND THE CYCLE IT IS IN.
--
-- ⚠️ NOT APPLIED BY THE PR. Applied from Cowork after the §5 blast-radius dry
--    run in the PR body has been read. Applying it is NOT inert: the four
--    target_submit triggers roll the new bp_learn_days out on the next write to
--    any project (fix-249's lesson), so the dry run IS the rollout preview.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG (live defs read 2026-09-29, pg_get_functiondef)
-- ---------------------------------------------------------------------------
-- bp_learn_days read permit_type_defaults FIRST and RETURNed (fix-249,
-- "policy beats learner"). permit_type_defaults has a row for all 15 types
-- we permit, so the 90→180→365→all-time ladder below it never ran. A Kirkland
-- BP and a Seattle BP were projected from the same 210. The unreachable ladder
-- also used AVG — one 653-day Demolition dragged its cohort by 19 days.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE: the learner becomes DATA
-- ---------------------------------------------------------------------------
--   bp_duration_stats(tenant, type?, clock?)   one row per cell, MEDIAN + n.
--   bp_learn_days_explain(...)                 walks the ladder over those rows
--                                              and says WHICH TIER answered.
--   bp_learn_days(...)                         = explain(...).days. Signature
--                                              kept, + p_cycle DEFAULT NULL.
--   bp_learned_durations()                     read-only RPC, same rows, for the
--                                              client (fix-586 rewires the UI;
--                                              scheduleBenchmarks.ts untouched).
--
-- The ladder — BOBBY'S RULING 2026-09-29, which OVERRIDES the brief's §3:
--   type×juris×cycle → type×juris → policy → hardcoded
-- ★★★ NO CROSS-JURISDICTION TIER. The brief's (type×cycle) and (type) tiers
--     are removed: a city never borrows another city's history.
-- Each tier walks 90d → 180d → 365d → all-time, a window answering at
-- n >= LEARN_MIN_SAMPLES — EXCEPT the type×juris ALL-TIME window, which answers
-- with whatever history exists (n >= 1): *"if we've only done one project
-- there, we use whatever data we do have."* Zero history → policy.
--
-- ★ The two whole-permit clocks (intake_to_approval, c1_resub_offset) have no
--   cycle cells — c1_resub_offset IS cycle 1 by definition, intake_to_approval
--   spans every cycle. For them the ladder starts at type×juris.
-- ★ This agrees with fix-37, which removed the cross-juris tier from the old
--   client learner for the same reason.
--
-- CONSTANTS (brief §2/§3) — named once, here. src/lib/durationLadder.ts pins
-- the same values and a test asserts they match this file.
--   LEARN_MIN_SAMPLES     = 5
--   LAST_RESORT_MIN_SAMPLES = 1   (type×juris all-time window only)
--   OUR_CLOCK_FLOOR_DAYS  = 3     (our_turnaround only; survivorship at cycle 3+)
--   CLAMP_LOW / CLAMP_HIGH = 0.5 / 2.0 × policy   (only when a policy exists)
--   OUTLIER_CAP_DAYS      = 730   (0 <= days <= 730, same cap as fix-253 and
--                                  scheduleBenchmarks.OUTLIER_HARD_CAP_DAYS)
--
-- ALSO (brief §6, "done is done"): bp_recompute_target_submits skips non-BP
-- permits that are approved or issued. The BP loop never reads bp_learn_days
-- and is left byte-for-byte alone. Patched by ANCHOR against the live text.
--
-- NOT TOUCHED: permit_type_defaults values, bp_learn_target_submit_days,
-- projectedApproval.ts, scheduleBenchmarks.ts, bp_phase_durations(_grid).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bp_duration_stats — the one learner, as rows
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: an authenticated caller is fenced by RLS on permits; the
-- engine (bp_recompute_target_submits, SECURITY DEFINER) passes its project's
-- tenant explicitly because auth_tenant_ids() is empty on the scraper path
-- (fix-249's second bug).
CREATE OR REPLACE FUNCTION public.bp_duration_stats(
  p_tenant uuid,
  p_type   text DEFAULT NULL,
  p_clock  text DEFAULT NULL
)
RETURNS TABLE (
  type        text,
  juris       text,
  cycle_index integer,
  clock       text,
  scope       text,
  window_tier text,
  n           integer,
  median_days integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ★★★ Every cell is WITHIN one jurisdiction (Bobby, 2026-09-29). There is no
  --     cross-juris row to borrow, so no caller can borrow one.
  WITH base AS (
    SELECT p.id AS permit_id, p.type AS ptype, pr.juris AS pjuris, p.approval_date
    FROM permits p
    JOIN projects pr ON pr.id = p.project_id
    WHERE p.tenant_id = p_tenant
      AND (p_type IS NULL OR p.type = p_type)
  ),
  samples AS (
    -- CITY clock, per cycle: submitted → corr_issued
    SELECT b.ptype, b.pjuris, pc.cycle_index AS ci, 'city_review'::text AS clk,
           (pc.corr_issued - pc.submitted) AS days, pc.corr_issued AS ended_on
    FROM base b
    JOIN permit_cycles pc ON pc.permit_id = b.permit_id AND pc.cycle_index >= 1
    WHERE (p_clock IS NULL OR p_clock = 'city_review')
      AND pc.submitted IS NOT NULL AND pc.corr_issued IS NOT NULL
    UNION ALL
    -- OUR clock, per cycle: corr_issued → resubmitted
    SELECT b.ptype, b.pjuris, pc.cycle_index, 'our_turnaround',
           (pc.resubmitted - pc.corr_issued), pc.resubmitted
    FROM base b
    JOIN permit_cycles pc ON pc.permit_id = b.permit_id AND pc.cycle_index >= 1
    WHERE (p_clock IS NULL OR p_clock = 'our_turnaround')
      AND pc.corr_issued IS NOT NULL AND pc.resubmitted IS NOT NULL
    UNION ALL
    -- whole permit: cycle-0 intake_accepted → approval_date
    SELECT b.ptype, b.pjuris, NULL::integer, 'intake_to_approval',
           (b.approval_date - c0.intake_accepted), b.approval_date
    FROM base b
    JOIN permit_cycles c0 ON c0.permit_id = b.permit_id AND c0.cycle_index = 0
    WHERE (p_clock IS NULL OR p_clock = 'intake_to_approval')
      AND b.approval_date IS NOT NULL AND c0.intake_accepted IS NOT NULL
    UNION ALL
    -- whole permit: cycle-0 intake_accepted → cycle-1 resubmitted
    SELECT b.ptype, b.pjuris, NULL::integer, 'c1_resub_offset',
           (c1.resubmitted - c0.intake_accepted), c1.resubmitted
    FROM base b
    JOIN permit_cycles c0 ON c0.permit_id = b.permit_id AND c0.cycle_index = 0
    JOIN permit_cycles c1 ON c1.permit_id = b.permit_id AND c1.cycle_index = 1
    WHERE (p_clock IS NULL OR p_clock = 'c1_resub_offset')
      AND c0.intake_accepted IS NOT NULL AND c1.resubmitted IS NOT NULL
  ),
  ok AS (
    SELECT * FROM samples WHERE days BETWEEN 0 AND 730
  ),
  windows (window_tier, window_days) AS (
    VALUES ('90d', 90), ('180d', 180), ('365d', 365), ('all', NULL::integer)
  ),
  win AS (
    SELECT o.ptype, o.pjuris, o.ci, o.clk, o.days, w.window_tier
    FROM ok o
    JOIN windows w
      ON w.window_days IS NULL OR o.ended_on >= (CURRENT_DATE - w.window_days)
  ),
  cells AS (
    SELECT
      ptype, pjuris, ci, clk, window_tier,
      CASE WHEN GROUPING(ci) = 0 THEN 'type_juris_cycle' ELSE 'type_juris' END AS scope,
      COUNT(*)::integer AS n,
      -- ★ MEDIAN, cast to numeric BEFORE round(): round(double) is banker's
      --   rounding (fix-249's 98.5 → 98). [10,10,10,1000] → 10, not 257.
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::numeric)::integer AS median_days
    FROM win
    GROUP BY GROUPING SETS (
      (ptype, pjuris, ci, clk, window_tier),
      (ptype, pjuris, clk, window_tier)
    )
  )
  SELECT ptype, pjuris, ci, clk, scope, window_tier, n, median_days
  FROM cells
  WHERE
    -- whole-permit clocks carry ci = NULL, so their "cycle" grouping set is a
    -- duplicate of the type×juris one — drop it.
    NOT (clk IN ('intake_to_approval', 'c1_resub_offset') AND scope = 'type_juris_cycle')
    -- a project with no juris has no jurisdiction to learn for.
    AND pjuris IS NOT NULL;
$function$;

COMMENT ON FUNCTION public.bp_duration_stats(uuid, text, text) IS
  'fix-585: THE one duration learner. One row per (type, juris, cycle_index, '
  'clock, scope, window_tier) with n and MEDIAN days (0..730). bp_learn_days '
  'and bp_learned_durations read this; nothing else may compute a duration '
  'median (census test: DurationLearnerCensusFix585).';

-- ---------------------------------------------------------------------------
-- 2. bp_learn_days_explain — the ladder, and which rung answered
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_learn_days_explain(
  p_type      text,
  p_juris     text,
  p_milestone text,
  p_tenant    uuid    DEFAULT NULL,
  p_cycle     integer DEFAULT NULL
)
RETURNS TABLE (
  days         integer,
  tier         text,     -- type_juris_cycle | type_juris | policy | hardcoded | none
  window_tier  text,     -- 90d | 180d | 365d | all | NULL
  n            integer,
  learned_days integer,  -- the raw median before floor/clamp; NULL off the learned tiers
  policy_days  integer,
  clamped      boolean
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- ★ The brief's constants, named once (mirrored in src/lib/durationLadder.ts).
  c_learn_min_samples    CONSTANT integer := 5;
  c_last_resort_min      CONSTANT integer := 1;
  c_our_clock_floor_days CONSTANT integer := 3;
  c_clamp_low            CONSTANT numeric := 0.5;
  c_clamp_high           CONSTANT numeric := 2.0;

  v_tenant           uuid;
  v_i2a              integer;
  v_c1               integer;
  v_policy           integer;
  v_default          integer;
  v_row              RECORD;
  v_floored          integer;
  v_days             integer;
BEGIN
  IF p_milestone NOT IN ('intake_to_approval', 'c1_resub_offset',
                         'city_review', 'our_turnaround') THEN
    RETURN;
  END IF;

  -- Tenant: explicit wins (engine path, no JWT). Otherwise the caller's.
  v_tenant := p_tenant;
  IF v_tenant IS NULL THEN
    SELECT t INTO v_tenant FROM unnest(auth_tenant_ids()) t ORDER BY t LIMIT 1;
  END IF;

  -- Policy: the guardrail. Same lookup fix-249 used, unchanged.
  SELECT intake_to_approval_days, c1_resub_offset_days
    INTO v_i2a, v_c1
    FROM permit_type_defaults
    WHERE permit_type_defaults.type = p_type
      AND (
        CASE WHEN p_tenant IS NOT NULL
             THEN tenant_id = p_tenant
             ELSE tenant_id = ANY (auth_tenant_ids())
        END
      )
    ORDER BY tenant_id
    LIMIT 1;

  v_policy := CASE p_milestone
    WHEN 'intake_to_approval' THEN v_i2a
    -- c1_resub_offset_days is NULL for every type today → the /3 heuristic.
    WHEN 'c1_resub_offset'    THEN COALESCE(v_c1, v_i2a / 3)
    -- the two per-cycle clocks have no policy column.
    ELSE NULL
  END;

  -- ==== TIERS 1–2: this jurisdiction's history, most specific first. ====
  -- ★★★ s.juris = p_juris on BOTH tiers: never another city's median.
  IF v_tenant IS NOT NULL THEN
    SELECT s.* INTO v_row
    FROM bp_duration_stats(v_tenant, p_type, p_milestone) s
    WHERE s.juris = p_juris
      AND (
           (s.scope = 'type_juris_cycle' AND s.cycle_index = p_cycle)
        OR  s.scope = 'type_juris'
      )
      AND (
           s.n >= c_learn_min_samples
        -- ★ "if we've only done one project there, we use whatever data we do
        --   have" — the type×juris ALL-TIME window is the last resort.
        OR (s.scope = 'type_juris' AND s.window_tier = 'all' AND s.n >= c_last_resort_min)
      )
    ORDER BY
      CASE s.scope
        WHEN 'type_juris_cycle' THEN 1
        WHEN 'type_juris'       THEN 2
        ELSE 3
      END,
      CASE s.window_tier
        WHEN '90d'  THEN 1
        WHEN '180d' THEN 2
        WHEN '365d' THEN 3
        ELSE 4
      END
    LIMIT 1;

    IF FOUND THEN
      v_floored := v_row.median_days;
      -- ★ DO NOT BAKE IN THE ZERO: cycle 3–4 OUR-clock medians are
      --   survivorship-biased ("trivial correction, resubmitted same day").
      IF p_milestone = 'our_turnaround' THEN
        v_floored := GREATEST(v_floored, c_our_clock_floor_days);
      END IF;
      v_days := v_floored;
      -- ★ Policy is the CLAMP: one weird cohort cannot move a target by a year.
      IF v_policy IS NOT NULL THEN
        v_days := LEAST(GREATEST(v_days, round(v_policy * c_clamp_low)::integer),
                        round(v_policy * c_clamp_high)::integer);
      END IF;
      RETURN QUERY SELECT v_days, v_row.scope, v_row.window_tier, v_row.n,
                          v_row.median_days, v_policy, (v_days <> v_floored);
      RETURN;
    END IF;
  END IF;

  -- ==== TIER 5: policy, the fallback. ====
  IF v_policy IS NOT NULL THEN
    RETURN QUERY SELECT v_policy, 'policy'::text, NULL::text, 0, NULL::integer,
                        v_policy, false;
    RETURN;
  END IF;

  -- ==== TIER 6: hardcoded, whole-permit clocks only (unchanged table). ====
  IF p_milestone IN ('intake_to_approval', 'c1_resub_offset') THEN
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
    IF p_milestone = 'c1_resub_offset' THEN v_default := v_default / 3; END IF;
    RETURN QUERY SELECT v_default, 'hardcoded'::text, NULL::text, 0,
                        NULL::integer, NULL::integer, false;
    RETURN;
  END IF;

  -- ★ A per-cycle clock with no history and no policy has NO number. Say so.
  RETURN QUERY SELECT NULL::integer, 'none'::text, NULL::text, 0,
                      NULL::integer, NULL::integer, false;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. bp_learn_days — same answer, one scalar. Gains p_cycle.
-- ---------------------------------------------------------------------------
-- The 4-arg form must be DROPPED, not left beside the 5-arg one: two
-- overloads make a 4-arg call ambiguous (fix-438's PostgREST trap). Every
-- existing caller (bp_recompute_target_submits) passes 4 positional args and
-- resolves to the new function through the DEFAULT.
DROP FUNCTION IF EXISTS public.bp_learn_days(text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.bp_learn_days(
  p_type      text,
  p_juris     text,
  p_milestone text,
  p_tenant    uuid    DEFAULT NULL,
  p_cycle     integer DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.days
  FROM public.bp_learn_days_explain(p_type, p_juris, p_milestone, p_tenant, p_cycle) e;
$function$;

-- ---------------------------------------------------------------------------
-- 4. bp_learned_durations — the same rows, for the client
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_learned_durations()
RETURNS TABLE (
  type        text,
  juris       text,
  cycle_index integer,
  clock       text,
  scope       text,
  window_tier text,
  n           integer,
  median_days integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.*
  FROM unnest(auth_tenant_ids()) AS t(tenant_id)
  CROSS JOIN LATERAL public.bp_duration_stats(t.tenant_id) s;
$function$;

-- Grants: never anon (fix-157). New functions default to EXECUTE for PUBLIC.
REVOKE ALL ON FUNCTION public.bp_duration_stats(uuid, text, text)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_learn_days_explain(text, text, text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_learn_days(text, text, text, uuid, integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_learned_durations()                               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_duration_stats(uuid, text, text)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_learn_days_explain(text, text, text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_learn_days(text, text, text, uuid, integer)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_learned_durations()                               TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. bp_recompute_target_submits — done is done (non-BP loop only)
-- ---------------------------------------------------------------------------
-- Patched by ANCHOR against the live definition, never retyped (fix-410 /
-- fix-425). Each anchor must occur exactly once or the migration aborts.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.bp_recompute_target_submits(uuid)'::regprocedure);
  v_new text;
  a1 constant text :=
    'p.target_submit_is_projected, c0.submitted AS c0_submitted';
  r1 constant text :=
    'p.target_submit_is_projected, c0.submitted AS c0_submitted, p.approval_date, p.actual_issue';
  a2 constant text :=
    E'    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;\n    IF v_permit.c0_submitted IS NOT NULL THEN';
  r2 constant text :=
    E'    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;\n'
    '    -- fix-585: done is done. An approved or issued permit''s target is history.\n'
    E'    IF v_permit.approval_date IS NOT NULL OR v_permit.actual_issue IS NOT NULL THEN CONTINUE; END IF;\n'
    '    IF v_permit.c0_submitted IS NOT NULL THEN';
BEGIN
  IF position('fix-585' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-585: bp_recompute_target_submits already patched';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 THEN
    RAISE EXCEPTION 'fix-585: anchor a1 not found exactly once in bp_recompute_target_submits';
  END IF;
  IF (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'fix-585: anchor a2 not found exactly once in bp_recompute_target_submits';
  END IF;
  v_new := replace(replace(v_def, a1, r1), a2, r2);
  EXECUTE v_new;
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 6. Post-conditions — assert the change LANDED (fix-540)
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'bp_learn_days') <> 1 THEN
    RAISE EXCEPTION 'fix-585: bp_learn_days must have exactly one overload';
  END IF;
  IF position('bp_learn_days_explain' IN
       pg_get_functiondef('public.bp_learn_days(text,text,text,uuid,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fix-585: bp_learn_days does not read the ladder';
  END IF;
  IF position('fix-585' IN
       pg_get_functiondef('public.bp_recompute_target_submits(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fix-585: recompute guard did not land';
  END IF;
END;
$check$;

COMMIT;
