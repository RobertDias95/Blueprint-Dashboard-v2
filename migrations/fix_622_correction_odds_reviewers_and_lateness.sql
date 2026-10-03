-- fix-622 (P-300 items 1 and 3): the estimate reads the reviewers when the
-- letter isn't read · it never points at a date that has passed.
--
-- CREATE OR REPLACE of the read-only bp_correction_odds() (fix-614). Still
-- STABLE, SECURITY DEFINER, tenant-scoped, authenticated only. ADDITIVE: three
-- new keys; every fix-614 key is byte-for-byte the same. The client reads a
-- missing key as "no signal", so CI is green and the app is unchanged until
-- this is applied.
--
-- NEW
--   reviewer_cells  per (type × juris × reviewer bucket 1 · 2 · 3 · 4+):
--                   resolved_rounds, approved_next — fix-614's round /
--                   resolved / approved-next definitions exactly, keyed on the
--                   number of reviewers who asked for corrections in round N
--                   instead of the letter's count. No cross-city borrowing.
--   permits[].reviewer_count
--                   reviewers asking for corrections on the permit's latest
--                   round; NULL when none (no reviewer rows, or none of them
--                   currently says corrections_required) — never zero.
--   lateness        per (type × juris): late_rounds, typical_days,
--                   window_tier — how late the city answered once it had
--                   missed its OWN review date (permit_cycles.city_target).
--                   ★★★ READ FROM THE ONE LEARNER (fix-585): a new clock
--                   `city_late` in bp_duration_stats — not a percentile
--                   computed here. fix-585's census allows exactly one
--                   duration learner and its grandfather list is shrink-only,
--                   so a second percentile over durations in this function
--                   would be the third learner it exists to prevent. The
--                   learner reports MEDIANS, so this is the typical lateness,
--                   picked by the learner's ruled ladder (newest window with
--                   n >= 5, else all-time). The brief's "cautious end" (an
--                   80th percentile) would need a percentile column on the
--                   learner itself — flagged in the PR, not done here.
--   bp_duration_stats  CREATE OR REPLACE of the LIVE body (2026-10-03,
--                   md5-guarded) plus one UNION ALL branch: clock 'city_late',
--                   per cycle, days = answer − city_target for LATE answers
--                   only. "Answer" = that cycle's corr_issued, or the permit's
--                   approval when it was the permit's last cycle. Every
--                   existing clock is byte-for-byte unchanged, and every
--                   reader asks for a clock by name (bp_learn_days_explain
--                   passes p_milestone; durationLadder filters on r.clock), so
--                   the new rows reach nobody else.
--
-- STATUS VOCABULARY (measured 2026-10-03, permit_cycle_reviewers.current_status
-- is a closed, normalised set of 7): approved 2,603 · corrections_required 427 ·
-- in_review 182 · not_required 150 · in_process 96 · pending 85 · assigned 68.
-- "Asked for corrections" = 'corrections_required' and nothing else
-- (src/lib/correctionOdds.ts REVIEWER_CORRECTIONS_STATUS; a test pins both).
-- ★ current_status is the LAST status seen, not the status when the letter went
--   out — a reviewer who later approved the resubmittal on the same cycle row
--   reads 'approved'. So history slightly undercounts, and an open round whose
--   reviewers have all moved on reads NULL (no signal), never 0.

BEGIN;

DO $guard$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_correction_odds()'::regprocedure))
     <> 'a73c6e78291a806a80b109b66a97c646'
     AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_correction_odds()'::regprocedure) NOT LIKE '%reviewer_cells%' THEN
    RAISE EXCEPTION 'fix-622: bp_correction_odds() is not the fix-614 body read on 2026-10-03 — STOP';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_duration_stats(uuid,text,text)'::regprocedure))
     <> 'cd5927f1d6494dcc767a1b3ae590168d'
     AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_duration_stats(uuid,text,text)'::regprocedure) NOT LIKE '%city_late%' THEN
    RAISE EXCEPTION 'fix-622: bp_duration_stats() is not the fix-585 body read on 2026-10-03 — STOP';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- The one learner, plus the city_late clock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_duration_stats(p_tenant uuid, p_type text DEFAULT NULL::text, p_clock text DEFAULT NULL::text)
 RETURNS TABLE(type text, juris text, cycle_index integer, clock text, scope text, window_tier text, n integer, median_days integer)
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
  -- fix-622 §B: how late the city answers once past its own review date —
  -- READ FROM THE ONE LEARNER (the city_late clock), never computed here.
  -- The learner's ruled ladder: the newest window with n >= 5, else all-time.
  lateness AS (
    SELECT DISTINCT ON (ls.type, ls.juris)
           ls.type, ls.juris, ls.n AS late_rounds, ls.median_days AS typical_days, ls.window_tier
      FROM unnest(public.auth_tenant_ids()) AS t(tenant_id)
      CROSS JOIN LATERAL public.bp_duration_stats(t.tenant_id, NULL, 'city_late') ls
     WHERE ls.scope = 'type_juris'
       AND ls.median_days > 0
       AND (ls.n >= 5 OR ls.window_tier = 'all')
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
                'typical_days', typical_days, 'window_tier', window_tier))
              FROM lateness), '[]'::jsonb)
  );
$function$;

-- Never anon, never PUBLIC (fix-157). CREATE OR REPLACE keeps the ACL; restated.
REVOKE ALL ON FUNCTION public.bp_correction_odds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_correction_odds() TO authenticated;
-- The learner keeps its ACL (authenticated, service_role; never anon).
REVOKE ALL ON FUNCTION public.bp_duration_stats(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_duration_stats(uuid, text, text) TO authenticated, service_role;

DO $check$
BEGIN
  IF has_function_privilege('anon', 'public.bp_duration_stats(uuid,text,text)', 'EXECUTE')
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.bp_duration_stats(uuid,text,text)'::regprocedure) NOT LIKE '%city_late%' THEN
    RAISE EXCEPTION 'fix-622: bp_duration_stats() not replaced, or anon can execute it';
  END IF;
  IF has_function_privilege('anon', 'public.bp_correction_odds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-622: anon can execute bp_correction_odds()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.bp_correction_odds()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-622: authenticated lost EXECUTE on bp_correction_odds()';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.bp_correction_odds()'::regprocedure) <> 's'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.bp_correction_odds()'::regprocedure) THEN
    RAISE EXCEPTION 'fix-622: bp_correction_odds() must stay STABLE SECURITY DEFINER';
  END IF;
END
$check$;

COMMIT;
