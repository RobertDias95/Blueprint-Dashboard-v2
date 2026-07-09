-- fix-225: DA project handoff, Phase 1 — lightweight "reassign DA" (ownership only).
--
-- Moves who OWNS a project's work to a new DA WITHOUT spinning up a redesign and
-- WITHOUT moving the draw_schedule board block. The board block stays frozen
-- under the ORIGINAL DA (the shared-work marker signals the split). The "new DA
-- needs a new block / redraw / new permit" case is the existing REDESIGN feature
-- — the client routes users there; this file never touches draw_schedule blocks.
--
-- Admin-only (ownership/board changes are admin-gated per fix-220): two layers —
-- an is_tenant_admin guard inside the SECURITY DEFINER RPCs (they bypass RLS)
-- PLUS admin-only write RLS on project_da_handoffs.
--
-- Metrics co-credit is Phase 2 (fix-226) — out of scope; the handoff row here is
-- what Phase 2 will read.

-- ---------------------------------------------------------------------------
-- 1. project_da_handoffs — the handoff ledger (powers undo + the shared marker
--    + Phase-2 co-credit).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_da_handoffs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_da        text,
  to_da          text NOT NULL,
  effective_date date,
  note           text,
  actor_uid      uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_da_handoffs_project
  ON public.project_da_handoffs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_da_handoffs_tenant
  ON public.project_da_handoffs (tenant_id);

ALTER TABLE public.project_da_handoffs ENABLE ROW LEVEL SECURITY;
-- reads: any tenant member (drives the shared marker + handoff history)
DROP POLICY IF EXISTS project_da_handoffs_tenant_select ON public.project_da_handoffs;
CREATE POLICY project_da_handoffs_tenant_select ON public.project_da_handoffs
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));
-- direct writes: admins only (fix-220 pattern; the RPCs below are the app path)
DROP POLICY IF EXISTS project_da_handoffs_tenant_admin_write ON public.project_da_handoffs;
CREATE POLICY project_da_handoffs_tenant_admin_write ON public.project_da_handoffs
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

REVOKE ALL ON public.project_da_handoffs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_da_handoffs
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Decouple ownership from the board — the DA-sync trigger learns a skip flag.
--    Setting permits.da normally propagates to draw_schedule.da_assigned (the
--    board follows). A pure reassign must NOT move the board, so the trigger
--    honors a transaction-local flag that ONLY bp_reassign_project_da /
--    bp_undo_project_da_reassign set. Default (unset) behavior is unchanged.
--    (Body is the LIVE definition + the guard at the top.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_sync_draw_schedule_da()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- fix-225: an ownership-only reassign suppresses the board follow.
  IF current_setting('app.bp_skip_da_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.da IS NOT NULL AND NEW.da IS DISTINCT FROM OLD.da THEN
    UPDATE public.draw_schedule
       SET da_assigned = NEW.da
     WHERE project_id = NEW.project_id
       AND da_assigned IS DISTINCT FROM NEW.da;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. bp_reassign_project_da — admin-only ownership move (one transaction).
--    Writes the handoff row, re-points the project's permits.da (+ derived lead
--    DA) to the new DA with the board follow suppressed, and moves OPEN task
--    assignees old→new (done/Resolved tasks keep the old DA as history).
--    Does NOT touch draw_schedule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_reassign_project_da(
  p_project_id uuid,
  p_to_da text,
  p_effective_date date DEFAULT NULL,
  p_note text DEFAULT NULL
)
 RETURNS TABLE(
   id uuid, project_id uuid, from_da text, to_da text,
   effective_date date, note text, created_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_to_da   text   := btrim(COALESCE(p_to_da, ''));
  v_from_da text;
  v_handoff public.project_da_handoffs;
BEGIN
  IF v_to_da = '' THEN
    RAISE EXCEPTION 'bp_reassign_project_da: to_da is required' USING ERRCODE = '22023';
  END IF;

  SELECT pr.tenant_id INTO v_tenant
  FROM public.projects pr
  WHERE pr.id = p_project_id AND pr.tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_reassign_project_da: project % not in caller tenant', p_project_id
      USING ERRCODE = '42501';
  END IF;

  -- Admin gate (service_role/scraper exempt) — mirrors fix-220.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'reassigning a project DA is restricted to admins'
      USING ERRCODE = '42501';
  END IF;

  -- from_da = the project's current owner: the board block's DA, else the BP's
  -- DA, else any permit's DA. (The board is the frozen source of truth.)
  SELECT ds.da_assigned INTO v_from_da
  FROM public.draw_schedule ds WHERE ds.project_id = p_project_id;
  IF v_from_da IS NULL THEN
    SELECT p.da INTO v_from_da FROM public.permits p
     WHERE p.project_id = p_project_id AND p.type = 'Building Permit'
       AND p.parent_permit_id IS NULL AND p.da IS NOT NULL
     ORDER BY p.id LIMIT 1;
  END IF;
  IF v_from_da IS NULL THEN
    SELECT p.da INTO v_from_da FROM public.permits p
     WHERE p.project_id = p_project_id AND p.da IS NOT NULL ORDER BY p.id LIMIT 1;
  END IF;

  -- 3a. write the handoff row.
  INSERT INTO public.project_da_handoffs
    (tenant_id, project_id, from_da, to_da, effective_date, note, actor_uid)
  VALUES (
    v_tenant, p_project_id, v_from_da, v_to_da,
    COALESCE(p_effective_date, current_date),
    NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid()
  )
  RETURNING * INTO v_handoff;

  -- 3b. set ownership: every permit's DA → to_da, WITHOUT the board following.
  PERFORM set_config('app.bp_skip_da_sync', 'on', true);
  UPDATE public.permits p SET da = v_to_da
   WHERE p.project_id = p_project_id AND p.da IS DISTINCT FROM v_to_da;
  PERFORM set_config('app.bp_skip_da_sync', 'off', true);

  -- 3c. re-point OPEN task co-assignees from_da → to_da (done tasks untouched).
  IF v_from_da IS NOT NULL AND v_from_da <> v_to_da THEN
    -- add to_da to every OPEN task currently assigned to from_da...
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
    SELECT a.tenant_id, a.task_id, v_to_da
    FROM public.permit_task_assignees a
    JOIN public.permit_tasks t ON t.id = a.task_id
    JOIN public.permits pm ON pm.id = t.permit_id
    WHERE pm.project_id = p_project_id
      AND t.completion_status <> 'Resolved'
      AND a.assignee = v_from_da
    ON CONFLICT (task_id, assignee) DO NOTHING;
    -- ...then remove from_da from those OPEN tasks.
    DELETE FROM public.permit_task_assignees a
    USING public.permit_tasks t, public.permits pm
    WHERE a.task_id = t.id AND t.permit_id = pm.id
      AND pm.project_id = p_project_id
      AND t.completion_status <> 'Resolved'
      AND a.assignee = v_from_da;
  END IF;

  -- NOTE: draw_schedule is deliberately left untouched (frozen board block).

  RETURN QUERY SELECT v_handoff.id, v_handoff.project_id, v_handoff.from_da,
                      v_handoff.to_da, v_handoff.effective_date,
                      v_handoff.note, v_handoff.created_at;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. bp_undo_project_da_reassign — restore the prior owner + open assignees,
--    delete the handoff row. Admin-only. Board was never moved, so it isn't
--    touched here either (the suppress flag keeps the restore from moving it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_undo_project_da_reassign(p_handoff_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_h       public.project_da_handoffs;
BEGIN
  SELECT * INTO v_h FROM public.project_da_handoffs
   WHERE id = p_handoff_id AND tenant_id = ANY (v_tenants);
  IF v_h.id IS NULL THEN
    RAISE EXCEPTION 'bp_undo_project_da_reassign: handoff % not in caller tenant', p_handoff_id
      USING ERRCODE = '42501';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_h.tenant_id) THEN
    RAISE EXCEPTION 'undoing a project DA reassign is restricted to admins'
      USING ERRCODE = '42501';
  END IF;

  -- restore ownership: permits still on to_da go back to from_da (board frozen).
  PERFORM set_config('app.bp_skip_da_sync', 'on', true);
  UPDATE public.permits p SET da = v_h.from_da
   WHERE p.project_id = v_h.project_id AND p.da = v_h.to_da;
  PERFORM set_config('app.bp_skip_da_sync', 'off', true);

  -- restore OPEN task co-assignees to_da → from_da.
  IF v_h.from_da IS NOT NULL AND v_h.from_da <> v_h.to_da THEN
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
    SELECT a.tenant_id, a.task_id, v_h.from_da
    FROM public.permit_task_assignees a
    JOIN public.permit_tasks t ON t.id = a.task_id
    JOIN public.permits pm ON pm.id = t.permit_id
    WHERE pm.project_id = v_h.project_id
      AND t.completion_status <> 'Resolved'
      AND a.assignee = v_h.to_da
    ON CONFLICT (task_id, assignee) DO NOTHING;
    DELETE FROM public.permit_task_assignees a
    USING public.permit_tasks t, public.permits pm
    WHERE a.task_id = t.id AND t.permit_id = pm.id
      AND pm.project_id = v_h.project_id
      AND t.completion_status <> 'Resolved'
      AND a.assignee = v_h.to_da;
  END IF;

  DELETE FROM public.project_da_handoffs WHERE id = p_handoff_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_reassign_project_da(uuid, text, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_undo_project_da_reassign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_reassign_project_da(uuid, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_undo_project_da_reassign(uuid) TO authenticated, service_role;
