-- fix-145 (2026-06-09): edit a reuse-redesign's DD phase from Project Overview.
--
-- fix-144 creates a draw_schedule lane for a redesign_reuses_original_permit
-- redesign, but there was no EDIT path: that redesign has no BP permit, so the
-- Project Overview DDPhaseEditor never renders. This RPC lets the new inline
-- editor update the redesign's lane (DA / dates / status) atomically, OCC-safe.
--
-- dd_start forward-snaps to Monday; dd_end stays the user-entered Friday (the
-- UI snaps it to the end-week Friday client-side). start_week = snapped Monday,
-- end_week = Monday of dd_end's week — the grid's Monday-keyed convention.
-- manually_placed is re-set true on every edit (a deliberate redesign lane must
-- survive auto-rebalancing). INSERT-on-missing fallback so the editor still
-- works if a redesign somehow has no lane row yet.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_145_update_redesign_dd_phase". This file is the repo record.

CREATE OR REPLACE FUNCTION public.bp_update_redesign_dd_phase(
  p_project_id           uuid,
  p_da                   text,
  p_dd_start             date,
  p_dd_end               date,
  p_status               text,
  p_expected_updated_at  timestamptz
)
RETURNS TABLE (project_id uuid, updated_at timestamptz, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_snapped_start date;
  v_snapped_end   date;
  v_existing      timestamptz;
  v_new_upd       timestamptz;
BEGIN
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'p_project_id is required'; END IF;
  IF p_da IS NULL OR TRIM(p_da) = '' THEN RAISE EXCEPTION 'p_da is required'; END IF;
  IF p_dd_start IS NULL OR p_dd_end IS NULL THEN
    RAISE EXCEPTION 'dd_start and dd_end are required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.projects
   WHERE id = p_project_id AND tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found in caller tenant', p_project_id;
  END IF;

  v_snapped_start := snap_to_monday_forward(p_dd_start);
  v_snapped_end   := p_dd_end;  -- user picks; UI snaps to the end-week Friday

  SELECT updated_at INTO v_existing
  FROM public.draw_schedule
  WHERE project_id = p_project_id;

  IF v_existing IS NULL THEN
    -- No row yet (edge case): INSERT with manually_placed=true. No OCC check.
    INSERT INTO public.draw_schedule (
      tenant_id, project_id, da_assigned,
      start_week, end_week, dd_start, dd_end,
      status, manual_status, manually_placed, updated_at
    ) VALUES (
      v_tenant, p_project_id, TRIM(p_da),
      to_char(v_snapped_start, 'YYYY-MM-DD'),
      to_char(date_trunc('week', v_snapped_end)::date, 'YYYY-MM-DD'),
      v_snapped_start, v_snapped_end,
      COALESCE(NULLIF(TRIM(p_status), ''), 'Scheduled'), false, true, now()
    ) RETURNING updated_at INTO v_new_upd;
    project_id := p_project_id;
    updated_at := v_new_upd;
    conflict   := false;
    RETURN NEXT; RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_existing IS DISTINCT FROM p_expected_updated_at THEN
    project_id := p_project_id;
    updated_at := v_existing;
    conflict   := true;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.draw_schedule SET
    da_assigned = TRIM(p_da),
    start_week  = to_char(v_snapped_start, 'YYYY-MM-DD'),
    end_week    = to_char(date_trunc('week', v_snapped_end)::date, 'YYYY-MM-DD'),
    dd_start    = v_snapped_start,
    dd_end      = v_snapped_end,
    status      = COALESCE(NULLIF(TRIM(p_status), ''), status),
    manually_placed = true,  -- any explicit edit re-locks the manual flag
    updated_at  = now()
  WHERE project_id = p_project_id
  RETURNING updated_at INTO v_new_upd;

  project_id := p_project_id;
  updated_at := v_new_upd;
  conflict   := false;
  RETURN NEXT;
END;
$function$;
