-- ===========================================================================
-- fix-405 — THE TRIGGER THE NEW RULE NEEDS, AND THE MINT GATE THAT LET IT IN
-- ===========================================================================
--
-- Two halves, both about the SAME two tasks, from opposite ends.
--
-- ---------------------------------------------------------------------------
-- ★★★ HALF ONE — WITHOUT THIS TRIGGER, `superseded_project_cancelled` IS DEAD
-- CODE. THIS IS THE fix-395 GAP CLASS, CAUGHT BEFORE IT SHIPPED.
-- ---------------------------------------------------------------------------
--
-- fix-395 found a supersede rule whose driving column NO TRIGGER WATCHED: the
-- rule was correct, the SQL was live, and it never once ran, because nothing
-- called the closer when the column it reads changed. A rule is only as real as
-- the trigger that invokes it.
--
-- `superseded_project_cancelled` reads `project_holds`. Before this migration
-- NOTHING on `project_holds` touched tasks at all — the closer is invoked from
-- `permits` (status/num/approval_date) and `permit_cycles` (the five date
-- columns) and from nowhere else. Cancelling a project would have left every
-- open bot task on its permits sitting there until some UNRELATED permit edit
-- happened to fire one of the other triggers.
--
-- ★★ ONLY A CANCEL. `kind = 'hold'` is a PAUSE, and a paused permit's work is
-- still applicable — it is coming back. fix-390/391 already make a hold quiet
-- at both scopes; closing its tasks would be a different and wrong claim.
-- `hold_end IS NOT NULL` means the cancel was LIFTED, which is likewise not a
-- reason to close anything.
--
-- ★ It loops the project's permits and calls the closer once per permit rather
-- than closing rows itself. Every close in this system goes through one
-- function so the human guard, the reason vocabulary and the ledger cannot
-- diverge — a second writer is how those three drift apart.
--
-- ★ AFTER, RETURNS NULL: this is a statement-effect trigger, not a row filter.
--
-- ---------------------------------------------------------------------------
-- ★★★ HALF TWO — THE 2 CANCELLED-PROJECT TASKS WERE MINTED **AFTER** THE CANCEL
-- ---------------------------------------------------------------------------
--
-- Measured on prod 2026-08-26: both `number_entry` tasks on the cancelled
-- project were created THREE DAYS AFTER the cancellation row. The sweep had no
-- opinion about project or permit holds, so it kept minting onto dead work —
-- and half one would then have closed them again on the next cancel event. A
-- rule that closes what a sweep keeps re-creating is churn, not a fix.
--
-- ★★ THIS IS THE fix-395 CONTRACT, NOT A RATE REDUCTION. fix-395 moved the
-- lifecycle gates into the minter for exactly this reason: "the auto-clear must
-- never be able to close a task the minter would immediately re-create." The
-- brief says do not reduce minting in this ticket, and this does not — it stops
-- the sweep producing rows the closer is now obliged to delete.
--
-- ★ BOTH SCOPES. A cancelled or held PROJECT and a held PERMIT (fix-390) both
-- mean "not now"; the sweep asks about neither today.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- HALF ONE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_trg_supersede_on_project_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  -- Only a CANCEL matters here. A plain hold pauses work; it does not make the
  -- work inapplicable, and fix-390/391 already silence the board for it.
  IF COALESCE(NEW.kind, 'hold') <> 'cancelled' OR NEW.hold_end IS NOT NULL THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT id FROM public.permits WHERE project_id = NEW.project_id LOOP
    PERFORM public.bp_supersede_stale_bot_tasks(r.id);
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS project_holds_supersede_tasks ON public.project_holds;
CREATE TRIGGER project_holds_supersede_tasks
  AFTER INSERT OR UPDATE OF kind, hold_end ON public.project_holds
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_supersede_on_project_hold();

-- ---------------------------------------------------------------------------
-- HALF TWO — re-emitted whole from the LIVE body; only the marked gate is new.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_generate_number_entry_tasks(p_tenant_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[];
  v_today   date := current_date;
  v_count   integer := 0;
  v_tenant  uuid;
  v_permit  record;
  v_made    uuid;
BEGIN
  IF p_tenant_id IS NOT NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
    THEN
      RAISE EXCEPTION 'bp_generate_number_entry_tasks: tenant % not in caller scope', p_tenant_id
        USING ERRCODE = '42501';
    END IF;
    v_tenants := ARRAY[p_tenant_id];
  ELSE
    v_tenants := public.auth_tenant_ids();
  END IF;
  IF v_tenants IS NULL OR array_length(v_tenants, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    IF EXISTS (
      SELECT 1 FROM public.app_sweeps
      WHERE tenant_id = v_tenant AND sweep_name = 'number_entry' AND last_swept_on >= v_today
    ) THEN
      CONTINUE;
    END IF;

    FOR v_permit IN
      SELECT p.id FROM public.permits p
      WHERE p.tenant_id = v_tenant
        AND (p.num IS NULL OR btrim(p.num) = '')
        AND p.target_submit IS NOT NULL
        AND p.target_submit <= v_today
        AND COALESCE(btrim(p.status), '') NOT IN (
          'Conceptually Approved','Approved','Issued','Completed','Closed',
          'Ready for Issuance','Ready To Issue','Finaled','Withdrawn')
        -- ★★★ fix-405: not onto a cancelled project or a paused permit.
        AND NOT EXISTS (SELECT 1 FROM public.project_holds h
                         WHERE h.project_id = p.project_id AND h.hold_end IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.permit_holds h
                         WHERE h.permit_id = p.id AND h.hold_end IS NULL)
    LOOP
      v_made := public.bp_create_lifecycle_task(v_tenant, v_permit.id, 'number_entry', NULL, '{}'::jsonb);
      IF v_made IS NOT NULL THEN v_count := v_count + 1; END IF;
    END LOOP;

    INSERT INTO public.app_sweeps (tenant_id, sweep_name, last_swept_on, updated_at)
    VALUES (v_tenant, 'number_entry', v_today, now())
    ON CONFLICT (tenant_id, sweep_name)
    DO UPDATE SET last_swept_on = EXCLUDED.last_swept_on, updated_at = now();
  END LOOP;

  RETURN v_count;
END;
$function$;
