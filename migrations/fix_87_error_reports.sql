-- fix-87: error capture + triage system.
--
-- Today Bobby's bug-report loop is verbal: he hits something, has to remember
-- and re-describe it. Goal: capture every error source (frontend toast,
-- uncaught JS exception, backend RPC failure, scraper) into a single DB
-- table, group by a normalized fingerprint, surface in Settings → Errors,
-- and badge the nav with a count.
--
-- This migration is the backend half: the error_reports table + four RPCs
-- (bp_log_error append, bp_list_error_groups aggregate, bp_update_error_
-- group_status bulk-status update, bp_new_error_count nav badge).
-- The scraper integration is a follow-up against the v1 repo posting to
-- the same bp_log_error RPC.
--
-- Tenant pattern follows the rest of the repo: auth_tenant_ids() resolves
-- the caller's tenants from tenant_memberships; the BEFORE INSERT trigger
-- default_tenant_id_to_caller() stamps tenant_id; RLS + SECURITY DEFINER
-- RPCs filter explicitly via `= ANY(auth_tenant_ids())`.
--
-- Fingerprinting is server-side so it's consistent regardless of who logs:
-- strip ISO timestamps, strip 2+ digit integers (so '#10098' / '#10099'
-- fingerprint identically), collapse whitespace, lowercase, then md5
-- of `source|normalized`. Source is part of the hash so a 'permit not
-- found' from the scraper and one from a frontend toast cluster
-- separately.

CREATE TABLE IF NOT EXISTS public.error_reports (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email    text,
  source        text NOT NULL CHECK (source IN
                  ('frontend_toast','frontend_exception','backend_rpc','scraper')),
  level         text NOT NULL CHECK (level IN ('error','warning')),
  message       text NOT NULL,
  fingerprint   text NOT NULL,
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','queued','in_progress','resolved','dismissed')),
  backlog_ref   text,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS error_reports_default_tenant ON public.error_reports;
CREATE TRIGGER error_reports_default_tenant
  BEFORE INSERT ON public.error_reports
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

CREATE INDEX IF NOT EXISTS error_reports_fingerprint_idx
  ON public.error_reports(tenant_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS error_reports_status_idx
  ON public.error_reports(tenant_id, status, created_at DESC);

ALTER TABLE public.error_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS error_reports_tenant_select ON public.error_reports;
CREATE POLICY error_reports_tenant_select ON public.error_reports
  FOR SELECT USING (tenant_id = ANY(auth_tenant_ids()));

DROP POLICY IF EXISTS error_reports_tenant_insert ON public.error_reports;
CREATE POLICY error_reports_tenant_insert ON public.error_reports
  FOR INSERT WITH CHECK (tenant_id = ANY(auth_tenant_ids()));

DROP POLICY IF EXISTS error_reports_tenant_update ON public.error_reports;
CREATE POLICY error_reports_tenant_update ON public.error_reports
  FOR UPDATE USING (tenant_id = ANY(auth_tenant_ids()))
              WITH CHECK (tenant_id = ANY(auth_tenant_ids()));

-- ============================================================
-- bp_log_error: append-only logger. Computes the fingerprint server-side
-- so all clients (this app + the future scraper integration) hash messages
-- identically. Returns the new row's bigint id; frontend callers fire-and-
-- forget so they don't care about the return.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bp_log_error(
  p_source  text,
  p_level   text,
  p_message text,
  p_context jsonb DEFAULT '{}'::jsonb
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
  -- Normalize for fingerprinting: strip ISO timestamps, strip 2+ digit
  -- integers (permit ids, row ids), collapse whitespace, lowercase.
  v_normalized := lower(regexp_replace(
    regexp_replace(p_message, '\d{4}-\d{2}-\d{2}[T0-9:.+Z-]*', '<ts>', 'g'),
    '\s+', ' ', 'g'
  ));
  v_normalized := regexp_replace(v_normalized, '\b\d{2,}\b', '<num>', 'g');
  v_fingerprint := md5(p_source || '|' || trim(v_normalized));

  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  END IF;

  INSERT INTO public.error_reports
    (user_id, user_email, source, level, message, fingerprint, context)
  VALUES
    (v_user_id, v_user_email, p_source, p_level, p_message, v_fingerprint,
     COALESCE(p_context, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_log_error(text,text,text,jsonb) TO authenticated;

-- ============================================================
-- bp_list_error_groups: aggregate by fingerprint for the Errors page.
-- Returns one row per fingerprint with the most-recent source/level/
-- message/context/status sampled, plus count, user_count, first/last
-- seen, and a backlog_ref if any row in the group has one.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bp_list_error_groups(
  p_status text[] DEFAULT ARRAY['new','queued','in_progress']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
STABLE
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(g ORDER BY last_seen DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      fingerprint,
      (array_agg(source   ORDER BY created_at DESC))[1] AS source,
      (array_agg(level    ORDER BY created_at DESC))[1] AS level,
      (array_agg(message  ORDER BY created_at DESC))[1] AS sample_message,
      (array_agg(context  ORDER BY created_at DESC))[1] AS sample_context,
      (array_agg(status   ORDER BY created_at DESC))[1] AS status,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      COUNT(*)::int AS count,
      COUNT(DISTINCT user_id)::int AS user_count,
      (array_agg(backlog_ref ORDER BY created_at DESC)
        FILTER (WHERE backlog_ref IS NOT NULL))[1] AS backlog_ref
    FROM public.error_reports
    WHERE tenant_id = ANY(auth_tenant_ids())
      AND status = ANY(p_status)
    GROUP BY fingerprint
  ) g;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_list_error_groups(text[]) TO authenticated;

-- ============================================================
-- bp_update_error_group_status: bulk-update all rows sharing a fingerprint.
-- 'resolved'/'dismissed' stamp resolved_at + resolved_by; other statuses
-- clear them (so a status walk-back doesn't leave stale resolution data).
-- Returns the count of rows affected.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bp_update_error_group_status(
  p_fingerprint text,
  p_new_status  text,
  p_backlog_ref text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.error_reports SET
    status      = p_new_status,
    backlog_ref = COALESCE(p_backlog_ref, backlog_ref),
    resolved_at = CASE
      WHEN p_new_status IN ('resolved','dismissed') THEN now()
      ELSE NULL
    END,
    resolved_by = CASE
      WHEN p_new_status IN ('resolved','dismissed') THEN auth.uid()
      ELSE NULL
    END
  WHERE tenant_id = ANY(auth_tenant_ids())
    AND fingerprint = p_fingerprint;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_update_error_group_status(text,text,text)
  TO authenticated;

-- ============================================================
-- bp_new_error_count: cheap count of distinct unresolved fingerprints for
-- the nav warning-triangle badge.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bp_new_error_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
STABLE
AS $function$
  SELECT COUNT(DISTINCT fingerprint)::int
  FROM public.error_reports
  WHERE tenant_id = ANY(auth_tenant_ids())
    AND status = 'new';
$function$;

GRANT EXECUTE ON FUNCTION public.bp_new_error_count() TO authenticated;
