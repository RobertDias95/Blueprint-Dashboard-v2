-- fix-181: "send out results" BOT task when a permit becomes issued (or, for
-- no-issuance types, approved). One AFTER UPDATE trigger on public.permits is the
-- shared chokepoint for BOTH the scraper and manual dashboard edits — no scraper
-- repo change needed. It calls the existing bp_create_lifecycle_task with a NEW
-- event 'results_ready' (BOT badge + filter are generic on is_auto_generated, so
-- no UI change beyond adding the event to the TS AutoEvent union).
--
-- Results-available rule, per permit type:
--   * issuance types     -> fire when actual_issue transitions NULL -> non-null.
--   * no-issuance types  -> fire when approval_date transitions NULL -> non-null
--     (they never get an actual_issue document).
-- Forward-only: AFTER UPDATE only (NOT INSERT) — the ~100 already-issued permits
-- are NOT backfilled. One task per permit (the existing partial-unique-index
-- dedupe), assigned to the permit's ent lead (discipline='ent', derived at read
-- time — same path as the other lifecycle events).
--
-- migrations/ is partial; prod is canon. bp_create_lifecycle_task below is
-- re-emitted from the LIVE pg_get_functiondef with only the additive
-- 'results_ready' event layered in.

-- ---------------------------------------------------------------------------
-- 1. Extend bp_create_lifecycle_task with the 'results_ready' event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(p_tenant_id uuid, p_permit_id integer, p_event text, p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry','scrape_reconcile','results_ready')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

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

  IF p_event = 'number_entry' THEN
    v_bucket := 'de';
  ELSIF p_event = 'scrape_reconcile' THEN
    SELECT CASE WHEN c.intake_accepted IS NOT NULL THEN 'pm' ELSE 'de' END
      INTO v_bucket
    FROM public.permit_cycles c
    WHERE c.permit_id = p_permit_id AND c.cycle_index = 0;
    v_bucket := COALESCE(v_bucket, 'de');
  ELSE
    v_bucket := 'pm';
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
      v_title := 'Reconcile: portal shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'observed_status'), 60), ''), '?')
                 || ' — dashboard shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'db_status'), 60), ''), '?')
                 || ' — ' || v_num_label;
      v_priority := true;
    WHEN 'results_ready' THEN
      -- fix-181: type-aware title. The trigger passes the basis explicitly so
      -- the branch never has to re-derive the issuance/no-issuance distinction.
      IF COALESCE(p_context->>'basis', 'issued') = 'approved' THEN
        v_title := 'Permit approved — send out results — ' || v_num_label;
      ELSE
        v_title := 'Permit issued — send out approved plans / results — ' || v_num_label;
      END IF;
      v_priority := true;
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  IF p_event = 'scrape_reconcile' THEN
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

-- ---------------------------------------------------------------------------
-- 2. Trigger: results-available -> 'results_ready' BOT task. AFTER UPDATE only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_permit_results_ready_autotask()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- fix-181 / fix-41 parity: keep this set IDENTICAL to NO_ISSUANCE_PERMIT_TYPES
  -- in src/lib/permitTypeTaxonomy.ts (and the scraper repo). If a type is added
  -- or removed there, mirror the change here.
  v_no_issuance boolean :=
    NEW.type IN ('SDOT Tree', 'PAR/Pre-Sub', 'ECA Waiver', 'ULS');
  v_fire  boolean := false;
  v_basis text;
BEGIN
  IF v_no_issuance THEN
    -- No-issuance types never get an actual_issue document; "results available"
    -- is the approval.
    IF OLD.approval_date IS NULL AND NEW.approval_date IS NOT NULL THEN
      v_fire := true; v_basis := 'approved';
    END IF;
  ELSE
    IF OLD.actual_issue IS NULL AND NEW.actual_issue IS NOT NULL THEN
      v_fire := true; v_basis := 'issued';
    END IF;
  END IF;

  IF v_fire THEN
    -- Failure-tolerant: a task-insert hiccup must NEVER block the permit write.
    -- bp_create_lifecycle_task writes only to permit_tasks (never back to
    -- permits), so this AFTER-UPDATE-on-permits trigger cannot recurse. The
    -- partial unique index dedupes to one 'results_ready' task per permit.
    BEGIN
      PERFORM public.bp_create_lifecycle_task(
        NEW.tenant_id, NEW.id, 'results_ready', NULL,
        jsonb_build_object('basis', v_basis)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bp_permit_results_ready_autotask: task create failed for permit % (basis %): %',
        NEW.id, v_basis, SQLERRM;
    END;
  END IF;

  RETURN NULL; -- AFTER trigger — return value ignored.
END;
$function$;

-- fix-157 security model: a trigger function is invoked by the engine, never
-- called by a client, so revoke the default PUBLIC EXECUTE (avoids the
-- anon/authenticated SECURITY DEFINER advisory; the trigger still fires).
REVOKE EXECUTE ON FUNCTION public.bp_permit_results_ready_autotask() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bp_permit_results_ready ON public.permits;
CREATE TRIGGER bp_permit_results_ready
  AFTER UPDATE OF actual_issue, approval_date ON public.permits
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_permit_results_ready_autotask();
