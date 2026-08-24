-- ===========================================================================
-- fix-393 — THE REMAINING REALTIME TABLES, AND THE AUDIT CLOSES
-- ===========================================================================
--
-- fix-391 published the two hold tables and reported five more that the client
-- subscribes to and Postgres never emits. This finishes that audit.
--
-- ★★★ THE BRIEF'S LIST WAS FIVE. IT IS FOUR, AND THE FIFTH IS THE INTERESTING
-- ONE. `builders` is NOT a member of REALTIME_TABLES and never has been — the
-- fix-391 audit comment listed it (and counted 24 tables where there are 22),
-- and this ticket inherited that error from my own note. Verified three ways:
--
--   1. REALTIME_TABLES has 22 keys and no `builders` entry, so
--      useRealtimeInvalidation would register NO HANDLER for it. Publishing it
--      would put rows on the wire that nothing in the app is listening for.
--   2. `useBuilders` and `useUpsertBuilder` are defined in hooks/useBuilders.ts
--      and imported by NOTHING. `queryKeys.buildersAll` is referenced nowhere
--      outside its own declaration.
--   3. The live builder UI is `useBuilderSearch`, keyed
--      ['builders_search', tenantId, query] — a DIFFERENT first element, so a
--      ['builders'] invalidation cannot prefix-match it. That hook's own
--      comment says the omission is deliberate ("realtime invalidation isn't
--      needed for an ephemeral autocomplete").
--
-- So `builders` is reported, not published — per the ticket's own rule that
-- publishing events nobody consumes is the same lie in the other direction.
--
-- ---------------------------------------------------------------------------
-- ★★ THE FOUR, AND WHO ACTUALLY FEEDS THEM
-- ---------------------------------------------------------------------------
--
--   permit_cycle_reviewers   THE HIGHEST-VALUE ONE. Written by the SCRAPER
--                            under service_role and by no client path at all
--                            (there is no insert/update/delete on it anywhere
--                            in src/). Read by EIGHT mounted surfaces including
--                            /dashboard and /projects. A reviewer landing has
--                            been up to 60s late on the screen everyone leaves
--                            open.
--   error_reports            fix-87's promise: a new error refreshes the triage
--                            page AND the nav badge. The badge (ErrorTriageCount
--                            in the Ribbon) is mounted on EVERY page, so this is
--                            the second table whose events reach every client.
--                            Written by both the app (bp_log_error) and the
--                            scraper.
--   vendor_report_state      fix-265's promise: a send in one tab re-buckets the
--                            forecast in every other, so two people cannot
--                            re-send the same "new" projects. App-written only,
--                            one admin page — the narrowest of the four.
--   external_team_directory  fix-227's promise: a firm added in Settings reaches
--                            the per-project picker live. App-written only,
--                            admin-gated.
--
-- ---------------------------------------------------------------------------
-- ★★ RLS, CHECKED PER TABLE (the ticket asked; here is the answer)
-- ---------------------------------------------------------------------------
--
-- Realtime evaluates the SUBSCRIBER's own RLS against each change before
-- delivering it, so what matters is the SELECT policy. All four carry the
-- holds' shape:
--
--     USING (tenant_id = ANY (auth_tenant_ids()))
--
-- Every one of the four has a `tenant_id` column, so no change can be delivered
-- across a tenant boundary. Two differ in shape and neither differs in effect:
--
--   ★ vendor_report_state's SELECT policy is scoped to the `authenticated` ROLE
--     specifically (the other three are `public`), plus a separate service_role
--     ALL policy USING (true). The service_role policy is for the WRITER; it is
--     not a subscriber, so it widens nothing on the socket.
--   ★ external_team_directory gates writes on is_tenant_admin(tenant_id) while
--     reads stay tenant-wide. That is the intended asymmetry: admins edit the
--     directory, everyone's picker sees it.
--
-- ★★★ AND THE ONE REAL DIFFERENCE FROM THE HOLDS, MEASURED NOT ASSUMED.
-- error_reports, permit_cycle_reviewers (and builders) carry table GRANTS to
-- `anon`, which the hold tables do not. That looks alarming and is inert here,
-- because RLS still gates: with no JWT, auth_tenant_ids() returns {} and the
-- SELECT predicate matched 0 of 141 error_reports rows on prod. It is also not
-- special to these tables — 60 public tables carry anon grants today. That is a
-- posture question for its own ticket (fix-157/fix-273 territory), NOT a
-- realtime leak, and NOT something this migration touches.
--
-- ★ REPLICA IDENTITY IS LEFT ALONE, for fix-391's reason. All four are
-- `default` (primary key), the same as `permits` and `project_messages` whose
-- realtime demonstrably works. The RLS predicate keys on tenant_id, which is
-- present in the NEW record of every INSERT and UPDATE, so FULL would buy an
-- old_record nobody reads at the cost of wider WAL rows.
--
-- ★★ THE FALLBACK POLL STAYS. fix-371's floor: a backgrounded tab freezes
-- timers AND drops sockets, so the poll is the floor and the socket is an
-- accelerant. Nothing here touches REALTIME_FALLBACK_MS.
--
-- ★ NO ROW IS WRITTEN. Publication membership is DDL.
--
-- ★★ AFTER THIS: 22 of 22 client-subscribed tables are published. The audit
-- that started in fix-336 (which published 3 of its 6) and continued in fix-391
-- (2 more) is closed. If a future ticket adds a REALTIME_TABLES entry, it must
-- add the publication membership in the same PR — the silence is invisible.
-- ===========================================================================

-- ★ Idempotent: ALTER PUBLICATION ... ADD TABLE errors if the table is already
-- a member, so each is guarded rather than assumed.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'permit_cycle_reviewers',
    'error_reports',
    'vendor_report_state',
    'external_team_directory'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table
      );
    END IF;
  END LOOP;
END
$$;

-- Prove it landed rather than assuming the ALTER did what it says.
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES
    ('permit_cycle_reviewers'),
    ('error_reports'),
    ('vendor_report_state'),
    ('external_team_directory')
  ) AS x(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = x.t
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'fix-393: still missing from supabase_realtime: %', v_missing;
  END IF;
END
$verify$;
