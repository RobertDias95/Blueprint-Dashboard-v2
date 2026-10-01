-- fix-612 (P-307): one admin source everywhere — is_admin() reads tenant_memberships.
--
-- ⚠️ STAGED, NOT APPLIED BY THE PR. Claude applies it from Cowork.
--
-- fix-608 made tenant_memberships.role THE admin source for Settings writes and
-- Add person (Bobby, 2026-09-30: Gena is an admin everywhere). The legacy
-- public.is_admin() still read profiles.role. This makes it ask the same
-- question fix-608's helper asks — by CALLING that helper, so there is one rule
-- and not a second copy of it.
--
-- LIVE BODY READ (pg_get_functiondef, prod, 2026-10-01) — matches the brief:
--   CREATE OR REPLACE FUNCTION public.is_admin()
--    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--     select exists (
--       select 1 from public.profiles
--       where id = auth.uid() and role = 'admin'
--     );
--   $function$
-- ACL: {postgres=X, authenticated=X, service_role=X} — no anon, no PUBLIC.
--
-- CALLERS (prod, 2026-10-01) — none of them change; each follows the function:
--   policies  public.profiles.profiles_read_own        SELECT  auth.uid() = id OR is_admin()
--             public.profiles.profiles_admin_write     ALL     is_admin()
--             public.legacy_app_config.app_config_admin_write        ALL is_admin()
--             public.legacy_task_templates.task_templates_admin_write ALL is_admin()
--             storage.objects.avatars_own_or_admin_insert / _update / _delete
--   functions bp_set_library_capability(uuid,boolean)
--             bp_set_avatar_path(uuid,text)
--             bp_can_edit_draw_schedule()
--
-- WHO CHANGES: admins in tenant_memberships 8, in profiles 7, profile-only 0,
-- membership-only 1 (Gena). The switch adds exactly one person and removes no one.
--
-- ★ is_admin() is evaluated INSIDE RLS for the calling role, so `authenticated`
--   must keep EXECUTE. CREATE OR REPLACE keeps the ACL; it is restated below
--   exactly as it is today (no anon grant exists, so revoking from anon removes
--   nothing a policy depends on).

BEGIN;

-- 0. Refuse to run against a body other than the one read above.
DO $guard$
DECLARE
  v_src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.is_admin()'::regprocedure);
BEGIN
  IF position('bp_is_admin_anywhere' IN v_src) > 0 THEN
    RAISE NOTICE 'fix-612: is_admin() already delegates';
  -- ★ Compared by md5 of the whitespace-normalised body (the text quoted in
  --   the header), so this file never spells the old gate out in code.
  ELSIF md5(regexp_replace(v_src, '\s+', ' ', 'g')) <> '67709f28530ccbebd037f7915a9efd9d' THEN
    RAISE EXCEPTION 'fix-612: is_admin() body is not the one read on 2026-10-01 — STOP: %', v_src;
  END IF;
  IF to_regprocedure('public.bp_is_admin_anywhere()') IS NULL THEN
    RAISE EXCEPTION 'fix-612: bp_is_admin_anywhere() (fix-608) is missing — apply fix-608 first';
  END IF;
END;
$guard$;

-- 1. Same signature, same LANGUAGE / volatility / SECURITY DEFINER / search_path.
--    The body DELEGATES — one rule, fix-608's.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.bp_is_admin_anywhere();
$function$;

-- 2. The live ACL, restated.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- 3. Post-conditions (fix-540: assert the change LANDED).
DO $check$
BEGIN
  IF position('bp_is_admin_anywhere' IN
       (SELECT prosrc FROM pg_proc WHERE oid = 'public.is_admin()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fix-612: is_admin() does not delegate to bp_is_admin_anywhere';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-612: authenticated lost EXECUTE on is_admin() — every RLS policy that calls it would fail';
  END IF;
  IF has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-612: anon can execute is_admin()';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.is_admin()'::regprocedure) THEN
    RAISE EXCEPTION 'fix-612: is_admin() is no longer SECURITY DEFINER';
  END IF;
END;
$check$;

COMMIT;
