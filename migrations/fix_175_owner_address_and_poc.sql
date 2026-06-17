-- fix-175 (v2): owner LLC address (on builder) + per-project point-of-contact
--
-- Scope A — schema:
--   * builders.address       — canonical entity address (drives autofill-on-pick
--                              so the address "travels" across that owner's projects)
--   * projects.builder_address — denormalized display cache, mirrors the existing
--                              builder_name/company/email/phone columns (so the
--                              Overview inline cell can read/write it via the plain
--                              projects UPDATE path, identical to its 4 siblings)
--   * projects.poc_name / projects.poc_email — per-project point-of-contact
--
-- Scope B — RPCs:
--   * bp_create_project_with_permits: projects INSERT + builders upsert carry
--     address/poc; builders upsert switches ON CONFLICT DO NOTHING -> DO UPDATE
--     SET address = COALESCE(EXCLUDED.address, builders.address) so a form-submit
--     refreshes the catalog address without a blank wiping it.
--   * bp_update_project_with_permits: same projects/builders changes, PLUS the
--     fix-163 tenant gate (this writer derived v_tenant from the row but never
--     checked it against the caller's scope — closing that cross-tenant gap).
--
-- migrations/ is partial; prod (eibnmwthkcuumyclyxoe) is canon. Both function
-- bodies below are re-emitted from the LIVE pg_get_functiondef with only the
-- additive fix-175 changes layered in.

-- ---------------------------------------------------------------------------
-- Scope A — columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.builders ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS builder_address text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS poc_name text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS poc_email text;

-- ---------------------------------------------------------------------------
-- Scope B.1 — bp_create_project_with_permits
-- ---------------------------------------------------------------------------
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
    redesign_reuses_original_permit, redesign_notes
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
    NULLIF(v_pd->>'redesign_notes', '')
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

-- ---------------------------------------------------------------------------
-- Scope B.2 — bp_update_project_with_permits
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_update_project_with_permits(p_project_id uuid, p_project_expected_updated_at timestamp with time zone, p_project_patch jsonb, p_permit_upserts jsonb, p_permit_deletes integer[])
 RETURNS TABLE(out_conflict boolean, out_conflict_kind text, out_conflict_id text, out_project_updated_at timestamp with time zone, out_permits jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant       uuid;
  v_patch        jsonb := COALESCE(p_project_patch, '{}'::jsonb);
  v_upserts      jsonb := COALESCE(p_permit_upserts, '[]'::jsonb);
  v_deletes      integer[] := COALESCE(p_permit_deletes, ARRAY[]::integer[]);
  v_rows         integer;
  v_proj_ua      timestamptz;
  v_permits_out  jsonb := '[]'::jsonb;
  v_elem         jsonb;
  v_pid          integer;
  v_pua          timestamptz;
  v_ptype        text;
  v_del          integer;
  v_occ          boolean := false;
  v_kind         text;
  v_cid          text;
  v_product_types text[];
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'p_project_id is required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.projects WHERE id = p_project_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;

  -- fix-175 / fix-163 tenant gate: this writer derived v_tenant from the row but
  -- never checked it against the caller's scope. SECURITY DEFINER bypasses RLS, so
  -- without this an authenticated caller could update any project by id. Placed
  -- BEFORE the BEGIN..EXCEPTION block so the 42501 is NOT swallowed as an occ path.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (v_tenant = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_update_project_with_permits: tenant % not in caller scope', v_tenant
      USING ERRCODE = '42501';
  END IF;

  IF v_patch ? 'product_types' AND jsonb_typeof(v_patch->'product_types') = 'array' THEN
    SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
    INTO v_product_types
    FROM jsonb_array_elements_text(v_patch->'product_types') AS value
    WHERE NULLIF(value, '') IS NOT NULL;
  ELSE
    v_product_types := ARRAY[]::text[];
  END IF;

  BEGIN
    IF v_patch <> '{}'::jsonb THEN
      UPDATE public.projects SET
        address          = CASE WHEN v_patch ? 'address'          THEN NULLIF(v_patch->>'address','')             ELSE address END,
        juris            = CASE WHEN v_patch ? 'juris'             THEN NULLIF(v_patch->>'juris','')               ELSE juris END,
        acq_lead         = CASE WHEN v_patch ? 'acq_lead'          THEN NULLIF(v_patch->>'acq_lead','')            ELSE acq_lead END,
        notes            = CASE WHEN v_patch ? 'notes'             THEN v_patch->>'notes'                          ELSE notes END,
        archived         = CASE WHEN v_patch ? 'archived'          THEN (v_patch->>'archived')::boolean            ELSE archived END,
        go_date          = CASE WHEN v_patch ? 'go_date'           THEN NULLIF(v_patch->>'go_date','')::date        ELSE go_date END,
        units            = CASE WHEN v_patch ? 'units'             THEN NULLIF(v_patch->>'units','')::int           ELSE units END,
        zone             = CASE WHEN v_patch ? 'zone'              THEN NULLIF(v_patch->>'zone','')                 ELSE zone END,
        lot_width        = CASE WHEN v_patch ? 'lot_width'         THEN NULLIF(v_patch->>'lot_width','')::numeric    ELSE lot_width END,
        lot_depth        = CASE WHEN v_patch ? 'lot_depth'         THEN NULLIF(v_patch->>'lot_depth','')::numeric    ELSE lot_depth END,
        parking_type     = CASE WHEN v_patch ? 'parking_type'      THEN NULLIF(v_patch->>'parking_type','')         ELSE parking_type END,
        parking_stalls   = CASE WHEN v_patch ? 'parking_stalls'    THEN NULLIF(v_patch->>'parking_stalls','')::int   ELSE parking_stalls END,
        alley            = CASE WHEN v_patch ? 'alley'             THEN NULLIF(v_patch->>'alley','')                ELSE alley END,
        product_types    = CASE WHEN v_patch ? 'product_types'     THEN v_product_types                              ELSE product_types END,
        entitlement_lead = CASE WHEN v_patch ? 'entitlement_lead'  THEN NULLIF(v_patch->>'entitlement_lead','')     ELSE entitlement_lead END,
        design_manager   = CASE WHEN v_patch ? 'design_manager'    THEN NULLIF(v_patch->>'design_manager','')       ELSE design_manager END,
        builder_name     = CASE WHEN v_patch ? 'builder_name'      THEN NULLIF(v_patch->>'builder_name','')         ELSE builder_name END,
        builder_company  = CASE WHEN v_patch ? 'builder_company'   THEN NULLIF(v_patch->>'builder_company','')      ELSE builder_company END,
        builder_email    = CASE WHEN v_patch ? 'builder_email'     THEN NULLIF(v_patch->>'builder_email','')        ELSE builder_email END,
        builder_phone    = CASE WHEN v_patch ? 'builder_phone'     THEN NULLIF(v_patch->>'builder_phone','')        ELSE builder_phone END,
        builder_address  = CASE WHEN v_patch ? 'builder_address'   THEN NULLIF(v_patch->>'builder_address','')      ELSE builder_address END,
        poc_name         = CASE WHEN v_patch ? 'poc_name'          THEN NULLIF(v_patch->>'poc_name','')             ELSE poc_name END,
        poc_email        = CASE WHEN v_patch ? 'poc_email'         THEN NULLIF(v_patch->>'poc_email','')            ELSE poc_email END
      WHERE id = p_project_id
        AND updated_at = p_project_expected_updated_at;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        v_occ := true; v_kind := 'project'; v_cid := p_project_id::text;
        RAISE EXCEPTION 'occ_conflict';
      END IF;

      IF COALESCE(TRIM(v_patch->>'builder_name'), '') <> '' THEN
        INSERT INTO public.builders (name, company, email, phone, address, tenant_id)
        VALUES (
          TRIM(v_patch->>'builder_name'),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_company','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_email','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_phone','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_address','')), ''),
          v_tenant
        )
        ON CONFLICT (name, company) DO UPDATE
          SET address = COALESCE(EXCLUDED.address, public.builders.address);
      END IF;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_upserts)
    LOOP
      IF v_elem ? 'id' AND NULLIF(v_elem->>'id','') IS NOT NULL THEN
        UPDATE public.permits SET
          type           = CASE WHEN v_elem ? 'type'           THEN NULLIF(v_elem->>'type','')            ELSE type END,
          ent_lead       = CASE WHEN v_elem ? 'ent_lead'       THEN NULLIF(v_elem->>'ent_lead','')        ELSE ent_lead END,
          da             = CASE WHEN v_elem ? 'da'             THEN NULLIF(v_elem->>'da','')              ELSE da END,
          portal_url     = CASE WHEN v_elem ? 'portal_url'     THEN NULLIF(v_elem->>'portal_url','')      ELSE portal_url END,
          num            = CASE WHEN v_elem ? 'num'            THEN NULLIF(v_elem->>'num','')             ELSE num END,
          struct_address = CASE WHEN v_elem ? 'struct_address' THEN NULLIF(v_elem->>'struct_address','')  ELSE struct_address END,
          expected_issue = CASE WHEN v_elem ? 'expected_issue' THEN NULLIF(v_elem->>'expected_issue','')::date ELSE expected_issue END,
          target_submit  = CASE WHEN v_elem ? 'target_submit'  THEN NULLIF(v_elem->>'target_submit','')::date  ELSE target_submit  END
        WHERE id = (v_elem->>'id')::int
          AND project_id = p_project_id
          AND updated_at = (v_elem->>'expected_updated_at')::timestamptz
        RETURNING id, updated_at INTO v_pid, v_pua;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 0 THEN
          v_occ := true; v_kind := 'permit'; v_cid := v_elem->>'id';
          RAISE EXCEPTION 'occ_conflict';
        END IF;
        v_permits_out := v_permits_out || jsonb_build_object('id', v_pid, 'updated_at', v_pua);
      ELSE
        v_ptype := NULLIF(v_elem->>'type','');
        IF v_ptype IS NULL THEN
          RAISE EXCEPTION 'new permit requires a non-empty type';
        END IF;
        INSERT INTO public.permits (
          tenant_id, project_id, type, ent_lead, da, portal_url, num,
          struct_address, expected_issue, target_submit, stage, status
        ) VALUES (
          v_tenant, p_project_id, v_ptype,
          NULLIF(v_elem->>'ent_lead',''),
          NULLIF(v_elem->>'da',''),
          NULLIF(v_elem->>'portal_url',''),
          NULLIF(v_elem->>'num',''),
          NULLIF(v_elem->>'struct_address',''),
          NULLIF(v_elem->>'expected_issue','')::date,
          NULLIF(v_elem->>'target_submit','')::date,
          'de', 'Pre-Submittal — GO'
        )
        RETURNING id, updated_at INTO v_pid, v_pua;

        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index)
        VALUES (v_tenant, v_pid, 0);

        v_permits_out := v_permits_out || jsonb_build_object('id', v_pid, 'updated_at', v_pua);
      END IF;
    END LOOP;

    FOREACH v_del IN ARRAY v_deletes
    LOOP
      DELETE FROM public.permits WHERE id = v_del AND project_id = p_project_id;
    END LOOP;

    SELECT updated_at INTO v_proj_ua FROM public.projects WHERE id = p_project_id;

  EXCEPTION WHEN OTHERS THEN
    IF v_occ THEN
      out_conflict := true;
      out_conflict_kind := v_kind;
      out_conflict_id := v_cid;
      out_project_updated_at := NULL;
      out_permits := '[]'::jsonb;
      RETURN NEXT;
      RETURN;
    ELSE
      RAISE;
    END IF;
  END;

  out_conflict := false;
  out_conflict_kind := NULL;
  out_conflict_id := NULL;
  out_project_updated_at := v_proj_ua;
  out_permits := v_permits_out;
  RETURN NEXT;
END;
$function$;
