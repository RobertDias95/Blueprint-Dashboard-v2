-- fix-249b: re-derive target_submit when a cycle-1 `resubmitted` arrives as an
-- INSERT (the scraper's bulk path), not only as an UPDATE.
--
-- Bobby's requirement, confirmed twice: "I just want the permit anchored to the
-- bp resubmittal date and to move with the building permit — same with the
-- ULS." IPR and ULS are anchored to the Building Permit's cycle-1
-- `resubmitted`. That anchor was inert on the path that matters most.
--
-- WHAT WAS ACTUALLY HAPPENING (probed on prod 2026-07-28, read-only)
-- ------------------------------------------------------------------
-- Three facts, all verified against the live catalog:
--
--   1. `bp_trg_permit_cycles_target_submit` is AFTER **UPDATE OF**
--      intake_accepted, resubmitted. There is no INSERT arm at all.
--
--   2. `bp_trg_cycle_submit_recompute_ins` does fire AFTER INSERT, but its
--      function opens with `IF NEW.cycle_index <> 0 THEN RETURN NEW; END IF;`
--      — a cycle-1 INSERT recomputes nothing.
--
--   3. `bp_replace_permit_cycles` (the scraper's bulk path) DELETEs every
--      cycle for the permit and REINSERTs them in a loop, i = 0..n-1.
--
-- REFINEMENT vs the original diagnosis: it is NOT true that a bulk replace
-- fires no recompute. The loop inserts cycle 0 FIRST, and that cycle-0 INSERT
-- does satisfy (2) and fires bp_recompute_target_submits. But it fires while
-- only cycle 0 exists — BEFORE cycle 1 (carrying `resubmitted`) has been
-- inserted. So the engine recomputes against a permit that appears to have no
-- cycle-1 resubmit, falls back to the PROJECTED anchor, and nothing ever
-- re-derives once the real date lands. One recompute per bulk call, at
-- precisely the wrong moment. The practical effect is what Bobby described:
-- IPR/ULS never move with the BP's real resubmittal.
--
-- `bp_apply_cycle_autoadvance`, called at the end of the bulk replace, only
-- ever writes `submitted` (never `resubmitted`), so it fires nothing relevant:
-- its INSERTs are all cycle_index >= 1 (early-returned by (2)) and its
-- ON CONFLICT DO UPDATE touches a column the trigger in (1) does not watch.
--
-- THE FIX
-- -------
-- A transaction-local suppression flag (`bp.cycle_bulk_replace`) silences the
-- per-row cycle triggers for the duration of the bulk replace, and
-- bp_replace_permit_cycles then performs EXACTLY ONE recompute at the end,
-- once every cycle row is in place. Without the flag the bulk path would
-- recompute once per inserted cycle — the trap called out in the brief.
--
-- Separately, an INSERT arm is added for the non-bulk path: a directly
-- inserted cycle row (index >= 1) carrying a `resubmitted` date now re-derives
-- immediately, matching what the UPDATE arm has always done.
--
-- ANCHORS ARE NOT TOUCHED. This migration changes only WHEN the engine runs,
-- never what it computes.
--
-- VERIFIED ON PROD, 2026-07-28 (rolled-back probe, fix-153 pattern)
-- -----------------------------------------------------------------
-- Fixture: 1400 8th Ave W — BP #183 with a real cycle-1 resubmitted of
-- 2026-05-08, and ULS #184 not yet submitted and not manual.
--
--   ULS target before                         2026-07-22   (= resub + 75)
--   ULS policy offset temporarily set to 100
--   PERFORM bp_replace_permit_cycles(183, <its own cycles>)
--   ULS target after                          2026-08-16
--   expected (resub + 100)                    2026-08-16   -- match
--
-- The whole probe ran inside a transaction aborted by RAISE EXCEPTION, which
-- is also how the values were read back; the ULS offset, the ULS target and
-- BP #183's cycles were all confirmed unchanged afterwards. Before this
-- migration the bulk path's only recompute fired at the cycle-0 INSERT, with
-- cycle 1 not yet present, so the ULS could not have tracked the offset.
--
-- Depends on: fix_249_target_submit_policy_beats_learner.sql (applied first).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Suppression helper
-- ---------------------------------------------------------------------------
-- Transaction-local (set_config third arg = true), so it can never leak into
-- another session or outlive the statement that set it.
CREATE OR REPLACE FUNCTION public.bp_cycle_bulk_replace_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(NULLIF(current_setting('bp.cycle_bulk_replace', true), ''), '0') = '1';
$function$;

COMMENT ON FUNCTION public.bp_cycle_bulk_replace_active() IS
  'fix-249b: true while bp_replace_permit_cycles is rewriting a permit''s '
  'cycles. The per-row permit_cycles recompute triggers early-return on it so '
  'the bulk path recomputes the project exactly once, at the end, instead of '
  'once per inserted cycle row.';

-- ---------------------------------------------------------------------------
-- 2. Teach the existing cycle triggers to stand down during a bulk replace
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_cycle_submit_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  -- fix-249b: the bulk path recomputes once at the end; suppress per-row work.
  IF bp_cycle_bulk_replace_active() THEN RETURN NEW; END IF;

  IF NEW.cycle_index <> 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.submitted IS NOT DISTINCT FROM OLD.submitted THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO v_project_id
    FROM permits WHERE id = NEW.permit_id;
  IF v_project_id IS NOT NULL THEN
    PERFORM public.bp_recompute_target_submits(v_project_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bp_trg_permit_cycles_target_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  -- fix-249b: see above.
  IF bp_cycle_bulk_replace_active() THEN RETURN NULL; END IF;

  SELECT project_id INTO v_project_id FROM permits WHERE id = NEW.permit_id;
  IF v_project_id IS NOT NULL THEN
    PERFORM public.bp_recompute_target_submits(v_project_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. INSERT arm — the gap itself (non-bulk path)
-- ---------------------------------------------------------------------------
-- Deliberately narrow: cycle_index >= 1 with a non-null `resubmitted`. Cycle-0
-- inserts are already covered by bp_trg_cycle_submit_recompute_ins, so
-- including them here would double-fire outside the bulk path.
DROP TRIGGER IF EXISTS bp_trg_permit_cycles_target_submit_ins ON public.permit_cycles;
CREATE TRIGGER bp_trg_permit_cycles_target_submit_ins
AFTER INSERT ON public.permit_cycles
FOR EACH ROW
WHEN (NEW.cycle_index >= 1 AND NEW.resubmitted IS NOT NULL)
EXECUTE FUNCTION public.bp_trg_permit_cycles_target_submit();

-- ---------------------------------------------------------------------------
-- 4. Bulk path: suppress per-row, recompute exactly once at the end
-- ---------------------------------------------------------------------------
-- Body is otherwise byte-for-byte the live definition (probed 2026-07-28).
CREATE OR REPLACE FUNCTION public.bp_replace_permit_cycles(
  p_permit_id integer,
  p_cycles jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cy           jsonb;
  i            integer;
  n            integer;
  v_project_id uuid;
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

  -- fix-249b: stand the per-row cycle triggers down for the rewrite. Without
  -- this the cycle-0 INSERT would recompute the project against a permit whose
  -- cycle 1 has not been inserted yet — the engine would see no BP cycle-1
  -- resubmit, fall back to the projected anchor, and never re-derive.
  perform set_config('bp.cycle_bulk_replace', '1', true);

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

  perform public.bp_apply_cycle_autoadvance(p_permit_id);

  -- Re-arm the triggers BEFORE recomputing so the recompute itself behaves
  -- exactly as it does on every other path.
  perform set_config('bp.cycle_bulk_replace', '0', true);

  -- fix-249b: exactly ONE recompute per bulk call, now that every cycle row
  -- (including cycle 1's `resubmitted`) is in place. bp_recompute_target_submits
  -- is idempotent — it only writes where the candidate differs — and it raises
  -- bp.target_submit_engine_depth for the duration, which is what stops
  -- bp_trg_set_target_submit_manual_flag from mistaking engine writes for
  -- hand-typed ones.
  select project_id into v_project_id from public.permits where id = p_permit_id;
  if v_project_id is not null then
    perform public.bp_recompute_target_submits(v_project_id);
  end if;

  select count(*) into n from public.permit_cycles where permit_id = p_permit_id;

  return jsonb_build_object('permit_id', p_permit_id, 'cycles', n);
end;
$function$;

COMMIT;
