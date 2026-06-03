-- fix-108: complete the team-triple cascade.
--
-- Apply via MCP after merge. This migration is NOT auto-applied by the PR.
--
-- ──────────────────────────────────────────────────────────────────────
-- Bobby's rule (verbatim):
--   "If Briana, Ahmadi and Brit had tasks assigned, and the project
--    moves to Ainsley, the tasks should move to Miles, Ainsley, and
--    Lindsay — that's their team. You can still create tasks for
--    people outside the team (like Cam, or Bobby on a PAR). Those
--    should NOT auto-reassign. But when projects move, the
--    responsibility and reporting moves with them."
--
-- Two functions; four gaps:
--   (A) bp_cascade_ent_lead_for_project ignored permits with da=NULL.
--   (B) bp_move_draw_schedule_da's DA task cascade was too broad
--       (matched any assignee in dm_da_groups; fix narrows to
--       v_old_da).
--   (C) bp_move_draw_schedule_da didn't cascade DM tasks.
--   (D) bp_cascade_ent_lead_for_project didn't cascade ENT tasks.
--
-- Every fix below is NARROW (matches the specific old assignee), so
-- manual overrides (Cam, Bobby-on-PAR) survive untouched.
-- ──────────────────────────────────────────────────────────────────────


-- ── Commit 1: bp_move_draw_schedule_da ───────────────────────────────
-- Adds v_old_dm capture, narrows DA cascades, and adds the DM task
-- cascade. Function signature is unchanged (no new OUT columns).

CREATE OR REPLACE FUNCTION public.bp_move_draw_schedule_da(
  p_project_id            uuid,
  p_new_da                text,
  p_new_dm                text,
  p_start_week            text,
  p_end_week              text,
  p_status                text,
  p_expected_updated_at   timestamp with time zone
)
RETURNS TABLE(
  out_project_id            uuid,
  out_updated_at            timestamp with time zone,
  out_conflict              boolean,
  out_old_da                text,
  out_permits_updated       integer,
  out_tasks_updated         integer,
  out_gap_exists            boolean,
  out_gap_downstream_count  integer,
  out_gap_after_week        text
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_da             text;
  v_old_dm             text;   -- fix-108: capture BP's current DM before reassign.
  v_old_start          text;
  v_old_end            text;
  v_new_dd_start       date;
  v_new_dd_end         date;
  v_new_target         date;
  v_updated_at         timestamptz;
  v_permits_updated    int := 0;
  v_tasks_updated      int := 0;
  v_dm_tasks_updated   int := 0;   -- fix-108: DM cascade counter (audit only).
  v_downstream_count   int := 0;
  v_tenant_id          uuid;
  v_anchor_id          int;
BEGIN
  v_new_dd_start := bp_week_key_to_date(p_start_week);
  v_new_dd_end := bp_week_key_to_date(p_end_week);
  IF v_new_dd_end IS NOT NULL THEN v_new_dd_end := v_new_dd_end + 4; END IF;
  v_new_target := bp_week_key_to_date(p_end_week);
  IF v_new_target IS NOT NULL THEN v_new_target := v_new_target + 14; END IF;

  SELECT da_assigned, start_week, end_week, tenant_id
    INTO v_old_da, v_old_start, v_old_end, v_tenant_id
    FROM draw_schedule
    WHERE project_id = p_project_id AND updated_at = p_expected_updated_at;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_project_id, NULL::timestamptz, true, NULL::text, 0, 0, false, 0, NULL::text;
    RETURN;
  END IF;

  -- fix-108: capture the BP's current DM so we can narrow the DM task
  -- cascade below. Multi-BP convention (fix-106) — first BP by id.
  SELECT dm INTO v_old_dm
    FROM permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC LIMIT 1;

  UPDATE draw_schedule SET
    da_assigned = p_new_da, start_week = p_start_week, end_week = p_end_week,
    status = p_status, dd_start = v_new_dd_start, dd_end = v_new_dd_end
  WHERE project_id = p_project_id
  RETURNING updated_at INTO v_updated_at;

  -- fix-108 (gap B): narrow the permits.da rewrite to the project's
  -- ACTUAL old DA, not "any DA in dm_da_groups." Pre-fix any permit
  -- assigned to any roster DA got swept onto the new DA — which
  -- broke the floating-DA convention (Cam on a sibling permit would
  -- have been reassigned away). The DM column still rides along on
  -- the same selection.
  UPDATE permits SET da = p_new_da, dm = p_new_dm
  WHERE project_id = p_project_id
    AND da IS NOT NULL
    AND da = v_old_da;
  GET DIAGNOSTICS v_permits_updated = ROW_COUNT;

  -- fix-108 (gap B): narrow the DA TASK cascade the same way. Tasks
  -- assigned to Cam or any non-old-DA assignee stay put. Bobby's
  -- floating-DA rule: only the project's old DA reassigns.
  UPDATE permit_tasks SET assigned_to = p_new_da
  WHERE permit_id IN (SELECT id FROM permits WHERE project_id = p_project_id)
    AND assigned_to IS NOT NULL
    AND assigned_to = v_old_da;
  GET DIAGNOSTICS v_tasks_updated = ROW_COUNT;

  -- fix-108 (gap C): cascade DM tasks too. Pre-fix permits.dm got
  -- rewritten (via the join above) but permit_tasks assigned to the
  -- old DM stayed at the old DM. Bobby's rule: when the project
  -- moves, the DM (Brittani / Derry / Jade / Lindsay) reporting
  -- moves with it. Manual overrides (someone outside the four DMs)
  -- survive because the WHERE narrows on assigned_to = v_old_dm
  -- specifically.
  IF p_new_dm IS NOT NULL
     AND v_old_dm IS NOT NULL
     AND v_old_dm IS DISTINCT FROM p_new_dm THEN
    UPDATE permit_tasks SET assigned_to = p_new_dm
    WHERE permit_id IN (SELECT id FROM permits WHERE project_id = p_project_id)
      AND assigned_to = v_old_dm;
    GET DIAGNOSTICS v_dm_tasks_updated = ROW_COUNT;
  END IF;

  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end
  WHERE project_id = p_project_id;

  IF EXISTS (SELECT 1 FROM permits WHERE project_id = p_project_id AND type = 'Building Permit') THEN
    UPDATE permits SET target_submit = v_new_target
    WHERE project_id = p_project_id AND type = 'Building Permit';
  ELSE
    SELECT id INTO v_anchor_id FROM permits
    WHERE project_id = p_project_id ORDER BY id ASC LIMIT 1;
    IF v_anchor_id IS NOT NULL THEN
      UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id;
    END IF;
  END IF;

  IF v_old_da IS NOT NULL AND v_old_da <> COALESCE(p_new_da, '') AND v_old_start IS NOT NULL THEN
    SELECT COUNT(*) INTO v_downstream_count FROM draw_schedule
      WHERE da_assigned = v_old_da AND project_id <> p_project_id
        AND start_week IS NOT NULL AND start_week > v_old_start;
  END IF;

  -- fix-108: audit_log gains old_dm + new_dm + dm_tasks_updated for
  -- traceability. The OUT columns stay the same — DM cascade count is
  -- internal/audit only (the modal's success message reads off the DA
  -- counts; DM is part of the same logical move, so a separate display
  -- count isn't needed).
  INSERT INTO audit_log(action, table_name, row_id, changes, tenant_id, user_id)
  VALUES ('move_da', 'draw_schedule', p_project_id::text,
    jsonb_build_object(
      'old_da', v_old_da, 'new_da', p_new_da,
      'old_dm', v_old_dm, 'new_dm', p_new_dm,
      'old_start_week', v_old_start, 'old_end_week', v_old_end,
      'new_start_week', p_start_week, 'new_end_week', p_end_week,
      'permits_updated', v_permits_updated,
      'tasks_updated', v_tasks_updated,
      'dm_tasks_updated', v_dm_tasks_updated,
      'downstream_count', v_downstream_count),
    v_tenant_id, auth.uid());

  RETURN QUERY SELECT p_project_id, v_updated_at, false, v_old_da,
    v_permits_updated, v_tasks_updated, v_downstream_count > 0,
    v_downstream_count, v_old_start;
END;
$function$;


-- ── Commit 2: bp_cascade_ent_lead_for_project ────────────────────────
-- Captures BP's old/new ent_lead around the existing per-DA UPDATE;
-- adds a parallel UPDATE for null-DA permits (gap A); cascades ENT
-- tasks (gap D). Signature unchanged.

CREATE OR REPLACE FUNCTION public.bp_cascade_ent_lead_for_project(
  p_project_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants            uuid[] := public.auth_tenant_ids();
  v_count_da_permits   integer := 0;   -- existing per-DA UPDATE.
  v_count_null_permits integer := 0;   -- fix-108 (gap A): null-DA siblings.
  v_count_tasks        integer := 0;   -- fix-108 (gap D): ENT task cascade.
  v_old_bp_ent_lead    text;
  v_new_bp_ent_lead    text;
BEGIN
  -- fix-108 (gap D): capture the BP's CURRENT ent_lead BEFORE the
  -- per-DA UPDATE so the task cascade below can find tasks assigned
  -- to the outgoing ENT.
  SELECT ent_lead INTO v_old_bp_ent_lead
    FROM public.permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC LIMIT 1;

  -- Existing per-DA UPDATE (unchanged). Each permit's ent_lead routes
  -- from its OWN DA via bp_ent_lead_for_da. Null-DA permits don't
  -- match here because bp_ent_lead_for_da(NULL, juris) is NULL and
  -- the `IS NOT NULL` gate filters them out.
  UPDATE public.permits p
  SET ent_lead   = public.bp_ent_lead_for_da(p.da, pr.juris),
      updated_at = now()
  FROM public.projects pr
  WHERE p.project_id = p_project_id
    AND pr.id = p.project_id
    AND p.tenant_id = ANY (v_tenants)
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS NOT NULL
    AND public.bp_ent_lead_for_da(p.da, pr.juris) IS DISTINCT FROM p.ent_lead;
  GET DIAGNOSTICS v_count_da_permits = ROW_COUNT;

  -- fix-108 (gap D, continued): capture the BP's NEW ent_lead. The
  -- per-DA UPDATE just ran — this read picks up the post-cascade
  -- value. Used as the cascade target for both null-DA permits and
  -- ENT tasks below.
  SELECT ent_lead INTO v_new_bp_ent_lead
    FROM public.permits
    WHERE project_id = p_project_id AND type = 'Building Permit'
    ORDER BY id ASC LIMIT 1;

  -- fix-108 (gap A): cascade the BP's new ent_lead to null-DA permit
  -- siblings whose ent_lead matched the OLD BP value. Bobby's 2450
  -- repro: IPR / TRAO / ULS / Demolition all carry the BP's ENT
  -- inherited at create time but have no DA of their own, so the
  -- per-DA UPDATE above can't reach them. The narrow match
  -- (p.ent_lead IS NOT DISTINCT FROM v_old_bp_ent_lead) means manual
  -- overrides like "Bobby on PAR" survive.
  IF v_new_bp_ent_lead IS NOT NULL
     AND v_old_bp_ent_lead IS NOT NULL
     AND v_new_bp_ent_lead IS DISTINCT FROM v_old_bp_ent_lead THEN
    UPDATE public.permits p
    SET ent_lead   = v_new_bp_ent_lead,
        updated_at = now()
    FROM public.projects pr
    WHERE p.project_id = p_project_id
      AND pr.id = p.project_id
      AND p.tenant_id = ANY (v_tenants)
      AND p.da IS NULL
      AND p.ent_lead IS NOT DISTINCT FROM v_old_bp_ent_lead
      AND v_new_bp_ent_lead IS DISTINCT FROM p.ent_lead;
    GET DIAGNOSTICS v_count_null_permits = ROW_COUNT;

    -- fix-108 (gap D, continued): cascade ENT tasks. Tasks assigned to
    -- the outgoing BP ENT (Miles in the 2450 case) reassign to the
    -- incoming BP ENT (Briana). Tasks assigned to other people
    -- (Cam, Bobby on PAR, anyone outside the ENT slot) stay put
    -- because the WHERE narrows on assigned_to = v_old_bp_ent_lead.
    UPDATE public.permit_tasks
    SET assigned_to = v_new_bp_ent_lead
    WHERE permit_id IN (
      SELECT id FROM public.permits WHERE project_id = p_project_id
    )
      AND assigned_to IS NOT NULL
      AND assigned_to = v_old_bp_ent_lead;
    GET DIAGNOSTICS v_count_tasks = ROW_COUNT;
  END IF;

  -- Return the sum so callers see the total cascade footprint. The
  -- function signature stays integer-returning per the original
  -- contract; consumers that want a per-bucket breakdown read the
  -- audit_log (out of scope for this PR — bp_cascade_ent_lead_for_project
  -- never wrote audit_log).
  RETURN COALESCE(v_count_da_permits, 0)
       + COALESCE(v_count_null_permits, 0)
       + COALESCE(v_count_tasks, 0);
END;
$function$;
