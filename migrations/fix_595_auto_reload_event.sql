-- ===========================================================================
-- fix-595 — a stale app catches up when you come back
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Claude applies this from Cowork. fix-595 did not run it
--       against prod, and **CI is green with it unapplied**.
--
-- ★★★ AND THE FEATURE WORKS WITHOUT IT, WHICH IS THE POINT OF THE ORDERING.
--     `bp_record_client_build` rejects an unknown `p_notice_event` with 22023,
--     and `recordClientBuild` swallows every failure by design (fix-589: *"the
--     migration ships unapplied, so today this is a 404 on every call"*). So
--     until this lands, an auto-reload **still reloads** — it just is not
--     recorded. Asserted in `AutoReloadOnReturnFix595`: *"RPC rejecting
--     'auto_reloaded' does not block the reload."*
--
-- ---------------------------------------------------------------------------
-- IT WAS RUN AGAINST PROD, AND ROLLED BACK — 2026-09-29
-- ---------------------------------------------------------------------------
--
-- The fix-153 pattern this repo uses in place of a CI database: the whole file
-- was executed inside `BEGIN; … ROLLBACK;` on eibnmwthkcuumyclyxoe, verified
-- from INSIDE the transaction, and absence re-checked afterwards.
--
--   inside the transaction        column present 1 · reader returns it 1
--                                 bp_list_client_builds overloads 1   ★
--                                 bp_record_client_build overloads 1  ★
--                                 authenticated EXECUTE true · anon false
--   after the ROLLBACK            column present 0 · reader returns it 0
--                                 overloads still 1 (the DROP did not leak)
--
-- ★ THE OVERLOAD COUNTS ARE THE POINT OF CHECKING. fix-438's lesson was a
--   changed argument list making a SILENT second function that breaks PostgREST;
--   neither statement here does that, and now it is measured rather than argued.
--
-- ★★ AND THE TWO COALESCE DIRECTIONS WERE EXERCISED ON A REAL ROW, because they
--    are the one thing in this file that reads the same and behaves differently.
--    Two upserts, the second carrying LATER timestamps for both columns:
--
--      notice_auto_reloaded_at  →  2020-01-01   ← first wins, as §3 requires
--      notice_reloaded_at       →  2030-12-31   ← newest wins, unchanged
--
--    The probe row was rolled back; `build = 'fix595-probe'` returns 0 rows.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS A NEW EVENT AT ALL
-- ---------------------------------------------------------------------------
--
-- P-292's success measure is: *"within one working day of a deploy, nobody
-- active is on a build older than the latest, and `notice_auto_reloaded_at` is
-- set for the people who never press Reload."* That question needs
-- `'auto_reloaded'` and `'reloaded'` kept APART — one column meaning "the app
-- caught itself up" OR "somebody pressed the button" could not answer it.
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-09-29, the morning this was written
-- ---------------------------------------------------------------------------
--
--   people tracked                                        31
--   on a build older than the newest                      15
--   behind AND active in the last 12h                      2   ← P-292's shape
--   of those, ignored the ribbon entirely                  2
--   people who have EVER pressed Dismiss                   0   ★
--
-- ★ Nobody is fighting the ribbon. They are living with it — which is why
--   fix-589 concluded that re-showing it cannot be the cure, and why Bobby
--   ruled the reload instead.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
--
-- ★ Nullable, no default, no backfill: null means "this person's app has never
--   reloaded itself", which is true of everybody today and is the state the
--   success measure is read against.
ALTER TABLE public.client_build_seen
  ADD COLUMN IF NOT EXISTS notice_auto_reloaded_at timestamptz;

COMMENT ON COLUMN public.client_build_seen.notice_auto_reloaded_at IS
  'fix-595: when this person''s app reloaded ITSELF onto a newer build, on '
  'returning to a window left idle 30+ minutes with nothing unsaved. Set on the '
  'FIRST auto-reload and never overwritten. Distinct from notice_reloaded_at, '
  'which is somebody pressing the button.';

-- ---------------------------------------------------------------------------
-- 2. The recorder accepts the fourth event.
-- ---------------------------------------------------------------------------
--
-- ★★ SET ON THE FIRST, NEVER OVERWRITTEN — `COALESCE(c.…, EXCLUDED.…)`, the
--    same shape as `notice_first_shown_at` and deliberately NOT the shape of
--    `notice_reloaded_at`, which takes the newest. §3 asks for the first one:
--    the question is *"did this person's app ever catch itself up"*, and the
--    first time it did is the answer.
CREATE OR REPLACE FUNCTION public.bp_record_client_build(
  p_build text,
  p_display_mode text,
  p_built_at timestamptz DEFAULT NULL::timestamptz,
  p_user_agent text DEFAULT NULL::text,
  p_notice_event text DEFAULT NULL::text
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

  -- ★ fix-595 adds 'auto_reloaded'. The raise stays: an event nobody defined is
  --   a client bug, and swallowing it would hide it.
  IF p_notice_event IS NOT NULL
     AND p_notice_event NOT IN ('shown', 'dismissed', 'reloaded', 'auto_reloaded') THEN
    RAISE EXCEPTION 'bp_record_client_build: unknown notice event %', p_notice_event
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.client_build_seen AS c (
    user_id, build, built_at, display_mode, user_agent, tenant_id,
    first_seen_at, last_seen_at,
    notice_first_shown_at, notice_shown_count, notice_dismissed_at,
    notice_reloaded_at, notice_auto_reloaded_at
  )
  VALUES (
    v_uid, btrim(p_build), p_built_at, v_mode, left(coalesce(p_user_agent, ''), 400), v_tenant,
    now(), now(),
    CASE WHEN p_notice_event = 'shown'         THEN now() END,
    CASE WHEN p_notice_event = 'shown'         THEN 1 ELSE 0 END,
    CASE WHEN p_notice_event = 'dismissed'     THEN now() END,
    CASE WHEN p_notice_event = 'reloaded'      THEN now() END,
    CASE WHEN p_notice_event = 'auto_reloaded' THEN now() END
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
    -- ★★★ FIRST WINS, unlike the line above it. See the note on §2.
    notice_auto_reloaded_at =
      COALESCE(c.notice_auto_reloaded_at, EXCLUDED.notice_auto_reloaded_at);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The reader returns it.
-- ---------------------------------------------------------------------------
--
-- ★★★ `DROP` FIRST, AND IT IS NOT OPTIONAL. `CREATE OR REPLACE FUNCTION` cannot
--     change a function's RETURN TYPE — adding a column to a `RETURNS TABLE(…)`
--     is exactly that, and Postgres refuses with *"cannot change return type of
--     existing function"*. This is the same family as fix-438's lesson (a changed
--     ARG list makes a silent overload that breaks PostgREST); the return-type
--     version errors loudly instead, which is kinder.
--
-- ★ `IF EXISTS` so the file is idempotent, and the drop + create are inside the
--   transaction so the function is never missing to a concurrent caller.
DROP FUNCTION IF EXISTS public.bp_list_client_builds();

CREATE OR REPLACE FUNCTION public.bp_list_client_builds()
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
  out_notice_auto_reloaded_at timestamptz
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
    c.notice_auto_reloaded_at
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

-- ★ The grant goes with the DROP — dropping a function takes its grants with it,
--   and a reader that can no longer execute is a Settings panel that 500s.
REVOKE ALL ON FUNCTION public.bp_list_client_builds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_list_client_builds() TO authenticated;

COMMIT;

-- ===========================================================================
-- VERIFY, after applying
-- ===========================================================================
--
--   -- the fourth event is accepted
--   SELECT public.bp_record_client_build('test','browser',NULL,NULL,'auto_reloaded');
--   -- (as a signed-in user; it returns quietly for a NULL auth.uid())
--
--   -- and the reader hands it back
--   SELECT out_notice_auto_reloaded_at FROM public.bp_list_client_builds() LIMIT 1;
--
-- ===========================================================================
-- READ THE MORNING AFTER THE NEXT DEPLOY — P-292's success measure
-- ===========================================================================
--
--   WITH newest AS (SELECT build FROM client_build_seen ORDER BY built_at DESC LIMIT 1),
--   current_per_user AS (
--     SELECT DISTINCT ON (user_id) user_id, build, last_seen_at, notice_auto_reloaded_at
--       FROM client_build_seen ORDER BY user_id, last_seen_at DESC)
--   SELECT count(*) FILTER (WHERE build <> (SELECT build FROM newest)
--                             AND last_seen_at > now() - interval '12 hours') AS still_behind_and_active,
--          count(*) FILTER (WHERE notice_auto_reloaded_at IS NOT NULL)        AS caught_up_by_themselves
--     FROM current_per_user;
--
--   -- `still_behind_and_active` should be 0. It was 2 on 2026-09-29.
-- ===========================================================================
