-- ===========================================================================
-- fix-640 — EVERY OPEN REVIEWER SHOWS A DUE DATE, ESTIMATED WHEN THE CITY
--           GIVES NONE                                                P-335
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-11: "i want to show due dates. even if past due, this is our
--    queue to go follow up with a reviewer. especially in 2+ rounds of reviews.
--    if we do not know a review target date, maybe we can think of a smart way
--    to create one? average review timeline for that discipline, in that
--    jurisdiction, for that permit type, for that review cycle?"
--
-- READ-ONLY. No row is written by this file.
--
-- ---------------------------------------------------------------------------
-- 1. `permit_cycle_reviewers_current` carries `target_date`
-- ---------------------------------------------------------------------------
-- fix-638 fetched it from the table in a second request because the view
-- stopped at `updated_at`. APPENDED (CREATE OR REPLACE VIEW may only add
-- columns at the end); `security_invoker = true` restated so RLS still scopes
-- it. Its one reader (`useAllPermitCycleReviewers`) selects `*`; no SQL object
-- depends on the view (checked 2026-10-11).
--
-- ---------------------------------------------------------------------------
-- 2. ★★★ THE ESTIMATE IS LEARNED BY THE ONE LEARNER — fix-585
-- ---------------------------------------------------------------------------
-- The brief asked for "one read-only estimator function" computing its own
-- medians. fix-585's standing rule is that there is ONE duration learner,
-- `bp_duration_stats`, and its census test fails any new SQL function that
-- aggregates durations without reading it (the grandfather list is
-- shrink-only). So the review length is learned THERE, as a new clock, and
-- the estimator only READS its cells:
--
--   clock       = 'reviewer_review:<discipline key>'  (discipline rides in the
--                 clock, so the learner's return type and grouping sets are
--                 untouched)
--   cycle_index = the ROUND: 1, or 2 for every later cycle ("round 2+")
--   type        = the permit type, AND '*' — each sample is emitted twice so
--                 "drop the permit type" is still a within-jurisdiction cell
--   days        = round start → the reviewer's verdict
--                 · round start = that cycle's permit_cycles.submitted —
--                   fix-253's start of the CITY phase of a cycle
--                 · verdict = last_event_date of an approved /
--                   corrections_required row (no reviewer history table
--                   exists; a verdict row's last event IS the verdict)
--   guards      = the learner's own: 0–730 days; a project with no
--                 jurisdiction learns nothing.
--
-- ★★ ONLY WHEN ASKED FOR BY NAME. The branch runs for p_clock =
--    'reviewer_review' and NOT for a NULL clock, so `bp_learned_durations()`
--    (which passes NULL and ships every row to the client) is byte-for-byte
--    what it was. `bp_learn_days_explain` and `bp_correction_odds` pass their
--    own clocks and never see it either.
--
-- ★★ PATCHED BY ANCHOR against the live text (fix-410's rule — never retype a
--    live function): the branch is inserted before the `ok AS (` CTE, inside
--    the samples UNION. The DO block refuses to run if the anchor is missing
--    or appears more than once, and is a no-op if the branch is already in.
--
-- ---------------------------------------------------------------------------
-- 3. `bp_reviewer_due_estimates(p_ids uuid[])` — reads the learner
-- ---------------------------------------------------------------------------
-- For each given OPEN reviewer with a discipline, a jurisdiction and a round
-- start, the first cell — in the learner's own recency ladder, 90d → 180d →
-- 365d → all-time, n >= 5 (fix-585's LEARN_MIN_SAMPLES) — at:
--   1. discipline × jurisdiction × permit type × round
--   2. discipline × jurisdiction × permit type
--   3. discipline × jurisdiction (any type)
-- ★★★ THE BRIEF'S 4TH LEVEL ("drop the jurisdiction") IS NOT BUILT. Bobby,
--     2026-09-29 (fix-585): "NO CROSS-JURISDICTION TIER … a city never borrows
--     another city's history." Measured on prod 2026-10-11 it answered 0 of the
--     67 estimates anyway.
-- No cell qualifies → no estimate, no line.
-- ESTIMATED DUE = round start + the median, in CALENDAR days.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The view carries target_date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.permit_cycle_reviewers_current
WITH (security_invoker = true)
AS
SELECT r.id,
       r.tenant_id,
       r.permit_id,
       r.cycle_index,
       r.reviewer_name,
       r.discipline,
       r.current_status,
       r.last_event_date,
       r.created_at,
       r.updated_at,
       r.target_date
  FROM public.permit_cycle_reviewers r
 WHERE r.cycle_index = (
         SELECT max(r2.cycle_index)
           FROM public.permit_cycle_reviewers r2
          WHERE r2.permit_id = r.permit_id);

-- ---------------------------------------------------------------------------
-- 2a. The discipline key — one spelling per discipline ("land_use" = "Land Use")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_reviewer_discipline_key(p_discipline text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(btrim(regexp_replace(replace(lower(COALESCE(p_discipline, '')), '_', ' '), '\s+', ' ', 'g')), '');
$function$;

-- ---------------------------------------------------------------------------
-- 2b. The learner learns the reviewer clock (patched by anchor)
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def    text := pg_get_functiondef('public.bp_duration_stats(uuid,text,text)'::regprocedure);
  v_anchor text := '  ),' || chr(10) || '  ok AS (';
  v_branch text := $branch$
    UNION ALL
    SELECT t.ptype2, b.pjuris, CASE WHEN r.cycle_index <= 1 THEN 1 ELSE 2 END,
           'reviewer_review:' || public.bp_reviewer_discipline_key(r.discipline),
           (r.last_event_date - pc.submitted), r.last_event_date
    FROM base b
    JOIN permit_cycle_reviewers r ON r.permit_id = b.permit_id
    JOIN permit_cycles pc ON pc.permit_id = r.permit_id AND pc.cycle_index = r.cycle_index
    CROSS JOIN LATERAL (VALUES (b.ptype), ('*'::text)) t(ptype2)
    WHERE p_clock = 'reviewer_review'
      AND r.current_status IN ('approved', 'corrections_required')
      AND public.bp_reviewer_discipline_key(r.discipline) IS NOT NULL
      AND pc.submitted IS NOT NULL
      AND r.last_event_date IS NOT NULL
$branch$;
  v_hits   integer;
BEGIN
  IF position('reviewer_review' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-640: bp_duration_stats already learns reviewer_review — no change';
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-640: anchor found % times in bp_duration_stats (expected 1) — re-read the live definition', v_hits;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_branch || v_anchor);
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3. The estimator — reads the learner, aggregates nothing itself
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_reviewer_due_estimates(p_ids uuid[])
RETURNS TABLE(
  reviewer_id   uuid,
  round_start   date,
  estimated_due date,
  typical_days  integer,
  sample_n      integer,
  basis_level   integer,
  window_tier   text,
  juris         text,
  discipline    text,
  permit_type   text,
  round_label   text
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH targets AS (
    SELECT r.id,
           r.tenant_id,
           pc.submitted                                     AS start_d,
           pr.juris                                         AS juris,
           p.type                                           AS ptype,
           r.discipline                                     AS dlabel,
           public.bp_reviewer_discipline_key(r.discipline)  AS dkey,
           CASE WHEN r.cycle_index <= 1 THEN 1 ELSE 2 END   AS rnd
      FROM public.permit_cycle_reviewers r
      JOIN public.permits p        ON p.id = r.permit_id
      LEFT JOIN public.projects pr ON pr.id = p.project_id
      LEFT JOIN public.permit_cycles pc
             ON pc.permit_id = r.permit_id AND pc.cycle_index = r.cycle_index
     WHERE r.id = ANY (p_ids)
       AND r.current_status IN ('assigned', 'in_process', 'in_review', 'pending')
       AND pc.submitted IS NOT NULL
       AND pr.juris IS NOT NULL
       AND public.bp_reviewer_discipline_key(r.discipline) IS NOT NULL
  ),
  cells AS (
    SELECT tn.tenant_id AS tid, s.*
      FROM (SELECT DISTINCT tenant_id FROM targets) tn
      CROSS JOIN LATERAL public.bp_duration_stats(tn.tenant_id, NULL, 'reviewer_review') s
  ),
  ladder (tier, ord) AS (
    VALUES ('90d', 1), ('180d', 2), ('365d', 3), ('all', 4)
  )
  SELECT t.id,
         t.start_d,
         t.start_d + pick.median_days,
         pick.median_days,
         pick.n,
         pick.lvl,
         pick.window_tier,
         t.juris,
         t.dlabel,
         t.ptype,
         CASE t.rnd WHEN 1 THEN 'round 1' ELSE 'round 2+' END
    FROM targets t
    CROSS JOIN LATERAL (
      SELECT c.lvl, c.median_days, c.n, c.window_tier
        FROM (
          SELECT 1 AS lvl, s.median_days, s.n, s.window_tier, l.ord
            FROM cells s JOIN ladder l ON l.tier = s.window_tier
           WHERE s.tid = t.tenant_id AND s.clock = 'reviewer_review:' || t.dkey
             AND s.juris = t.juris AND s.type = t.ptype
             AND s.scope = 'type_juris_cycle' AND s.cycle_index = t.rnd
             AND s.n >= 5
          UNION ALL
          SELECT 2, s.median_days, s.n, s.window_tier, l.ord
            FROM cells s JOIN ladder l ON l.tier = s.window_tier
           WHERE s.tid = t.tenant_id AND s.clock = 'reviewer_review:' || t.dkey
             AND s.juris = t.juris AND s.type = t.ptype
             AND s.scope = 'type_juris'
             AND s.n >= 5
          UNION ALL
          SELECT 3, s.median_days, s.n, s.window_tier, l.ord
            FROM cells s JOIN ladder l ON l.tier = s.window_tier
           WHERE s.tid = t.tenant_id AND s.clock = 'reviewer_review:' || t.dkey
             AND s.juris = t.juris AND s.type = '*'
             AND s.scope = 'type_juris'
             AND s.n >= 5
        ) c
       ORDER BY c.lvl, c.ord
       LIMIT 1
    ) pick;
$function$;

COMMENT ON FUNCTION public.bp_reviewer_due_estimates(uuid[]) IS
  'fix-640 (P-335): for the given OPEN reviewer ids, round start (cycle submitted) '
  '+ the reviewer_review median from bp_duration_stats (fix-585''s one learner), '
  'first qualifying cell of: discipline x juris x type x round, then x type, then '
  'discipline x juris; each walking 90d/180d/365d/all at n >= 5. Never crosses '
  'jurisdictions. Read-only, invoker rights.';

REVOKE ALL ON FUNCTION public.bp_reviewer_discipline_key(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_reviewer_discipline_key(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_reviewer_due_estimates(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_reviewer_due_estimates(uuid[]) TO authenticated, service_role;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It writes no row. Estimates are computed on read and never stored.
-- 2. It does not change what bp_duration_stats returns for any existing clock,
--    nor for a NULL clock — the new branch answers only 'reviewer_review'.
-- 3. It does not overwrite a city date: the popover prefers `target_date`, and
--    asks for an estimate only when there is none or when the "target" is the
--    slot's own open date (`target_date = last_event_date`).
-- 4. It never borrows across jurisdictions (Bobby, 2026-09-29).
