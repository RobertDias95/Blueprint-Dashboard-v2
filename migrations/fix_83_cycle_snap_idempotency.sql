-- fix-83: race-safe cycle auto-snap.
--
-- Bug: 4903 S Greenway BP — clicking the calendar date-picker up-arrow 5-6
-- times to backscroll c0.intake_accepted spawned 6 phantom cycle 1 rows. Root
-- cause: fix-75's commitOnChange fires onChange-driven mutations per step,
-- the calendar emits a full valid date at every arrow click, and the snap
-- branch in bp_upsert_permit_cycle_row used IF NOT EXISTS / INSERT-else-UPDATE
-- which is not atomic under concurrent calls — each in-flight transaction saw
-- "c1 doesn't exist yet" and each did its own INSERT.
--
-- This migration provides the database half of the two-layer fix (the
-- frontend half is a 500ms debounce in DateCell.onChange). It makes the snap
-- idempotent at the SQL level so any future race — slow-typing, calendar
-- spam, concurrent tabs, scraper retries — collapses cleanly to one row.
--
-- Both prod and staging already carry UNIQUE (permit_id, cycle_index) on
-- permit_cycles (named permit_cycles_permit_id_cycle_index_key). This script
-- guards the ADD CONSTRAINT in a DO block so re-runs are safe and a fresh
-- environment without the constraint still gets it. Prod also has zero
-- existing duplicate (permit_id, cycle_index) pairs as of 2026-05-29.
--
-- The function rewrite swaps each of the four snap branches (two in the
-- INSERT path, two in the UPDATE path) from IF NOT EXISTS / INSERT-else-
-- UPDATE to a single INSERT … ON CONFLICT (permit_id, cycle_index) DO UPDATE.
-- The DO UPDATE's WHERE clause preserves fix-25-DD patch 3: the snap only
-- propagates to a c1.submitted that is NULL or still equals the OLD intake
-- (i.e., snap-set, never manually overridden). In the INSERT path v_old_*
-- is NULL so the comparison silently fails and only NULL c1.submitted
-- targets get filled — same as the prior IF NOT EXISTS branch.
--
-- bp_upsert_permit_cycle_row's signature, return shape, OCC handling, and
-- intake_accepted < submitted validation are all unchanged.

BEGIN;

-- Idempotent constraint add — both prod + staging already have this; this
-- guard means the migration is safe to re-run, AND a freshly-provisioned
-- environment gets the same protection.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.permit_cycles'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (permit_id, cycle_index)'
  ) THEN
    ALTER TABLE public.permit_cycles
      ADD CONSTRAINT permit_cycles_permit_cycle_unique
      UNIQUE (permit_id, cycle_index);
  END IF;
END
$$;

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
  v_new_resubmitted := NULLIF(p_data->>'resubmitted','')::date;
  -- fix-30: optional tenant_id override for service-role callers
  -- (scraper). NULL when omitted — falls through to default trigger.
  v_tenant_id       := NULLIF(p_data->>'tenant_id','')::uuid;

  IF p_id IS NULL THEN
    v_cycle_index := NULLIF(p_data->>'cycle_index','')::integer;
  ELSE
    SELECT pc.cycle_index INTO v_cycle_index
      FROM public.permit_cycles pc WHERE pc.id = p_id;
  END IF;

  IF v_new_submitted IS NOT NULL AND v_new_intake IS NOT NULL
     AND v_new_intake < v_new_submitted THEN
    RAISE EXCEPTION
      'bp_upsert_permit_cycle_row: Cycle %: intake_accepted (%) cannot precede submitted (%)',
      COALESCE(v_cycle_index, -1), v_new_intake, v_new_submitted
      USING ERRCODE = '22008';
  END IF;

  -- INSERT path (no p_id). tenant_id explicitly passed when caller
  -- supplies it; otherwise the default trigger fills it from
  -- auth.uid(). Snap INSERTs further down use the same v_tenant_id.
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

      -- fix-83: race-safe snap. Concurrent intake_accepted writes from
      -- the same browser (calendar-arrow spam) or from scraper retries
      -- collapse on UNIQUE (permit_id, cycle_index). The DO UPDATE WHERE
      -- mirrors fix-25-DD patch 3 — snap only propagates to a NULL or
      -- not-manually-overridden submitted. v_old_intake is NULL on the
      -- INSERT path so submitted = v_old_intake is FALSE; only the
      -- IS NULL leg applies here (same as the prior IF NOT EXISTS).
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

  -- UPDATE path. fix-25-DD: read OLD intake/resub BEFORE the UPDATE
  -- so the snap propagation WHERE clauses can widen safely.
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

      -- fix-83: same INSERT … ON CONFLICT DO UPDATE pattern as the
      -- INSERT path. v_old_intake here is the PRE-UPDATE c0.intake so
      -- fix-25-DD patch 3 still gates "don't stomp a manual override".
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

  -- OCC miss: row exists but updated_at differs from expected.
  SELECT pc.updated_at INTO v_actual
    FROM public.permit_cycles pc WHERE pc.id = p_id;
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END;
$function$;

COMMIT;
