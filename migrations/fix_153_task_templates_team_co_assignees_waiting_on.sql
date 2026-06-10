-- fix-153 (2026-06-10): task templates — team auto-resolve, co-assignees,
-- waiting_on; migrate the 'co' (Corrections) bucket into 'pm' (Permitting).
--
-- Bobby's v1-vs-v2 review found v2 had the scaffolding but not the capability:
--   * task_templates.default_assignee was being (mis)used as a TEAM field —
--     it stores literal "Entitlements" / "Architecture", never a person. We
--     rename it default_team for honesty and teach the create-project RPC to
--     RESOLVE that team to the SPECIFIC permit's person at task-create time
--     (Entitlements → permit.ent_lead, Architecture → permit.da). Per-permit DA
--     overrides therefore cascade for free (a Demo permit with da='Trevor' sends
--     all its Architecture template tasks to Trevor).
--   * No template-level co-assignees or waiting_on — added as
--     default_co_assignees (text[]) and default_waiting_on (text), both flowing
--     into the seeded permit_tasks at create time.
--   * permit_tasks had no co_assignees column at all (the fix-70 memory was
--     wrong — verified absent on PROD), so we add it here.
--   * The editor showed three buckets (D&E / Permitting / Corrections); the 5
--     'co' templates all happen during permitting, so they migrate to 'pm' and
--     the Corrections tab is dropped from the UI.
--
-- The default_assignee → default_team rename breaks every function that reads
-- the old name, so this migration recreates the two affected RPCs in the same
-- transaction: bp_upsert_task_template_row (the editor's writer) and
-- bp_create_project_with_permits (the wizard's seeder). A third new RPC,
-- bp_reorder_task_templates, backs the drag-handle reordering UI.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_153_task_templates_team_co_assignees_waiting_on". This file is the repo
-- record.

-- 1. Rename default_assignee → default_team for semantic clarity.
ALTER TABLE public.task_templates
  RENAME COLUMN default_assignee TO default_team;

-- 2. Add new template-level columns.
ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS default_co_assignees text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS default_waiting_on text;

-- 3. permit_tasks.co_assignees did NOT exist on PROD (the fix-70 memory was
--    stale — verified absent). Add it so the seeder can carry template
--    co-assignees through.
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS co_assignees text[] DEFAULT ARRAY[]::text[];

-- 4. Migrate the 5 'co' (Corrections) templates to 'pm' — they all happen
--    during the permitting phase. After this, no template should be 'co'.
UPDATE public.task_templates
  SET bucket = 'pm', updated_at = now()
  WHERE bucket = 'co';

-- 5. Document/verify scope.
DO $$
DECLARE
  v_de int; v_pm int; v_co int;
BEGIN
  SELECT count(*) INTO v_de FROM public.task_templates WHERE bucket = 'de';
  SELECT count(*) INTO v_pm FROM public.task_templates WHERE bucket = 'pm';
  SELECT count(*) INTO v_co FROM public.task_templates WHERE bucket = 'co';
  RAISE NOTICE 'fix-153 post-migration: de=%, pm=%, co=% (co should be 0)', v_de, v_pm, v_co;
END $$;

-- 6. Recreate the editor's upsert RPC to read/write the renamed + new columns.
--    co-assignees arrive as a JSONB array from the client; we coerce to text[]
--    (empty array when absent or not an array). waiting_on/team are plain text.
CREATE OR REPLACE FUNCTION public.bp_upsert_task_template_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_id uuid, updated_at timestamp with time zone, conflict boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_actual       timestamptz;
  v_co_assignees text[] := COALESCE(
    CASE WHEN jsonb_typeof(p_data->'default_co_assignees') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'default_co_assignees'))
      ELSE NULL END,
    ARRAY[]::text[]);
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.task_templates (
      permit_type, jurisdiction, bucket, text,
      default_team, default_co_assignees, default_waiting_on,
      default_target_offset, cat, sort_order
    )
    VALUES (
      p_data->>'permit_type',
      NULLIF(p_data->>'jurisdiction',''),
      COALESCE(p_data->>'bucket','de'),
      p_data->>'text',
      NULLIF(p_data->>'default_team',''),
      v_co_assignees,
      NULLIF(p_data->>'default_waiting_on',''),
      NULLIF(p_data->>'default_target_offset','')::integer,
      p_data->>'cat',
      COALESCE((p_data->>'sort_order')::integer, 0)
    )
    RETURNING task_templates.id, task_templates.updated_at INTO out_id, updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.task_templates t SET
    permit_type           = p_data->>'permit_type',
    jurisdiction          = NULLIF(p_data->>'jurisdiction',''),
    bucket                = COALESCE(p_data->>'bucket','de'),
    text                  = p_data->>'text',
    default_team          = NULLIF(p_data->>'default_team',''),
    default_co_assignees  = v_co_assignees,
    default_waiting_on    = NULLIF(p_data->>'default_waiting_on',''),
    default_target_offset = NULLIF(p_data->>'default_target_offset','')::integer,
    cat                   = p_data->>'cat',
    sort_order            = COALESCE((p_data->>'sort_order')::integer, 0),
    updated_at            = now()
  WHERE t.id = p_id AND t.updated_at = p_expected_updated_at
  RETURNING t.id, t.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;
  SELECT t.updated_at INTO v_actual FROM public.task_templates t WHERE t.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END; $function$;

-- 7. Batch-reorder RPC for drag-handle reordering. Writes each template's new
--    0-based position as sort_order in one statement. Ids not belonging to the
--    caller's tenant are filtered out by RLS on task_templates.
CREATE OR REPLACE FUNCTION public.bp_reorder_task_templates(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.task_templates t
  SET sort_order = ord.pos - 1, updated_at = now()
  FROM unnest(p_ids) WITH ORDINALITY AS ord(id, pos)
  WHERE t.id = ord.id;
END; $function$;

-- 8. Recreate the wizard's seeder with team-resolution + co-assignees +
--    waiting_on carry-through. Only the permit_tasks INSERT-SELECT block
--    changed vs fix-144; everything else is identical.
DROP FUNCTION IF EXISTS public.bp_create_project_with_permits(uuid, text, text, text, jsonb, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.bp_create_project_with_permits(p_tenant_id uuid, p_address text, p_juris text, p_notes text, p_project_data jsonb, p_permits jsonb, p_manually_placed boolean DEFAULT false, p_redesign_dd_phase jsonb DEFAULT NULL)
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
    INSERT INTO public.builders (name, company, email, phone, tenant_id)
    VALUES (TRIM(v_pd->>'builder_name'),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_company', '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_email',   '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_phone',   '')), ''),
      p_tenant_id) ON CONFLICT (name, company) DO NOTHING;
  END IF;

  IF v_reuses_permit THEN
    -- fix-144: a reuse redesign creates no permits; if a DD phase was supplied,
    -- build the redesign project's draw_schedule lane from it so it shows on the
    -- Draw Schedule. manually_placed=true → auto-rebalance leaves it alone.
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
        p_tenant_id,
        v_permit_id,
        tt.bucket,
        tt.text,
        tt.cat,
        -- fix-153: team → person at create time, against THIS permit's fields.
        -- Falls back to NULL when the team's field on the permit is unset (user
        -- can manually assign later). A literal name (legacy data) passes through.
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

  IF v_auto_placed THEN
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
