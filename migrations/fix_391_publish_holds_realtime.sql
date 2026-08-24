-- ===========================================================================
-- fix-391 §2 — HOLDS JOIN THE REALTIME PUBLICATION
-- ===========================================================================
--
-- fix-390 found that `project_holds` has been listed in the client's
-- REALTIME_TABLES since fix-167 while NEVER being a member of the
-- `supabase_realtime` publication. The subscription has been silent the whole
-- time: what actually refreshed a hold was the mutation's own invalidation plus
-- fix-371's 60-second fallback poll. Bobby ruled: publish.
--
-- ★★ BOTH TABLES, IN ONE MIGRATION. Publishing only the new one would leave the
-- two scopes behaving differently — the same reasoning fix-390 used for NOT
-- publishing just `permit_holds` then.
--
-- ★★★ THE TRAP THIS CLOSES, RESTATED SO IT IS NOT RE-LEARNED: a subscription to
-- an UNPUBLISHED table raises no error. The channel joins, the handler is
-- registered, nothing ever arrives, and the fallback poll hides it by making
-- the data eventually correct. `pg_publication_tables` is the only place the
-- truth lives — check it before debugging any "realtime isn't working" report.
--
-- ★ REPLICA IDENTITY IS LEFT ALONE. Both tables are `default` (primary key),
-- which is exactly what `permits` and `project_messages` carry — two tables
-- whose realtime demonstrably works today. Our RLS policy keys on `tenant_id`,
-- which is present in the NEW record of every INSERT and UPDATE, so FULL would
-- buy an old_record nobody reads at the cost of wider WAL rows.
--
-- ★★ THE FALLBACK POLL STAYS. fix-371's lesson: a backgrounded tab freezes
-- timers AND drops sockets, so the poll is the floor and the socket is an
-- accelerant. Nothing in this migration touches it.
--
-- ★ NO ROW IS WRITTEN. A publication change is DDL.
--
-- ---------------------------------------------------------------------------
-- ★★ THE AUDIT (reported, NOT fixed here — this ticket ships holds only)
-- ---------------------------------------------------------------------------
-- Of the 24 tables the client lists in REALTIME_TABLES, SEVEN were missing from
-- the publication. This migration adds the two hold tables. The other five are
-- still silent and each is somebody's live expectation:
--
--   error_reports            fix-87 expects a new error to refresh the triage
--                            page and the nav badge "across every open tab"
--   permit_cycle_reviewers   reviewer changes
--   vendor_report_state      fix-265 expects a send in one tab to re-bucket the
--                            forecast in every other tab, so two people cannot
--                            re-send the same "new" projects
--   builders                 catalog
--   external_team_directory  fix-227 expects a firm added in Settings to reach
--                            the per-project picker live
--
-- Each behaves like the holds did: correct within 60 seconds via the poll, never
-- instant. Publishing them is a one-line follow-up per table and wants its own
-- ticket, because each has a blast radius worth thinking about separately.
-- ===========================================================================

-- ★ Idempotent: ALTER PUBLICATION ... ADD TABLE errors if the table is already
-- a member, so each is guarded rather than assumed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = 'project_holds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_holds;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = 'permit_holds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_holds;
  END IF;
END
$$;

-- Prove it landed rather than assuming the ALTER did what it says.
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES ('project_holds'), ('permit_holds')) AS x(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = x.t
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'fix-391: still missing from supabase_realtime: %', v_missing;
  END IF;
END
$verify$;
