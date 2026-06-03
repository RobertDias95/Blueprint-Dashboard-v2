-- fix-107: auto-place the BP's DD phase block at the Lead DA's first
-- available slot on project creation.
--
-- Apply via MCP after merge. This migration is NOT auto-applied by the PR.
--
-- ──────────────────────────────────────────────────────────────────────
-- TWO PIECES
--
-- Commit 1 — new RPC bp_next_available_da_slot(da_name, duration_days,
-- start_from). Walks every block on the DA's lane (draw_schedule project
-- blocks UNION ALL da_time_blocks training / vacation / redesign / NP)
-- chronologically and returns the first gap large enough for the
-- requested duration. Cursor starts at GREATEST(start_from, current_date)
-- so the function never points backwards in time — even when
-- backfilling.
--
-- Commit 2 — bp_create_project_with_permits learns to call the slot
-- finder. When Step 1's lead_da is set AND the BP permit's dd_start /
-- dd_end weren't passed in by the client, the create RPC reserves the
-- slot in draw_schedule and writes the computed dates to the BP. Client-
-- explicit dates (e.g. historical backfill) still win.
--
-- ──────────────────────────────────────────────────────────────────────
-- DEFAULT DURATION
--
-- The existing wizard places via bp_place_new_project_on_da with
-- p_duration_weeks=4 (default). That RPC produces:
--   dd_start = first Monday
--   dd_end   = first Monday + 25 days (Friday of week 4)
-- so the inclusive DD-phase span is 26 days. fix-107 preserves that
-- mental model — `c_default_duration_days` below is 26 so a project
-- placed via the new path occupies the same calendar footprint as one
-- placed via the old path. Per Bobby: don't hardcode a new length here;
-- preserve current behavior.
--
-- ──────────────────────────────────────────────────────────────────────

-- ── Commit 1: bp_next_available_da_slot ──────────────────────────────

CREATE OR REPLACE FUNCTION public.bp_next_available_da_slot(
  p_da_name      text,
  p_duration_days int,
  p_start_from   date DEFAULT current_date
)
RETURNS TABLE(slot_start date, slot_end date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cursor date;
  v_block  RECORD;
BEGIN
  -- Sanity guards (caller falls back to default placement when these fire).
  IF p_da_name IS NULL OR trim(p_da_name) = '' THEN RETURN; END IF;
  IF p_duration_days IS NULL OR p_duration_days <= 0 THEN RETURN; END IF;

  -- Never look backwards. Backfilled projects with start_from in the past
  -- still anchor at today.
  v_cursor := GREATEST(p_start_from, current_date);

  -- Walk every block on this DA's lane in chronological order. Both
  -- sources count as occupied:
  --   draw_schedule  → project blocks (dd_start / dd_end are dates)
  --   da_time_blocks → training / redesign / vacation / NP (week-keys)
  -- Per Bobby: NP-style blocks are NOT skippable gaps — they block the
  -- slot like any other occupant. The UNION ALL treats them uniformly.
  --
  -- da_time_blocks stores week-keys (Monday text). The block's
  -- effective right edge is end_week_monday + 4 (the Friday of that
  -- week) so the date range stays Mon-Fri inclusive, matching how
  -- those blocks are visualized in the Draw Schedule grid.
  FOR v_block IN
    SELECT block_start, block_end FROM (
      SELECT dd_start AS block_start, dd_end AS block_end
        FROM draw_schedule
        WHERE da_assigned = p_da_name
          AND dd_start IS NOT NULL
          AND dd_end IS NOT NULL
          AND dd_end >= v_cursor
      UNION ALL
      SELECT bp_week_key_to_date(start_week) AS block_start,
             bp_week_key_to_date(end_week) + 4 AS block_end
        FROM da_time_blocks
        WHERE da_name = p_da_name
          AND start_week IS NOT NULL
          AND end_week IS NOT NULL
          AND bp_week_key_to_date(end_week) + 4 >= v_cursor
    ) AS blocks
    ORDER BY block_start ASC NULLS LAST, block_end ASC NULLS LAST
  LOOP
    -- If the gap between the cursor and this block's start fits the
    -- requested duration, return it. Walk over blocks that started in
    -- the past (block_start < v_cursor) — those just push the cursor
    -- forward; the IF below short-circuits because block_start - v_cursor
    -- is negative.
    IF v_block.block_start IS NOT NULL
       AND v_block.block_start - v_cursor >= p_duration_days THEN
      slot_start := v_cursor;
      slot_end   := v_cursor + p_duration_days - 1;
      RETURN NEXT;
      RETURN;
    END IF;
    -- No fit before this block — advance cursor past its end (+1 so the
    -- next slot's first day doesn't overlap the block's last day).
    IF v_block.block_end IS NOT NULL THEN
      v_cursor := GREATEST(v_cursor, v_block.block_end + 1);
    END IF;
  END LOOP;

  -- No block intervenes (or every block walked without a fit) — return
  -- the slot starting at the current cursor.
  slot_start := v_cursor;
  slot_end   := v_cursor + p_duration_days - 1;
  RETURN NEXT;
END;
$function$;


-- ── Commit 2: bp_create_project_with_permits ─────────────────────────
-- Same function body as the live prod definition (pulled via MCP); only
-- the additions for lead_da + auto-placement are new. Marked with
-- `-- fix-107:` comments.

CREATE OR REPLACE FUNCTION public.bp_create_project_with_permits(
  p_tenant_id    uuid,
  p_address      text,
  p_juris        text,
  p_notes        text,
  p_project_data jsonb,
  p_permits      jsonb
)
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
  -- fix-107: auto-placement state.
  v_lead_da       text := NULLIF(trim(COALESCE(v_pd->>'lead_da', '')), '');
  v_auto_dd_start date;
  v_auto_dd_end   date;
  v_bp_permit_id  integer := NULL;
  v_bp_dd_start   date;
  v_bp_dd_end     date;
  -- fix-107: tracks whether the auto-slot actually got applied to a BP
  -- (vs. the client passing explicit dd dates that overrode it). The
  -- draw_schedule reservation below only fires on a true auto-place;
  -- a client-explicit BP keeps whatever lane scheduling the caller wants
  -- to do separately (e.g. backfilled historical dates with no lane).
  v_auto_placed   boolean := false;
  c_default_duration_days CONSTANT int := 26;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id is required'; END IF;
  IF p_address IS NULL OR trim(p_address) = '' THEN RAISE EXCEPTION 'p_address is required'; END IF;
  IF p_permits IS NULL OR jsonb_array_length(p_permits) = 0 THEN
    RAISE EXCEPTION 'p_permits must contain at least one permit';
  END IF;

  SELECT id INTO v_existing_id FROM public.projects WHERE address = p_address;
  IF v_existing_id IS NOT NULL THEN
    project_id := v_existing_id;
    permit_ids := ARRAY[]::integer[];
    conflict   := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_pd ? 'product_types' AND jsonb_typeof(v_pd->'product_types') = 'array' THEN
    SELECT COALESCE(array_agg(value::text), ARRAY[]::text[])
    INTO v_product_types
    FROM jsonb_array_elements_text(v_pd->'product_types') AS value
    WHERE NULLIF(value, '') IS NOT NULL;
  ELSE
    v_product_types := ARRAY[]::text[];
  END IF;

  INSERT INTO public.projects (
    tenant_id, address, juris, notes,
    entitlement_lead, design_manager, acq_lead,
    go_date, units, zone, lot_width, lot_depth, unit_types,
    parking_type, parking_stalls, alley, product_types, project_tags,
    builder_name, builder_company, builder_email, builder_phone
  )
  VALUES (
    p_tenant_id, p_address, v_juris, NULLIF(p_notes, ''),
    NULLIF(v_pd->>'entitlement_lead', ''),
    NULLIF(v_pd->>'design_manager', ''),
    NULLIF(v_pd->>'acq_lead', ''),
    NULLIF(v_pd->>'go_date', '')::date,
    NULLIF(v_pd->>'units', '')::int,
    NULLIF(v_pd->>'zone', ''),
    NULLIF(v_pd->>'lot_width', '')::numeric,
    NULLIF(v_pd->>'lot_depth', '')::numeric,
    CASE WHEN v_pd ? 'unit_types' AND jsonb_typeof(v_pd->'unit_types') = 'array' THEN v_pd->'unit_types' ELSE NULL END,
    NULLIF(v_pd->>'parking_type', ''),
    NULLIF(v_pd->>'parking_stalls', '')::int,
    NULLIF(v_pd->>'alley', ''),
    v_product_types,
    CASE WHEN v_pd ? 'project_tags' AND jsonb_typeof(v_pd->'project_tags') = 'array' THEN v_pd->'project_tags' ELSE NULL END,
    NULLIF(v_pd->>'builder_name', ''),
    NULLIF(v_pd->>'builder_company', ''),
    NULLIF(v_pd->>'builder_email', ''),
    NULLIF(v_pd->>'builder_phone', '')
  )
  ON CONFLICT (address) DO NOTHING
  RETURNING id INTO v_project_id;

  IF v_project_id IS NULL THEN
    SELECT id INTO v_project_id FROM public.projects WHERE address = p_address;
    project_id := v_project_id;
    permit_ids := ARRAY[]::integer[];
    conflict   := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF COALESCE(TRIM(v_pd->>'builder_name'), '') <> '' THEN
    INSERT INTO public.builders (name, company, email, phone, tenant_id)
    VALUES (
      TRIM(v_pd->>'builder_name'),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_company', '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_email',   '')), ''),
      NULLIF(TRIM(COALESCE(v_pd->>'builder_phone',   '')), ''),
      p_tenant_id
    )
    ON CONFLICT (name, company) DO NOTHING;
  END IF;

  -- fix-107: pre-compute the auto-slot ONCE if Step 1 set lead_da. The
  -- slot finder is STABLE; calling it before the permits loop keeps the
  -- math out of the per-permit inner block and makes the "client dates
  -- win" branch obvious.
  IF v_lead_da IS NOT NULL THEN
    SELECT s.slot_start, s.slot_end INTO v_auto_dd_start, v_auto_dd_end
      FROM public.bp_next_available_da_slot(
        v_lead_da,
        c_default_duration_days,
        current_date
      ) s;
  END IF;

  FOR v_permit IN SELECT * FROM jsonb_array_elements(p_permits)
  LOOP
    v_permit_type := v_permit->>'type';
    IF v_permit_type IS NULL OR trim(v_permit_type) = '' THEN
      RAISE EXCEPTION 'each permit must have a non-empty type';
    END IF;

    v_task_ids_raw := v_permit->'task_template_ids';
    IF v_task_ids_raw IS NULL OR jsonb_typeof(v_task_ids_raw) <> 'array' THEN
      RAISE EXCEPTION 'permit type % missing task_template_ids array', v_permit_type;
    END IF;

    SELECT COALESCE(array_agg((value #>> '{}')::uuid), ARRAY[]::uuid[])
      INTO v_task_ids
      FROM jsonb_array_elements(v_task_ids_raw);

    -- fix-107: per-permit dd resolution. Client-explicit dates ALWAYS
    -- win (e.g. a backfill submitting historical dates). The auto-slot
    -- only fires for the FIRST BP, only when both client dd dates are
    -- null, and only when lead_da is set + a slot was computed above.
    v_bp_dd_start := NULLIF(v_permit->>'dd_start', '')::date;
    v_bp_dd_end   := NULLIF(v_permit->>'dd_end',   '')::date;
    IF v_permit_type = 'Building Permit'
       AND v_bp_permit_id IS NULL                  -- only the first BP gets auto-placed
       AND v_lead_da IS NOT NULL
       AND v_auto_dd_start IS NOT NULL
       AND v_bp_dd_start IS NULL
       AND v_bp_dd_end IS NULL THEN
      v_bp_dd_start := v_auto_dd_start;
      v_bp_dd_end   := v_auto_dd_end;
      v_auto_placed := true;
    END IF;

    INSERT INTO public.permits (
      tenant_id, project_id, type, num,
      ent_lead, dm, da, dual_da, architect,
      target_submit, expected_issue, dd_start, dd_end, kickoff_date,
      stage, status, notes
    )
    VALUES (
      p_tenant_id, v_project_id, v_permit_type,
      NULLIF(v_permit->>'num', ''),
      NULLIF(v_permit->>'ent_lead', ''),
      NULLIF(v_permit->>'dm', ''),
      NULLIF(v_permit->>'da', ''),
      NULLIF(v_permit->>'dual_da', ''),
      NULLIF(v_permit->>'architect', ''),
      COALESCE(
        NULLIF(v_permit->>'target_submit', '')::date,
        CASE
          WHEN v_permit_type = 'Building Permit'
               AND v_bp_dd_end IS NOT NULL
          -- fix-96-c: align with bp_recompute_target_submits' 21-day
          -- default. Engine takes over once dd dates land.
          THEN (v_bp_dd_end + INTERVAL '21 days')::date
          ELSE NULL
        END
      ),
      NULLIF(v_permit->>'expected_issue', '')::date,
      v_bp_dd_start,
      v_bp_dd_end,
      NULLIF(v_permit->>'kickoff_date', '')::date,
      'de', 'Pre-Submittal — GO', NULLIF(p_notes, '')
    )
    RETURNING id INTO v_permit_id;

    v_permit_ids := array_append(v_permit_ids, v_permit_id);

    -- fix-107: remember the first BP for the post-loop draw_schedule
    -- reservation. We only place THIS BP — additional BPs (which the
    -- wizard never creates today, but future flows might) inherit the
    -- same lane via the existing bp_trg_sync_draw_schedule_da trigger
    -- when their DA is set.
    IF v_permit_type = 'Building Permit' AND v_bp_permit_id IS NULL THEN
      v_bp_permit_id := v_permit_id;
    END IF;

    INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index)
    VALUES (p_tenant_id, v_permit_id, 0);

    IF array_length(v_task_ids, 1) > 0 THEN
      INSERT INTO public.permit_tasks (
        tenant_id, permit_id, bucket, text, cat, assigned_to, sort_order,
        is_jurisdiction_specific
      )
      SELECT p_tenant_id, v_permit_id, tt.bucket, tt.text, tt.cat,
             tt.default_assignee, COALESCE(tt.sort_order, 0),
             (tt.jurisdiction IS NOT NULL)
      FROM public.task_templates tt
      WHERE tt.id = ANY(v_task_ids)
        AND tt.permit_type = v_permit_type
        AND (tt.jurisdiction = v_juris OR tt.jurisdiction IS NULL);
    END IF;
  END LOOP;

  -- fix-107: reserve the slot in draw_schedule. Only fires when the
  -- auto-slot was actually applied to a BP this run (the gates above
  -- collapse to v_lead_da set + first BP existed + client dd dates
  -- were null). manually_placed = false so a later drag-correction
  -- by the team flips the flag normally. status_override / color_override
  -- left null; the lane picks up the project's default appearance.
  IF v_auto_placed THEN
    INSERT INTO public.draw_schedule (
      tenant_id, project_id, da_assigned,
      start_week, end_week, dd_start, dd_end,
      status, manual_status, manually_placed
    )
    VALUES (
      p_tenant_id, v_project_id, v_lead_da,
      to_char(v_auto_dd_start, 'YYYY-MM-DD'),
      to_char(v_auto_dd_end,   'YYYY-MM-DD'),
      v_auto_dd_start, v_auto_dd_end,
      'Scheduled', false, false
    )
    -- ON CONFLICT names the constraint (not the column) because
    -- `project_id` is also an OUT parameter on this function and the
    -- bare column form raises 42702 (ambiguous reference).
    ON CONFLICT ON CONSTRAINT draw_schedule_pkey1 DO NOTHING;
  END IF;

  project_id := v_project_id;
  permit_ids := v_permit_ids;
  conflict   := false;
  RETURN NEXT;
END;
$function$;


-- ──────────────────────────────────────────────────────────────────────
-- (Optional) post-merge sanity probes — uncomment + run via MCP after
-- apply:
--
-- -- 1) Empty lane: a DA with NO blocks → slot starts today.
-- SELECT * FROM bp_next_available_da_slot('ImaginaryDa', 26);
--
-- -- 2) Real DA: confirm slot_end - slot_start + 1 = 26 days inclusive.
-- SELECT slot_start, slot_end, slot_end - slot_start + 1 AS span_days
-- FROM bp_next_available_da_slot('Trevor', 26);
--
-- ──────────────────────────────────────────────────────────────────────
