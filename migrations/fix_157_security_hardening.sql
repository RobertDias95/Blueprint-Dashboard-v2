-- fix-157 (2026-06-12): Security hardening — audit follow-up.
--
-- IT security audit (Keenan, 2026-05-26) passed with three hardening flags,
-- grounded by Supabase advisors (2026-06-12):
--   * 60 SECURITY DEFINER functions executable by `anon` (the public key role)
--   * 34 functions with a mutable search_path
--   * juris_permit_stats materialized view exposed in the API to anon
-- Signups are disabled and the app makes ZERO Supabase data calls before login
-- (verified: all 31 query hooks gate on `enabled: !!tenantId`; the only pre-auth
-- call is supabase.auth.getSession()). So `anon` has no legitimate RPC use.
--
-- Migration applied to prod via MCP; this file is the repo backstop. Every
-- CREATE OR REPLACE is based on the LIVE prod definition (migrations/ is a
-- partial record; prod is ahead — bp_create_lifecycle_task was last changed by
-- fix-156).

-- ============================================================================
-- A. Revoke anon function access.
--
-- IMPORTANT (probe finding): 111 of 133 public functions grant EXECUTE to
-- PUBLIC (not just to `anon` directly), so `REVOKE ... FROM anon` ALONE leaves
-- anon executing them via PUBLIC. We must revoke PUBLIC too. That is safe here:
-- every one of the 133 functions also has an EXPLICIT authenticated +
-- service_role grant (0 rely solely on PUBLIC), so those roles keep EXECUTE.
-- The leading GRANT is belt-and-suspenders to guarantee that invariant.
-- ============================================================================
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Future functions: drop the PUBLIC/anon default; keep the privileged roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Carve-out (Step 0.4): the RLS policies on all 8 realtime-subscribed tables
-- (projects, permits, permit_cycles, permit_tasks, draw_schedule, intake_records,
-- permit_cycle_reviewers, error_reports) call auth_tenant_ids(). The app mounts a
-- realtime channel at the root (useRealtimeInvalidation) that subscribes to these
-- tables BEFORE login — pre-auth, postgres_changes evaluates their RLS as `anon`.
-- Without EXECUTE here that eval errors "permission denied for function"; with it,
-- anon's empty JWT yields an empty tenant array → RLS denies every row (no leak).
-- This is the ONLY public function any anon-reachable RLS policy needs, so it's
-- the single intentional exception. (Advisor delta is therefore 60→1, not 60→0.)
GRANT EXECUTE ON FUNCTION public.auth_tenant_ids() TO anon;

-- ============================================================================
-- B. Pin search_path on the 34 flagged functions. Generated programmatically
--    from pg_proc (correct signatures); includes trigger functions.
-- ============================================================================
ALTER FUNCTION public._rbcol(p_key text, p_label text, p_type text, p_filterable boolean, p_source text) SET search_path = public, pg_temp;
ALTER FUNCTION public._report_col_sql(p_entity text, p_key text) SET search_path = public, pg_temp;
ALTER FUNCTION public._report_from_sql(p_entity text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_da_time_block_row(p_id text, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_dm_da_group_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_draw_schedule_row(p_project_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_intake_records_row(p_id integer, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_jurisdiction(p_name text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_permit_cycle_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_permit_task_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_permit_type(p_name text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_task_template_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_task_template_subtask_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_delete_team_member_row(p_id uuid, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_member_active_in_quarter(p_active_start text, p_active_end text, p_quarter text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_rename_da(p_old text, p_new text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_rename_dm(p_old text, p_new text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_set_app_config_key(p_key text, p_value jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_swap_intake_dates(p_id_a integer, p_id_b integer, p_expected_a timestamp with time zone, p_expected_b timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_sync_draw_schedule_da() SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_trg_task_done_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_da_time_block_row(p_id text, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_dm_da_group_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_draw_schedule_row(p_project_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_intake_records_row(p_id integer, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_jurisdiction(p_name text, p_learn_window_days integer, p_notes text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_permit_task_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_permit_type(p_name text, p_is_builtin boolean, p_notes text) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_task_template_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_task_template_subtask_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_upsert_team_member_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.bp_week_key_to_date(p_week_key text) SET search_path = public, pg_temp;
ALTER FUNCTION public.snap_to_monday_forward(p_date date) SET search_path = public, pg_temp;

-- ============================================================================
-- C. Tighten the service-path tenant gates.
--
-- bp_create_lifecycle_task + bp_generate_number_entry_tasks previously SKIPPED
-- tenant validation whenever auth_tenant_ids() was empty (the scraper path) —
-- but ANY no-JWT EXECUTE-holder hit that. Harden: the no-membership path is
-- allowed only for the scraper on the service key (auth.role() = 'service_role');
-- every other caller must own the target tenant. Bodies are the LIVE prod
-- definitions (fix-156) with only the gate changed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(
  p_tenant_id uuid, p_permit_id integer, p_event text,
  p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_permit         public.permits%ROWTYPE;
  v_project_addr   text;
  v_num_label      text;
  v_cycle_label    text;
  v_title          text;
  v_bucket         text;
  v_city_check     boolean := false;
  v_priority       boolean := false;
  v_notes          text;
  v_new_id         uuid;
BEGIN
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  -- fix-157: harden the tenant gate. The no-auth-context path is for the scraper
  -- on the service key ONLY; every other caller must own the target tenant.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_permit
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: permit % not found in tenant %',
      p_permit_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT address INTO v_project_addr
  FROM public.projects WHERE id = v_permit.project_id;

  v_num_label   := COALESCE(NULLIF(btrim(v_permit.num), ''), 'no number yet');
  v_cycle_label := COALESCE(p_cycle_idx::text, '?');

  v_bucket := CASE WHEN p_event = 'number_entry' THEN 'de' ELSE 'pm' END;

  CASE p_event
    WHEN 'intake_submitted' THEN
      v_title := 'Verify: intake submitted / fees paid — ' || v_num_label;
      v_city_check := true;
    WHEN 'intake_accepted' THEN
      v_title := 'Verify: intake accepted — reviews starting — ' || v_num_label;
    WHEN 'corr_issued' THEN
      v_title := 'Corrections issued (cycle ' || v_cycle_label
                 || ') — send to consultants — ' || v_num_label;
      v_priority := true;
    WHEN 'resubmitted' THEN
      v_title := 'Verify: city accepted resubmission (cycle ' || v_cycle_label
                 || ') — ' || v_num_label;
      v_city_check := true;
    WHEN 'number_entry' THEN
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project');
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  INSERT INTO public.permit_tasks (
    tenant_id, permit_id, text, discipline, bucket, stage,
    completion_status, done, is_auto_generated, auto_event, cycle_idx,
    city_acceptance_check, priority, notes, sort_order
  ) VALUES (
    p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
    'Open', false, true, p_event, p_cycle_idx,
    v_city_check, v_priority, v_notes, 0
  )
  ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
    WHERE is_auto_generated = true
  DO NOTHING
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bp_generate_number_entry_tasks(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[];
  v_today   date := current_date;
  v_count   integer := 0;
  v_tenant  uuid;
  v_permit  record;
  v_made    uuid;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    -- fix-157: an explicit tenant is the scraper/service path; a non-service
    -- caller may only target a tenant it belongs to.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
    THEN
      RAISE EXCEPTION 'bp_generate_number_entry_tasks: tenant % not in caller scope', p_tenant_id
        USING ERRCODE = '42501';
    END IF;
    v_tenants := ARRAY[p_tenant_id];
  ELSE
    v_tenants := public.auth_tenant_ids();
  END IF;
  IF v_tenants IS NULL OR array_length(v_tenants, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    IF EXISTS (
      SELECT 1 FROM public.app_sweeps
      WHERE tenant_id = v_tenant AND sweep_name = 'number_entry' AND last_swept_on >= v_today
    ) THEN
      CONTINUE;
    END IF;

    FOR v_permit IN
      SELECT p.id FROM public.permits p
      WHERE p.tenant_id = v_tenant
        AND (p.num IS NULL OR btrim(p.num) = '')
        AND p.target_submit IS NOT NULL
        AND p.target_submit <= v_today
        AND COALESCE(btrim(p.status), '') NOT IN (
          'Conceptually Approved','Approved','Issued','Completed','Closed',
          'Ready for Issuance','Ready To Issue','Finaled','Withdrawn')
    LOOP
      v_made := public.bp_create_lifecycle_task(v_tenant, v_permit.id, 'number_entry', NULL, '{}'::jsonb);
      IF v_made IS NOT NULL THEN v_count := v_count + 1; END IF;
    END LOOP;

    INSERT INTO public.app_sweeps (tenant_id, sweep_name, last_swept_on, updated_at)
    VALUES (v_tenant, 'number_entry', v_today, now())
    ON CONFLICT (tenant_id, sweep_name)
    DO UPDATE SET last_swept_on = EXCLUDED.last_swept_on, updated_at = now();
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Re-assert grants on the two replaced functions (authenticated for the app's
-- Dashboard sweep call; service_role for the scraper). NOT anon.
GRANT EXECUTE ON FUNCTION public.bp_create_lifecycle_task(uuid, integer, text, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_generate_number_entry_tasks(uuid) TO authenticated, service_role;

-- ============================================================================
-- D. Materialized view: remove API exposure. juris_permit_stats is read only
--    through bp_get_juris_permit_stats, which is SECURITY DEFINER (reads it as
--    owner) — so neither anon nor authenticated needs direct access. The matview
--    currently grants full privileges to both; strip them. service_role (admin)
--    retains access.
-- ============================================================================
REVOKE ALL ON public.juris_permit_stats FROM anon, authenticated;

-- ============================================================================
-- E. Intentionally left as-is (RLS-enabled, no-policy INFO lints):
--    app_sweeps + _fix22_permits_dropped_cols_snapshot are reached only by
--    SECURITY DEFINER / service paths that bypass RLS; denying all direct client
--    access (no policy) is the intended posture. Not changed here.
--    Leaked-password protection is a Supabase dashboard toggle (Bobby), not code.
-- ============================================================================
