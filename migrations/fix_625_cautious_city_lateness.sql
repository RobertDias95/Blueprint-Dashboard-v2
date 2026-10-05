-- fix-625 (P-319): the city-lateness figure is the cautious one, and a thin
-- window can't swing it.
--
-- Bobby, 2026-10-05: "Cautious, as you ruled." fix-622 re-anchors a missed
-- city review date at today + the city_late clock's MEDIAN, picked by
-- fix-585's ladder (newest window with n >= 5) — which let Seattle Demolition
-- read 83 days on 10 recent rounds against 10 all-time.
--
-- §A  bp_duration_stats (THE one learner, fix-585) gains one output column,
--     p80_days — the 80th percentile, computed beside the median in the same
--     aggregate. A new OUT column cannot be added by CREATE OR REPLACE, so the
--     function is DROPPED and CREATED in this transaction. Dependents, found
--     on 2026-10-05 (pg_depend tracks none; these are the bodies that name it):
--       bp_learn_days_explain   SELECT s.* INTO v_row (RECORD) — an extra
--                               column is harmless; NOT touched.
--       bp_learned_durations    SELECT s.* into a fixed 8-column return —
--                               RESTATED with the 8 columns listed, so its
--                               output (what the client reads) is unchanged.
--       bp_correction_odds      reads the cautious figure — RESTATED (below).
--     Every existing column, clock and row is unchanged; only p80_days is new.
--
-- §B  For city_late ONLY, a recent window is used when it has at least 30 late
--     rounds; otherwise all-time; all-time with fewer than 5 → no lateness
--     (the estimate plans from today and says so). Other clocks keep fix-585's
--     ladder untouched (that ladder lives in bp_learn_days_explain and the
--     client, neither of which changes).
--     ★ WHY 30, NOT THE BRIEF'S 20 (measured 2026-10-05): at 20, Seattle
--       Demolition's 180-day window qualifies (29 rounds) and its 80th
--       percentile is 100 days — still swung. At 30 it falls to 365 days (66
--       rounds, p80 19, all-time 19). Every other row picks the same window at
--       20 and at 30, so 30 changes exactly the row the brief named.
--     ★ THE SWING IS A DEFINITION ARTIFACT, reported not changed: the recent
--       Seattle Demolition tail is entirely rounds whose "answer" is the
--       permit's APPROVAL (24 rounds, p80 108, max 211) — a demolition is
--       usually approved alongside its Building Permit, so that date measures
--       the BP's wait, not the city's review. Rounds answered by corrections
--       read p80 14. Redefining the clock is Bobby's call (see the PR).

BEGIN;

DO $guard$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_duration_stats(uuid,text,text)'::regprocedure))
     <> 'cb0055de5400c8c49374aa674cd8fd53' THEN
    RAISE EXCEPTION 'fix-625: bp_duration_stats() is not the fix-622 body read on 2026-10-05 — STOP';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_learned_durations()'::regprocedure))
     <> 'e9fd3fdf127b01a2af6c78dc65428248' THEN
    RAISE EXCEPTION 'fix-625: bp_learned_durations() is not the body read on 2026-10-05 — STOP';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_correction_odds()'::regprocedure))
     <> '385cc4582974801e4cb5282170e31a67' THEN
    RAISE EXCEPTION 'fix-625: bp_correction_odds() is not the fix-622 body read on 2026-10-05 — STOP';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- §A  The one learner, with p80_days.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.bp_duration_stats(uuid, text, text);

CREATE FUNCTION public.bp_duration_stats(p_tenant uuid, p_type text DEFAULT NULL::text, p_clock text DEFAULT NULL::text)
 RETURNS TABLE(type text, juris text, cycle_index integer, clock text, scope text, window_tier text, n integer, median_days integer, p80_days integer)
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
    UNION ALL
    -- ★ fix-622 §B: the CITY'S LATENESS, per cycle — its own review date
    --   (city_target) → its answer (that cycle's corr_issued, or the approval
    --   when it was the permit's last cycle). LATE answers only: "how late does
    --   the city run once it has missed its own date".
    SELECT b.ptype, b.pjuris, pc.cycle_index, 'city_late',
           (COALESCE(pc.corr_issued, CASE WHEN pc.cycle_index = lc.last_ci THEN b.approval_date END)
              - pc.city_target),
           COALESCE(pc.corr_issued, CASE WHEN pc.cycle_index = lc.last_ci THEN b.approval_date END)
    FROM base b
    JOIN permit_cycles pc ON pc.permit_id = b.permit_id AND pc.cycle_index >= 1
    JOIN (SELECT pcl.permit_id, max(pcl.cycle_index) AS last_ci
            FROM permit_cycles pcl GROUP BY pcl.permit_id) lc ON lc.permit_id = b.permit_id
    WHERE (p_clock IS NULL OR p_clock = 'city_late')
      AND pc.city_target IS NOT NULL
      AND COALESCE(pc.corr_issued, CASE WHEN pc.cycle_index = lc.last_ci THEN b.approval_date END)
            > pc.city_target
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
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::numeric)::integer AS median_days,
      -- ★ fix-625: the CAUTIOUS end — the 80th percentile, rounded the same way.
      round(percentile_cont(0.8) WITHIN GROUP (ORDER BY days)::numeric)::integer AS p80_days
    FROM win
    GROUP BY GROUPING SETS (
      (ptype, pjuris, ci, clk, window_tier),
      (ptype, pjuris, clk, window_tier)
    )
  )
  SELECT ptype, pjuris, ci, clk, scope, window_tier, n, median_days, p80_days
  FROM cells
  WHERE
    -- whole-permit clocks carry ci = NULL, so their "cycle" grouping set is a
    -- duplicate of the type×juris one — drop it.
    NOT (clk IN ('intake_to_approval', 'c1_resub_offset') AND scope = 'type_juris_cycle')
    -- a project with no juris has no jurisdiction to learn for.
    AND pjuris IS NOT NULL;
$function$;

-- The learner's ACL, restated after the DROP (authenticated, service_role; never anon).
REVOKE ALL ON FUNCTION public.bp_duration_stats(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_duration_stats(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bp_learned_durations — the same 8 columns the client reads, now listed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_learned_durations()
 RETURNS TABLE(type text, juris text, cycle_index integer, clock text, scope text, window_tier text, n integer, median_days integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ★ fix-625: the learner gained p80_days; this keeps its 8 columns.
  SELECT s.type, s.juris, s.cycle_index, s.clock, s.scope, s.window_tier, s.n, s.median_days
  FROM unnest(auth_tenant_ids()) AS t(tenant_id)
  CROSS JOIN LATERAL public.bp_duration_stats(t.tenant_id) s;
$function$;

-- ---------------------------------------------------------------------------
-- bp_correction_odds — the CAUTIOUS lateness, with the city_late ladder (§B).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_correction_odds()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scoped AS (
    SELECT p.id AS permit_id, p.type, pr.juris,
           (p.approval_date IS NOT NULL OR p.actual_issue IS NOT NULL) AS approved
      FROM public.permits p
      JOIN public.projects pr ON pr.id = p.project_id
     WHERE p.tenant_id = ANY (public.auth_tenant_ids())
  ),
  round_keys AS (
    SELECT pc.permit_id, pc.cycle_index AS n
      FROM public.permit_cycles pc
      JOIN scoped s ON s.permit_id = pc.permit_id
     WHERE pc.cycle_index >= 1 AND pc.corr_issued IS NOT NULL
    UNION
    SELECT ci.permit_id, ci.cycle
      FROM public.correction_items ci
      JOIN scoped s ON s.permit_id = ci.permit_id
     WHERE ci.cycle >= 1
  ),
  letters AS (
    SELECT ci.permit_id, ci.cycle AS n,
           count(*) FILTER (WHERE ci.is_correction) AS n_corr
      FROM public.correction_items ci
      JOIN scoped s ON s.permit_id = ci.permit_id
     WHERE ci.cycle >= 1
     GROUP BY 1, 2
  ),
  -- fix-622: reviewers asking for corrections, per (permit, round).
  reviewers AS (
    SELECT r.permit_id, r.cycle_index AS n,
           count(*) FILTER (WHERE r.current_status = 'corrections_required') AS n_rev
      FROM public.permit_cycle_reviewers r
      JOIN scoped s ON s.permit_id = r.permit_id
     WHERE r.cycle_index >= 1
     GROUP BY 1, 2
  ),
  rounds AS (
    SELECT s.permit_id, s.type, s.juris, s.approved, k.n,
           l.n_corr,                                   -- NULL = no parsed letter
           NULLIF(rv.n_rev, 0) AS n_rev,               -- NULL = no reviewer signal
           EXISTS (SELECT 1 FROM round_keys k2
                    WHERE k2.permit_id = k.permit_id AND k2.n > k.n) AS another_round
      FROM round_keys k
      JOIN scoped s ON s.permit_id = k.permit_id
      LEFT JOIN letters l ON l.permit_id = k.permit_id AND l.n = k.n
      LEFT JOIN reviewers rv ON rv.permit_id = k.permit_id AND rv.n = k.n
  ),
  resolved AS (
    SELECT type, juris,
           CASE WHEN n_corr <= 1  THEN '1'
                WHEN n_corr <= 3  THEN '2-3'
                WHEN n_corr <= 6  THEN '4-6'
                WHEN n_corr <= 10 THEN '7-10'
                ELSE '11+' END AS bucket,
           (NOT another_round AND approved) AS approved_next
      FROM rounds
     WHERE n_corr IS NOT NULL
       AND (another_round OR approved)
  ),
  cells AS (
    SELECT type, juris, bucket,
           count(*)::int AS resolved_rounds,
           count(*) FILTER (WHERE approved_next)::int AS approved_next
      FROM resolved
     WHERE juris IS NOT NULL
     GROUP BY 1, 2, 3
  ),
  -- fix-622: the same, keyed on how many reviewers asked for corrections.
  reviewer_resolved AS (
    SELECT type, juris,
           CASE WHEN n_rev >= 4 THEN '4+' ELSE n_rev::text END AS bucket,
           (NOT another_round AND approved) AS approved_next
      FROM rounds
     WHERE n_rev IS NOT NULL
       AND (another_round OR approved)
  ),
  reviewer_cells AS (
    SELECT type, juris, bucket,
           count(*)::int AS resolved_rounds,
           count(*) FILTER (WHERE approved_next)::int AS approved_next
      FROM reviewer_resolved
     WHERE juris IS NOT NULL
     GROUP BY 1, 2, 3
  ),
  -- ★★ fix-625: how late the city answers once past its own review date — the
  --    CAUTIOUS end (the learner's p80_days), never computed here. city_late's
  --    own ladder: a recent window needs >= 30 late rounds, else all-time;
  --    all-time with fewer than 5 → no row (the estimate plans from today).
  lateness AS (
    SELECT DISTINCT ON (ls.type, ls.juris)
           ls.type, ls.juris, ls.n AS late_rounds,
           ls.p80_days AS cautious_days, ls.median_days AS typical_days, ls.window_tier
      FROM unnest(public.auth_tenant_ids()) AS t(tenant_id)
      CROSS JOIN LATERAL public.bp_duration_stats(t.tenant_id, NULL, 'city_late') ls
     WHERE ls.scope = 'type_juris'
       AND ls.p80_days > 0
       AND ((ls.window_tier <> 'all' AND ls.n >= 30) OR (ls.window_tier = 'all' AND ls.n >= 5))
     ORDER BY ls.type, ls.juris,
              CASE ls.window_tier WHEN '90d' THEN 1 WHEN '180d' THEN 2 WHEN '365d' THEN 3 ELSE 4 END
  ),
  latest AS (
    SELECT DISTINCT ON (permit_id) permit_id, n, n_corr, n_rev
      FROM rounds
     WHERE NOT approved
     ORDER BY permit_id, n DESC
  )
  SELECT jsonb_build_object(
    'cells', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'type', type, 'juris', juris, 'bucket', bucket,
                'resolved_rounds', resolved_rounds, 'approved_next', approved_next))
              FROM cells), '[]'::jsonb),
    'permits', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'permit_id', permit_id, 'round', n, 'correction_count', n_corr,
                'reviewer_count', n_rev))
              FROM latest), '[]'::jsonb),
    'reviewer_cells', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'type', type, 'juris', juris, 'bucket', bucket,
                'resolved_rounds', resolved_rounds, 'approved_next', approved_next))
              FROM reviewer_cells), '[]'::jsonb),
    'lateness', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'type', type, 'juris', juris, 'late_rounds', late_rounds,
                'cautious_days', cautious_days, 'typical_days', typical_days,
                'window_tier', window_tier))
              FROM lateness), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.bp_correction_odds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_correction_odds() TO authenticated;
REVOKE ALL ON FUNCTION public.bp_learned_durations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_learned_durations() TO authenticated, service_role;

DO $check$
BEGIN
  IF has_function_privilege('anon', 'public.bp_duration_stats(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bp_learned_durations()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bp_correction_odds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-625: anon can execute a learner function';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.bp_duration_stats(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bp_learned_durations()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.bp_correction_odds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-625: authenticated lost EXECUTE on a learner function';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_duration_stats(uuid,text,text)'::regprocedure)
     NOT LIKE '%p80_days%' THEN
    RAISE EXCEPTION 'fix-625: bp_duration_stats() has no p80_days';
  END IF;
END
$check$;

COMMIT;
