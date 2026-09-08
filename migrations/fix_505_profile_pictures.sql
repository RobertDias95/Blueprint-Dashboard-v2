-- ===========================================================================
-- fix-505 (P-162) — PROFILE PICTURES
-- ===========================================================================
--
-- ★★★ NOT APPLIED BY THE AGENT. The brief is explicit: Cowork applies this on
--     Bobby's yes, and Bobby uploads the first picture as the live test.
--
-- Bobby, 2026-09-04: *"in settings, if we can have the option to upload our
-- headshot or profile picture, and then that would display at the top right,
-- and then in our teams… where it says our name or letters for our first and
-- last name, it would show our picture there."*
--
-- ---------------------------------------------------------------------------
-- ★★★ THE BRIEF'S JOIN DOES NOT EXIST ON PROD, AND THIS IS THE WHOLE RISK
-- ---------------------------------------------------------------------------
-- The brief says: *"`profiles.name` is the roster join to `team_members.name`"*
-- and asks for `bp_avatar_paths()` joined that way. Measured on prod
-- 2026-09-08:
--
--     profiles                     37
--     profiles.name    NOT NULL     0     ← every row
--     profiles.full_name NOT NULL   0     ← every row
--     matched profiles.name = team_members.name
--                                   0
--
-- A function built on that join would return ZERO ROWS FOREVER: every upload
-- would succeed, every avatar would stay initials, and nothing would say why.
-- (This is the trap fix-330 already recorded — "resolve names via
-- team_members.email".)
--
-- ★★★ SO THE JOIN IS `lower(profiles.email) = lower(team_members.email)`, and
--     it is NOT re-implemented here: `bp_profile_display_name(profile_id)`
--     already IS that resolution, it is what `bp_list_project_messages` stamps
--     into `author_name`, and it is therefore already the name every avatar
--     circle in this app is drawn from. Measured: 36 of 37 logins resolve to a
--     roster key through it; the 37th has no roster row and resolves to its
--     email's local part, which is exactly the string its chat messages carry.
--     One definition of "what this login is called", four consumers.
--
-- ---------------------------------------------------------------------------
-- ★★★ AND IT MUST BE A FUNCTION, NOT A VIEW
-- ---------------------------------------------------------------------------
-- The brief offers "a view or RPC". A view cannot work: `profiles` carries
--
--     profiles_read_own   SELECT   USING ((auth.uid() = id) OR is_admin())
--
-- so a `security_invoker` view over it returns the viewer's OWN row and nothing
-- else — every avatar but your own would silently stay initials, and an admin
-- testing it would see everything work. SECURITY DEFINER, `search_path=public`,
-- granted to `authenticated`: the same shape `bp_profile_display_name` and
-- `bp_list_project_messages` already use for exactly this reason.
--
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
-- ★ `avatar_path` is the STORAGE KEY, not a URL. The bucket is private, so a
--   URL would be a signature with an expiry baked into a table — stale the hour
--   after it is written. Signing happens at read time (fix-330's rule).
--
-- ★ `avatar_updated_at` is the cache-buster. The object path is stable by
--   design (one object per person, re-upload overwrites), so nothing in the
--   path changes when the picture does — without this, a browser that has the
--   old image cached keeps showing it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

COMMENT ON COLUMN public.profiles.avatar_path IS
  'fix-505: storage key in the private `avatars` bucket, {tenant_id}/{profile_id}.{ext}. NULL = no picture, draw initials.';
COMMENT ON COLUMN public.profiles.avatar_updated_at IS
  'fix-505: when the picture last changed. The object path is stable, so this is what busts a cached image.';

-- ---------------------------------------------------------------------------
-- 2. The bucket
-- ---------------------------------------------------------------------------
-- ★ PRIVATE, and re-asserted on conflict exactly as fix-284/330 do: a bucket
--   that someone flipped public in the dashboard must come back private when
--   this runs.
--
-- ★ 2 MB and three image types. The client resizes to 512×512 before upload
--   (src/lib/avatarImage.ts), so a phone photo arrives well under this — the
--   bucket limit is what makes the rule TRUE, the client check is what makes it
--   KIND. Both lists are mirrored in src/lib/avatars.ts and a test diffs them
--   against this file, the fix-330 pattern.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Object policies
-- ---------------------------------------------------------------------------
-- Path: `{tenant_id}/{profile_id}.{ext}` — so the first segment is the tenant
-- test (the same shape chat-attachments uses with a project id) and the second
-- is who it belongs to.
--
-- ★★ READ: anyone in the tenant. A picture is identity, and an avatar a
--    teammate cannot load is a broken circle beside a name they can already
--    read.
--
-- ★★★ WRITE: your own object, OR an admin writing anyone's.
--     ★ THIS IS A RECOMMENDATION, NOT A RULING — Bobby has not decided, and the
--       PR says so. The case for it: Settings → Team already lets an admin edit
--       anyone's first name, last name and email (fix-487 §B), a headshot is
--       the same class of fact, and somebody has to be able to remove a picture
--       that should not be there. The case against: a picture is more personal
--       than a surname. Narrowing this later is one policy, and no data moves.
DROP POLICY IF EXISTS avatars_tenant_read ON storage.objects;
CREATE POLICY avatars_tenant_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())
  );

-- ★ INSERT and UPDATE are separate policies because an UPSERT is an INSERT the
--   first time and an UPDATE every time after. A bucket that accepts the first
--   upload and silently refuses every replacement is the failure this splits.
DROP POLICY IF EXISTS avatars_own_or_admin_insert ON storage.objects;
CREATE POLICY avatars_own_or_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())
    AND (
      split_part(split_part(objects.name, '/', 2), '.', 1) = auth.uid()::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS avatars_own_or_admin_update ON storage.objects;
CREATE POLICY avatars_own_or_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())
    AND (
      split_part(split_part(objects.name, '/', 2), '.', 1) = auth.uid()::text
      OR public.is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())
    AND (
      split_part(split_part(objects.name, '/', 2), '.', 1) = auth.uid()::text
      OR public.is_admin()
    )
  );

-- ★★ DELETE IS GRANTED HERE, unlike chat-attachments — and the difference is
--    the point. A chat attachment is part of an append-only record somebody
--    else has read; a headshot is a thing about YOU that you must be able to
--    take down. "Remove" would otherwise leave the object in the bucket with
--    only the column nulled.
DROP POLICY IF EXISTS avatars_own_or_admin_delete ON storage.objects;
CREATE POLICY avatars_own_or_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())
    AND (
      split_part(split_part(objects.name, '/', 2), '.', 1) = auth.uid()::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS avatars_service_write ON storage.objects;
CREATE POLICY avatars_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- ---------------------------------------------------------------------------
-- 4. bp_avatar_paths() — every picture in the tenant, keyed by DISPLAY NAME
-- ---------------------------------------------------------------------------
-- ★★★ `name` here is `bp_profile_display_name(id)` — see the header. It is the
--     roster key ("Bobby") for the 36 logins that have a roster row, and the
--     email's local part for the one that does not, which is precisely the
--     string that login's chat messages already carry as `author_name`.
--
-- ★★ THE CLIENT INDEXES ON BOTH THE KEY AND THE FULL NAME. `<Avatar>` is handed
--    `fullNameOf(rosterKey)` — "Bobby Dias", not "Bobby" (register #127) — so a
--    lookup on this value alone would miss every circle in the app. The
--    resolution stays in the client because that is where `useTeamMembers`
--    already is; see src/lib/avatars.ts `buildAvatarIndex`.
--
-- ★ Rows with no picture are OMITTED rather than returned as NULL: the result
--   is a lookup table, and 37 rows of nothing is 36 rows of noise today.
DROP FUNCTION IF EXISTS public.bp_avatar_paths();
CREATE FUNCTION public.bp_avatar_paths()
RETURNS TABLE (name text, avatar_path text, avatar_updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.bp_profile_display_name(pr.id) AS name,
    pr.avatar_path,
    pr.avatar_updated_at
  FROM public.profiles pr
  WHERE pr.avatar_path IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = pr.id
        AND m.tenant_id = ANY (public.auth_tenant_ids())
    );
$function$;

REVOKE ALL ON FUNCTION public.bp_avatar_paths() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_avatar_paths() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. bp_set_avatar_path(profile_id, path) — the column write
-- ---------------------------------------------------------------------------
-- ★★ WHY AN RPC RATHER THAN A DIRECT UPDATE. `profiles_read_own` means the
--    client cannot even SELECT another person's row, so an admin setting
--    somebody else's picture through PostgREST would be writing a row it cannot
--    read back — and `profiles_admin_write` is `is_admin()`, which would let an
--    admin edit `role` from the same endpoint. One narrow function instead: it
--    can express a path and nothing else.
--
-- ★ NULL clears it. Passing NULL is how Remove writes the column; the object
--   itself is deleted by the client, which holds the storage session.
DROP FUNCTION IF EXISTS public.bp_set_avatar_path(uuid, text);
CREATE FUNCTION public.bp_set_avatar_path(p_profile_id uuid, p_path text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- ★★★ THE SAME RULE THE STORAGE POLICY ENFORCES, ENFORCED AGAIN HERE. A
  --     SECURITY DEFINER function bypasses RLS by construction, so the check
  --     that the object policy makes cannot be assumed to have run: the two
  --     writes (object, column) go through different doors.
  IF p_profile_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only your own picture, or an admin''s';
  END IF;

  -- ★ Same tenant, always — an admin of one tenant may not touch another's.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.user_id = p_profile_id
      AND m.tenant_id = ANY (public.auth_tenant_ids())
  ) THEN
    RAISE EXCEPTION 'no such member in this tenant';
  END IF;

  UPDATE public.profiles
     SET avatar_path = NULLIF(TRIM(COALESCE(p_path, '')), ''),
         avatar_updated_at = CASE
           WHEN NULLIF(TRIM(COALESCE(p_path, '')), '') IS NULL THEN NULL
           ELSE v_now
         END
   WHERE id = p_profile_id;

  RETURN v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_set_avatar_path(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_set_avatar_path(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. bp_profile_id_for_roster_name(name) — the admin path
-- ---------------------------------------------------------------------------
-- ★★ Settings → Team knows a ROSTER NAME and needs the login id to write. It
--    cannot read `profiles` to find one (read-own-only), so the lookup is a
--    function — and it returns NULL for a roster row with no login, which is
--    the state the dialog renders as "no login — picture can be set once they
--    can sign in".
--
-- ★ It reuses the same display-name resolution rather than re-deriving the
--   email join, so "which login is this roster row" has ONE answer.
DROP FUNCTION IF EXISTS public.bp_profile_id_for_roster_name(text);
CREATE FUNCTION public.bp_profile_id_for_roster_name(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT pr.id
  FROM public.profiles pr
  WHERE EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = pr.id
        AND m.tenant_id = ANY (public.auth_tenant_ids())
    )
    AND lower(TRIM(public.bp_profile_display_name(pr.id))) = lower(TRIM(p_name))
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.bp_profile_id_for_roster_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_profile_id_for_roster_name(text) TO authenticated;

COMMIT;
