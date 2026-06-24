-- fix-199: bidirectional Seattle intake sync — permits.intake_date <-> intake_records.
--
-- A Seattle CN/DM permit's intake date IS its slot. Keep the two in lockstep
-- BOTH ways so Project Overview, the Intake Tracker, and the draw-schedule
-- Seattle intakes always show the same date. See
-- docs/fix-198-intake-records-investigation.md for the full map.
--
-- Directions:
--   permits.intake_date -> intake_records : AFTER INSERT/UPDATE TRIGGER on permits
--     (covers the SCRAPER too, not just the UI). Upserts the permit's OWN
--     real-permit slot; clearing the date DELETEs that slot (falls off the
--     tracker). NEVER auto-claims or mutates an OPEN placeholder.
--   intake_records -> permits : in bp_upsert_intake_records_row + (already)
--     bp_swap_intake_dates. Writing/editing a real-permit row pushes its
--     (non-null) date to the linked permit.
--
-- LOOP GUARD (value-equality short-circuit on both sides, so the trigger and the
-- RPC can't ping-pong):
--   * the trigger no-ops when the permit's existing slot already equals the new
--     intake_date;
--   * the RPC updates the slot FIRST then the permit, and only writes the permit
--     when its value actually differs — so the permit-update fires the trigger,
--     which finds the slot already equal and no-ops.
--
-- Scope: Seattle Building Permit / Demolition only (matches the Design-strip
-- SeattleIntakeRow gate: project.juris = 'Seattle' AND permit.type in those two).

-- ---------------------------------------------------------------------------
-- D. Partial unique index — one real-permit slot per permit. (Probed: 0 existing
--    violations after the fix-198 dedupe.) Placeholders (permit_id NULL) exempt.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS intake_records_permit_real_uq
  ON public.intake_records (tenant_id, permit_id)
  WHERE permit_id IS NOT NULL AND is_placeholder = false;

-- ---------------------------------------------------------------------------
-- A. permits.intake_date -> intake_records trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_sync_intake_record_from_permit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_juris     text;
  v_address   text;
  v_slot_id   integer;
  v_slot_date date;
  v_new_id    integer;
BEGIN
  -- Gate: Seattle Building Permit / Demolition only.
  IF NEW.type NOT IN ('Building Permit', 'Demolition') THEN
    RETURN NEW;
  END IF;
  SELECT p.juris, p.address INTO v_juris, v_address
    FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_juris IS DISTINCT FROM 'Seattle' THEN
    RETURN NEW;
  END IF;

  -- This permit's OWN real-permit slot (never a placeholder).
  SELECT ir.id, ir.intake_date INTO v_slot_id, v_slot_date
    FROM public.intake_records ir
   WHERE ir.permit_id = NEW.id AND ir.is_placeholder = false
   ORDER BY ir.id
   LIMIT 1;

  -- CLEAR: the permit's intake date was removed -> drop its slot (off the tracker).
  IF NEW.intake_date IS NULL THEN
    IF v_slot_id IS NOT NULL THEN
      DELETE FROM public.intake_records WHERE id = v_slot_id;
    END IF;
    RETURN NEW;
  END IF;

  -- LOOP GUARD: slot already equals the permit's date -> nothing to do.
  IF v_slot_id IS NOT NULL AND v_slot_date IS NOT DISTINCT FROM NEW.intake_date THEN
    RETURN NEW;
  END IF;

  IF v_slot_id IS NOT NULL THEN
    -- Sync the existing slot's date only (leave its display fields as-is).
    UPDATE public.intake_records SET intake_date = NEW.intake_date WHERE id = v_slot_id;
  ELSE
    -- No slot yet -> create one (id is max+1; intake_records.id has no sequence,
    -- matching bp_upsert_intake_records_row's client-side nextId()).
    v_new_id := (SELECT COALESCE(MAX(id), 0) + 1 FROM public.intake_records);
    INSERT INTO public.intake_records (
      id, tenant_id, project_id, permit_id, address, permit_num, permit_type,
      intake_date, is_placeholder, portal_url
    ) VALUES (
      v_new_id, NEW.tenant_id, NEW.project_id, NEW.id, v_address, NEW.num, NEW.type,
      NEW.intake_date, false, NEW.portal_url
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bp_trg_permits_intake_sync_ins ON public.permits;
CREATE TRIGGER bp_trg_permits_intake_sync_ins
  AFTER INSERT ON public.permits
  FOR EACH ROW
  WHEN (NEW.intake_date IS NOT NULL)
  EXECUTE FUNCTION public.bp_sync_intake_record_from_permit();

DROP TRIGGER IF EXISTS bp_trg_permits_intake_sync_upd ON public.permits;
CREATE TRIGGER bp_trg_permits_intake_sync_upd
  AFTER UPDATE OF intake_date ON public.permits
  FOR EACH ROW
  WHEN (NEW.intake_date IS DISTINCT FROM OLD.intake_date)
  EXECUTE FUNCTION public.bp_sync_intake_record_from_permit();

-- ---------------------------------------------------------------------------
-- B. intake_records -> permits reverse sync, folded into the upsert RPC.
--    Updates the slot FIRST (existing behavior), then pushes the slot's
--    NON-NULL date to the linked permit (value-guarded). A null slot date is
--    NOT pushed (preserves the valid "real slot, date TBD" state) and never
--    deletes a permit's date here — clearing happens only from the permit side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_upsert_intake_records_row(p_id integer, p_data jsonb, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_id integer, updated_at timestamp with time zone, conflict boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actual         timestamptz;
  v_permit_id      integer := NULLIF(p_data->>'permit_id','')::integer;
  v_intake_date    date    := NULLIF(p_data->>'intake_date','')::date;
  v_is_placeholder boolean := COALESCE((p_data->>'is_placeholder')::boolean, false);
BEGIN
  IF p_expected_updated_at IS NULL THEN
    INSERT INTO public.intake_records (
      id, project_id, permit_id, address, permit_num, permit_type,
      intake_date, is_placeholder, portal_url, link
    )
    VALUES (
      p_id,
      NULLIF(p_data->>'project_id','')::uuid,
      v_permit_id,
      p_data->>'address',
      p_data->>'permit_num',
      p_data->>'permit_type',
      v_intake_date,
      v_is_placeholder,
      p_data->>'portal_url',
      p_data->>'link'
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING intake_records.id, intake_records.updated_at
      INTO out_id, updated_at;

    IF NOT FOUND THEN
      SELECT ir.updated_at INTO v_actual
        FROM public.intake_records ir WHERE ir.id = p_id;
      out_id := p_id;
      updated_at := v_actual;
      conflict := true;
      RETURN NEXT;
      RETURN;
    END IF;

    -- fix-199 reverse sync: a real-permit slot's non-null date drives the permit.
    IF v_permit_id IS NOT NULL AND NOT v_is_placeholder AND v_intake_date IS NOT NULL THEN
      UPDATE public.permits p SET intake_date = v_intake_date
       WHERE p.id = v_permit_id AND p.intake_date IS DISTINCT FROM v_intake_date;
    END IF;

    conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.intake_records ir
  SET
    project_id     = NULLIF(p_data->>'project_id','')::uuid,
    permit_id      = v_permit_id,
    address        = p_data->>'address',
    permit_num     = p_data->>'permit_num',
    permit_type    = p_data->>'permit_type',
    intake_date    = v_intake_date,
    is_placeholder = v_is_placeholder,
    portal_url     = p_data->>'portal_url',
    link           = p_data->>'link'
  WHERE ir.id = p_id
    AND ir.updated_at = p_expected_updated_at
  RETURNING ir.id, ir.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    -- fix-199 reverse sync (same rule as the insert path).
    IF v_permit_id IS NOT NULL AND NOT v_is_placeholder AND v_intake_date IS NOT NULL THEN
      UPDATE public.permits p SET intake_date = v_intake_date
       WHERE p.id = v_permit_id AND p.intake_date IS DISTINCT FROM v_intake_date;
    END IF;

    conflict := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT ir.updated_at INTO v_actual
    FROM public.intake_records ir WHERE ir.id = p_id;
  out_id := p_id;
  updated_at := v_actual;
  conflict := true;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- E. One-time backfill — create a real-permit slot for every Seattle CN/DM
--    permit that has an intake_date but no slot yet. Idempotent (NOT EXISTS
--    guard); placeholders untouched; the partial unique index above protects
--    against duplicates. Direct INSERT (does not touch permits, so no trigger
--    fires here).
-- ---------------------------------------------------------------------------
WITH to_backfill AS (
  SELECT pe.id AS permit_id, pe.tenant_id, pe.project_id, pr.address,
         pe.num, pe.type, pe.intake_date, pe.portal_url,
         ROW_NUMBER() OVER (ORDER BY pe.id) AS rn
  FROM public.permits pe
  JOIN public.projects pr ON pr.id = pe.project_id
  WHERE pe.intake_date IS NOT NULL
    AND pe.type IN ('Building Permit', 'Demolition')
    AND pr.juris = 'Seattle'
    AND NOT EXISTS (
      SELECT 1 FROM public.intake_records ir
      WHERE ir.permit_id = pe.id AND ir.is_placeholder = false
    )
), base AS (
  SELECT COALESCE(MAX(id), 0) AS max_id FROM public.intake_records
)
INSERT INTO public.intake_records (
  id, tenant_id, project_id, permit_id, address, permit_num, permit_type,
  intake_date, is_placeholder, portal_url
)
SELECT b.max_id + t.rn, t.tenant_id, t.project_id, t.permit_id, t.address,
       t.num, t.type, t.intake_date, false, t.portal_url
FROM to_backfill t CROSS JOIN base b;
