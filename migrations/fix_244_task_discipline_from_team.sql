-- fix-244: a task's Design-view COLUMN follows its TEAM.
--
-- BUG: bp_create_project_with_permits seeds permit_tasks from task_templates but
-- never sets permit_tasks.discipline, so seeded tasks are discipline=NULL. The
-- Design view splits its two columns by discipline via
-- bp_list_permit_tasks' COALESCE(discipline,'ent'), so EVERY seeded task —
-- including Design-Associate / Schematic-Team ones (e.g. "Schematic Design" on
-- 4017 Corliss Ave N) — lands in the Entitlements column.
--
-- RULE (Bobby): column = team.
--   team = Entitlements                                       -> discipline 'ent'
--   team ∈ {Design Associate, Design Manager, Schematic Team} -> discipline 'arch'
--   ('Architecture', legacy pre-fix-222)                      -> discipline 'arch'
--   NULL / unknown                                            -> default 'ent'
--
-- This migration:
--   1. Centralizes the rule in bp_discipline_for_team(team) — the SQL twin of
--      src/lib/taskTeam.ts disciplineForTeam (KEEP IN LOCKSTEP).
--   2. SEEDING: bp_create_project_with_permits now sets each seeded task's
--      discipline = COALESCE(bp_discipline_for_team(tt.default_team),'ent').
--   3. BACKFILL: sets discipline for EXISTING NULL-discipline permit_tasks from
--      their matched template.default_team (match by permit_type + text + tenant).
--      Idempotent (WHERE discipline IS NULL) — never clobbers a discipline a user
--      set via the editor (those rows are non-null, e.g. the hand-set 'arch'
--      "test" task and auto-generated tasks). Unmatched NULL rows are left NULL
--      (they render as 'ent' via the list COALESCE) — we do NOT force NULL->arch.
--
-- The D&E/Permitting phase axis (permit_tasks.bucket = de/pm) is SEPARATE and
-- untouched.
--
-- The live re-bucket (changing a task's primary owner to a team re-derives its
-- column) is a client change in the same PR (PermitDetailV2 save()); the SQL
-- side only needs the seeding default + backfill.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical rule. STABLE, no table access — pure mapping.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_discipline_for_team(p_team text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_team IN ('Design Associate','Design Manager','Schematic Team','Architecture')
      THEN 'arch'
    WHEN p_team = 'Entitlements'
      THEN 'ent'
    ELSE NULL           -- specific person / unknown / NULL → no team signal
  END;
$function$;

REVOKE ALL ON FUNCTION public.bp_discipline_for_team(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_discipline_for_team(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Seeding — set discipline from the template's default_team.
-- Body identical to the live definition except the two marked fix-244 lines in
-- the permit_tasks seed INSERT (discipline column + its SELECT expression).
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
  v_schematic_designer text[] := ARRAY[]::text[];  -- fix-222
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

  -- fix-222: project's Schematic Designer(s), sent as a jsonb array.
  IF v_pd ? 'schematic_designer' AND jsonb_typeof(v_pd->'schematic_designer') = 'array' THEN
    SELECT COALESCE(array_agg(value::text), ARRAY[]::text[]) INTO v_schematic_designer
    FROM jsonb_array_elements_text(v_pd->'schematic_designer') AS value WHERE NULLIF(value, '') IS NOT NULL;
  ELSE v_schematic_designer := ARRAY[]::text[]; END IF;

  INSERT INTO public.projects (
    tenant_id, address, juris, notes, entitlement_lead, design_manager, acq_lead,
    go_date, units, zone, lot_width, lot_depth, unit_types,
    parking_type, parking_stalls, alley, product_types, project_tags,
    builder_name, builder_company, builder_email, builder_phone,
    builder_address, poc_name, poc_email,
    num_lots, is_corner_lot, closing_date,
    redesign_of_project_id, redesign_trigger,
    redesign_reuses_original_permit, redesign_notes,
    reused_from_project_id, schematic_designer
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
    NULLIF(v_pd->>'redesign_notes', ''),
    NULLIF(v_pd->>'reused_from_project_id', '')::uuid,
    v_schematic_designer
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
        tenant_id, permit_id, bucket, discipline, text, cat,   -- fix-244: + discipline
        assigned_to, co_assignees, waiting_on,
        sort_order, is_jurisdiction_specific
      )
      SELECT
        p_tenant_id, v_permit_id, tt.bucket,
        -- fix-244: column follows team. NULL/unknown team → 'ent' (matches the
        -- bp_list_permit_tasks COALESCE default). Keep in lockstep with
        -- src/lib/taskTeam.ts disciplineForTeam.
        COALESCE(public.bp_discipline_for_team(tt.default_team), 'ent'),
        tt.text, tt.cat,
        -- fix-222: new team taxonomy routing (Architecture kept for safety).
        CASE tt.default_team
          WHEN 'Entitlements'     THEN NULLIF(v_permit->>'ent_lead', '')
          WHEN 'Design Associate' THEN NULLIF(v_permit->>'da', '')
          WHEN 'Architecture'     THEN NULLIF(v_permit->>'da', '')
          WHEN 'Schematic Team'   THEN (v_schematic_designer)[1]
          ELSE NULLIF(tt.default_team, '')
        END AS assigned_to,
        -- fix-222: resolve dynamic co-assignee tokens per-project; plain names
        -- pass through. Mirrors src/lib/taskTeam.ts resolveCoAssignees.
        (
          SELECT COALESCE(
                   array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND r <> ''),
                   ARRAY[]::text[])
          FROM unnest(COALESCE(tt.default_co_assignees, ARRAY[]::text[])) AS elem
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN elem = 'role:design_associate'
                THEN ARRAY[NULLIF(v_permit->>'da', '')]
              WHEN elem = 'role:design_manager'
                THEN ARRAY[(
                  SELECT g.dm_name FROM public.dm_da_groups g
                  WHERE g.tenant_id = p_tenant_id
                    AND g.da_name = NULLIF(v_permit->>'da', '')
                  LIMIT 1)]
              WHEN elem = 'role:schematic_designer'
                THEN COALESCE(v_schematic_designer, ARRAY[]::text[])
              ELSE ARRAY[elem]
            END AS arr
          ) x
          CROSS JOIN LATERAL unnest(x.arr) AS r
        ) AS co_assignees,
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

  -- fix-208: ONE holistic project DD window.
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

-- ---------------------------------------------------------------------------
-- 3. Backfill existing NULL-discipline tasks from their matched template.
-- Match: permits.type = tt.permit_type AND permit_tasks.text = tt.text (+tenant).
-- Idempotent (only NULL rows); never clobbers a user-set discipline. Unmatched
-- NULL rows are left NULL (render 'ent' via the list COALESCE) — no NULL->arch.
-- ---------------------------------------------------------------------------
WITH derived AS (
  SELECT pt.id AS task_id,
         CASE
           WHEN bool_or(tt.default_team IN ('Design Associate','Design Manager','Schematic Team','Architecture'))
             THEN 'arch'
           ELSE 'ent'   -- Entitlements or a matched-but-null-team template
         END AS disc
  FROM public.permit_tasks pt
  JOIN public.permits p        ON p.id = pt.permit_id
  JOIN public.task_templates tt ON tt.tenant_id = pt.tenant_id
                                AND tt.permit_type = p.type
                                AND tt.text = pt.text
  WHERE pt.discipline IS NULL
  GROUP BY pt.id
)
UPDATE public.permit_tasks pt
   SET discipline = d.disc,
       updated_at = now()
  FROM derived d
 WHERE pt.id = d.task_id
   AND pt.discipline IS NULL;

COMMIT;
