-- fix-156 (2026-06-12): BOT task parity — Permit Detail render + derived
-- (bidirectional) assignment.
--
-- Two fixes to the fix-155 lifecycle auto-tasks, both in service of Bobby's
-- principle: a BOT task must have "the same concept and core as the other
-- tasks." If it shows in My Tasks it MUST show under the permit's tasks in
-- project view, and assignment must follow team moves automatically.
--
-- 1. RENDER (bucket): fix-155 put every auto-task in bucket='pm'. The Permit
--    Detail task panel shows ONE lifecycle-phase tab at a time (D&E / Permitting)
--    and defaults to D&E until the permit's intake is accepted. A numberless
--    permit (the number_entry case) sits on the D&E tab, so its pm-bucket task
--    was hidden behind the Permitting tab — empirically reproduced. Per fix-79's
--    own bucket definition ('pm' = AFTER the permit was submitted to the city),
--    number_entry is PRE-submission and belongs in 'de'. The post-submission
--    events (intake_*/corr_issued/resubmitted) stay 'pm' and already render on
--    the permit's default Permitting tab (verified: permit 240's resubmitted
--    task renders fine). The render path itself was correct — this is a bucket
--    (phase) correction, not a grouping bug.
--
-- 2. ASSIGNMENT (derived, bidirectional): fix-155 wrote a STATIC assigned_to =
--    ent_lead at creation. Every human task instead derives its assignee at READ
--    time (bp_list_tasks / bp_list_permit_tasks: discipline='ent' -> permits.ent_lead),
--    so it follows a team move with no row write. The frozen assigned_to broke
--    that for auto-tasks. We stop writing it; the derived primary_assignee is the
--    single source — identical to every human task, and bidirectional.
--    (Parity note: the read RPCs derive purely from permits.ent_lead, with NO
--    project.entitlement_lead fallback — so we drop fix-155's project-ent
--    fallback too. 1 of 25 number_entry rows used it on an ent_lead-less permit;
--    it becomes unassigned, exactly like a human ENT task on that permit.)
--
-- Migration applied to prod via MCP; this file is the repo backstop.

-- ============================================================================
-- 1. Re-create the creator: correct bucket per phase + stop writing assigned_to.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(
  p_tenant_id uuid,
  p_permit_id integer,
  p_event     text,
  p_cycle_idx integer DEFAULT NULL,
  p_context   jsonb   DEFAULT '{}'::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_tenants uuid[];
  v_permit         public.permits%ROWTYPE;
  v_project_addr   text;
  v_num_label      text;
  v_cycle_label    text;
  v_title          text;
  v_bucket         text;
  v_city_check     boolean := false;
  v_priority       boolean := false;
  v_notes          text;
  v_new_id         uuid;
BEGIN
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  v_caller_tenants := public.auth_tenant_ids();
  IF array_length(v_caller_tenants, 1) IS NOT NULL
     AND NOT (p_tenant_id = ANY (v_caller_tenants))
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_permit
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: permit % not found in tenant %',
      p_permit_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT address INTO v_project_addr
  FROM public.projects WHERE id = v_permit.project_id;

  v_num_label   := COALESCE(NULLIF(btrim(v_permit.num), ''), 'no number yet');
  v_cycle_label := COALESCE(p_cycle_idx::text, '?');

  -- fix-156: bucket = lifecycle PHASE, so the auto-task co-locates with the
  -- same-phase human tasks and lands on the tab the permit defaults to.
  -- number_entry is pre-submission (D&E); the rest are post-submission
  -- (Permitting). Mirrors fix-79's 'pm' = after-submitted definition.
  v_bucket := CASE WHEN p_event = 'number_entry' THEN 'de' ELSE 'pm' END;

  CASE p_event
    WHEN 'intake_submitted' THEN
      v_title := 'Verify: intake submitted / fees paid — ' || v_num_label;
      v_city_check := true;
    WHEN 'intake_accepted' THEN
      v_title := 'Verify: intake accepted — reviews starting — ' || v_num_label;
    WHEN 'corr_issued' THEN
      v_title := 'Corrections issued (cycle ' || v_cycle_label
                 || ') — send to consultants — ' || v_num_label;
      v_priority := true;
    WHEN 'resubmitted' THEN
      v_title := 'Verify: city accepted resubmission (cycle ' || v_cycle_label
                 || ') — ' || v_num_label;
      v_city_check := true;
    WHEN 'number_entry' THEN
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project');
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  -- fix-156: do NOT write assigned_to. Assignment is DERIVED at read time
  -- (discipline='ent' -> permits.ent_lead, identical to every human task), so
  -- the task follows team moves automatically with no per-task write.
  INSERT INTO public.permit_tasks (
    tenant_id, permit_id, text, discipline, bucket, stage,
    completion_status, done, is_auto_generated, auto_event, cycle_idx,
    city_acceptance_check, priority, notes, sort_order
  ) VALUES (
    p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
    'Open', false, true, p_event, p_cycle_idx,
    v_city_check, v_priority, v_notes, 0
  )
  ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
    WHERE is_auto_generated = true
  DO NOTHING
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_create_lifecycle_task(uuid, integer, text, integer, jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- 2. Backfill existing auto-tasks + audit rows.
-- ============================================================================

-- 2a. number_entry: bucket/stage pm -> de so they render on the D&E tab.
WITH upd AS (
  UPDATE public.permit_tasks
     SET bucket = 'de', stage = 'de', updated_at = now()
   WHERE is_auto_generated = true
     AND auto_event = 'number_entry'
     AND bucket <> 'de'
  RETURNING id, tenant_id, permit_id
)
INSERT INTO public.audit_log (table_name, row_id, action, changes, tenant_id)
SELECT 'permit_tasks', id::text, 'fix156_number_entry_bucket_to_de',
       jsonb_build_object('source', 'migration', 'permit_id', permit_id,
                          'bucket', jsonb_build_object('from', 'pm', 'to', 'de')),
       tenant_id
FROM upd;

-- 2b. All auto-tasks: NULL out the frozen assigned_to so assignment is purely
--     derived (follows ent_lead). Capture the old value in the audit row.
WITH upd AS (
  UPDATE public.permit_tasks t
     SET assigned_to = NULL, updated_at = now()
    FROM (
      SELECT id, assigned_to AS old_assigned
      FROM public.permit_tasks
      WHERE is_auto_generated = true AND assigned_to IS NOT NULL
    ) o
   WHERE t.id = o.id
  RETURNING t.id, t.tenant_id, t.permit_id, o.old_assigned
)
INSERT INTO public.audit_log (table_name, row_id, action, changes, tenant_id)
SELECT 'permit_tasks', id::text, 'fix156_null_auto_assigned_to',
       jsonb_build_object('source', 'migration', 'permit_id', permit_id,
                          'assigned_to', jsonb_build_object('from', old_assigned, 'to', null),
                          'reason', 'assignment now derived from permits.ent_lead'),
       tenant_id
FROM upd;
