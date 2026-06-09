-- fix-147 (2026-06-09): the ent_lead cascade must not stomp explicit picks.
--
-- bp_cascade_ent_lead_for_project (fix-72) auto-fills each permit's ent_lead
-- from its DA's da_team_routing whenever the DA changes. Its first UPDATE did
-- this UNCONDITIONALLY: Bobby explicitly set ENT=Briana on 3623 SW Othello St's
-- Demolition permit, then set DA=Cam — the cascade silently overwrote Briana →
-- Miles (Cam routes to Miles). The routing data is correct; the cascade just
-- shouldn't override a deliberate choice.
--
-- The only change: add `AND p.ent_lead IS NULL` to the first UPDATE so it auto-
-- fills ONLY when there's no pick yet. To re-trigger the cascade on a permit
-- that already has an ent_lead, the user clears it first, then changes the DA.
--
-- The second UPDATE (BP ent_lead propagating down to NULL-DA permits) is left
-- unchanged — it's already gated on `p.ent_lead IS NOT DISTINCT FROM
-- v_old_bp_ent_lead`, so it only touches permits that were following the BP.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_147_cascade_respects_explicit_ent_lead". This file is the repo record.

CREATE OR REPLACE FUNCTION public.bp_cascade_ent_lead_for_project(p_project_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants            uuid[] := public.auth_tenant_ids();
  v_count_da_permits   integer := 0;
  v_count_null_permits integer := 0;
  v_count_tasks        integer := 0;
  v_old_bp_ent_lead    text;
  v_new_bp_ent_lead    text;
BEGIN
  SELECT ent_lead INTO v_old_bp_ent_lead FROM public.permits
    WHERE project_id = p_project_id AND type = 'Building Permit' ORDER BY id ASC LIMIT 1;
  UPDATE public.permits p
  SET ent_lead = public.bp_ent_lead_for_da(p.da, pr.juris), updated_at = now()
  FROM public.projects pr WHERE p.project_id = p_project_id AND pr.id = p.project_id
    AND p.tenant_id = ANY (v_tenants)
    AND p.ent_lead IS NULL  -- fix-147: don't stomp explicit picks
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS NOT NULL
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS DISTINCT FROM p.ent_lead;
  GET DIAGNOSTICS v_count_da_permits = ROW_COUNT;
  SELECT ent_lead INTO v_new_bp_ent_lead FROM public.permits
    WHERE project_id = p_project_id AND type = 'Building Permit' ORDER BY id ASC LIMIT 1;
  IF v_new_bp_ent_lead IS NOT NULL AND v_old_bp_ent_lead IS NOT NULL
     AND v_new_bp_ent_lead IS DISTINCT FROM v_old_bp_ent_lead THEN
    UPDATE public.permits p
    SET ent_lead = v_new_bp_ent_lead, updated_at = now()
    FROM public.projects pr WHERE p.project_id = p_project_id AND pr.id = p.project_id
      AND p.tenant_id = ANY (v_tenants) AND p.da IS NULL
      AND p.ent_lead IS NOT DISTINCT FROM v_old_bp_ent_lead
      AND v_new_bp_ent_lead IS DISTINCT FROM p.ent_lead;
    GET DIAGNOSTICS v_count_null_permits = ROW_COUNT;
    UPDATE public.permit_tasks SET assigned_to = v_new_bp_ent_lead
    WHERE permit_id IN (SELECT id FROM public.permits WHERE project_id = p_project_id)
      AND assigned_to IS NOT NULL AND assigned_to = v_old_bp_ent_lead;
    GET DIAGNOSTICS v_count_tasks = ROW_COUNT;
  END IF;
  RETURN COALESCE(v_count_da_permits, 0)
       + COALESCE(v_count_null_permits, 0)
       + COALESCE(v_count_tasks, 0);
END;
$function$;
