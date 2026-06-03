-- fix-106: multi-BP recompute gap.
--
-- Apply via MCP after merge. This migration is NOT auto-applied by the PR.
--
-- ──────────────────────────────────────────────────────────────────────
-- THE GAP
--
-- Pre-fix-106 bp_recompute_target_submits (fix-101's version, live in
-- prod) picks ONE BP per project:
--
--   SELECT id, dd_end, actual_issue, target_submit, target_submit_is_manual
--     INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_target, v_bp_is_manual
--     FROM permits
--     WHERE project_id = p_project_id AND type = 'Building Permit'
--     ORDER BY id ASC LIMIT 1;
--
-- …then runs the +21 / learner-offset math on JUST that one BP. The
-- downstream non-BP loop filters with type <> 'Building Permit', so
-- every 2nd+ BP on a multi-building project is invisible to the engine
-- — its dd_end can move and target_submit never follows.
--
-- 5 projects in prod have multi-BPs (12 non-first BPs total). 621 Daley
-- St / permit 204 already drifted and got patched by hand; the other 11
-- are time bombs waiting for the next dd_end edit.
--
-- ──────────────────────────────────────────────────────────────────────
-- THE FIX
--
-- Add a per-BP FOR LOOP that iterates every Building Permit on the
-- project and recomputes its own target_submit from its own dd_end
-- (+ the shared learner-offset / 21-day fallback). The existing manual
-- respect, depth guard, and learner lookup are unchanged.
--
-- The FIRST BP's "locals" (v_bp_id / v_bp_target / v_bp_dd_end /
-- v_bp_actual / v_bp_c0_intake / v_bp_c0_submitted / v_bp_c1_resub)
-- still load via `ORDER BY id ASC LIMIT 1` — exactly as today — so the
-- non-BP downstream loop's anchor (Grading / LSM / Demolition / IPR /
-- ULS / etc.) does NOT change. Per-non-BP anchor is fix-107's scope;
-- Bobby flagged this PR as "preserves current behavior" for non-BPs.
--
-- The new per-BP loop sits AFTER the existing first-BP recompute block
-- and BEFORE the v_proj_intake / v_proj_c1_resub / v_proj_issue
-- derivation. The first BP is recomputed twice (once by the existing
-- block, once by the new loop) — the second pass is a no-op (the
-- IS DISTINCT guard skips an unchanged target_submit), so it doesn't
-- inflate v_updated. The loop's real work is on the 2nd+ BPs.
--
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

  -- FIRST BP locals (anchor for the non-BP downstream loop). fix-106
  -- keeps the same ORDER BY id ASC LIMIT 1 logic — the non-BP formulas
  -- haven't changed.
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

  -- First BP recompute (unchanged from fix-101). Updates v_bp_target so
  -- the non-BP loop's anchor reflects the freshest computed value.
  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false) THEN
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

  -- fix-106: per-BP recompute. Iterate EVERY Building Permit on the
  -- project and recompute its own target_submit independently from its
  -- own dd_end. The first BP is also visited here — that pass is a
  -- no-op because the IS DISTINCT guard skips an unchanged
  -- target_submit (the first-BP block above already wrote it). The
  -- real work lands on the 2nd+ BPs that were invisible to the engine
  -- pre-fix-106. Manual rows are preserved by the same gate the
  -- first-BP block uses.
  FOR v_permit IN
    SELECT id, dd_end, target_submit, target_submit_is_manual
    FROM permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC
  LOOP
    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;
    IF v_permit.dd_end IS NOT NULL THEN
      v_offset := bp_learn_target_submit_days('Building Permit', v_juris, 'dd_end');
      v_candidate := v_permit.dd_end + COALESCE(v_offset, 21);
    ELSE
      v_candidate := NULL;
    END IF;
    IF v_candidate IS NOT NULL
       AND v_candidate IS DISTINCT FROM v_permit.target_submit THEN
      UPDATE permits SET target_submit = v_candidate WHERE id = v_permit.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

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

  -- Non-BP loop — UNCHANGED. Each non-BP type's formula reads
  -- v_bp_target / v_proj_intake / v_proj_c1_resub / v_proj_issue, all
  -- of which still anchor on the FIRST BP exactly as before. Per-non-BP
  -- anchor is fix-107's scope.
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


-- ── Optional one-time backfill (DO NOT RUN unless Bobby confirms) ─────
--
-- After fix-106, every 2nd+ BP with target_submit_is_manual=false will
-- recompute on its next UPDATE to dd_end (or any other field that
-- triggers the recompute path). The block below would force the
-- recompute right now for every project, so the 11 known time-bomb
-- 2nd+ BPs (and the previously-patched 621 Daley) all settle before
-- the next edit lands. Same shape as fix-101's commented backfill.
--
-- fix-106 backfill: uncomment + run after Bobby confirms scope. The
-- engine's manual gate is honored — manual rows are preserved.
--
-- SELECT SUM(bp_recompute_target_submits(p.id)) AS rows_updated
-- FROM (SELECT DISTINCT project_id AS id FROM permits WHERE type = 'Building Permit') p;
