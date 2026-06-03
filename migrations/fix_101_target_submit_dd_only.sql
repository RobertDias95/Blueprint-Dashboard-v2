-- fix-101: target_submit follows the DD phase, not c0.submitted, and
-- a DD-phase edit always re-claims the field from a stale manual flag.
--
-- Two coupled changes shipped in one migration. Apply via MCP after
-- merge. This migration is NOT auto-applied by the PR.
--
-- ──────────────────────────────────────────────────────────────────────
-- Bobby's mental model (confirmed): the Building Permit's target_submit
-- IS the DD phase's end + ~3 weeks. It reflects THE PLAN. c0.submitted
-- is a separate concept — the historical record of when the permit
-- actually got filed. fix-74 conflated these by setting target_submit
-- to c0.submitted once the BP was filed; this migration reverses that
-- policy for the BP branch only.
--
-- Evidence row: 6516 37th Ave SW BP (id 10146)
--   dd_end          = 2025-10-17
--   c0.submitted    = 2025-11-03
--   target_submit   = 2025-11-09 (manual override pre-fix-101)
--   expected        = 2025-11-07 (dd_end + 21 days)
-- After this migration, an automatic recompute (target_submit_is_manual
-- = false) on a row in this shape will land 2025-11-07 instead of
-- 2025-11-03.
--
-- Non-BP per-type formulas (Grading / LSM / Demolition / ECA Waiver /
-- IPR / ULS / LBA / Short Plat / SIP / PAR-Pre-Sub / SDOT Tree / TRAO /
-- Condo) are UNCHANGED. They still anchor on the BP's projected target
-- + per-type learned offsets the same way they did pre-fix-101. Only
-- the BP branch swaps its candidate computation.
--
-- Reverses: fix_74_target_submit_on_submit.sql for the BP branch only.
-- ──────────────────────────────────────────────────────────────────────

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

  -- c0.submitted is no longer consulted for the BP target_submit
  -- (fix-101 Commit 1). It is still read here because v_proj_intake
  -- below COALESCEs on c0.intake_accepted (not submitted) — the
  -- downstream non-BP formulas haven't changed.
  IF v_bp_id IS NOT NULL THEN
    SELECT intake_accepted, submitted INTO v_bp_c0_intake, v_bp_c0_submitted
      FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 0;
    SELECT resubmitted INTO v_bp_c1_resub
      FROM permit_cycles WHERE permit_id = v_bp_id AND cycle_index = 1;
  END IF;

  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false) THEN
    -- fix-101 Commit 1: BP target_submit follows dd_end (+ learner /
    -- 21-day default) — the c0.submitted gate from fix-74 is removed.
    -- The historical record of when the permit was filed lives on
    -- c0.submitted and never displaces the plan.
    IF v_bp_dd_end IS NOT NULL THEN
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

  FOR v_permit IN
    SELECT p.id, p.type, p.target_submit, p.target_submit_is_manual,
           c0.submitted AS c0_submitted
    FROM permits p
    LEFT JOIN permit_cycles c0
      ON c0.permit_id = p.id AND c0.cycle_index = 0
    WHERE p.project_id = p_project_id AND p.type <> 'Building Permit'
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;

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


-- ──────────────────────────────────────────────────────────────────────
-- COMMIT 2 — DD-phase edits clear the manual flag
--
-- Rule (per Bobby): "if i manually adjust it okay, but if the last
-- action was moving the DD phase, then it should auto update based on
-- our rule." Last action wins, with DD winning a combined edit (the DD
-- phase IS the structural source of truth; manually retyping a
-- target_submit in the same statement that moves dd_end is treated as
-- accidental).
--
-- Implementation: widen the existing BEFORE trigger
-- bp_trg_set_target_submit_manual_flag from UPDATE OF target_submit to
-- UPDATE OF target_submit, dd_end, dd_start. The function branches on
-- which columns moved; a dd_end / dd_start change clears the manual
-- flag unconditionally, and the AFTER UPDATE recompute trigger
-- (bp_trg_permits_target_submit_upd, unchanged) then runs the engine
-- on the now-cleared row. A target_submit-only change keeps the
-- pre-fix-101 semantics (depth>0 → false, depth==0 → true).
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bp_trg_set_target_submit_manual_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng_depth   integer;
  v_dd_changed  boolean := false;
  v_ts_changed  boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- fix-101 Commit 2: a DD-phase edit ALWAYS clears the manual flag
    -- (Bobby's "last action wins" rule, with DD winning a combined
    -- edit). We branch on which columns moved; the AFTER UPDATE
    -- recompute trigger then runs the engine on the now-cleared row.
    v_dd_changed := (NEW.dd_end   IS DISTINCT FROM OLD.dd_end)
                 OR (NEW.dd_start IS DISTINCT FROM OLD.dd_start);
    v_ts_changed := NEW.target_submit IS DISTINCT FROM OLD.target_submit;
  ELSE
    -- INSERT: only the target_submit value matters; treat as a value change.
    v_ts_changed := true;
  END IF;

  -- DD wins (including a combined dd_end + target_submit edit in the
  -- same UPDATE — Bobby treats those as a single structural action
  -- where the DD phase is the source of truth).
  IF v_dd_changed THEN
    NEW.target_submit_is_manual := false;
    RETURN NEW;
  END IF;

  -- Pre-fix-101 short-circuit: a no-op UPDATE on target_submit leaves
  -- the flag alone so an unrelated UPDATE doesn't reset Bobby's manual
  -- choice.
  IF NOT v_ts_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.target_submit IS NULL THEN
    NEW.target_submit_is_manual := false;
    RETURN NEW;
  END IF;

  v_eng_depth := COALESCE(
    NULLIF(current_setting('bp.target_submit_engine_depth', true), '')::int,
    0
  );

  IF v_eng_depth > 0 OR pg_trigger_depth() > 1 THEN
    NEW.target_submit_is_manual := false;
  ELSE
    NEW.target_submit_is_manual := true;
  END IF;

  RETURN NEW;
END;
$function$;

-- Widen the trigger to fire on dd_end / dd_start in addition to
-- target_submit. The function above branches on which column changed.
DROP TRIGGER IF EXISTS bp_trg_set_target_submit_manual_flag ON public.permits;
CREATE TRIGGER bp_trg_set_target_submit_manual_flag
  BEFORE INSERT OR UPDATE OF target_submit, dd_end, dd_start
  ON public.permits
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_trg_set_target_submit_manual_flag();


-- ── Optional one-time backfill (DO NOT RUN unless Bobby confirms) ─────
--
-- After Commit 1, every BP with target_submit_is_manual=false will
-- recompute on its next UPDATE to dd_end (or any field that triggers
-- the recompute path) — its target_submit will shift from
-- c0.submitted → dd_end + 21. The block below would force the shift
-- right now for every project so the UI shows the correct values
-- without waiting for the next edit. Per the fix-74 memory, ~91 rows
-- were aligned to c0.submitted via that migration; this backfill
-- would reverse those.
--
-- Bobby will decide whether to run this manually via MCP after merge.
-- The trigger-driven path is sufficient for new edits.
--
-- fix-101 backfill: uncomment + run after Bobby confirms scope.
-- This will SHIFT target_submit for every existing BP where
--   target_submit_is_manual = false
-- so the engine computes the new value (dd_end + learner / 21) and
-- writes it back. Manual rows are preserved by the engine's existing
-- gate.
--
-- SELECT SUM(bp_recompute_target_submits(p.id)) AS rows_updated
-- FROM (SELECT DISTINCT project_id AS id FROM permits WHERE type = 'Building Permit') p;
