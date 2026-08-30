-- ===========================================================================
-- fix-454 §A — HALF OF EVERY REVIEWER FETCH IS HISTORY THE CLIENT THROWS AWAY
-- ===========================================================================
--
-- P-104 (was P-014, "stale reviewer rows are not pruned"). Measuring it on
-- 2026-08-30 changed the shape of the answer.
--
-- ★★★ THIS IS NOT A PRUNE, AND THERE IS DELIBERATELY NO `DELETE` IN THIS FILE.
-- The superseded rows are cycle history and they stay. fix-185 already scopes
-- every consumer to the current cycle CORRECTLY — nothing is mislabelled and no
-- row is wrong. The defect is that all 2,597 of them are SHIPPED TO THE BROWSER
-- on the app's eight hottest screens.
--
-- MEASURED ON PROD 2026-08-30:
--   · permit_cycle_reviewers = 2,597 rows across 382 permits, 919 kB of JSON.
--   · 1,359 rows (52.3%) across 268 permits sit BELOW their permit's max
--     permit_cycles.cycle_index.
--   · `useAllPermitCycleReviewers` pulls every row for the tenant with
--     `select('*')`. fix-189 added pagination to it because it crossed 1,000
--     rows; it has since grown 2.6x and now takes THREE round trips.
--   · REALTIME_TABLES['permit_cycle_reviewers'] invalidates the prefix key
--     `['permit_cycle_reviewers']`, so ONE scraper write re-pulls all 919 kB
--     for every open client. Same class as bp_list_tasks (fix-434).
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY "LATEST CYCLE THAT HAS ROWS" AND NOT "THE PERMIT'S CURRENT CYCLE"
-- ---------------------------------------------------------------------------
--
-- The obvious filter — keep only rows on `max(permit_cycles.cycle_index)` —
-- CHANGES WHAT THE APP RENDERS, and STEP 0b caught it before it shipped.
--
-- fix-186 gave two surfaces a third state between "has reviewers" and "has
-- none": the current cycle has no reviewer rows yet, but an EARLIER cycle does,
-- so the round simply has not been assigned. Both compute it the same way, from
-- the mere EXISTENCE of history:
--
--   · ReviewerRollupChip.tsx:136
--       awaitingCurrentCycle = !!cycles && counts.total === 0
--                              && latestIdx !== null && rows.length > 0
--   · projectViewHelpers.ts:180
--       awaitingCurrentCycle: rows.length > 0
--
-- They render "Cycle N — not yet assigned" instead of a bare dash. **15 permits
-- on prod are in that state right now.** A strict current-cycle filter returns
-- ZERO rows for exactly those permits, so `rows.length > 0` would flip to false
-- and 15 live chips would silently lose their explanation. There is no row left
-- to carry a flag on, either — the state is defined by the absence of rows.
--
-- ★★★ SO THE VIEW KEEPS EACH PERMIT'S LATEST CYCLE **THAT HAS ROWS**. For a
-- permit whose current cycle has reviewers that IS the current cycle (the
-- overwhelming majority: 365 of 382). For one of the 15 awaiting permits it is
-- the most recent earlier cycle — precisely the rows `rows.length > 0` is
-- asking about. Every consumer's input is then byte-identical to today:
--
--   rowsForCycle(rows, currentCycleIndex(cycles, rows))  same slice
--   latestCycleIndex(rows)                               same index
--   rows.length > 0                                      same boolean
--   rollupCounts(visible, ...)                           same counts
--
-- and NOT ONE LINE OF CONSUMER LOGIC CHANGES. That is the whole reason this
-- shape was chosen over the smaller one: it buys 50.2% for zero behavioural
-- risk, where the extra 2% would have cost a new signal threaded through four
-- files to serve 15 permits.
--
-- MEASURED RESULT: 2,597 rows / 919 kB  ->  1,293 rows / 456 kB.
-- 1,304 rows and 463 kB (50.2%) stop leaving the database, per cold mount AND
-- per realtime invalidation. Pagination: 3 round trips -> 2.
--
-- ---------------------------------------------------------------------------
-- ★★ NOTE ON THE TWO PERMITS WITH ROWS ABOVE THEIR MAX CYCLE
-- ---------------------------------------------------------------------------
-- 14 rows on 2 permits carry cycle_index = 1 while the permit's only
-- permit_cycles row is the cycle_index = 0 design slot. A filter written against
-- permit_cycles would have had to decide what to do with them. This one never
-- consults permit_cycles at all — it ranks within permit_cycle_reviewers itself
-- — so those rows are simply that permit's latest cycle and are kept. One less
-- edge case to get wrong.

-- ★ security_invoker so the caller's RLS on permit_cycle_reviewers applies
--   unchanged. A view without it runs as the OWNER and would hand every tenant's
--   reviewer rows to every signed-in user — the exposure the grant audit
--   (fix-273) exists to prevent. Matches correction_reconciliation and
--   project_plan_of_record, the tight precedent on this database.
create or replace view public.permit_cycle_reviewers_current
with (security_invoker = true) as
select r.*
  from public.permit_cycle_reviewers r
 where r.cycle_index = (
   select max(r2.cycle_index)
     from public.permit_cycle_reviewers r2
    where r2.permit_id = r.permit_id
 );

comment on view public.permit_cycle_reviewers_current is
  'fix-454: each permit''s LATEST cycle that has reviewer rows. The default '
  'read for useAllPermitCycleReviewers. NOT a prune — permit_cycle_reviewers '
  'keeps every historical row. "Latest with rows" rather than "the permit''s '
  'current cycle" so fix-186''s awaitingCurrentCycle state (15 permits on prod) '
  'still sees the history it is asking about; see the migration header.';

-- ★★★ SELECT ONLY — AND `authenticated` MUST BE NAMED IN THE REVOKE.
--
-- This was written first as `revoke all ... from public, anon;` and the applied
-- view came back with **authenticated=arwdxtm** — INSERT, UPDATE, DELETE and
-- TRUNCATE on a brand-new relation. That is the Supabase default-privileges
-- gotcha exactly: `ALTER DEFAULT PRIVILEGES` grants authenticated everything on
-- each NEW relation in `public`, and revoking from PUBLIC and anon does not
-- touch it. It is also why several older views here still read
-- `authenticated=arwdxtm` while the tight ones read `authenticated=r`.
--
-- ★ So the revoke names authenticated too, and the grant hands back exactly one
--   privilege. Verified on prod after apply: `authenticated=r/postgres`, no anon.
revoke all on public.permit_cycle_reviewers_current from public, anon, authenticated;
grant select on public.permit_cycle_reviewers_current to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- select count(*) from public.permit_cycle_reviewers;          -- 2597, unchanged
-- select count(*) from public.permit_cycle_reviewers_current;  -- 1293
-- select relacl, reloptions from pg_class
--   where oid = 'public.permit_cycle_reviewers_current'::regclass;
--   -- authenticated=r/postgres, no anon; {security_invoker=true}
