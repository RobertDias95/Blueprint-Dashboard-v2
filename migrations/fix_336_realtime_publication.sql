-- ===========================================================================
-- fix-336 §1 — the three tables the notification model reads that Postgres was
-- never publishing
-- ===========================================================================
--
-- Bobby: "Is the notification center giving live updates versus on refresh? If
-- that has not been fixed, that is the next thing up because that is vital."
--
-- ★★ THE CLIENT WAS ALREADY SUBSCRIBED. useRealtimeInvalidation has been
-- mounted at the app root since Q2 and asks for postgres_changes on 14 tables;
-- useScraperActivity opened a second channel for audit_log. SIX of those 15
-- tables were NOT IN THE `supabase_realtime` PUBLICATION, so Postgres never
-- emitted their changes and those handlers had never fired once. Nothing
-- errors: a subscription to an unpublished table is simply silent, which is
-- exactly the "dead socket that looks alive" this ticket is about.
--
-- ★ THIS MIGRATION ADDS THE THREE THAT FEED THE BELL, and only those. The
-- notification model (lib/boardReads.buildNewItems) has seven sources:
--
--     flips            audit_log               ← NOT published. The largest
--                                                source, and the reason the
--                                                bell felt frozen.
--     tasks            permit_tasks            ✓ already published
--     handoffs         permit_milestone_acks   ← NOT published
--     permits          permits                 ✓
--     mentions         project_messages        ✓
--     post requests    post_requests           ✓ (fix-339's shared items)
--     read state       board_item_reads        ← NOT published. Without it,
--                                                acknowledging in one tab left
--                                                the badge stale in every other.
--
-- The other unpublished tables the client subscribes to
-- (permit_cycle_reviewers, error_reports, project_holds, vendor_report_state,
-- external_team_directory) are NOT added here: none of them feeds the
-- notification model, and this ticket's rule is the minimum set, not all 27.
-- They are named in the PR so the next person knows they are still silent.
--
-- ★★ ALL THREE HAVE RLS ENABLED WITH A SELECT POLICY, verified before writing
-- this: postgres_changes filters the stream through those policies, so
-- publishing a table WITHOUT RLS would broadcast every row to every connected
-- client. audit_log and permit_milestone_acks are tenant-scoped
-- (tenant_id = ANY auth_tenant_ids()); board_item_reads is user-scoped
-- (user_id = auth.uid() AND tenant), which is the tightest of the three and the
-- one the second-identity proof in the PR is run against.
--
-- ★ MEASURED ON THE WIRE, after applying this, with two identities against
-- production (transcript in the PR):
--   · an authenticated identity in tenant B received a tenant-B audit_log row
--     written by a different session, in full, ~1s after commit;
--   · the same socket received NOTHING for the tenant-A row committed beside
--     it;
--   · an anon connection received no row data at all — the payload arrives
--     stripped, `{"new":{},"old":{},"errors":["Error 401: Unauthorized"]}`.
--
-- ★ CONFIGURATION ONLY. No row is inserted, updated or deleted.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'audit_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'permit_milestone_acks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_milestone_acks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_item_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_item_reads;
  END IF;
END $$;
