-- ===========================================================================
-- fix-673 (P-353) — record WHY the app did not reload itself
-- ===========================================================================
--
-- Bobby, 2026-10-14: "it used to auto refresh if outdated and an update was
-- around, it no longer does that. why?" — and `client_build_seen` could not
-- say. It recorded that the ribbon showed and that nobody reloaded, never what
-- held the automatic reload back.
--
-- This adds two columns and teaches the existing heartbeat RPC one event:
--
--   client_build_seen.auto_reload_blocked_reason   autoReloadBlocker()'s answer
--   client_build_seen.auto_reload_blocked_at       when it was last recorded
--   bp_record_client_build(..., p_blocked_reason)  accepts 'auto_reload_blocked'
--   bp_list_client_builds()                        returns both columns
--
-- ★★★ NO EXISTING ROW CHANGES. The columns are nullable with no default, so
--     the ALTER rewrites nothing and every current row reads NULL.
--
-- ★★ THE LATEST REASON WINS, unlike notice_auto_reloaded_at (first wins). The
--    question is "why is this person STILL on this build?", which is answered
--    by the most recent refusal, not the first.
--
-- ★★★ DROP + CREATE, NOT CREATE OR REPLACE, for both functions:
--     · bp_record_client_build gains an argument — CREATE OR REPLACE with a new
--       argument list makes an OVERLOAD, and two candidates break PostgREST's
--       resolution (fix-438). The new argument has a DEFAULT, so every bundle
--       still open on a person's screen, which calls with five named
--       arguments, resolves to the new function unchanged.
--     · bp_list_client_builds changes its RETURNS TABLE, which Postgres only
--       allows through a drop.
--     Grants are restated exactly as they are today (authenticated +
--     service_role; never anon) — a re-created function would otherwise pick
--     up Supabase's default EXECUTE for anon.

BEGIN;

ALTER TABLE public.client_build_seen
  ADD COLUMN IF NOT EXISTS auto_reload_blocked_reason text,
  ADD COLUMN IF NOT EXISTS auto_reload_blocked_at timestamptz;

ALTER TABLE public.client_build_seen
  ADD CONSTRAINT client_build_seen_auto_reload_blocked_reason_check
  CHECK (
    auto_reload_blocked_reason IS NULL
    OR auto_reload_blocked_reason IN (
      'not-away-long-enough', 'dirty', 'mutating', 'active-is-input', 'already-tried'
    )
  );

COMMENT ON COLUMN public.client_build_seen.auto_reload_blocked_reason IS
  'fix-673: the latest reason the app declined to reload itself onto a newer '
  'build (autoReloadBlocker() in src/lib/autoReload.ts). Overwritten by each new '
  'refusal; NULL when no decision was ever held back.';
COMMENT ON COLUMN public.client_build_seen.auto_reload_blocked_at IS
  'fix-673: when auto_reload_blocked_reason was last recorded.';

DROP FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text);

CREATE FUNCTION public.bp_record_client_build(
  p_build text,
  p_display_mode text,
  p_built_at timestamptz DEFAULT NULL::timestamptz,
  p_user_agent text DEFAULT NULL::text,
  p_notice_event text DEFAULT NULL::text,
  p_blocked_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_mode   text;
BEGIN
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

  v_mode := CASE WHEN p_display_mode = 'standalone' THEN 'standalone' ELSE 'browser' END;

  -- ★ fix-673 adds 'auto_reload_blocked'. The raise stays: an event nobody
  --   defined is a client bug, and swallowing it would hide it.
  IF p_notice_event IS NOT NULL
     AND p_notice_event NOT IN (
       'shown', 'dismissed', 'reloaded', 'auto_reloaded', 'auto_reload_blocked'
     ) THEN
    RAISE EXCEPTION 'bp_record_client_build: unknown notice event %', p_notice_event
      USING ERRCODE = '22023';
  END IF;

  -- ★ A blocked event must say why, and only a blocked event may.
  IF (p_notice_event = 'auto_reload_blocked' AND p_blocked_reason IS NULL)
     OR (p_notice_event IS DISTINCT FROM 'auto_reload_blocked' AND p_blocked_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'bp_record_client_build: a blocked reason goes with auto_reload_blocked only'
      USING ERRCODE = '22023';
  END IF;
  IF p_blocked_reason IS NOT NULL
     AND p_blocked_reason NOT IN (
       'not-away-long-enough', 'dirty', 'mutating', 'active-is-input', 'already-tried'
     ) THEN
    RAISE EXCEPTION 'bp_record_client_build: unknown blocked reason %', p_blocked_reason
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.client_build_seen AS c (
    user_id, build, built_at, display_mode, user_agent, tenant_id,
    first_seen_at, last_seen_at,
    notice_first_shown_at, notice_shown_count, notice_dismissed_at,
    notice_reloaded_at, notice_auto_reloaded_at,
    auto_reload_blocked_reason, auto_reload_blocked_at
  )
  VALUES (
    v_uid, btrim(p_build), p_built_at, v_mode, left(coalesce(p_user_agent, ''), 400), v_tenant,
    now(), now(),
    CASE WHEN p_notice_event = 'shown'         THEN now() END,
    CASE WHEN p_notice_event = 'shown'         THEN 1 ELSE 0 END,
    CASE WHEN p_notice_event = 'dismissed'     THEN now() END,
    CASE WHEN p_notice_event = 'reloaded'      THEN now() END,
    CASE WHEN p_notice_event = 'auto_reloaded' THEN now() END,
    CASE WHEN p_notice_event = 'auto_reload_blocked' THEN p_blocked_reason END,
    CASE WHEN p_notice_event = 'auto_reload_blocked' THEN now() END
  )
  ON CONFLICT (user_id, build) DO UPDATE SET
    last_seen_at = now(),
    display_mode = EXCLUDED.display_mode,
    user_agent   = COALESCE(EXCLUDED.user_agent, c.user_agent),
    built_at     = COALESCE(EXCLUDED.built_at, c.built_at),
    notice_first_shown_at = COALESCE(c.notice_first_shown_at, EXCLUDED.notice_first_shown_at),
    notice_shown_count    = c.notice_shown_count + EXCLUDED.notice_shown_count,
    notice_dismissed_at   = COALESCE(EXCLUDED.notice_dismissed_at, c.notice_dismissed_at),
    notice_reloaded_at    = COALESCE(EXCLUDED.notice_reloaded_at, c.notice_reloaded_at),
    notice_auto_reloaded_at =
      COALESCE(c.notice_auto_reloaded_at, EXCLUDED.notice_auto_reloaded_at),
    -- ★★ LATEST WINS — see the header.
    auto_reload_blocked_reason =
      COALESCE(EXCLUDED.auto_reload_blocked_reason, c.auto_reload_blocked_reason),
    auto_reload_blocked_at =
      COALESCE(EXCLUDED.auto_reload_blocked_at, c.auto_reload_blocked_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_record_client_build(text, text, timestamptz, text, text, text)
  TO authenticated, service_role;

DROP FUNCTION public.bp_list_client_builds();

CREATE FUNCTION public.bp_list_client_builds()
RETURNS TABLE(
  out_user_id uuid,
  out_email text,
  out_name text,
  out_build text,
  out_built_at timestamptz,
  out_display_mode text,
  out_first_seen_at timestamptz,
  out_last_seen_at timestamptz,
  out_notice_shown_count integer,
  out_notice_first_shown_at timestamptz,
  out_notice_dismissed_at timestamptz,
  out_notice_reloaded_at timestamptz,
  out_notice_auto_reloaded_at timestamptz,
  out_auto_reload_blocked_reason text,
  out_auto_reload_blocked_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    c.notice_reloaded_at,
    c.notice_auto_reloaded_at,
    c.auto_reload_blocked_reason,
    c.auto_reload_blocked_at
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

REVOKE ALL ON FUNCTION public.bp_list_client_builds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_client_builds() TO authenticated, service_role;

COMMIT;
