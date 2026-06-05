-- fix-119-a: tighten the cycle auto-snap WHERE clause to skip no-op updates.
--
-- Investigation context (see fix-119 brief):
--   The Bobby-reported "6 phantom cycles from 6 arrow clicks" bug was already
--   closed by fix-83 (migration `fix_83_cycle_snap_idempotency.sql`), which
--   swapped the snap branches in bp_upsert_permit_cycle_row from
--   IF NOT EXISTS / INSERT-else-UPDATE to atomic
--   INSERT … ON CONFLICT (permit_id, cycle_index) DO UPDATE. Prod has zero
--   duplicate (permit_id, cycle_index) rows as of 2026-06-05; no residual
--   damage exists.
--
-- What fix-119-a adds: defense-in-depth tightening. The fix-83 ON CONFLICT
-- WHERE clause fires the UPDATE on every conflicting call that satisfies
--   submitted IS NULL OR submitted = v_old_intake
-- — which includes the case where v_old_intake equals EXCLUDED.submitted
-- (i.e., the new snap target is identical to what cycle N+1 already shows).
-- That path bumps cycle N+1.updated_at unnecessarily on every rapid-retry,
-- breaking the "OCC token round-trips don't move when nothing changed"
-- invariant downstream consumers (the inflight-edit highlight ring,
-- updated_at-driven cache invalidation) rely on.
--
-- Adding `AND submitted IS DISTINCT FROM EXCLUDED.submitted` to the WHERE
-- collapses the same-value re-assertion to a true no-op: PG's
-- INSERT … ON CONFLICT semantics treat a WHERE-false branch as an
-- absorbed conflict (no row written, no trigger fired). cycle N+1's
-- updated_at therefore only advances when the snap target actually
-- changes value.
--
-- Signature / return shape / OCC handling / chronology validation are
-- unchanged from fix-83. The only diff is the four ON CONFLICT WHERE
-- clauses (two in the INSERT path, two in the UPDATE path).

BEGIN;

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

  -- Chronology validation (unchanged from fix-83).
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

  -- INSERT path (caller created a fresh cycle row).
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
          WHERE (public.permit_cycles.submitted IS NULL
                 OR public.permit_cycles.submitted = v_old_intake)
            -- fix-119-a: skip the UPDATE entirely when the snap target
            -- already equals the new value. Prevents no-op updated_at
            -- bumps on rapid re-asserts.
            AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;

      IF v_new_resubmitted IS NOT NULL AND v_cycle_index >= 1 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_resubmitted)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE (public.permit_cycles.submitted IS NULL
                 OR public.permit_cycles.submitted = v_old_resubmitted)
            -- fix-119-a: same no-op skip as above.
            AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;
    END IF;

    conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- UPDATE path (existing row + OCC).
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
          WHERE (public.permit_cycles.submitted IS NULL
                 OR public.permit_cycles.submitted = v_old_intake)
            -- fix-119-a: skip no-op updates.
            AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted
        RETURNING permit_cycles.id, permit_cycles.updated_at,
                  permit_cycles.cycle_index, permit_cycles.submitted
          INTO snap_id, snap_updated_at, snap_cycle_index, snap_submitted;
      END IF;

      IF v_new_resubmitted IS NOT NULL AND v_cycle_index >= 1 THEN
        INSERT INTO public.permit_cycles (tenant_id, permit_id, cycle_index, submitted)
        VALUES (v_tenant_id, v_permit_id, v_next_index, v_new_resubmitted)
        ON CONFLICT (permit_id, cycle_index) DO UPDATE
          SET submitted = EXCLUDED.submitted
          WHERE (public.permit_cycles.submitted IS NULL
                 OR public.permit_cycles.submitted = v_old_resubmitted)
            -- fix-119-a: skip no-op updates.
            AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted
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

COMMIT;
