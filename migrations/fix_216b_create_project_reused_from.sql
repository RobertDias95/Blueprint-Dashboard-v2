-- fix-216b: bp_create_project_with_permits stores reused_from_project_id.
--
-- Source of truth = the repo's fix-210 body (migrations/fix_210_redesign_permit_dd.sql).
-- This is that body verbatim with a TWO-TOKEN edit so a REUSE create persists the
-- provenance link:
--   1. INSERT INTO public.projects column list: + reused_from_project_id
--   2. VALUES: + NULLIF(v_pd->>'reused_from_project_id','')::uuid  (right after redesign_notes)
-- The column is nullable, so non-reuse creates (no key in p_project_data) insert
-- NULL — no behavior change. Already applied + validated on prod
-- (eibnmwthkcuumyclyxoe) via a rolled-back probe; committed here for repo parity.
CREATE OR REPLACE FUNCTION public.bp_create_project_with_permits(p_tenant_id uuid, p_address text, p_juris text, p_notes text, p_project_data jsonb, p_permits jsonb, p_manually_placed boolean DEFAULT false, p_redesign_dd_phase jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(project_id uuid, permit_ids integer[], conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id    uuid;
  v_existing_id   uuid;
  v_juris         text  := COALESCE(NULLIF(trim(p_juris), ''), 'Unknown');
  v_pd            jsonb := COALESCE(p_project_data, '{}'::jsonb);
  v_permit        jsonb;
  v_permit_id     integer;
  v_permit_ids    integer[] := ARRAY[]::integer[];
  v_permit_type   text;
  v_task_ids      uuid[];
  v_task_ids_raw  jsonb;
  v_product_types text[];
  v_lead_da       text := NULLIF(trim(COALESCE(v_pd->>'lead_da', '')), '');
  v_auto_dd_start date;
  v_auto_dd_end   date;
  v_bp_permit_id  integer := NULL;
  v_bp_dd_start   date;
  v_bp_dd_end     date;
  v_auto_placed   boolean := false;
  v_manual_dd_start date;
  v_manual_dd_end   date;
  v_reuses_permit boolean := COALESCE((v_pd->>'redesign_reuses_original_permit')::boolean, false);
  c_default_duration_days CONSTANT int := 26;
  v_primary_dd_start date;
  v_primary_dd_end   date;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_address IS NULL OR trim(p_address) = '' THEN RAISE EXCEPTION 'p_address is required'; END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_create_project_with_permits: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_reuses_permit AND (p_permits IS NULL OR jsonb_array_length(p_permits) = 0) THEN
    RAISE EXCEPTION 'p_permits must contain at least one permit';
  END IF;
  IF v_reuses_permit AND p_permits IS NOT NULL AND jsonb_array_length(p_permits) > 0 THEN
    RAISE NOTICE 'fix-126: redesign_reuses_original_permit=true but p_permits has % entries — skipping permit creation', jsonb_array_length(p_permits);
  END IF;

  SELECT id INTO v_existing_id FROM public.projects WHERE address = p_address;
  IF v_existing_id IS NOT NULL THEN
    project_id := v_existing_id; permit_ids := ARRAY[]::integer[]; conflict := true;
    RETURN NEXT; RETURN;
  END IF;

  IF v_pd ? 'product_types' AND jsonb_typeof(v_pd->'product_types') = 'array' THEN
    SELECT COALESCE(array_agg(value::text), ARRAY[]::text[]) INTO v_product_types
    FROM jsonb_array_elements_text(v_pd->'product_types') AS value WHERE NULLIF(value, '') IS NOT NULL;
  ELSE v_product_types := ARRAY[]::text[]; END IF;

  INSERT INTO public.projects (
    tenant_id, address, juris, notes, entitlement_lead, design_manager, acq_lead,
    go_date, units, zone, lot_width, lot_depth, unit_types,
    parking_type, parking_stalls, alley, product_types, project_tags,
    builder_name, builder_company, builder_email, builder_phone,
    builder_address, poc_name, poc_email,
    num_lots, is_corner_lot, closing_date,
    redesign_of_project_id, redesign_trigger,
    redesign_reuses_original_permit, redesign_notes, reused_from_project_id
  ) VALUES (
    p_tenant_id, p_address, v_juris, NULLIF(p_notes, ''),
    NULLIF(v_pd->>'entitlement_lead', ''), NULLIF(v_pd->>'design_manager', ''),
    NULLIF(v_pd->>'acq_lead', ''), NULLIF(v_pd->>'go_date', '')::date,
    NULLIF(v_pd->>'units', '')::int, NULLIF(v_pd->>'zone', ''),
    NULLIF(v_pd->>'lot_width', '')::numeric, NULLIF(v_pd->>'lot_depth', '')::numeric,
    CASE WHEN v_pd ? 'unit_types' AND jsonb_typeof(v_pd->'unit_types') = 'array' THEN v_pd->'unit_types' ELSE NULL END,
    NULLIF(v_pd->>'parking_type', ''), NULLIF(v_pd->>'parking_stalls', '')::int,
    NULLIF(v_pd->>'alley', ''), v_product_types,
    CASE WHEN v_pd ? 'project_tags' AND jsonb_typeof(v_pd->'project_tags') = 'array' THEN v_pd->'project_tags' ELSE NULL END,
    NULLIF(v_pd->>'builder_name', ''), NULLIF(v_pd->>'builder_company', ''),
    NULLIF(v_pd->>'builder_email', ''), NULLIF(v_pd->>'builder_phone', ''),
    NULLIF(v_pd->>'builder_address', ''), NULLIF(v_pd->>'poc_name', ''), NULLIF(v_pd->>'poc_email', ''),
    NULLIF(v_pd->>'num_lots', '')::int,
    CASE WHEN v_pd ? 'is_corner_lot' THEN (v_pd->>'is_corner_lot')::boolean ELSE NULL END,
    NULLIF(v_pd->>'closing_date', '')::date,
    NULLIF(v_pd->>'redesign_of_project_id', '')::uuid,
    NULLIF(v_pd->>'redesign_trigger', ''),
    CASE WHEN v_pd ? 'redesign_reuses_original_permit' THEN (v_pd->>'redesign_reuses_original_permit')::boolean ELSE NULL END,
    NULLIF(v_pd->>'redesign_notes', ''), NULLIF(v_pd->>'reused_from_project_id', '')::uuid
  ) ON CONFLICT (address) DO NOTHING RETURNING id INTO v_project_id;

  IF v_project_id IS NULL THEN
    SELECT id INTO v_project_id FROM public.projects WHERE address = p_address;
    project_id := v_project_id; permit_ids := ARRAY[]::integer[]; conflict := true;
    RETURN NEXT; RETURN;
  END IF;

  IF COALESCE(TRIM(v_pd->>'builder_name'), '') <> '' THEN
    INSERT INTO public.builders (name, company, email, phone, address, tenant_id)
    VALUES (TRIM(v_pd->>'builder_name'),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_company', '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_email',   '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_phone',   '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_address', '')), ''),
      p_tenant_id)
    ON CONFLICT (name, company) DO UPDATE
      SET address = COALESCE(EXCLUDED.address, public.builders.address);
  END IF;

  IF v_reuses_permit THEN
    IF p_redesign_dd_phase IS NOT NULL THEN
      INSERT INTO public.draw_schedule (
        tenant_id, project_id, da_assigned,
        start_week, end_week, dd_start, dd_end,
        status, manual_status, manually_placed
      ) VALUES (
        p_tenant_id, v_project_id,
        p_redesign_dd_phase->>'da',
        to_char(snap_to_monday_forward((p_redesign_dd_phase->>'dd_start')::date), 'YYYY-MM-DD'),
        to_char(date_trunc('week', (p_redesign_dd_phase->>'dd_end')::date)::date, 'YYYY-MM-DD'),
        snap_to_monday_forward((p_redesign_dd_phase->>'dd_start')::date),
        (p_redesign_dd_phase->>'dd_end')::date,
        'Scheduled', false, true
      ) ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
    END IF;
    project_id := v_project_id; permit_ids := ARRAY[]::integer[]; conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lead_da IS NOT NULL THEN
    SELECT s.slot_start, s.slot_end INTO v_auto_dd_start, v_auto_dd_end
    FROM public.bp_next_available_da_slot(v_lead_da, c_default_duration_days, current_date) s;
    IF v_auto_dd_start IS NOT NULL THEN
      v_auto_dd_start := snap_to_monday_forward(v_auto_dd_start);
      v_auto_dd_end   := v_auto_dd_start + (c_default_duration_days - 1);
    END IF;
  END IF;

  FOR v_permit IN SELECT * FROM jsonb_array_elements(p_permits) LOOP
    v_permit_type := v_permit->>'type';
    IF v_permit_type IS NULL OR trim(v_permit_type) = '' THEN RAISE EXCEPTION 'each permit must have a non-empty type'; END IF;
    v_task_ids_raw := v_permit->'task_template_ids';
    IF v_task_ids_raw IS NULL OR jsonb_typeof(v_task_ids_raw) <> 'array' THEN
      RAISE EXCEPTION 'permit type % missing task_template_ids array', v_permit_type;
    END IF;
    SELECT COALESCE(array_agg((value #>> '{}')::uuid), ARRAY[]::uuid[]) INTO v_task_ids FROM jsonb_array_elements(v_task_ids_raw);
    v_bp_dd_start := NULLIF(v_permit->>'dd_start', '')::date;
    v_bp_dd_end   := NULLIF(v_permit->>'dd_end',   '')::date;
    IF v_permit_type = 'Building Permit' AND v_bp_permit_id IS NULL THEN
      IF v_lead_da IS NOT NULL AND v_auto_dd_start IS NOT NULL AND v_bp_dd_start IS NULL AND v_bp_dd_end IS NULL THEN
        v_bp_dd_start := v_auto_dd_start; v_bp_dd_end := v_auto_dd_end; v_auto_placed := true;
      ELSIF v_bp_dd_start IS NOT NULL AND v_bp_dd_end IS NOT NULL THEN
        v_manual_dd_start := v_bp_dd_start; v_manual_dd_end := v_bp_dd_end;
      END IF;
    END IF;
    INSERT INTO public.permits (
      tenant_id, project_id, type, num, ent_lead, dm, da, dual_da, architect,
      target_submit, expected_issue, dd_start, dd_end, kickoff_date, stage, status, notes
    ) VALUES (
      p_tenant_id, v_project_id, v_permit_type, NULLIF(v_permit->>'num', ''), NULLIF(v_permit->>'ent_lead', ''),
      NULLIF(v_permit->>'dm', ''), NULLIF(v_permit->>'da', ''), NULLIF(v_permit->>'dual_da', ''), NULLIF(v_permit->>'architect', ''),
      COALESCE(NULLIF(v_permit->>'target_submit', '')::date,
        CASE WHEN v_permit_type = 'Building Permit' AND v_bp_dd_end IS NOT NULL THEN (v_bp_dd_end + INTERVAL '21 days')::date ELSE NULL END),
      NULLIF(v_permit->>'expected_issue', '')::date, v_bp_dd_start, v_bp_dd_end,
      NULLIF(v_permit->>'kickoff_date', '')::date, 'de', 'Pre-Submittal — GO', NULLIF(p_notes, '')
    ) RETURNING id INTO v_permit_id;
    v_permit_ids := array_append(v_permit_ids, v_permit_id);
    IF v_permit_type = 'Building Permit' AND v_bp_permit_id IS NULL THEN v_bp_permit_id := v_permit_id; END IF;
    INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index) VALUES (p_tenant_id, v_permit_id, 0);
    IF array_length(v_task_ids, 1) > 0 THEN
      INSERT INTO public.permit_tasks (
        tenant_id, permit_id, bucket, text, cat,
        assigned_to, co_assignees, waiting_on,
        sort_order, is_jurisdiction_specific
      )
      SELECT
        p_tenant_id, v_permit_id, tt.bucket, tt.text, tt.cat,
        CASE tt.default_team
          WHEN 'Entitlements' THEN NULLIF(v_permit->>'ent_lead', '')
          WHEN 'Architecture' THEN NULLIF(v_permit->>'da', '')
          ELSE NULLIF(tt.default_team, '')
        END AS assigned_to,
        COALESCE(tt.default_co_assignees, ARRAY[]::text[]) AS co_assignees,
        tt.default_waiting_on AS waiting_on,
        COALESCE(tt.sort_order, 0),
        (tt.jurisdiction IS NOT NULL)
      FROM public.task_templates tt
      WHERE tt.id = ANY(v_task_ids)
        AND tt.permit_type = v_permit_type
        AND (tt.jurisdiction = v_juris OR tt.jurisdiction IS NULL);
    END IF;
  END LOOP;

  -- fix-210: write the redesign DD window to the PERMIT(s), not just the block.
  -- A redesign sends its window only in p_redesign_dd_phase, so the BP(s) above
  -- were created with NULL dd_start/dd_end. Apply the SAME window that drives the
  -- block to every non-sub Building Permit (so permit + block agree, and the
  -- fix-208 unify below then has a real primary to snap to), and set
  -- target_submit = dd_end + 21 explicitly (no trigger recomputes it on a
  -- create-time dd_end UPDATE). The REUSE path returns earlier and never reaches
  -- here, so it is untouched.
  IF p_redesign_dd_phase IS NOT NULL THEN
    v_primary_dd_start := snap_to_monday_forward((p_redesign_dd_phase->>'dd_start')::date);
    v_primary_dd_end   := (p_redesign_dd_phase->>'dd_end')::date;
    UPDATE public.permits AS pp
      SET dd_start      = v_primary_dd_start,
          dd_end        = v_primary_dd_end,
          target_submit = (v_primary_dd_end + INTERVAL '21 days')::date
      WHERE pp.project_id = v_project_id
        AND pp.type = 'Building Permit'
        AND pp.parent_permit_id IS NULL;
  END IF;

  -- fix-208: ONE holistic project DD window — snap every non-sub Building Permit
  -- to the primary (first non-sub) BP's window. Sub-permits are excluded. The
  -- table is aliased because an unqualified project_id collides with the
  -- RETURNS TABLE(project_id ...) OUT variable.
  IF v_bp_permit_id IS NOT NULL THEN
    SELECT pp.dd_start, pp.dd_end INTO v_primary_dd_start, v_primary_dd_end
      FROM public.permits pp WHERE pp.id = v_bp_permit_id;
    UPDATE public.permits AS pp
      SET dd_start = v_primary_dd_start, dd_end = v_primary_dd_end
      WHERE pp.project_id = v_project_id
        AND pp.type = 'Building Permit'
        AND pp.parent_permit_id IS NULL
        AND pp.id <> v_bp_permit_id
        AND (pp.dd_start IS DISTINCT FROM v_primary_dd_start
             OR pp.dd_end IS DISTINCT FROM v_primary_dd_end);
  END IF;

  IF p_redesign_dd_phase IS NOT NULL THEN
    INSERT INTO public.draw_schedule (tenant_id, project_id, da_assigned, start_week, end_week, dd_start, dd_end, status, manual_status, manually_placed)
    VALUES (p_tenant_id, v_project_id,
      p_redesign_dd_phase->>'da',
      to_char(snap_to_monday_forward((p_redesign_dd_phase->>'dd_start')::date), 'YYYY-MM-DD'),
      to_char(date_trunc('week', (p_redesign_dd_phase->>'dd_end')::date)::date, 'YYYY-MM-DD'),
      snap_to_monday_forward((p_redesign_dd_phase->>'dd_start')::date),
      (p_redesign_dd_phase->>'dd_end')::date,
      'Scheduled', false, true)
    ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
  ELSIF v_auto_placed THEN
    INSERT INTO public.draw_schedule (tenant_id, project_id, da_assigned, start_week, end_week, dd_start, dd_end, status, manual_status, manually_placed)
    VALUES (p_tenant_id, v_project_id, v_lead_da, to_char(v_auto_dd_start, 'YYYY-MM-DD'),
      to_char(date_trunc('week', v_auto_dd_end)::date, 'YYYY-MM-DD'),
      v_auto_dd_start, v_auto_dd_end, 'Scheduled', false, false) ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
  ELSIF v_manual_dd_start IS NOT NULL AND v_manual_dd_end IS NOT NULL AND v_lead_da IS NOT NULL THEN
    INSERT INTO public.draw_schedule (tenant_id, project_id, da_assigned, start_week, end_week, dd_start, dd_end, status, manual_status, manually_placed)
    VALUES (p_tenant_id, v_project_id, v_lead_da,
      to_char(snap_to_monday_forward(v_manual_dd_start), 'YYYY-MM-DD'),
      to_char(date_trunc('week', v_manual_dd_end)::date, 'YYYY-MM-DD'),
      snap_to_monday_forward(v_manual_dd_start), v_manual_dd_end, 'Scheduled', false, p_manually_placed)
    ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
  END IF;

  project_id := v_project_id; permit_ids := v_permit_ids; conflict := false;
  RETURN NEXT;
END;
$function$;
