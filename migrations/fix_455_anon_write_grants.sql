-- ===========================================================================
-- fix-455 — anon's WRITE GRANTS, database-wide, and the ratchet (P-105, P-015)
-- ===========================================================================
--
-- ★★★ SEVERITY, STATED HONESTLY: THIS IS A DEFENCE-IN-DEPTH FAILURE, NOT A
-- LIVE BREACH. All 97 public tables have RLS enabled with policies, all 11
-- views set `security_invoker`, and `anon` satisfies no tenant policy — so
-- nothing was reachable. The design intends TWO layers and has been running on
-- one. This restores the second. Nobody needs to rotate anything.
--
-- WHERE IT CAME FROM: fix-454 created a view with the house pattern
-- (`revoke all … from public, anon`) and the APPLIED view came back
-- `authenticated=arwdxtm`. One apply explained a database-wide pattern.
--
-- MEASURED ON PROD 2026-08-30 (read-only, before this migration):
--   tables 97 — 60 with anon INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/MAINTAIN,
--               60 with anon SELECT, 80 with authenticated write, 97 with RLS
--   views  11 — 1 with anon write (permit_cycle_starvation), 4 with
--               authenticated write, 11 of 11 with security_invoker
--   ★ TRUNCATE is already absent everywhere — fix-273's revoke held. What it
--     could not do was stop the NEXT relation being born with the rest.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE ROOT CAUSE IS `pg_default_acl`, AND THERE ARE TWO ENTRIES
-- ---------------------------------------------------------------------------
--   granter `postgres`,       schema public, tables:
--     postgres=arwdDxtm | anon=arwdxtm | authenticated=arwdxtm | service_role=arwdDxtm
--   granter `supabase_admin`, schema public, tables:
--     postgres=arwdDxtm | anon=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
--
-- A default-privileges entry applies to relations created BY that granter.
-- Migrations here run as `postgres`, so the `postgres` entry is the one that
-- governs every relation this team creates — and it is the one §B fixes.
--
-- ★★ THE `supabase_admin` ENTRY IS DELIBERATELY LEFT ALONE, AND NOT BECAUSE IT
-- IS HARMLESS. We cannot change it: `pg_has_role(current_user,
-- 'supabase_admin', 'USAGE')` is FALSE for postgres on a managed Supabase
-- project, and ALTER DEFAULT PRIVILEGES FOR ROLE requires membership. It
-- governs relations Supabase's own provisioning creates, not ours. Recorded
-- here so the next person does not think it was missed.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
--   · ★ NOT A BLANKET REVOKE. The Bridge writes as `authenticated` and needs
--     those grants; a blanket revoke takes the app down. No `authenticated`
--     grant on any TABLE is touched.
--   · ★ anon's SELECT IS LEFT ALONE. STEP 0b found nothing runs as anon (see
--     below), but removing read is a separate, riskier decision and is not
--     this ticket's to make.
--   · No RLS policy, no security_invoker setting, no service_role grant.
--   · No data. Not one row is inserted, updated or deleted.
--
-- ---------------------------------------------------------------------------
-- STEP 0b — IS ANYTHING RUNNING AS anon? NO.
-- ---------------------------------------------------------------------------
--   · `src/router.tsx` has exactly ONE public route: `/login`. Everything else
--     is inside <AuthGuard>.
--   · `src/pages/Login.tsx` makes four Supabase calls and every one is an AUTH
--     endpoint — resetPasswordForEmail, verifyOtp, updateUser,
--     signInWithPassword. There is no `.from()` and no `.rpc()` on the
--     unauthenticated surface. AuthGuard's only call is signOut().
--   · The anon key in `src/lib/supabase.ts` is the API key used to REACH the
--     auth endpoint; once signed in the JWT carries role `authenticated`.
--   · The Edge Function (`supabase/functions/admin-create-user`) builds its
--     client with SUPABASE_SERVICE_ROLE_KEY.
--   · The scraper and file_indexer run from GitHub Actions (ARCHITECTURE.md
--     lines 22 and 68), not a browser. ★ And under EITHER hypothesis they are
--     unaffected: this migration changes neither `service_role` nor
--     `authenticated` on any table.
--   · ★ 26 functions are anon-EXECUTE, but they are trigger functions and pure
--     helpers. `bp_log_error` is NOT among them, so not even error logging
--     runs as anon. The one anon-executable INVOKER function that writes is
--     `bp_rename_permit_type` — which is precisely the shape this revoke
--     closes, since an invoker function writes with the CALLER's table grants.
--
-- ---------------------------------------------------------------------------
-- STEP 0c — THE FOUR VIEWS WITH `authenticated=arwdxtm` ARE NOT UPDATABLE
-- ---------------------------------------------------------------------------
-- information_schema.views reports is_updatable = NO, is_insertable_into = NO,
-- is_trigger_updatable = NO and is_trigger_insertable_into = NO for all four
-- (indexer_missing_letter_current, indexer_reconciliation_current,
-- indexer_run_current, permit_cycle_starvation). Postgres would reject a write
-- through them whatever the grant said. That makes these grants ones that
-- COULD NEVER HAVE BEEN EXERCISED — tidied for consistency with
-- permit_cycle_reviewers_current, not because they were reachable.

-- ---------------------------------------------------------------------------
-- §A — take anon's write privileges on every relation in `public`
-- ---------------------------------------------------------------------------
-- ★ GENERATED FROM THE CATALOGUE, NEVER A HAND-TYPED LIST OF 60 NAMES. A typed
--   list is wrong the day somebody adds a table, which is exactly how this
--   posture drifted in the first place.
--
-- ★ MAINTAIN is in the set. It is a PostgreSQL 17 privilege (this database is
--   17.6) and it was present on all 60 tables; a revoke that named only the
--   six classic privileges would have left it behind and quietly reported
--   success. TRUNCATE is named too — fix-273 already cleared it, but naming it
--   makes this migration idempotent against a relation that regained it.
--
-- ★ Matviews are excluded: the one on this database (juris_permit_stats) has
--   no anon entry at all, and REVOKE INSERT on a matview is not meaningful.
do $$
declare
  r record;
  n_rel int := 0;
begin
  for r in
    select c.oid::regclass as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v')
     order by c.relname
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on %s from anon',
      r.rel
    );
    n_rel := n_rel + 1;
  end loop;
  raise notice 'fix-455 §A: revoked anon write privileges on % relations', n_rel;
end
$$;

-- ---------------------------------------------------------------------------
-- §A4 — the four views carrying `authenticated=arwdxtm`
-- ---------------------------------------------------------------------------
-- Revoke everything and re-grant SELECT only, matching the shape fix-454 got
-- right (permit_cycle_reviewers_current: authenticated=r, no anon).
-- ★ TABLES ARE NOT IN THIS LOOP. `authenticated` write on a table is the
--   Bridge's own save path.
do $$
declare
  v text;
  n int := 0;
begin
  foreach v in array array[
    'public.indexer_missing_letter_current',
    'public.indexer_reconciliation_current',
    'public.indexer_run_current',
    'public.permit_cycle_starvation'
  ]
  loop
    execute format('revoke all on %s from authenticated', v);
    execute format('grant select on %s to authenticated', v);
    n := n + 1;
  end loop;
  raise notice 'fix-455 §A4: % views reset to authenticated=SELECT', n;
end
$$;

-- ---------------------------------------------------------------------------
-- §B1 — THE RATCHET. This is worth more than the 60 revokes above.
-- ---------------------------------------------------------------------------
-- Without this, the next `create table` in `public` is born with anon write
-- again and the audit has to be run forever. With it, the posture holds by
-- default and the revoke above becomes a one-off cleanup.
--
-- ★ Only the `postgres` entry — see the header for why `supabase_admin`'s
--   cannot be altered from here and what it actually governs.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- ★ Sequences too. The same default-privileges entry hands anon
--   `rwU` (SELECT, UPDATE, USAGE) on every new sequence, and UPDATE on a
--   sequence is `setval` — it is a write, it is not covered by RLS, and it was
--   granted for the same reason the table privileges were.
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply) — see migrations/GRANT_POSTURE_CHECK.sql,
-- which is the same query kept as a standing manual check.
-- ---------------------------------------------------------------------------
-- Expect: anon write = 0 tables / 0 views; anon SELECT unchanged at 60;
-- authenticated write unchanged at 80 tables; views 0.
