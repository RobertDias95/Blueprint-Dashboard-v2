-- fix-141 (2026-06-09): Monday-snap the Draw Schedule write paths.
--
-- Root cause of the 6605 57th Ave NE "invisible lane": the Draw Schedule grid
-- keys every column by a Monday week-key (draw_schedule.start_week / end_week).
-- bp_next_available_da_slot returned slot_start = GREATEST(p_start_from,
-- current_date) — ANY weekday — and bp_create_project_with_permits wrote that
-- straight into start_week / dd_start. A non-Monday start_week has no matching
-- grid column, so the lane (and the whole project) rendered nowhere even though
-- the rows existed.
--
-- This migration:
--   1. Adds snap_to_monday_forward(date) — IMMUTABLE; mirrors the TS
--      snapToMonday(..., 'forward') helper byte-for-byte.
--   2. bp_next_available_da_slot: snaps the cursor forward to Monday at start
--      and after every block-skip (block_end is a Friday, so +1 is Saturday).
--   3. bp_create_project_with_permits: defensively re-snaps the auto-placed
--      dd_start to Monday and recomputes dd_end from it (Monday + 25 = Friday),
--      and writes end_week as the Monday week-key (was a Friday — latent bug on
--      this auto-place path, since end_week must be a Monday for the grid).
--   4. bp_update_draw_schedule_with_dd_sync: defense-in-depth — snaps the
--      incoming start_week / end_week to Monday before deriving dd_start
--      (= start-week Monday) and dd_end (= end-week Monday + 4 = Friday). The
--      Monday+4 dd_end convention is preserved exactly.
--
-- bp_place_new_project_on_da already uses date_trunc('week', ...) (Monday-safe)
-- and is left unchanged. bp_set_bp_dd_dates already date_trunc's its inputs to
-- Monday; the client (DDPhaseEditor) forward-snaps dd_start before calling it so
-- the net direction is forward per Bobby's locked decision.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_141_snap_to_monday_forward_rpc_guards". This file is the repo record.

-- 1) Shared SQL helper -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snap_to_monday_forward(p_date date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_date IS NULL THEN NULL
    WHEN EXTRACT(ISODOW FROM p_date) = 1 THEN p_date
    -- (8 - dow) is parenthesised before % 7 so Tue→+6 … Sun→+1 (never negative,
    -- never lands back on Sunday). Mon would also be (8-1)%7 = 0; the CASE above
    -- just makes the no-op explicit.
    ELSE p_date + ((8 - EXTRACT(ISODOW FROM p_date)::integer) % 7)
  END;
$$;

-- 2) bp_next_available_da_slot: Monday-aligned cursor ------------------------
CREATE OR REPLACE FUNCTION public.bp_next_available_da_slot(p_da_name text, p_duration_days integer, p_start_from date DEFAULT CURRENT_DATE)
 RETURNS TABLE(slot_start date, slot_end date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cursor date;
  v_block  RECORD;
BEGIN
  IF p_da_name IS NULL OR trim(p_da_name) = '' THEN RETURN; END IF;
  IF p_duration_days IS NULL OR p_duration_days <= 0 THEN RETURN; END IF;
  v_cursor := GREATEST(p_start_from, current_date);
  -- fix-141: lanes must start on a Monday or the grid (Monday-keyed columns)
  -- renders them in the wrong week — or, for a weekday with no column, nowhere.
  v_cursor := snap_to_monday_forward(v_cursor);
  FOR v_block IN
    SELECT block_start, block_end FROM (
      SELECT dd_start AS block_start, dd_end AS block_end
        FROM draw_schedule
        WHERE da_assigned = p_da_name
          AND dd_start IS NOT NULL AND dd_end IS NOT NULL AND dd_end >= v_cursor
      UNION ALL
      SELECT bp_week_key_to_date(start_week) AS block_start,
             bp_week_key_to_date(end_week) + 4 AS block_end
        FROM da_time_blocks
        WHERE da_name = p_da_name
          AND start_week IS NOT NULL AND end_week IS NOT NULL
          AND bp_week_key_to_date(end_week) + 4 >= v_cursor
    ) AS blocks
    ORDER BY block_start ASC NULLS LAST, block_end ASC NULLS LAST
  LOOP
    IF v_block.block_start IS NOT NULL AND v_block.block_start - v_cursor >= p_duration_days THEN
      slot_start := v_cursor;
      slot_end := v_cursor + p_duration_days - 1;
      RETURN NEXT; RETURN;
    END IF;
    IF v_block.block_end IS NOT NULL THEN
      v_cursor := GREATEST(v_cursor, v_block.block_end + 1);
      -- fix-141: re-align after skipping a block (block_end is Friday → +1 Sat).
      v_cursor := snap_to_monday_forward(v_cursor);
    END IF;
  END LOOP;
  slot_start := v_cursor;
  slot_end := v_cursor + p_duration_days - 1;
  RETURN NEXT;
END;
$function$;

-- 3) bp_create_project_with_permits: Monday-safe auto-placement --------------
CREATE OR REPLACE FUNCTION public.bp_create_project_with_permits(p_tenant_id uuid, p_address text, p_juris text, p_notes text, p_project_data jsonb, p_permits jsonb)
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
  -- fix-126-a: skip permit creation entirely when reuse=true.
  v_reuses_permit boolean := COALESCE((v_pd->>'redesign_reuses_original_permit')::boolean, false);
  c_default_duration_days CONSTANT int := 26;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_address IS NULL OR trim(p_address) = '' THEN RAISE EXCEPTION 'p_address is required'; END IF;

  -- fix-126-a: the "at least one permit" guard now only fires for
  -- non-reuse projects. A reuse=true redesign legitimately has zero
  -- permits (metadata + draw schedule block only — pure DA workflow tracker).
  IF NOT v_reuses_permit AND (p_permits IS NULL OR jsonb_array_length(p_permits) = 0) THEN
    RAISE EXCEPTION 'p_permits must contain at least one permit';
  END IF;
  -- Defensive: caller is supposed to send empty p_permits when reuse=true,
  -- but we don't trust the caller — log + drop the permits silently.
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
    -- fix-126-a: redesign columns.
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
    -- fix-126-a: redesign payload.
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

  -- fix-126-a: the permits FOR LOOP + auto-DD-placement block are skipped
  -- entirely on a reuse=true redesign. project_id + empty permit_ids return.
  IF v_reuses_permit THEN
    project_id := v_project_id; permit_ids := ARRAY[]::integer[]; conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lead_da IS NOT NULL THEN
    SELECT s.slot_start, s.slot_end INTO v_auto_dd_start, v_auto_dd_end
    FROM public.bp_next_available_da_slot(v_lead_da, c_default_duration_days, current_date) s;
    -- fix-141: slot_start is already Monday from the slot fn, but re-snap
    -- defensively and recompute dd_end from it (Monday + 25 = Friday) so a
    -- future change to the slot fn can't reintroduce a non-Monday dd_start /
    -- start_week on this auto-place path.
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
    IF v_permit_type = 'Building Permit' AND v_bp_permit_id IS NULL AND v_lead_da IS NOT NULL AND v_auto_dd_start IS NOT NULL AND v_bp_dd_start IS NULL AND v_bp_dd_end IS NULL THEN
      v_bp_dd_start := v_auto_dd_start; v_bp_dd_end := v_auto_dd_end; v_auto_placed := true;
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
        tenant_id, permit_id, bucket, text, cat, assigned_to, sort_order, is_jurisdiction_specific
      ) SELECT p_tenant_id, v_permit_id, tt.bucket, tt.text, tt.cat, tt.default_assignee, COALESCE(tt.sort_order, 0), (tt.jurisdiction IS NOT NULL)
      FROM public.task_templates tt WHERE tt.id = ANY(v_task_ids) AND tt.permit_type = v_permit_type AND (tt.jurisdiction = v_juris OR tt.jurisdiction IS NULL);
    END IF;
  END LOOP;

  IF v_auto_placed THEN
    INSERT INTO public.draw_schedule (tenant_id, project_id, da_assigned, start_week, end_week, dd_start, dd_end, status, manual_status, manually_placed)
    VALUES (p_tenant_id, v_project_id, v_lead_da, to_char(v_auto_dd_start, 'YYYY-MM-DD'),
      -- fix-141: end_week must be a Monday week-key (grid keys columns by it).
      -- v_auto_dd_end is the Friday end-of-DD-week; its Monday is date_trunc.
      to_char(date_trunc('week', v_auto_dd_end)::date, 'YYYY-MM-DD'),
      v_auto_dd_start, v_auto_dd_end, 'Scheduled', false, false) ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
  END IF;

  project_id := v_project_id; permit_ids := v_permit_ids; conflict := false;
  RETURN NEXT;
END;
$function$;

-- 4) bp_update_draw_schedule_with_dd_sync: server guard ----------------------
CREATE OR REPLACE FUNCTION public.bp_update_draw_schedule_with_dd_sync(p_project_id uuid, p_da_assigned text, p_start_week text, p_end_week text, p_schedule_status text, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_project_id uuid, out_updated_at timestamp with time zone, out_conflict boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_dd_start date; v_new_dd_end date; v_new_target date;
  v_updated_at timestamptz; v_rows int; v_anchor_id int;
BEGIN
  -- fix-141 defense-in-depth: snap the incoming week-keys to Monday before
  -- anything derives from them. Drag-and-drop already produces Mondays, so this
  -- is a no-op for the normal caller — it just guarantees no path can write a
  -- non-Monday start_week (which the grid can't render). dd_start follows the
  -- start-week Monday; dd_end stays the end-week Monday + 4 (Friday) — the
  -- existing convention is preserved, dd_end is NOT snapped to a Monday.
  IF p_start_week IS NOT NULL AND length(trim(p_start_week)) > 0 THEN
    p_start_week := to_char(snap_to_monday_forward(bp_week_key_to_date(p_start_week)), 'YYYY-MM-DD');
  END IF;
  IF p_end_week IS NOT NULL AND length(trim(p_end_week)) > 0 THEN
    p_end_week := to_char(snap_to_monday_forward(bp_week_key_to_date(p_end_week)), 'YYYY-MM-DD');
  END IF;

  v_new_dd_start := bp_week_key_to_date(p_start_week);
  v_new_dd_end := bp_week_key_to_date(p_end_week);
  IF v_new_dd_end IS NOT NULL THEN v_new_dd_end := v_new_dd_end + 4; END IF;
  v_new_target := bp_week_key_to_date(p_end_week);
  IF v_new_target IS NOT NULL THEN v_new_target := v_new_target + 14; END IF;

  UPDATE draw_schedule ds SET
    da_assigned = p_da_assigned, start_week = p_start_week, end_week = p_end_week,
    status = p_schedule_status, dd_start = v_new_dd_start, dd_end = v_new_dd_end
  WHERE ds.project_id = p_project_id AND ds.updated_at = p_expected_updated_at
  RETURNING ds.updated_at INTO v_updated_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT p_project_id, NULL::timestamptz, true; RETURN;
  END IF;

  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end
  WHERE project_id = p_project_id;

  -- Pick the same anchor the projection picks: BP if it exists, else first
  -- permit (lowest id). Cascade target_submit to ALL BPs on the project,
  -- OR (when no BP) to that one fallback anchor only.
  IF EXISTS (SELECT 1 FROM permits WHERE project_id = p_project_id AND type = 'Building Permit') THEN
    UPDATE permits SET target_submit = v_new_target
    WHERE project_id = p_project_id AND type = 'Building Permit';
  ELSE
    SELECT id INTO v_anchor_id FROM permits
    WHERE project_id = p_project_id ORDER BY id ASC LIMIT 1;
    IF v_anchor_id IS NOT NULL THEN
      UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id;
    END IF;
  END IF;

  RETURN QUERY SELECT p_project_id, v_updated_at, false;
END;
$function$;
