-- fix-66 (2026-05-28): make permits.target_submit writable through the
-- atomic project+permits RPC so it can be edited in place from the DD
-- Phase cell on Project Overview (anchored on the project's Building
-- Permit), the same way ACQ Target (expected_issue) already is.
--
-- target_submit is the engine-derived projected submit date that the
-- Schedule Health table already consumes for Estimated Approval, plus
-- upcoming-intakes filtering and weekly reports. Editing it in DD Phase
-- propagates everywhere those read the column.
--
-- ADDITIVE ONLY. Two changes to bp_update_project_with_permits:
--   1. UPDATE branch (existing-permit path): whitelist `target_submit`
--      alongside the columns already handled (type, ent_lead, da,
--      portal_url, num, struct_address, expected_issue).
--   2. INSERT branch (new-permit path): add `target_submit` to the
--      column list + a NULLIF(...)::date value. When the caller doesn't
--      supply target_submit, NULLIF(NULL,'') = NULL, i.e. identical to
--      today's behavior (the column wasn't listed, so it defaulted NULL).
--
-- The RETURNS TABLE signature, arg signature, OCC logic, builder upsert,
-- cycle-0 seeding, delete loop, and exception handling are all
-- byte-identical to the current prod definition (captured via
-- pg_get_functiondef). RETURNS TABLE is unchanged → CREATE OR REPLACE
-- works without a DROP+CREATE.
--
-- target_submit_is_manual is INTENTIONALLY NOT written here. The trigger
-- bp_trg_set_target_submit_manual_flag (BEFORE INSERT OR UPDATE OF
-- target_submit) owns that flag: on a direct user write it sets manual =
-- true; on a NULL value or an engine-path write (bp.target_submit_engine_
-- depth > 0 / pg_trigger_depth() > 1) it sets manual = false. The
-- frontend writes only target_submit and lets the trigger classify it.
-- bp_recompute_target_submits (the engine path) is untouched.

CREATE OR REPLACE FUNCTION public.bp_update_project_with_permits(
  p_project_id uuid,
  p_project_expected_updated_at timestamp with time zone,
  p_project_patch jsonb,
  p_permit_upserts jsonb,
  p_permit_deletes integer[]
)
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
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'p_project_id is required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.projects WHERE id = p_project_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
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
        product_type     = CASE WHEN v_patch ? 'product_type'      THEN NULLIF(v_patch->>'product_type','')         ELSE product_type END,
        entitlement_lead = CASE WHEN v_patch ? 'entitlement_lead'  THEN NULLIF(v_patch->>'entitlement_lead','')     ELSE entitlement_lead END,
        design_manager   = CASE WHEN v_patch ? 'design_manager'    THEN NULLIF(v_patch->>'design_manager','')       ELSE design_manager END,
        builder_name     = CASE WHEN v_patch ? 'builder_name'      THEN NULLIF(v_patch->>'builder_name','')         ELSE builder_name END,
        builder_company  = CASE WHEN v_patch ? 'builder_company'   THEN NULLIF(v_patch->>'builder_company','')      ELSE builder_company END,
        builder_email    = CASE WHEN v_patch ? 'builder_email'     THEN NULLIF(v_patch->>'builder_email','')        ELSE builder_email END,
        builder_phone    = CASE WHEN v_patch ? 'builder_phone'     THEN NULLIF(v_patch->>'builder_phone','')        ELSE builder_phone END
      WHERE id = p_project_id
        AND updated_at = p_project_expected_updated_at;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        v_occ := true; v_kind := 'project'; v_cid := p_project_id::text;
        RAISE EXCEPTION 'occ_conflict';
      END IF;

      IF COALESCE(TRIM(v_patch->>'builder_name'), '') <> '' THEN
        INSERT INTO public.builders (name, company, email, phone, tenant_id)
        VALUES (
          TRIM(v_patch->>'builder_name'),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_company','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_email','')), ''),
          NULLIF(TRIM(COALESCE(v_patch->>'builder_phone','')), ''),
          v_tenant
        )
        ON CONFLICT (name, company) DO NOTHING;
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
          -- fix-66: target_submit is now writable here. The trigger
          -- bp_trg_set_target_submit_manual_flag flips target_submit_is_manual
          -- = true on this direct write; we never set the flag ourselves.
          target_submit  = CASE WHEN v_elem ? 'target_submit'  THEN NULLIF(v_elem->>'target_submit','')::date  ELSE target_submit END
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
          -- fix-66: when target_submit isn't supplied this is NULL — the
          -- same value the column took before it was listed here.
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
