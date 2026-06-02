-- fix-89: full chronology validation in bp_upsert_permit_cycle_row.
--
-- Bug: 2601 E Galer Demo — typed resubmitted=06-12 on cycle 1 when
-- submitted=06-19 (off by 10 days; meant 06-22). The save went through
-- (the only chronology check today is intake_accepted < submitted), then
-- the cycle auto-snap (fix-25-DD / fix-83) wrote cycle 2.submitted=06-12,
-- producing three cycles where cycle 2 chronologically preceded cycle 1.
-- Cleanup was already done via MCP — this migration prevents the next one.
--
-- Bobby's design call: enforce the full per-cycle chain at save time
--   submitted ≤ intake_accepted ≤ corr_issued ≤ resubmitted
-- Cross-cycle invariants are gated transitively: the auto-snap writes
-- cycle N+1.submitted = cycle N.resubmitted, so resubmitted ≥ submitted
-- on cycle N implies cycle N+1.submitted ≥ cycle N.submitted, i.e. cycles
-- can only move forward in time.
--
-- The function body is pulled from prod (matches fix-83's migration as of
-- 2026-06-02). Only the validation block at the top changes. INSERT path,
-- UPDATE path, OCC handling, fix-83 ON CONFLICT snap branches, fix-25-DD
-- WHERE-clause gating — all unchanged. The new v_new_corr_issued local
-- carries the parsed corr_issued for the validation checks; the INSERT /
-- UPDATE writes still use the inline NULLIF(...) so the rest of the
-- function is byte-for-byte identical to fix-83.
--
-- Error code 22008 (datetime field overflow) matches the existing
-- intake/submitted exception so the client-side error toast handling
-- stays uniform — and fix-87 routes RAISE EXCEPTION through the toast →
-- bp_log_error path automatically, so chronology violations show up on
-- Settings → Errors as a side benefit.

CREATE OR REPLACE FUNCTION public.bp_upsert_permit_cycle_row(
  p_id uuid,
  p_data jsonb,
  p_expected_updated_at timestamp with time zone
)
RETURNS TABLE(
  out_id uuid,
  updated_at timestamp with time zone,
  conflict boolean,
  snap_id uuid,
  snap_cycle_index integer,
  snap_submitted date,
  snap_updated_at timestamp with time zone
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_actual           timestamptz;
  v_new_submitted    date;
  v_new_intake       date;
  v_new_corr_issued  date;
  v_new_resubmitted  date;
  v_old_intake       date;
  v_old_resubmitted  date;
  v_permit_id        integer;
  v_cycle_index      integer;
  v_next_index       integer;
  v_tenant_id        uuid;
BEGIN
  v_new_submitted   := NULLIF(p_data->>'submitted','')::date;
  v_new_intake      := NULLIF(p_data->>'intake_accepted','')::date;
  v_new_corr_issued := NULLIF(p_data->>'corr_issued','')::date;
  v_new_resubmitted := NULLIF(p_data->>'resubmitted','')::date;
  v_tenant_id       := NULLIF(p_data->>'tenant_id','')::uuid;

  IF p_id IS NULL THEN
    v_cycle_index := NULLIF(p_data->>'cycle_index','')::integer;
  ELSE
    SELECT pc.cycle_index INTO v_cycle_index
      FROM public.permit_cycles pc WHERE pc.id = p_id;
  END IF;

  -- fix-89: chronology chain — each pair only fires when both dates
  -- are non-null (partial data is legitimate during workflow). Same
  -- ERRCODE 22008 as the prior intake/submitted check so client-side
  -- handling is uniform.
  IF v_new_submitted IS NOT NULL AND v_new_intake IS NOT NULL
     AND v_new_intake < v_new_submitted THEN
    RAISE EXCEPTION
      'bp_upsert_permit_cycle_row: Cycle %: intake_accepted (%) cannot precede submitted (%)',
      COALESCE(v_cycle_index, -1), v_new_intake, v_new_submitted
      USING ERRCODE = '22008';
  END IF;

  IF v_new_intake IS NOT NULL AND v_new_corr_issued IS NOT NULL
     AND v_new_corr_issued < v_new_intake THEN
    RAISE EXCEPTION
      'bp_upsert_permit_cycle_row: Cycle %: corr_issued (%) cannot precede intake_accepted (%)',
      COALESCE(v_cycle_index, -1), v_new_corr_issued, v_new_intake
      USING ERRCODE = '22008';
  END IF;

  IF v_new_submitted IS NOT NULL AND v_new_corr_issued IS NOT NULL
     AND v_new_corr_issued < v_new_submitted THEN
    RAISE EXCEPTION
      'bp_upsert_permit_cycle_row: Cycle %: corr_issued (%) cannot precede submitted (%)',
      COALESCE(v_cycle_index, -1), v_new_corr_issued, v_new_submitted
      USING ERRCODE = '22008';
  END IF;

  IF v_new_resubmitted IS NOT NULL THEN
    IF v_new_submitted IS NOT NULL AND v_new_resubmitted < v_new_submitted THEN
      RAISE EXCEPTION
        'bp_upsert_permit_cycle_row: Cycle %: resubmitted (%) cannot precede submitted (%)',
        COALESCE(v_cycle_index, -1), v_new_resubmitted, v_new_submitted
        USING ERRCODE = '22008';
    END IF;
    IF v_new_intake IS NOT NULL AND v_new_resubmitted < v_new_intake THEN
      RAISE EXCEPTION
        'bp_upsert_permit_cycle_row: Cycle %: resubmitted (%) cannot precede intake_accepted (%)',
        COALESCE(v_cycle_index, -1), v_new_resubmitted, v_new_intake
        USING ERRCODE = '22008';
    END IF;
    IF v_new_corr_issued IS NOT NULL AND v_new_resubmitted < v_new_corr_issued THEN
      RAISE EXCEPTION
        'bp_upsert_permit_cycle_row: Cycle %: resubmitted (%) cannot precede corr_issued (%)',
        COALESCE(v_cycle_index, -1), v_new_resubmitted, v_new_corr_issued
        USING ERRCODE = '22008';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.permit_cycles (
      tenant_id, permit_id, cycle_index,
      submitted, city_target, corr_issued, resubmitted, intake_accepted
    ) VALUES (
      v_tenant_id,
      (p_data->>'permit_id')::integer,
      v_cycle_index,
      v_new_submitted,
      NULLIF(p_data->>'city_target','')::date,
      NULLIF(p_data->>'corr_issued','')::date,
      v_new_resubmitted, v_new_intake
    )
    RETURNING permit_cycles.id, permit_cycles.updated_at
      INTO out_id, updated_at;

    IF v_new_intake IS NOT NULL OR v_new_resubmitted IS NOT NULL THEN
      SELECT pc.permit_id, pc.cycle_index INTO v_permit_id, v_cycle_index
        FROM public.permit_cycles pc WHERE pc.id = out_id;
      v_next_index := v_cycle_index + 1;

      IF v_new_intake IS NOT NULL AND v_cycle_index = 0 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_intake)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE public.permit_cycles.submitted IS NULL
             OR public.permit_cycles.submitted = v_old_intake
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;

      IF v_new_resubmitted IS NOT NULL AND v_cycle_index >= 1 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_resubmitted)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE public.permit_cycles.submitted IS NULL
             OR public.permit_cycles.submitted = v_old_resubmitted
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;
    END IF;

    conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pc.intake_accepted, pc.resubmitted
    INTO v_old_intake, v_old_resubmitted
    FROM public.permit_cycles pc WHERE pc.id = p_id;

  UPDATE public.permit_cycles pc
  SET
    submitted       = v_new_submitted,
    city_target     = NULLIF(p_data->>'city_target','')::date,
    corr_issued     = NULLIF(p_data->>'corr_issued','')::date,
    resubmitted     = v_new_resubmitted,
    intake_accepted = v_new_intake
  WHERE pc.id = p_id AND pc.updated_at = p_expected_updated_at
  RETURNING pc.id, pc.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    IF v_new_intake IS NOT NULL OR v_new_resubmitted IS NOT NULL THEN
      SELECT pc.permit_id, pc.cycle_index INTO v_permit_id, v_cycle_index
        FROM public.permit_cycles pc WHERE pc.id = out_id;
      v_next_index := v_cycle_index + 1;

      IF v_new_intake IS NOT NULL AND v_cycle_index = 0 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_intake)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE public.permit_cycles.submitted IS NULL
             OR public.permit_cycles.submitted = v_old_intake
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;

      IF v_new_resubmitted IS NOT NULL AND v_cycle_index >= 1 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_resubmitted)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE public.permit_cycles.submitted IS NULL
             OR public.permit_cycles.submitted = v_old_resubmitted
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;
    END IF;

    conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT pc.updated_at INTO v_actual
    FROM public.permit_cycles pc WHERE pc.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END;
$function$;
