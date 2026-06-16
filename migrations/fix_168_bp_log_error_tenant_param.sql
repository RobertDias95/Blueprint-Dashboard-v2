-- fix-168 (2026-06-16): bp_log_error — repo-of-record backstop for the new
-- p_tenant_id param + fix-163 cross-tenant gate.
--
-- BACKSTOP: the scraper-side fix-75 (Blueprint-Dashboard- PR #45) added the
-- optional `p_tenant_id uuid DEFAULT NULL` arg to public.bp_log_error and
-- applied it to PROD via MCP, so the scraper (service_role, auth.uid() NULL)
-- can stamp error_reports.tenant_id directly — error_reports.tenant_id is NOT
-- NULL and the error_reports_default_tenant trigger yields NULL for a
-- service_role caller. v2 is the schema-of-record and didn't carry this change;
-- this file reproduces the live def so a fresh apply matches prod.
--
-- HARDEN (fix-163 class): p_tenant_id is a caller-supplied tenant on a SECURITY
-- DEFINER function — without a gate an authenticated user could log a row into
-- another tenant by passing a foreign p_tenant_id. Add the standard gate, but
-- ONLY when p_tenant_id is non-NULL: the frontend (errorLogger.ts) calls with 4
-- args (p_tenant_id omitted → NULL → trigger fills the caller's own tenant), and
-- that NULL path must stay untouched. service_role (scraper) bypasses; an
-- authenticated caller passing someone else's tenant → 42501.
--
-- App-callable → add-gate / KEEP the authenticated grant (fix-163 pattern).
-- Definition below is the LIVE prod def (pg_get_functiondef — canon) re-emitted
-- with only the gate added. Applied to prod via MCP.

CREATE OR REPLACE FUNCTION public.bp_log_error(
  p_source text,
  p_level text,
  p_message text,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_tenant_id uuid DEFAULT NULL::uuid
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id            bigint;
  v_fingerprint   text;
  v_normalized    text;
  v_user_id       uuid := auth.uid();
  v_user_email    text;
BEGIN
  -- fix-168: cross-tenant write gate (fix-163 convention). Only fires when an
  -- explicit tenant is supplied — the NULL frontend path and the service_role
  -- scraper path both pass through untouched.
  IF p_tenant_id IS NOT NULL
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_log_error: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  v_normalized := lower(regexp_replace(
    regexp_replace(p_message, '\d{4}-\d{2}-\d{2}[T0-9:.+Z-]*', '<ts>', 'g'),
    '\s+', ' ', 'g'
  ));
  v_normalized := regexp_replace(v_normalized, '\b\d{2,}\b', '<num>', 'g');
  v_fingerprint := md5(p_source || '|' || trim(v_normalized));

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  -- tenant_id explicit when provided (service-role scraper); NULL otherwise lets
  -- error_reports_default_tenant fill it from the authenticated caller's tenant.
  INSERT INTO public.error_reports
    (user_id, user_email, source, level, message, fingerprint, context, tenant_id)
  VALUES
    (v_user_id, v_user_email, p_source, p_level, p_message, v_fingerprint,
     COALESCE(p_context, '{}'::jsonb), p_tenant_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Grants — match the live ACL (authenticated + service_role; not anon/PUBLIC).
-- App-callable: the frontend logs as authenticated; the scraper as service_role.
REVOKE EXECUTE ON FUNCTION public.bp_log_error(text, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bp_log_error(text, text, text, jsonb, uuid) TO authenticated, service_role;
