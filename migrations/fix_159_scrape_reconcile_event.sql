-- fix-159 (2026-06-12): "scrape reconcile" lifecycle event (guard-skip
-- escalation, part 1 of 2 — v2 side).
--
-- The scraper's 24h manual-edit guard protects human edits, but a permit edited
-- daily can carry stale portal data indefinitely with no UI signal (real case:
-- permit 10222 / 003169-26PA, a Pre-Submittal — GO → In Process change blocked
-- across 3 runs). Design: after N consecutive guard-skips with a pending change,
-- the scraper (part 2, separate repo) fires a `scrape_reconcile` verification
-- task. This migration teaches the lifecycle engine that event.
--
-- Dedupe design (Step 0.2): the original five events keep "one task per
-- (event,cycle) EVER" via permit_tasks_auto_event_uniq. A reconcile is
-- different — a permit can drift again months after the first reconcile is
-- resolved, so it must be RE-FIREABLE. We therefore:
--   1. NARROW the existing index to exclude scrape_reconcile, and
--   2. add a sibling partial unique index keyed on (tenant_id, permit_id) over
--      only the OPEN (completion_status <> 'Resolved') scrape_reconcile rows.
-- Net: at most ONE OPEN scrape_reconcile per permit; once it's Resolved it drops
-- out of the sibling index and a fresh one can be created.
--
-- bp_create_lifecycle_task body is the LIVE prod definition (post fix-156/157;
-- migrations/ is a partial record) with the new event added. Applied to prod
-- via MCP; repo backstop.

-- ============================================================================
-- 1. Re-shape the dedupe indexes.
-- ============================================================================
DROP INDEX IF EXISTS public.permit_tasks_auto_event_uniq;
CREATE UNIQUE INDEX permit_tasks_auto_event_uniq
  ON public.permit_tasks (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
  WHERE is_auto_generated = true AND auto_event <> 'scrape_reconcile';

-- One OPEN reconcile per permit, re-creatable after the prior is Resolved.
CREATE UNIQUE INDEX IF NOT EXISTS permit_tasks_scrape_reconcile_open_uniq
  ON public.permit_tasks (tenant_id, permit_id)
  WHERE is_auto_generated = true
    AND auto_event = 'scrape_reconcile'
    AND completion_status <> 'Resolved';

-- ============================================================================
-- 2. Teach bp_create_lifecycle_task the scrape_reconcile event.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(
  p_tenant_id uuid, p_permit_id integer, p_event text,
  p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
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
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry','scrape_reconcile')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  -- fix-157: service-path gate. The no-auth-context path is the scraper on the
  -- service key ONLY; every other caller must own the target tenant.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
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

  -- Bucket = lifecycle phase (drives the D&E/Permitting tab the task shows on).
  IF p_event = 'number_entry' THEN
    v_bucket := 'de';                       -- pre-submission
  ELSIF p_event = 'scrape_reconcile' THEN
    -- fix-159: match the permit's phase the way the tab default does — 'pm' once
    -- cycle-0 intake is accepted, else 'de'. Cheap single-row lookup; no c0 row
    -- (or not accepted) → 'de'.
    SELECT CASE WHEN c.intake_accepted IS NOT NULL THEN 'pm' ELSE 'de' END
      INTO v_bucket
    FROM public.permit_cycles c
    WHERE c.permit_id = p_permit_id AND c.cycle_index = 0;
    v_bucket := COALESCE(v_bucket, 'de');
  ELSE
    v_bucket := 'pm';                        -- post-submission
  END IF;

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
    WHEN 'scrape_reconcile' THEN
      -- The dashboard is lying to the team → priority. observed_status/db_status
      -- come from p_context (the same values the scraper writes to
      -- extras.pending_scrape_change). Cap each at 60 chars to keep the title sane.
      v_title := 'Reconcile: portal shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'observed_status'), 60), ''), '?')
                 || ' — dashboard shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'db_status'), 60), ''), '?')
                 || ' — ' || v_num_label;
      v_priority := true;
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  IF p_event = 'scrape_reconcile' THEN
    -- fix-159: dedupe on the OPEN-reconcile sibling index → at most one open
    -- reconcile per permit; re-fireable once the prior one is Resolved.
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0
    )
    ON CONFLICT (tenant_id, permit_id)
      WHERE is_auto_generated = true
        AND auto_event = 'scrape_reconcile'
        AND completion_status <> 'Resolved'
    DO NOTHING
    RETURNING id INTO v_new_id;
  ELSE
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
      WHERE is_auto_generated = true AND auto_event <> 'scrape_reconcile'
    DO NOTHING
    RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END;
$function$;
