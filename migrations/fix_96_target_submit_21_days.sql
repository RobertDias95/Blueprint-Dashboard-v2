-- fix-96-c: align bp_create_project_with_permits' BP target_submit
-- seed with bp_recompute_target_submits' 21-day offset.
--
-- The create RPC's fallback used `dd_end + INTERVAL '14 days'` when the
-- client omitted target_submit on the Building Permit row. The recompute
-- engine (see fix-85's bp_recompute_target_submits + bp_learn_target_submit_days)
-- uses dd_end + 21 days as its default offset for the Building Permit type
-- when no learned override exists. So the moment a BP got created via the
-- wizard, the engine would recompute target_submit to a date 7 days later
-- than the seed — creating an immediate drift between "what the user saw"
-- and "what the schedule said." Bobby's call: align the seed with the
-- engine.
--
-- Only the BP fallback CASE changes. Everything else in the function body
-- is byte-for-byte identical to the live prod definition (pulled via MCP
-- 2026-06-02).
--
-- Verification post-apply (Bobby will run via MCP):
--   SELECT (DATE '2026-08-01' + INTERVAL '21 days')::date;
--   -- → 2026-08-22  ✓ (matches the brief's expected target_submit)
--
-- This migration is NOT auto-applied by the PR; apply via Supabase MCP
-- after merge.

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
               AND NULLIF(v_permit->>'dd_end', '') IS NOT NULL
          -- fix-96-c: align with bp_recompute_target_submits' 21-day
          -- default. Was '14 days'. The recompute engine fires on every
          -- subsequent dd_end edit / permit upsert and would otherwise
          -- silently shift the date by 7 the moment it runs.
          THEN (NULLIF(v_permit->>'dd_end', '')::date + INTERVAL '21 days')::date
          ELSE NULL
        END
      ),
      NULLIF(v_permit->>'expected_issue', '')::date,
      NULLIF(v_permit->>'dd_start', '')::date,
      NULLIF(v_permit->>'dd_end', '')::date,
      NULLIF(v_permit->>'kickoff_date', '')::date,
      'de', 'Pre-Submittal — GO', NULLIF(p_notes, '')
    )
    RETURNING id INTO v_permit_id;

    v_permit_ids := array_append(v_permit_ids, v_permit_id);

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

  project_id := v_project_id;
  permit_ids := v_permit_ids;
  conflict   := false;
  RETURN NEXT;
END;
$function$;
