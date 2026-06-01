-- fix-85: every BP on a multi-BP project cascades its own target_submit.
--
-- Bug: bp_recompute_target_submits picks ONE Building Permit per project via
-- `ORDER BY id ASC LIMIT 1` and recomputes only that one. On a multi-building
-- project, the 2nd+ BPs are invisible to the engine — their target_submit
-- never realigns when their dd_end or c0.submitted changes.
--
-- Blast radius in prod as of 2026-05-29: 5 multi-BP projects, 12 non-first
-- BPs total (surfaced during fix-74's backfill; 621 Daley St permit 204
-- was the only one currently drifting and got a manual patch). After this
-- migration + the one-time `SELECT bp_recompute_target_submits(id) FROM
-- projects;` backfill, all 12 will pull back into engine-derived state.
--
-- Bobby's design call: keep the FIRST BP (lowest id) as the anchor for the
-- non-BP cascade (Demolition / IPR / ULS / etc.) — current behavior. No
-- semantic change for any of the existing projects' non-BP permits. The fix
-- is to ALSO cascade target_submit for each BP independently, so all BPs
-- get their own correct target_submit. The non-BP path is untouched.
--
-- Preserved: depth guard (bp.target_submit_engine_depth), per-permit manual
-- override short-circuit, fix-74's c0.submitted inversion (BP and non-BP),
-- per-type dispatch table + offsets. Triggers (bp_trg_cycle_submit_recompute,
-- bp_trg_set_target_submit_manual_flag, bp_set_updated_at depth-guard) are
-- unchanged.

CREATE OR REPLACE FUNCTION public.bp_recompute_target_submits(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev_depth         integer;
  v_go                 date;
  v_juris              text;
  v_first_bp_id        integer;
  v_first_bp_target    date;     -- the FIRST BP's post-recompute target_submit
  v_first_bp_c0_intake date;
  v_first_bp_actual    date;
  v_first_bp_c1_resub  date;
  v_proj_intake        date;
  v_proj_c1_resub      date;
  v_proj_issue         date;
  v_bp                 RECORD;   -- per-BP loop
  v_bp_c0_submitted    date;
  v_bp_candidate       date;
  v_bp_offset          integer;
  v_permit             RECORD;   -- non-BP loop
  v_candidate          date;
  v_updated            integer := 0;
BEGIN
  IF p_project_id IS NULL THEN RETURN 0; END IF;

  v_prev_depth := COALESCE(
    NULLIF(current_setting('bp.target_submit_engine_depth', true), '')::int,
    0
  );
  PERFORM set_config('bp.target_submit_engine_depth', (v_prev_depth + 1)::text, true);

  SELECT go_date, juris INTO v_go, v_juris
    FROM projects WHERE id = p_project_id;

  -- fix-85: identify the first BP up-front; we still anchor the non-BP loop
  -- on this one, but the per-BP recompute loop below covers EVERY BP.
  SELECT id INTO v_first_bp_id
    FROM permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC LIMIT 1;

  -- fix-85: per-BP recompute. Each BP gets its own target_submit from its
  -- own c0.submitted / dd_end. Manual override still wins per-BP. We also
  -- snapshot the FIRST BP's resolved values for the non-BP cascade below
  -- (single SELECT for c0/c1, single source of truth for v_first_bp_target).
  FOR v_bp IN
    SELECT id, dd_end, actual_issue, target_submit, target_submit_is_manual
      FROM permits
      WHERE project_id = p_project_id AND type = 'Building Permit'
      ORDER BY id ASC
  LOOP
    SELECT submitted INTO v_bp_c0_submitted
      FROM permit_cycles
      WHERE permit_id = v_bp.id AND cycle_index = 0;

    v_bp_candidate := NULL;
    IF NOT COALESCE(v_bp.target_submit_is_manual, false) THEN
      IF v_bp_c0_submitted IS NOT NULL THEN
        v_bp_candidate := v_bp_c0_submitted;
      ELSIF v_bp.dd_end IS NOT NULL THEN
        v_bp_offset := bp_learn_target_submit_days('Building Permit', v_juris, 'dd_end');
        v_bp_candidate := v_bp.dd_end + COALESCE(v_bp_offset, 21);
      END IF;

      IF v_bp_candidate IS NOT NULL
         AND v_bp_candidate IS DISTINCT FROM v_bp.target_submit THEN
        UPDATE permits SET target_submit = v_bp_candidate WHERE id = v_bp.id;
        v_updated := v_updated + 1;
      END IF;
    END IF;

    IF v_bp.id = v_first_bp_id THEN
      -- Mirror the prior single-BP behavior exactly: the non-BP cascade
      -- reads the FIRST BP's just-computed candidate (or current value when
      -- the recompute branch was skipped — manual override or no inputs).
      v_first_bp_target := COALESCE(v_bp_candidate, v_bp.target_submit);
      v_first_bp_actual := v_bp.actual_issue;
      SELECT intake_accepted INTO v_first_bp_c0_intake
        FROM permit_cycles
        WHERE permit_id = v_bp.id AND cycle_index = 0;
      SELECT resubmitted INTO v_first_bp_c1_resub
        FROM permit_cycles
        WHERE permit_id = v_bp.id AND cycle_index = 1;
    END IF;
  END LOOP;

  -- Non-BP cascade — anchored on the FIRST BP (Bobby's call). Same
  -- proj_intake / proj_c1_resub / proj_issue math as before.
  v_proj_intake := COALESCE(v_first_bp_c0_intake, v_first_bp_target);
  IF v_proj_intake IS NOT NULL THEN
    v_proj_c1_resub := COALESCE(
      v_first_bp_c1_resub,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'c1_resub_offset')
    );
    v_proj_issue := COALESCE(
      v_first_bp_actual,
      v_proj_intake + bp_learn_days('Building Permit', v_juris, 'intake_to_approval')
    );
  ELSE
    v_proj_c1_resub := v_first_bp_c1_resub;
    v_proj_issue    := v_first_bp_actual;
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

    -- fix-74 inversion preserved: when this permit's own c0.submitted is
    -- set, target_submit IS that date (historical truth); otherwise
    -- dispatch on type.
    IF v_permit.c0_submitted IS NOT NULL THEN
      v_candidate := v_permit.c0_submitted;
    ELSE
      v_candidate := CASE v_permit.type
        WHEN 'Grading / Clearing' THEN v_first_bp_target
        WHEN 'LSM'                THEN v_first_bp_target
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
