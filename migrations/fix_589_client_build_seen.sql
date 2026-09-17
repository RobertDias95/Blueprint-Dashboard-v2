-- ===========================================================================
-- fix-589 §A — A BUILD HEARTBEAT, SO "IS ANYONE STALE?" IS ANSWERABLE
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED BY CLAUDE. Bobby applies this one.** The app ships with
--       it unapplied and behaves correctly that way: every call below is
--       fire-and-forget and the read surface renders an explicit
--       "not recorded yet" when the function is missing. CI is green without
--       it. Nothing in the app waits on it, and nothing breaks if it never
--       runs — it simply stays unanswerable, which is today's situation.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY THIS TABLE EXISTS
-- ---------------------------------------------------------------------------
--
-- Bobby, 2026-09-16: *"Is there a way to see if others are on a super outdated
-- version? Can we make sure the reload is popping up for everyone?"*
--
-- **Both answers were NO, and for one reason: nothing recorded a client build.**
--
--   · fix-587's stamp rides on `error_reports` only, and a stale person's
--     symptom is WRONG NUMBERS, not an error. There were ZERO error rows in
--     the three hours after that ticket merged.
--   · `user_activity` is written SERVER-SIDE by triggers. It knows who is
--     active. It cannot know what code they are running.
--   · `profiles` carries no build column (37 rows on prod, all with an email,
--     **none** with a name — resolve people through `team_members.email`).
--
-- Brittani ran a three-week-old bundle and the only evidence was three missing
-- toolbar buttons in a screenshot.
--
-- ★★★ `display_mode` IS THE COLUMN THAT WOULD HAVE ANSWERED IT ON DAY ONE.
--     An installed app and a tab are different windows with different lifetimes
--     — an installed window is never closed, which is the whole premise of the
--     notice. Knowing which one somebody was in is the difference between
--     "their reload did nothing" and "they reloaded a window that was already
--     current while the stale one sat behind it".
--
-- ★ IT IS A HEARTBEAT, NOT ANALYTICS — and that line is enforced by the shape,
--   not by good intentions. **One row per (person, build)**, holding who, what
--   build, which surface, when first and last seen. No page paths, no actions,
--   no dwell time, no event stream that can grow into one. The notice's own
--   life is four columns on that same row rather than an events table, for the
--   same reason: *(person, build)* is exactly the grain the question is asked
--   at, and a row that can only be UPDATED cannot become a firehose.
--
-- ---------------------------------------------------------------------------
-- ⚠️ RLS: A PERSON WRITES ONLY THEIR OWN ROW; THE ROSTER IS ADMIN-ONLY
-- ---------------------------------------------------------------------------
--
-- Build history is "which of my colleagues is behind" — a support question, not
-- a public one. Reading another person's row requires `is_tenant_admin`, and a
-- write is pinned to `auth.uid()` in BOTH the policy and the function, so a
-- forged `p_user_id` is not even expressible (there is no such parameter).
--
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- THE TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_build_seen (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ★ The short commit, exactly as `lib/buildInfo.BUILD_SHA` renders it.
  build         text        NOT NULL,
  -- ★★ AND WHEN THAT BUILD WAS BUILT. Not in the brief's column list, and it
  --    is what makes *"how far behind current"* a subtraction instead of a
  --    guess: the viewer compares a row's `built_at` with their own bundle's.
  --    Deriving it from a commit sha would need a git history the browser does
  --    not have, and parsing it out of a display string is how a date format
  --    change becomes a wrong number on a support call.
  built_at      timestamptz,
  -- ★★★ THE COLUMN THAT WOULD HAVE ANSWERED BRITTANI'S CASE ON DAY ONE.
  display_mode  text        NOT NULL
                  CHECK (display_mode IN ('standalone', 'browser')),
  user_agent    text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  tenant_id     uuid        NOT NULL,

  -- ── §B: the notice's own life, at the grain the question is asked ────────
  -- *"Can we make sure the reload is popping up for everyone?"* Today "it never
  -- showed" and "it showed and was ignored" are indistinguishable. These four
  -- columns are the entire difference.
  notice_first_shown_at timestamptz,
  notice_shown_count    integer NOT NULL DEFAULT 0,
  notice_dismissed_at   timestamptz,
  notice_reloaded_at    timestamptz,

  -- ★ The brief's uniqueness rule, as the primary key. One row per person per
  --   build; a second visit UPDATES it. An `ON CONFLICT (user_id, build)`
  --   below INFERS this index — fix-536's rule: do not replace it without
  --   reading that clause first.
  PRIMARY KEY (user_id, build)
);

-- ★ The repo's tenant pattern, unchanged: the trigger stamps `tenant_id` from
--   the caller so no client can choose one.
DROP TRIGGER IF EXISTS client_build_seen_default_tenant ON public.client_build_seen;
CREATE TRIGGER client_build_seen_default_tenant
  BEFORE INSERT ON public.client_build_seen
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

-- ★ The one query the admin surface runs: this tenant's rows, freshest first.
CREATE INDEX IF NOT EXISTS client_build_seen_tenant_idx
  ON public.client_build_seen (tenant_id, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_build_seen ENABLE ROW LEVEL SECURITY;

-- ★★ READ: yourself always, everybody else only if you are a tenant admin.
DROP POLICY IF EXISTS client_build_seen_select ON public.client_build_seen;
CREATE POLICY client_build_seen_select ON public.client_build_seen
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_tenant_admin(tenant_id)
  );

-- ★★★ WRITE: YOUR OWN ROW, AND ONLY YOUR OWN. Pinned to `auth.uid()` rather
--     than to a tenant, so an admin cannot write a build record on somebody
--     else's behalf either — a heartbeat that can be forged is worse than none,
--     because it reads as evidence.
DROP POLICY IF EXISTS client_build_seen_insert ON public.client_build_seen;
CREATE POLICY client_build_seen_insert ON public.client_build_seen
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = ANY (public.auth_tenant_ids())
  );

DROP POLICY IF EXISTS client_build_seen_update ON public.client_build_seen;
CREATE POLICY client_build_seen_update ON public.client_build_seen
  FOR UPDATE USING (user_id = auth.uid())
              WITH CHECK (user_id = auth.uid());

-- ★ No DELETE policy, deliberately. Nothing in the app removes a heartbeat.

-- ---------------------------------------------------------------------------
-- bp_record_client_build — the heartbeat, and the notice's trail
-- ---------------------------------------------------------------------------
--
-- ★★ ONE FUNCTION FOR BOTH, because they are the same row and the same grain.
--    A plain heartbeat passes no event; the notice passes 'shown', 'dismissed'
--    or 'reloaded'. The client rate-limits heartbeats behind
--    `BUILD_CHECK_MIN_GAP_MS` and does NOT rate-limit events, which is the
--    right way round: events are rare and each one is a fact.
--
-- ⚠️ THERE IS NO `p_user_id`. The row is keyed off `auth.uid()` inside the
--    function, so "record a build for somebody else" has no expression.
CREATE OR REPLACE FUNCTION public.bp_record_client_build(
  p_build         text,
  p_display_mode  text,
  p_built_at      timestamptz DEFAULT NULL,
  p_user_agent    text        DEFAULT NULL,
  p_notice_event  text        DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_mode   text;
BEGIN
  -- ★ Signed out is not an error here. The heartbeat fires from app load and a
  --   session can be mid-verify; returning quietly beats a logged failure on a
  --   path nobody is waiting for.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_tenant := (public.auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  IF p_build IS NULL OR btrim(p_build) = '' THEN
    RETURN;
  END IF;

  -- ★ An unknown display mode reads as a tab rather than refusing the write.
  --   The CHECK constraint would otherwise turn a future Chrome value
  --   ('window-controls-overlay', 'tabbed') into a lost heartbeat.
  v_mode := CASE WHEN p_display_mode = 'standalone' THEN 'standalone' ELSE 'browser' END;

  IF p_notice_event IS NOT NULL
     AND p_notice_event NOT IN ('shown', 'dismissed', 'reloaded') THEN
    RAISE EXCEPTION 'bp_record_client_build: unknown notice event %', p_notice_event
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.client_build_seen AS c (
    user_id, build, built_at, display_mode, user_agent, tenant_id,
    first_seen_at, last_seen_at,
    notice_first_shown_at, notice_shown_count, notice_dismissed_at, notice_reloaded_at
  )
  VALUES (
    v_uid, btrim(p_build), p_built_at, v_mode, left(coalesce(p_user_agent, ''), 400), v_tenant,
    now(), now(),
    CASE WHEN p_notice_event = 'shown'     THEN now() END,
    CASE WHEN p_notice_event = 'shown'     THEN 1 ELSE 0 END,
    CASE WHEN p_notice_event = 'dismissed' THEN now() END,
    CASE WHEN p_notice_event = 'reloaded'  THEN now() END
  )
  -- ★ Infers the PRIMARY KEY above. See the note on it.
  ON CONFLICT (user_id, build) DO UPDATE SET
    last_seen_at = now(),
    -- ★ The LATEST surface wins: somebody who opens the installed app after a
    --   tab is, from this moment, in the installed app.
    display_mode = EXCLUDED.display_mode,
    user_agent   = COALESCE(EXCLUDED.user_agent, c.user_agent),
    built_at     = COALESCE(EXCLUDED.built_at, c.built_at),
    -- ★★ FIRST shown is never overwritten; the COUNT is what grows. "It showed
    --    once three weeks ago" and "it has shown 60 times" are different
    --    answers to Bobby's question and both matter.
    notice_first_shown_at = COALESCE(c.notice_first_shown_at, EXCLUDED.notice_first_shown_at),
    notice_shown_count    = c.notice_shown_count + EXCLUDED.notice_shown_count,
    notice_dismissed_at   = COALESCE(EXCLUDED.notice_dismissed_at, c.notice_dismissed_at),
    notice_reloaded_at    = COALESCE(EXCLUDED.notice_reloaded_at, c.notice_reloaded_at);
END;
$function$;

-- ---------------------------------------------------------------------------
-- bp_list_client_builds — the admin read surface
-- ---------------------------------------------------------------------------
--
-- ★★ ADMIN ONLY, CHECKED IN THE FUNCTION as well as in the policy. It is
--    SECURITY DEFINER so RLS does not apply inside it, which means the guard
--    here IS the gate — stated out loud because that is exactly the kind of
--    line that gets copied without its `IF NOT`.
--
-- ★ Names come from `team_members.email`, NOT from `profiles.name`: all 37
--   prod profiles have a NULL name and an email. Same resolution the chat,
--   the roster and the board already use.
CREATE OR REPLACE FUNCTION public.bp_list_client_builds()
RETURNS TABLE (
  out_user_id         uuid,
  out_email           text,
  out_name            text,
  out_build           text,
  out_built_at        timestamptz,
  out_display_mode    text,
  out_first_seen_at   timestamptz,
  out_last_seen_at    timestamptz,
  out_notice_shown_count  integer,
  out_notice_first_shown_at timestamptz,
  out_notice_dismissed_at   timestamptz,
  out_notice_reloaded_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
BEGIN
  IF v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'bp_list_client_builds: admin only'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.user_id,
    p.email,
    tm.name,
    c.build,
    c.built_at,
    c.display_mode,
    c.first_seen_at,
    c.last_seen_at,
    c.notice_shown_count,
    c.notice_first_shown_at,
    c.notice_dismissed_at,
    c.notice_reloaded_at
  FROM public.client_build_seen c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  LEFT JOIN LATERAL (
    SELECT t.name
    FROM public.team_members t
    WHERE lower(t.email) = lower(p.email)
    ORDER BY t.former NULLS FIRST, t.id
    LIMIT 1
  ) tm ON TRUE
  WHERE c.tenant_id = v_tenant
  ORDER BY c.last_seen_at DESC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- GRANTS — fix-157 / fix-273 posture: authenticated only, never anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_list_client_builds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_list_client_builds() TO authenticated;

-- ★★ fix-273's rule, restated because a NEW table gets `authenticated` write
--    grants from the schema's default privileges whether or not anybody meant
--    it. The RPCs are SECURITY DEFINER and are the only intended writers.
REVOKE ALL ON TABLE public.client_build_seen FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.client_build_seen TO authenticated;

COMMIT;

-- ===========================================================================
-- VERIFY — after applying
-- ===========================================================================
--
-- -- 1. the table and its guard. Expect one row, rowsecurity = true.
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE oid = 'public.client_build_seen'::regclass;
--
-- -- 2. anon can execute neither function. Expect f, f.
-- SELECT has_function_privilege('anon', 'public.bp_record_client_build(text,text,timestamptz,text,text)', 'EXECUTE'),
--        has_function_privilege('anon', 'public.bp_list_client_builds()', 'EXECUTE');
--
-- -- 3. a non-admin is refused the roster. Impersonate (fix-587's recipe: BOTH
-- --    set_config('request.jwt.claims', …, true) AND SET LOCAL ROLE
-- --    authenticated) as a non-admin and expect 42501 from
-- --    bp_list_client_builds(); as an admin expect rows. End the block in
-- --    RAISE EXCEPTION so nothing persists.
--
-- -- 4. the heartbeat is idempotent: call bp_record_client_build twice with the
-- --    same build and expect ONE row whose last_seen_at moved and whose
-- --    first_seen_at did not.
--
-- -- 5. run scripts/sql/on_conflict_census.sql — fix-547 rule 1, a new
-- --    ON CONFLICT arrived. 42P10 must be 0.
