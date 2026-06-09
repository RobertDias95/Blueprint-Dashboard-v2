-- fix-141 backfill (2026-06-09): normalise the handful of dd_end rows that
-- violate the Monday(start) / Friday(end) DD-week convention.
--
-- Scope is tiny by design: start_week, end_week, and dd_start are already 100%
-- Monday in prod (the 6605 lane was hand-fixed this morning), and dd_end is
-- correctly Friday (= end-week Monday + 4) for 221 rows. We do NOT mass-snap
-- dd_end — that would corrupt those 221 correct Friday rows. We only fix:
--
--   1. dd_end values that are neither Monday nor Friday (1 permit: 272,
--      7726 44th Ave NE, dd_end 2026-03-10 Tue -> 2026-03-13 Fri).
--   2. The 6605 57th Ave NE morning hotfix, which set dd_end to the end-week
--      MONDAY (2026-07-13) to make the lane visible. The lane fix really lives
--      in start_week/dd_start (now Monday via the slot-fn fix); dd_end belongs
--      on the end-week Friday like the other 178 rows. permit 10220 + the
--      project's draw_schedule row: 2026-07-13 Mon -> 2026-07-17 Fri. Scoped by
--      project_id so the other 28 legitimate Monday-to-Monday dd_end spans are
--      left untouched.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_141_backfill_monday_snap_dd_dates". This file is the repo record.

-- Preview / audit-trail count (captured in the migration log).
DO $$
DECLARE
  v_anom_permits int; v_anom_ds int; v_6605_permits int; v_6605_ds int;
BEGIN
  SELECT count(*) INTO v_anom_permits FROM public.permits
    WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);
  SELECT count(*) INTO v_anom_ds FROM public.draw_schedule
    WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);
  SELECT count(*) INTO v_6605_permits FROM public.permits
    WHERE project_id = '371214ff-2abc-4267-9a0b-c21ad8683689'
      AND dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int = 1;
  SELECT count(*) INTO v_6605_ds FROM public.draw_schedule
    WHERE project_id = '371214ff-2abc-4267-9a0b-c21ad8683689'
      AND dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int = 1;
  RAISE NOTICE 'fix-141 backfill scope: anomalous dd_end->Friday = % permits / % draw_schedule; 6605 Mon->Fri realign = % permits / % draw_schedule',
    v_anom_permits, v_anom_ds, v_6605_permits, v_6605_ds;
END $$;

-- 1) Anomalous dd_end (neither Monday nor Friday) -> Friday of its ISO week.
--    (5 - ISODOW): Tue(2)->+3, Wed(3)->+2, Thu(4)->+1, Sat(6)->-1, Sun(7)->-2.
UPDATE public.permits
  SET dd_end = dd_end + (5 - EXTRACT(ISODOW FROM dd_end)::int)
  WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);
UPDATE public.draw_schedule
  SET dd_end = dd_end + (5 - EXTRACT(ISODOW FROM dd_end)::int)
  WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);

-- 2) 6605 morning hotfix: end-week MONDAY -> end-week FRIDAY (Monday + 4).
UPDATE public.permits
  SET dd_end = dd_end + 4
  WHERE project_id = '371214ff-2abc-4267-9a0b-c21ad8683689'
    AND dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int = 1;
UPDATE public.draw_schedule
  SET dd_end = dd_end + 4
  WHERE project_id = '371214ff-2abc-4267-9a0b-c21ad8683689'
    AND dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int = 1;

-- Post-backfill verification (captured in the migration log; expect 0 / 0).
DO $$
DECLARE v_bad_permits int; v_bad_ds int;
BEGIN
  SELECT count(*) INTO v_bad_permits FROM public.permits
    WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);
  SELECT count(*) INTO v_bad_ds FROM public.draw_schedule
    WHERE dd_end IS NOT NULL AND EXTRACT(ISODOW FROM dd_end)::int NOT IN (1,5);
  RAISE NOTICE 'fix-141 post-backfill: dd_end neither Mon nor Fri = % permits / % draw_schedule (expect 0 / 0)',
    v_bad_permits, v_bad_ds;
END $$;
