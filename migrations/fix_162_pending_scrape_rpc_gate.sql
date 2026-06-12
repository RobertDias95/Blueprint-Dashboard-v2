-- fix-162 (2026-06-12): tighten the fix-69 pending_scrape_change RPCs — revoke
-- the stray `authenticated` EXECUTE grant + add the service-path tenant gate.
--
-- bp_set_pending_scrape_change / bp_clear_pending_scrape_change (committed as the
-- repo-of-record backstop in fix_69_pending_scrape_change_rpcs.sql) are
-- SECURITY DEFINER, take a caller-supplied p_tenant_id, and had NO internal
-- tenant gate. They also carried an `authenticated` EXECUTE grant (fix-157's
-- ALTER DEFAULT PRIVILEGES auto-grants authenticated+service_role on every new
-- function) — so any logged-in user could write/clear another tenant's extras
-- key cross-tenant. Only the scraper (service key) should call them.
--
-- This file SUPERSEDES the grants section of fix_69_pending_scrape_change_rpcs.sql.
-- Applied to prod via MCP.
--
-- 1. Add the service-path gate INSIDE both functions, copied verbatim from the
--    live convention (bp_create_lifecycle_task): the no-auth-context path is the
--    scraper on the service key ONLY; every other caller must own the target
--    tenant. Defense-in-depth behind the REVOKE — survives a future
--    default-privilege re-grant of authenticated.
-- 2. REVOKE EXECUTE FROM authenticated (and PUBLIC/anon, defensively) → the final
--    ACL is service_role only.

CREATE OR REPLACE FUNCTION public.bp_set_pending_scrape_change(p_tenant_id uuid, p_permit_id integer, p_blob jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- fix-162: service-path gate (matches bp_create_lifecycle_task).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_set_pending_scrape_change: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  -- engine context -> permits_set_updated_at preserves OLD.updated_at
  perform set_config('bp.target_submit_engine_depth', '1', true);
  update public.permits
     set extras = coalesce(extras, '{}'::jsonb)
                  || jsonb_build_object('pending_scrape_change', p_blob)
   where id = p_permit_id
     and tenant_id = p_tenant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bp_clear_pending_scrape_change(p_tenant_id uuid, p_permit_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- fix-162: service-path gate (matches bp_create_lifecycle_task).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_clear_pending_scrape_change: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  perform set_config('bp.target_submit_engine_depth', '1', true);
  update public.permits
     set extras = (coalesce(extras, '{}'::jsonb) - 'pending_scrape_change')
   where id = p_permit_id
     and tenant_id = p_tenant_id
     and extras ? 'pending_scrape_change';
end;
$function$;

-- Lock the grants to service_role only (the scraper). Revoke the stray
-- authenticated grant; PUBLIC/anon were never granted but revoke defensively.
REVOKE EXECUTE ON FUNCTION public.bp_set_pending_scrape_change(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bp_clear_pending_scrape_change(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_set_pending_scrape_change(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bp_clear_pending_scrape_change(uuid, integer) TO service_role;
