-- fix-69 (2026-06-12): pending_scrape_change extras writers — REPO-OF-RECORD
-- BACKSTOP ONLY. These two functions were authored by the SCRAPER-side fix-69
-- (Blueprint-Dashboard- PR #39) and applied to PROD on 2026-06-12 via the MCP
-- from that session. They are committed here because THIS repo is the migrations
-- repo-of-record; nothing in this file changes prod (CREATE OR REPLACE of the
-- already-live, identical definitions is a no-op-equivalent).
--
-- What they are: guard-neutral writers of permits.extras.pending_scrape_change.
-- Each sets the engine-depth GUC (bp.target_submit_engine_depth = 1) so the
-- permits_set_updated_at trigger PRESERVES the existing updated_at — i.e. these
-- writes do NOT count as a manual edit and do NOT touch last_scraper_update_at,
-- so they stay invisible to the 24h manual-edit guard. The scraper's guard-skip
-- escalation calls bp_set_… to record a blocked portal change and bp_clear_… once
-- the real write finally lands.
--
-- Paired with v2 fix-159 (PR #137): the pending-change chip (PendingScrapeChip /
-- readPendingScrapeChange) reads this exact extras key, and the scrape_reconcile
-- lifecycle event fires the reconcile task. Contract (field names verbatim):
--   extras.pending_scrape_change = { observed_status, db_status, first_seen,
--                                    runs_skipped, last_run_at }
--
-- Definitions below are pulled VERBATIM from prod via pg_get_functiondef
-- (live def is canon). Grants match the live ACL at the time this was written:
-- authenticated + service_role (NOT anon / PUBLIC — consistent with fix-157's
-- default privileges). The REVOKE/GRANT are explicit so a fresh apply reproduces
-- that grant state.
--
-- SUPERSEDED BY fix_162_pending_scrape_rpc_gate.sql (2026-06-12): the stray
-- `authenticated` grant was a cross-tenant write risk (these are SECURITY DEFINER
-- with a caller-supplied p_tenant_id and no internal gate). fix-162 revokes
-- authenticated (final ACL = service_role only) and adds the service-path tenant
-- gate inside both functions. Apply fix-162 after this file.

CREATE OR REPLACE FUNCTION public.bp_set_pending_scrape_change(p_tenant_id uuid, p_permit_id integer, p_blob jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
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
  perform set_config('bp.target_submit_engine_depth', '1', true);
  update public.permits
     set extras = (coalesce(extras, '{}'::jsonb) - 'pending_scrape_change')
   where id = p_permit_id
     and tenant_id = p_tenant_id
     and extras ? 'pending_scrape_change';
end;
$function$;

-- Grants — match the live ACL (authenticated + service_role; not anon/PUBLIC).
REVOKE EXECUTE ON FUNCTION public.bp_set_pending_scrape_change(uuid, integer, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bp_clear_pending_scrape_change(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_set_pending_scrape_change(uuid, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_clear_pending_scrape_change(uuid, integer) TO authenticated, service_role;
