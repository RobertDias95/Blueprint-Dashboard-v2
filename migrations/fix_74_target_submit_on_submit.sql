-- fix-74 (2026-05-29): target_submit follows cycle 0 .submitted when set
-- (backfill alignment) + cascade fires on permit_cycles edits.
--
-- Symptom (verified on 3522 Ashworth / project ef984aca):
--   Backfilling historical projects, Bobby entered cycle 0 .submitted after
--   creating the project. target_submit stayed stuck on whatever the wizard
--   initially computed (e.g. "August 2026"), even after he edited DD dates
--   to match the actual timeline. He had to hard-key target_submit, which
--   set target_submit_is_manual = TRUE and suppressed every future cascade.
--
-- Root cause #1: bp_recompute_target_submits gated the BP path on
--   v_bp_c0_submitted IS NULL — once cycle 0 was submitted, the engine
--   stopped recomputing. The same `CONTINUE` short-circuited the non-BP loop.
--   The original intent — "submitted means projection is done" — is fine, but
--   the new value should BE the actual submit date, not the stale wizard
--   projection. This migration INVERTS the gate: when c0.submitted is set,
--   target_submit follows that date (historical truth); otherwise the
--   existing dd_end / per-type formulas run.
--
-- Root cause #2: cycle dates live in permit_cycles, but the cascade only
--   fired on the permits AFTER UPDATE trigger. Entering cycle 0 .submitted
--   didn't retrigger recompute — Bobby would have had to touch a permits
--   column to nudge it. Adding an AFTER INSERT/UPDATE trigger on
--   permit_cycles for cycle_index = 0 closes the gap.
--
-- PRESERVES:
--   - bp_set_updated_at depth-guard (cascade still suppresses sibling
--     updated_at bumps) — unchanged.
--   - bp_trg_set_target_submit_manual_flag — unchanged (manual override
--     still wins; target_submit_is_manual = TRUE skips the whole branch).
--   - Per-type formulas + offsets + dispatch table for non-BP permits —
--     unchanged; the c0.submitted check just wraps them.
--   - Existing permits AFTER triggers (bp_trg_permits_target_submit_*) —
--     unchanged.
--   - Frontend — no changes; cascade now realigns on backfill automatically.
--
-- ADDITIVE + SAFE: REPLACE one function, ADD one trigger fn + two triggers.

CREATE OR REPLACE FUNCTION public.bp_recompute_target_submits(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev_depth        integer;
  v_go                date;
  v_juris             text;
  v_bp_id             integer;
  v_bp_dd_end         date;
  v_bp_actual         date;
  v_bp_target         date;
  v_bp_is_manual      boolean;
  v_bp_c0_intake      date;
  v_bp_c0_submitted   date;
  v_bp_c1_resub       date;
  v_proj_intake       date;
  v_proj_c1_resub     date;
  v_proj_issue        date;
  v_permit            RECORD;
  v_candidate         date;
  v_offset            integer;
  v_updated           integer := 0;
BEGIN
  IF p_project_id IS NULL THEN RETURN 0; END IF;

  v_prev_depth := COALESCE(
    NULLIF(current_setting('bp.target_submit_engine_depth', true), '')::int,
    0
  );
  PERFORM set_config('bp.target_submit_engine_depth', (v_prev_depth + 1)::text, true);

  SELECT go_date, juris INTO v_go, v_juris
    FROM projects WHERE id = p_project_id;

  SELECT id, dd_end, actual_issue, target_submit, target_submit_is_manual
    INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_target, v_bp_is_manual
    FROM permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC LIMIT 1;

  IF v_bp_id IS NOT NULL THEN
    SELECT intake_accepted, submitted INTO v_bp_c0_intake, v_bp_c0_submitted
      FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 0;
    SELECT resubmitted INTO v_bp_c1_resub
      FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 1;
  END IF;

  -- fix-74: BP target_submit follows the actual cycle 0 submit when set;
  -- otherwise projects from dd_end (the prior behavior). Inverts the previous
  -- IS NULL gate, so backfilled projects realign instead of stranding the
  -- engine the moment c0.submitted is entered. Manual override still wins.
  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false) THEN
    IF v_bp_c0_submitted IS NOT NULL THEN
      v_candidate := v_bp_c0_submitted;
    ELSIF v_bp_dd_end IS NOT NULL THEN
      v_offset := bp_learn_target_submit_days('Building Permit', v_juris, 'dd_end');
      v_candidate := v_bp_dd_end + COALESCE(v_offset, 21);
    ELSE
      v_candidate := NULL;
    END IF;

    IF v_candidate IS NOT NULL AND v_candidate IS DISTINCT FROM v_bp_target THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_bp_id;
      v_updated := v_updated + 1;
    END IF;
    v_bp_target := v_candidate;
  END IF;

  v_proj_intake := COALESCE(v_bp_c0_intake, v_bp_target);
  IF v_proj_intake IS NOT NULL THEN
    v_proj_c1_resub := COALESCE(
      v_bp_c1_resub,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'c1_resub_offset')
    );
    v_proj_issue := COALESCE(
      v_bp_actual,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'intake_to_approval')
    );
  ELSE
    v_proj_c1_resub := v_bp_c1_resub;
    v_proj_issue    := v_bp_actual;
  END IF;

  -- Non-BP dependents: same fix-74 inversion — c0.submitted takes precedence
  -- over the per-type formula when set. Otherwise the existing dispatch table
  -- runs unchanged.
  FOR v_permit IN
    SELECT p.id, p.type, p.target_submit, p.target_submit_is_manual,
           c0.submitted AS c0_submitted
    FROM permits p
    LEFT JOIN permit_cycles c0
      ON c0.permit_id = p.id AND c0.cycle_index = 0
    WHERE p.project_id = p_project_id AND p.type <> 'Building Permit'
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;

    -- fix-74: when this permit has been submitted, target_submit IS the
    -- actual submit date (historical truth). Otherwise dispatch to the
    -- per-type formula below (unchanged).
    IF v_permit.c0_submitted IS NOT NULL THEN
      v_candidate := v_permit.c0_submitted;
    ELSE
      v_candidate := CASE v_permit.type
        WHEN 'Grading / Clearing' THEN v_bp_target
        WHEN 'LSM'                THEN v_bp_target
        WHEN 'Demolition' THEN
          CASE WHEN v_proj_intake IS NOT NULL THEN
            v_proj_intake +
            COALESCE(bp_learn_target_submit_days('Demolition', v_juris, 'bp_c0_intake'), 37)
          ELSE NULL END
        WHEN 'ECA Waiver' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('ECA Waiver', v_juris, 'go_date'), 10)
          ELSE NULL END
        WHEN 'IPR' THEN
          CASE WHEN v_proj_c1_resub IS NOT NULL THEN
            v_proj_c1_resub +
            COALESCE(bp_learn_target_submit_days('IPR', v_juris, 'bp_c1_resub'), 7)
          ELSE NULL END
        WHEN 'ULS' THEN
          CASE WHEN v_proj_c1_resub IS NOT NULL THEN
            v_proj_c1_resub +
            COALESCE(bp_learn_target_submit_days('ULS', v_juris, 'bp_c1_resub'), 7)
          ELSE NULL END
        WHEN 'LBA' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('LBA', v_juris, 'go_date'), 37)
          ELSE NULL END
        WHEN 'Short Plat' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('Short Plat', v_juris, 'go_date'), 37)
          ELSE NULL END
        WHEN 'SIP' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('SIP', v_juris, 'go_date'), 37)
          ELSE NULL END
        WHEN 'PAR/Pre-Sub' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('PAR/Pre-Sub', v_juris, 'go_date'), 10)
          ELSE NULL END
        WHEN 'SDOT Tree' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('SDOT Tree', v_juris, 'go_date'), 10)
          ELSE NULL END
        WHEN 'TRAO' THEN
          CASE WHEN v_go IS NOT NULL THEN
            v_go + COALESCE(bp_learn_target_submit_days('TRAO', v_juris, 'go_date'), 10)
          ELSE NULL END
        WHEN 'Condo' THEN
          CASE WHEN v_proj_issue IS NOT NULL THEN
            v_proj_issue +
            COALESCE(bp_learn_target_submit_days('Condo', v_juris, 'bp_actual_issue'), 129)
          ELSE NULL END
        ELSE NULL
      END;
    END IF;

    IF v_candidate IS NOT NULL
       AND v_candidate IS DISTINCT FROM v_permit.target_submit THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_permit.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  PERFORM set_config('bp.target_submit_engine_depth', v_prev_depth::text, true);
  RETURN v_updated;
END;
$function$;

-- fix-74: cycle data lives in permit_cycles, but the cascade only fires on
-- permits UPDATE. Add a trigger on permit_cycles so that entering or changing
-- cycle 0 .submitted re-runs the engine immediately (covers the backfill flow
-- where Bobby enters c0 .submitted without touching any permits column).
CREATE OR REPLACE FUNCTION public.bp_trg_cycle_submit_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id uuid;
BEGIN
  -- Only cycle 0 affects the BP/non-BP target_submit logic.
  IF NEW.cycle_index <> 0 THEN RETURN NEW; END IF;
  -- Skip when nothing material changed.
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

DROP TRIGGER IF EXISTS bp_trg_cycle_submit_recompute_ins ON public.permit_cycles;
DROP TRIGGER IF EXISTS bp_trg_cycle_submit_recompute_upd ON public.permit_cycles;
CREATE TRIGGER bp_trg_cycle_submit_recompute_ins
  AFTER INSERT ON public.permit_cycles
  FOR EACH ROW EXECUTE FUNCTION bp_trg_cycle_submit_recompute();
CREATE TRIGGER bp_trg_cycle_submit_recompute_upd
  AFTER UPDATE ON public.permit_cycles
  FOR EACH ROW EXECUTE FUNCTION bp_trg_cycle_submit_recompute();
