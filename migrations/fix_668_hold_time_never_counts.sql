-- ===========================================================================
-- fix-668 (P-024) — HOLD TIME NEVER COUNTS, ON THE SERVER'S CLOCKS TOO
-- ===========================================================================
--
-- Bobby, 2026-10-13: *"Hold time never counts."*
--
-- The client clocks read `lib/holdOverlap` (accountableDays / holdAdjustedDue).
-- These are the SERVER clocks that measured our time with raw date arithmetic:
--
--   bp_duration_stats            the one learner (fix-585). OUR clocks only:
--                                our_turnaround, intake_to_approval,
--                                c1_resub_offset. The CITY's clocks
--                                (city_review, city_late, reviewer_review) are
--                                the city's facts and are NOT touched.
--   bp_learn_target_submit_days  the target_submit learner fallback (policy
--                                still wins — fix-249).
--   bp_target_submit_benchmark   the same samples, for the Settings display.
--   bp_phase_durations           Phase Durations report — the 'ours' side
--   bp_phase_duration_grid       only; 'city' is the city's clock.
--   bp_get_weekly_da_report      already hid OPEN project holds (fix-170); now
--                                hides an open PERMIT hold too.
--   bp_weekly_snapshot_for       the Weekly Update's ages: past target submit,
--                                corrections waiting on us, approved awaiting
--                                issuance. "Awaiting intake" (the city's) and
--                                resubmit-by (the city's rule, already parked
--                                by fix-646) are untouched.
--
-- ★★★ ONE DEFINITION. `bp_held_days(permit, from, to)` is the SQL twin of
--     `heldOverlapDays`: the days in [from, to) inside any hold window over
--     the permit — its project's `hold` rows plus its own permit holds —
--     UNIONED (a day held twice counts once), an open hold running to the
--     Pacific today. A CANCEL row is not a hold and is never read.
--
-- ★★ Every function is patched BY ANCHOR from its LIVE text (fix-410 / fix-425
--    pattern): each anchor must match exactly once or the migration aborts.
--    Re-running is a no-op — a function that already calls bp_held_days is
--    skipped.
--
-- ★★ NO DATA IS WRITTEN. No stored value changes; every number is computed at
--    read time. (The target_submit engine reads the learner when it next runs
--    for a project, exactly as it does today.)

CREATE OR REPLACE FUNCTION public.bp_held_days(p_permit_id integer, p_from date, p_to date)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- fix-668: SQL twin of lib/holdOverlap.ts heldOverlapDays — keep in lockstep.
  WITH w AS (
    SELECT GREATEST(h.hold_start, p_from) AS s,
           LEAST(COALESCE(h.hold_end, public.bp_pacific_today()), p_to) AS e
      FROM public.project_holds h
      JOIN public.permits p ON p.project_id = h.project_id
     WHERE p.id = p_permit_id
       AND h.kind = 'hold'
    UNION ALL
    SELECT GREATEST(ph.hold_start, p_from),
           LEAST(COALESCE(ph.hold_end, public.bp_pacific_today()), p_to)
      FROM public.permit_holds ph
     WHERE ph.permit_id = p_permit_id
  )
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN 0
    ELSE COALESCE((
      SELECT SUM(upper(r) - lower(r))
        FROM unnest((SELECT range_agg(daterange(w.s, w.e)) FROM w WHERE w.e > w.s)) AS r
    ), 0)::integer
  END;
$function$;

REVOKE ALL ON FUNCTION public.bp_held_days(integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_held_days(integer, date, date) TO authenticated, service_role;

-- ★★ THE GUARD. A learner pass touches ~3,000 samples and fewer than 40
--    permits have ever been held; calling bp_held_days on every sample took
--    bp_duration_stats from 56 ms to 1.5 s in the rolled-back proof. Every call
--    site below asks `permit = ANY ((SELECT bp_held_permit_ids())::integer[])` first — the
--    parenthesised sub-select is an InitPlan, evaluated ONCE per query — so an
--    unheld permit costs one hash probe and returns exactly what it did before.
CREATE OR REPLACE FUNCTION public.bp_held_permit_ids()
RETURNS integer[]
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT x.id), '{}'::integer[])
    FROM (
      SELECT p.id
        FROM public.permits p
        JOIN public.project_holds h ON h.project_id = p.project_id AND h.kind = 'hold'
      UNION
      SELECT ph.permit_id FROM public.permit_holds ph
    ) AS x(id);
$function$;

REVOKE ALL ON FUNCTION public.bp_held_permit_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_held_permit_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.fix668_sub(p_def text, p_old text, p_new text, p_label text)
RETURNS text
LANGUAGE plpgsql
AS $f$
DECLARE
  v_n integer := (length(p_def) - length(replace(p_def, p_old, ''))) / length(p_old);
BEGIN
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fix-668: anchor "%" found % times, expected 1', p_label, v_n;
  END IF;
  RETURN replace(p_def, p_old, p_new);
END;
$f$;

-- The guarded held-days expression every patch below inserts.
CREATE OR REPLACE FUNCTION pg_temp.fix668_held(p_pid text, p_from text, p_to text)
RETURNS text
LANGUAGE sql
AS $f$
  SELECT format(
    '(CASE WHEN %s = ANY ((SELECT public.bp_held_permit_ids())::integer[]) THEN public.bp_held_days(%s, %s, %s) ELSE 0 END)',
    p_pid, p_pid, p_from, p_to);
$f$;

DO $$
DECLARE
  v_def text;
BEGIN
  -- ── bp_duration_stats: OUR three clocks ─────────────────────────────────
  v_def := pg_get_functiondef('public.bp_duration_stats(uuid, text, text)'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$(pc.resubmitted - pc.corr_issued), pc.resubmitted$a$,
      $a$(pc.resubmitted - pc.corr_issued)
             - $a$ || pg_temp.fix668_held('b.permit_id', 'pc.corr_issued', 'pc.resubmitted') || $a$, pc.resubmitted$a$,
      'duration_stats/our_turnaround');
    v_def := pg_temp.fix668_sub(v_def,
      $a$(b.approval_date - c0.intake_accepted), b.approval_date$a$,
      $a$(b.approval_date - c0.intake_accepted)
             - $a$ || pg_temp.fix668_held('b.permit_id', 'c0.intake_accepted', 'b.approval_date') || $a$, b.approval_date$a$,
      'duration_stats/intake_to_approval');
    v_def := pg_temp.fix668_sub(v_def,
      $a$(c1.resubmitted - c0.intake_accepted), c1.resubmitted$a$,
      $a$(c1.resubmitted - c0.intake_accepted)
             - $a$ || pg_temp.fix668_held('b.permit_id', 'c0.intake_accepted', 'c1.resubmitted') || $a$, c1.resubmitted$a$,
      'duration_stats/c1_resub_offset');
    EXECUTE v_def;
  END IF;

  -- ── bp_learn_target_submit_days: every anchor → c0.submitted ────────────
  v_def := pg_get_functiondef('public.bp_learn_target_submit_days(text, text, text, uuid)'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$AVG(c0.submitted - p.dd_end)::integer$a$,
      $a$AVG(c0.submitted - p.dd_end - $a$ || pg_temp.fix668_held('p.id', 'p.dd_end', 'c0.submitted') || $a$)::integer$a$,
      'learn_ts/dd_end');
    v_def := pg_temp.fix668_sub(v_def,
      $a$AVG(c0.submitted - pr.go_date)::integer$a$,
      $a$AVG(c0.submitted - pr.go_date - $a$ || pg_temp.fix668_held('p.id', 'pr.go_date', 'c0.submitted') || $a$)::integer$a$,
      'learn_ts/go_date');
    v_def := pg_temp.fix668_sub(v_def,
      $a$AVG(c0.submitted - bp_c0.intake_accepted)::integer$a$,
      $a$AVG(c0.submitted - bp_c0.intake_accepted - $a$ || pg_temp.fix668_held('p.id', 'bp_c0.intake_accepted', 'c0.submitted') || $a$)::integer$a$,
      'learn_ts/bp_c0_intake');
    v_def := pg_temp.fix668_sub(v_def,
      $a$AVG(c0.submitted - bp_c1.resubmitted)::integer$a$,
      $a$AVG(c0.submitted - bp_c1.resubmitted - $a$ || pg_temp.fix668_held('p.id', 'bp_c1.resubmitted', 'c0.submitted') || $a$)::integer$a$,
      'learn_ts/bp_c1_resub');
    v_def := pg_temp.fix668_sub(v_def,
      $a$AVG(c0.submitted - bp.actual_issue)::integer$a$,
      $a$AVG(c0.submitted - bp.actual_issue - $a$ || pg_temp.fix668_held('p.id', 'bp.actual_issue', 'c0.submitted') || $a$)::integer$a$,
      'learn_ts/bp_actual_issue');
    EXECUTE v_def;
  END IF;

  -- ── bp_target_submit_benchmark: the same samples, for display ───────────
  v_def := pg_get_functiondef('public.bp_target_submit_benchmark(text, text, text)'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$SELECT array_agg(s.days) INTO v_days FROM ($a$,
      $a$SELECT array_agg(s.days - $a$ || pg_temp.fix668_held('s.pid', 's.anchor_on', 's.sub_on') || $a$) INTO v_days FROM ($a$,
      'benchmark/array_agg');
    v_def := pg_temp.fix668_sub(v_def,
      $a$)) AS days$a$,
      $a$)) AS days,
             p.id AS pid,
             c0.submitted AS sub_on,
             (CASE p_anchor
                WHEN 'dd_end'          THEN p.dd_end
                WHEN 'go_date'         THEN pr.go_date
                WHEN 'bp_c0_intake'    THEN bp_c0.intake_accepted
                WHEN 'bp_c1_resub'     THEN bp_c1.resubmitted
                WHEN 'bp_actual_issue' THEN bp.actual_issue
              END) AS anchor_on$a$,
      'benchmark/days');
    EXECUTE v_def;
  END IF;

  -- ── bp_phase_durations / _grid: the 'ours' side only ───────────────────
  v_def := pg_get_functiondef('public.bp_phase_durations(text, text, integer, text, integer)'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$WHEN 'ours' THEN (pc.resubmitted  - pc.corr_issued)$a$,
      $a$WHEN 'ours' THEN (pc.resubmitted  - pc.corr_issued)
                            - $a$ || pg_temp.fix668_held('pc.permit_id', 'pc.corr_issued', 'pc.resubmitted'),
      'phase_durations/ours');
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.bp_phase_duration_grid(integer)'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$(pc.resubmitted - pc.corr_issued) AS ours_days$a$,
      $a$(pc.resubmitted - pc.corr_issued)
             - $a$ || pg_temp.fix668_held('pc.permit_id', 'pc.corr_issued', 'pc.resubmitted') || $a$ AS ours_days$a$,
      'phase_grid/ours');
    EXECUTE v_def;
  END IF;

  -- ── bp_get_weekly_da_report: an open PERMIT hold is held work too ───────
  v_def := pg_get_functiondef('public.bp_get_weekly_da_report(date, integer, jsonb)'::regprocedure);
  IF position('permit_holds' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$          AND ph.hold_end IS NULL
      )$a$,
      $a$          AND ph.hold_end IS NULL
      )
      -- fix-668: a permit's own open hold parks it too (one-way: the permit only).
      AND NOT EXISTS (
        SELECT 1 FROM public.permit_holds pph
        WHERE pph.permit_id = p.id
          AND pph.hold_end IS NULL
      )$a$,
      'weekly_da/permit_hold');
    EXECUTE v_def;
  END IF;

  -- ── bp_weekly_snapshot_for: OUR ages leave held days out ────────────────
  v_def := pg_get_functiondef('public.bp_weekly_snapshot_for(uuid[])'::regprocedure);
  IF position('bp_held_days' IN v_def) = 0 THEN
    v_def := pg_temp.fix668_sub(v_def,
      $a$l.status, l.target_submit, (v_today - l.target_submit)$a$,
      $a$l.status, l.target_submit,
           (v_today - l.target_submit) - $a$ || pg_temp.fix668_held('l.id', 'l.target_submit', 'v_today'),
      'snapshot/b_age');
    v_def := pg_temp.fix668_sub(v_def,
      $a$WHERE l.target_submit < v_today AND c0.submitted IS NULL$a$,
      $a$WHERE l.target_submit + $a$ || pg_temp.fix668_held('l.id', 'l.target_submit', 'v_today') || $a$ < v_today
       AND c0.submitted IS NULL$a$,
      'snapshot/b_where');
    v_def := pg_temp.fix668_sub(v_def,
      $a$l.status, x.corr_issued, (v_today - x.corr_issued)$a$,
      $a$l.status, x.corr_issued,
           (v_today - x.corr_issued) - $a$ || pg_temp.fix668_held('l.id', 'x.corr_issued', 'v_today'),
      'snapshot/d_age');
    v_def := pg_temp.fix668_sub(v_def,
      $a$AND x.corr_issued < v_today - 7$a$,
      $a$AND (v_today - x.corr_issued) - $a$ || pg_temp.fix668_held('l.id', 'x.corr_issued', 'v_today') || $a$ > 7$a$,
      'snapshot/d_where');
    v_def := pg_temp.fix668_sub(v_def,
      $a$l.status, l.approval_date, (v_today - l.approval_date)$a$,
      $a$l.status, l.approval_date,
           (v_today - l.approval_date) - $a$ || pg_temp.fix668_held('l.id', 'l.approval_date', 'v_today'),
      'snapshot/e_age');
    EXECUTE v_def;
  END IF;
END;
$$;
