-- ===========================================================================
-- fix-401 — THE LAST ROSTER TABLE JOINS THE PUBLICATION
-- ===========================================================================
--
-- Bobby, 2026-08-25: *"I don't know if our UI is updating when we're making
-- these updates back to the settings … we just really want to make sure that
-- this thing is holistically and globally reflecting as a true ecosystem."*
--
-- It was not. Thirty files read `dm_da_groups` — the dm derivation (fix-379),
-- the board lens (fix-365), DM co-assignment (fix-346/368), draw-schedule
-- grouping, the wizard's routing — and none of the three roster tables was
-- listed in the client's REALTIME_TABLES. A team move invalidated exactly one
-- query key in the one tab that made it.
--
-- ★★★ fix-393'S LESSON, IN MIRROR IMAGE. fix-393 established: adding a
-- REALTIME_TABLES key is HALF the job, because a subscription to an unpublished
-- table is silent. Measured on prod 2026-08-25, the OTHER half had failed here:
--
--   dm_da_groups                  published ✓   client key ✗
--   team_members                  published ✓   client key ✗
--   draw_schedule_quarter_layout  published ✗   client key ✗
--
-- Two of the three have been emitting to nobody. A publication with no listener
-- is exactly as silent as a listener with no publication, and neither side logs
-- anything. ★★ CHECK BOTH HALVES — that is the rule this migration exists to
-- write down. The client keys ship in the same PR (src/lib/queryKeys.ts).
--
-- ★ So this migration publishes exactly ONE table. The other two need no DDL.
--
-- ★★ RLS, checked per fix-393's discipline. All three carry `tenant_id`, have
-- RLS enabled with 2 policies, and are `default` (primary key) replica
-- identity — the same shape as `permits`, whose realtime demonstrably works.
-- Realtime evaluates the SUBSCRIBER's own RLS before delivering, so nothing
-- crosses a tenant boundary.
--
-- ★ REPLICA IDENTITY IS LEFT ALONE, for fix-391's reason: the policies key on
-- tenant_id, which is present in the NEW record of every INSERT and UPDATE, so
-- FULL would buy an old_record nobody reads at the cost of wider WAL rows.
--
-- ★ NO ROW IS WRITTEN. Publication membership is DDL.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = 'draw_schedule_quarter_layout'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draw_schedule_quarter_layout;
  END IF;
END
$$;

-- Prove all three are members rather than assuming the ALTER did what it says.
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES
    ('dm_da_groups'),
    ('team_members'),
    ('draw_schedule_quarter_layout')
  ) AS x(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = x.t
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'fix-401: still missing from supabase_realtime: %', v_missing;
  END IF;
END
$verify$;
