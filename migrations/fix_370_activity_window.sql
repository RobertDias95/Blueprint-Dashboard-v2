-- ===========================================================================
-- ★★★ fix-370 — the "14-day" activity feed covered nineteen hours
-- ===========================================================================
--
-- MEASURED ON PROD 2026-08-20, before anything was written:
--
--   rows matching bp_fetch_scraper_activity's own WHERE over 14 days   1,600
--   rows it returned                                                     300
--   dropped                                                     1,300 (81%)
--   where the 300th row fell                        2026-08-19 15:29 — YESTERDAY
--   rows in the last 24h alone                                           167
--
-- ★★★ `LIMIT 300` on a feed advertised as 14 days. Nothing anywhere said so,
-- and the client's suppression classifier runs AFTER the cap — so Bobby's bell
-- read "Not shown · 295", meaning 295 of the 300 fetched rows were noise and
-- about FIVE slots were left for anything a person cares about.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE TWO LOUD CATEGORIES ATE THE BUDGET BY RECENCY
-- ---------------------------------------------------------------------------
--
--   scrape_workflow_fetch_recovered                     603 / 14d — 38% of ALL
--   scrape_*_skipped_recent_manual_edit  (two actions)  322 / 14d
--   everything else — the rows a person can actually be shown   675 / 14d
--
-- Both mean "working as intended" and neither may reach a person. They were
-- being fetched anyway, ranked by recency alongside real changes, and winning.
--
-- ★★ THE FIX IS NOT TO DROP THEM. `myBoard.suppressionGroups` exists because
-- "showing the SUPPRESSED COUNT is how a quiet day and a broken notifier stop
-- looking the same: four bugs this year had the shape of a missing thing
-- looking identical to an absent one", and fix-336 built the notification
-- centre's "Not shown" tab to list the ROWS behind that number. Excluding them
-- outright would delete a signal two tickets deliberately built.
--
-- ★★★ SO EACH CLASS GETS ITS OWN BUDGET. One query, two windows: the showable
-- rows are ranked among themselves and the suppressed rows among themselves,
-- so a noisy afternoon of retries can no longer push a status flip out of the
-- feed. That is the whole mechanism.
--
-- ---------------------------------------------------------------------------
-- ★★★ AND THE COUNTS COME FROM AN UNCAPPED AGGREGATE
-- ---------------------------------------------------------------------------
--
-- A count computed over a capped page is a count of the page. `Not shown · 295`
-- understated reality by about four times. `bp_scraper_activity_summary` walks
-- the whole window and returns totals — cheap, no rows, and it is what lets the
-- bell state a fact and the UI say when a list is truncated.
--
-- ---------------------------------------------------------------------------
-- ★★ WHAT DELIBERATELY DID NOT MOVE INTO SQL
-- ---------------------------------------------------------------------------
--
-- `notYours` — "changes on permits that aren't yours" — is `ent_lead <> viewer`,
-- a different answer for every person, and the oversight layer legitimately
-- wants the wider set. Pushing the viewer into this function would make one
-- cached RPC result per person and hard-code a policy that is currently a
-- rendering decision. It stays client-side, exactly where it is.

BEGIN;

-- ---------------------------------------------------------------------------
-- ★★ The vocabulary, single-sourced.
-- ---------------------------------------------------------------------------
--
-- ★ Three functions read these lists (the feed, the summary, and anything
-- later). Written once so the feed and the count cannot come to disagree about
-- what "suppressed" means — the failure mode that produced a number nobody
-- could reconcile with a list.
--
-- ★★ TWINNED WITH `src/lib/myBoard.ts` (RETRY_ACTIONS / GUARD_ACTIONS), which
-- still classifies these rows in the browser for the centre's three sections.
-- A test asserts the two agree.

CREATE OR REPLACE FUNCTION public.bp_scraper_retry_actions()
  RETURNS text[]
  LANGUAGE sql IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  -- Portal fetches that failed and recovered on their own retry.
  SELECT ARRAY['scrape_workflow_fetch_recovered']::text[];
$$;

CREATE OR REPLACE FUNCTION public.bp_scraper_guard_actions()
  RETURNS text[]
  LANGUAGE sql IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  -- The scraper deferring to a human edit made in the last N hours.
  --
  -- ★ `scrape_reviewer_skipped_recent_manual_edit` is a real fourth action and
  -- is deliberately NOT here: `bp_scraper_activity_feed_action` excludes every
  -- `scrape_reviewer_%` action one step earlier, so it never reaches the feed
  -- at all and listing it here would imply it does. The TS twin keeps it in its
  -- guard set for the same reason it always has — that set is applied to rows
  -- from anywhere, not only from this function.
  SELECT ARRAY[
    'scrape_skipped_recent_manual_edit',
    'scrape_cycle_skipped_recent_manual_edit'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.bp_scraper_suppressed_actions()
  RETURNS text[]
  LANGUAGE sql IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.bp_scraper_retry_actions() || public.bp_scraper_guard_actions();
$$;

-- ★ WHAT COUNTS AS FEED VOLUME AT ALL — the predicate the old function carried
-- inline. Lifted out because the summary has to use exactly the same one: a
-- total computed over a slightly different WHERE clause is a number that
-- disagrees with its own list, which is the bug one level up.
CREATE OR REPLACE FUNCTION public.bp_scraper_activity_feed_action(p_action text)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
AS $$
  -- ★ The underscores are ESCAPED here and were not before. In LIKE, a bare `_`
  -- is a single-character wildcard, so the original predicate also matched a
  -- hypothetical `scrapeXfoo`. Measured over 90 days on prod: both forms select
  -- exactly 7,879 rows, so this is a tightening with no behaviour change today
  -- and one less way for a future action name to fall in by accident.
  SELECT (p_action LIKE 'scrape\_%' OR p_action = 'manual_admin_correction')
     AND p_action NOT LIKE 'scrape\_reviewer\_%';
$$;

-- ---------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------
--
-- ★ DROPPED, not replaced: adding defaulted parameters creates an OVERLOAD
-- rather than replacing the one-argument version, and a PostgREST call passing
-- only `p_days` would then be ambiguous and fail outright. The old signature
-- has to go for the new one to be callable.
DROP FUNCTION IF EXISTS public.bp_fetch_scraper_activity(integer);

CREATE OR REPLACE FUNCTION public.bp_fetch_scraper_activity(
  p_days             integer DEFAULT 14,
  p_limit            integer DEFAULT 1500,
  p_suppressed_limit integer DEFAULT 300
)
  RETURNS TABLE(
    id bigint, created_at timestamp with time zone, action text, row_id text,
    changes jsonb, permit_num text, permit_type text, address text, juris text,
    cycle_index integer, ent_lead text, portal_url text, project_id uuid
  )
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT al.id, al.created_at, al.action, al.row_id, al.changes,
           (al.action = ANY (public.bp_scraper_suppressed_actions())) AS is_suppressed
      FROM public.audit_log al
     WHERE al.created_at > NOW() - make_interval(days => GREATEST(p_days, 1))
       AND public.bp_scraper_activity_feed_action(al.action)
  ), ranked AS (
    -- ★★★ TWO BUDGETS, ONE QUERY. Ranking within each class is the entire fix:
    -- 603 retries and 322 guard-skips can no longer occupy slots that a status
    -- flip needed, because they are not competing for the same slots.
    --
    -- ★ `, id DESC` is not decoration. Several rows routinely share a
    -- created_at to the microsecond (one scrape write, several audit rows), and
    -- row_number() over a tie is not deterministic — the same query would
    -- return a different 1,500 on two runs, which is how a row goes missing
    -- with nothing to blame.
    SELECT b.*,
           row_number() OVER (
             PARTITION BY b.is_suppressed
             ORDER BY b.created_at DESC, b.id DESC
           ) AS rn
      FROM base b
  )
  -- ★ The joins happen AFTER the ranking, so only the rows that survive are
  -- joined. They are LEFT joins and eliminate nothing, so the meaning is
  -- unchanged; it is simply less work.
  SELECT
    r.id,
    r.created_at,
    r.action,
    r.row_id,
    r.changes,
    p.num      AS permit_num,
    p.type     AS permit_type,
    pr.address AS address,
    pr.juris   AS juris,
    (substring(r.row_id from ':cycle:([0-9]+)'))::int AS cycle_index,
    p.ent_lead AS ent_lead,
    p.portal_url AS portal_url,
    p.project_id AS project_id
  FROM ranked r
  LEFT JOIN public.permits  p  ON p.id  = (substring(r.row_id from '^[0-9]+'))::int
  LEFT JOIN public.projects pr ON pr.id = p.project_id
  WHERE (NOT r.is_suppressed AND r.rn <= GREATEST(p_limit, 1))
     OR (    r.is_suppressed AND r.rn <= GREATEST(p_suppressed_limit, 0))
  ORDER BY r.created_at DESC, r.id DESC;
$function$;

COMMENT ON FUNCTION public.bp_fetch_scraper_activity(integer, integer, integer) IS
  'fix-370: the scraper activity feed, with a SEPARATE row budget for the two '
  'always-suppressed classes (retries, manual-edit guards) so they cannot crowd '
  'out showable rows. Was a single LIMIT 300 across both, which turned a 14-day '
  'feed into a 19-hour one. True counts come from bp_scraper_activity_summary; '
  'notYours stays client-side because it is per viewer.';

-- ---------------------------------------------------------------------------
-- ★★★ The truth about the window, uncapped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_scraper_activity_summary(p_days integer DEFAULT 14)
  RETURNS TABLE(
    window_days integer,
    total       bigint,
    showable    bigint,
    retries     bigint,
    guarded     bigint,
    oldest_at   timestamp with time zone,
    newest_at   timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    GREATEST(p_days, 1),
    count(*),
    count(*) FILTER (
      WHERE NOT (al.action = ANY (public.bp_scraper_suppressed_actions()))
    ),
    count(*) FILTER (WHERE al.action = ANY (public.bp_scraper_retry_actions())),
    count(*) FILTER (WHERE al.action = ANY (public.bp_scraper_guard_actions())),
    min(al.created_at),
    max(al.created_at)
  FROM public.audit_log al
  WHERE al.created_at > NOW() - make_interval(days => GREATEST(p_days, 1))
    AND public.bp_scraper_activity_feed_action(al.action);
$function$;

COMMENT ON FUNCTION public.bp_scraper_activity_summary(integer) IS
  'fix-370: true volume over the WHOLE window, uncapped, so the bell''s '
  '"Not shown" line states a fact instead of counting its own page. No rows, '
  'one aggregate scan of an index-covered range.';

-- ---------------------------------------------------------------------------
-- ★ Grants: the posture fix-157 set and fix-273 audited. anon gets nothing;
-- these are SECURITY INVOKER, so RLS on audit_log/permits/projects still does
-- the tenant scoping exactly as it did before.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_scraper_retry_actions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_scraper_guard_actions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_scraper_suppressed_actions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_scraper_activity_feed_action(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_fetch_scraper_activity(integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_scraper_activity_summary(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bp_scraper_retry_actions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_scraper_guard_actions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_scraper_suppressed_actions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_scraper_activity_feed_action(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_fetch_scraper_activity(integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_scraper_activity_summary(integer) TO authenticated, service_role;

COMMIT;
