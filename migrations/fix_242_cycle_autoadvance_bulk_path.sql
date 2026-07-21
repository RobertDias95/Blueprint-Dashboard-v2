-- fix-242: cycle auto-advance must fire on the BULK save path too.
--
-- DISCOVERY (the brief's premise was slightly off — documented here):
--   The per-row cycle editor in v2 (PermitDetailV2 → commitCycleField /
--   commitDesignField → useUpsertPermitCycle) saves via
--   bp_upsert_permit_cycle_row, which ALREADY auto-advances:
--     - cycle 0 + intake_accepted  → snap cycle 1.submitted = intake_accepted
--     - cycle N>=1 + resubmitted    → snap cycle N+1.submitted = resubmitted
--   (see fix_119_idempotent_cycle_autoderivation.sql).
--
--   The gap is the OTHER write path: bp_replace_permit_cycles(permit_id, jsonb)
--   — the scraper's bulk "delete all cycles + reinsert the portal's array"
--   RPC. It has NO auto-advance, so when the scraper records a resubmitted
--   date on the latest cycle (or intake on cycle 0) without also supplying the
--   next cycle, the permit is left stuck with no cycle N+1. The v2 client never
--   calls bp_replace_permit_cycles, so the "stuck" permits Bobby saw were
--   written by the bulk path, not the editor.
--
-- FIX: extract the auto-advance rule into a single canonical helper,
-- bp_apply_cycle_autoadvance(permit_id), and call it at the end of
-- bp_replace_permit_cycles so both save paths now create the next cycle under
-- the same rule. bp_upsert_permit_cycle_row keeps its inline snap unchanged —
-- it additionally RETURNs the snap-row details the client cache reads
-- (snap_id / snap_cycle_index / …), a contract we must not break; the rule it
-- encodes is identical to the helper's.
--
-- Idempotency / never-clobber: the helper INSERTs the next cycle ON CONFLICT
-- (permit_id, cycle_index) DO UPDATE ... WHERE the existing submitted IS NULL
-- (and differs) — so it fills a blank next-cycle.submitted but never overwrites
-- a manually-set one, and re-running is a no-op. Same shape as the fix-83 /
-- fix-119 ON CONFLICT guard in bp_upsert_permit_cycle_row.
--
-- tenant_id is intentionally omitted from the INSERT — the BEFORE INSERT
-- trigger permit_cycles_default_tenant (default_tenant_id_to_caller) fills it
-- from the caller, exactly as bp_replace_permit_cycles' own inserts rely on.

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical auto-advance rule (single source of truth for the bulk path).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_apply_cycle_autoadvance(p_permit_id integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r         RECORD;
  v_rows    integer;
  v_created integer := 0;
BEGIN
  IF p_permit_id IS NULL THEN
    RETURN 0;
  END IF;

  -- One pass over the permit's current cycles. Each cycle that carries an
  -- "advance" trigger date (cycle 0 → intake_accepted, cycle N>=1 →
  -- resubmitted) ensures the NEXT cycle exists with submitted = that date.
  -- The FOR query is snapshotted at loop start, so a freshly-created next
  -- cycle is not itself re-advanced in the same call (mirrors the single-level
  -- advance bp_upsert_permit_cycle_row performs per write).
  FOR r IN
    SELECT pc.cycle_index + 1 AS next_index,
           CASE
             WHEN pc.cycle_index = 0  THEN pc.intake_accepted
             WHEN pc.cycle_index >= 1 THEN pc.resubmitted
           END AS trigger_date
    FROM public.permit_cycles pc
    WHERE pc.permit_id = p_permit_id
      AND ((pc.cycle_index = 0  AND pc.intake_accepted IS NOT NULL)
        OR (pc.cycle_index >= 1 AND pc.resubmitted    IS NOT NULL))
    ORDER BY pc.cycle_index
  LOOP
    INSERT INTO public.permit_cycles (permit_id, cycle_index, submitted)
    VALUES (p_permit_id, r.next_index, r.trigger_date)
    ON CONFLICT (permit_id, cycle_index) DO UPDATE
      SET submitted = EXCLUDED.submitted
      WHERE public.permit_cycles.submitted IS NULL
        AND public.permit_cycles.submitted IS DISTINCT FROM EXCLUDED.submitted;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created := v_created + v_rows;
  END LOOP;

  RETURN v_created;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_apply_cycle_autoadvance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_apply_cycle_autoadvance(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Bulk replace path — now auto-advances after the rebuild.
-- Body identical to the live definition except for the PERFORM + recount tail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_replace_permit_cycles(p_permit_id integer, p_cycles jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cy   jsonb;
  i    integer;
  n    integer;
begin
  if p_permit_id is null then
    raise exception 'p_permit_id is required';
  end if;
  if p_cycles is null or jsonb_typeof(p_cycles) <> 'array' then
    raise exception 'p_cycles must be a jsonb array';
  end if;
  if not exists (
    select 1 from public.permits p where p.id = p_permit_id
  ) then
    raise exception 'permit % not found', p_permit_id;
  end if;

  delete from public.permit_cycles where permit_id = p_permit_id;

  n := jsonb_array_length(p_cycles);
  for i in 0..n-1 loop
    cy := p_cycles->i;
    insert into public.permit_cycles (
      permit_id, cycle_index, submitted, city_target,
      corr_issued, resubmitted, intake_accepted
    ) values (
      p_permit_id, i,
      nullif(cy->>'submitted','')::date,
      nullif(cy->>'cityTarget','')::date,
      nullif(cy->>'corrIssued','')::date,
      nullif(cy->>'resubmitted','')::date,
      case when i = 0 then nullif(cy->>'intakeAccepted','')::date else null end
    );
  end loop;

  -- fix-242: apply the same auto-advance rule the per-row editor path
  -- (bp_upsert_permit_cycle_row) applies, so a resubmitted on the latest
  -- review cycle (or intake on cycle 0) supplied by the bulk caller creates
  -- the next cycle instead of leaving the permit stuck.
  perform public.bp_apply_cycle_autoadvance(p_permit_id);

  -- Recount so the return reflects any auto-advanced cycle.
  select count(*) into n from public.permit_cycles where permit_id = p_permit_id;

  return jsonb_build_object('permit_id', p_permit_id, 'cycles', n);
end;
$function$;

COMMIT;
