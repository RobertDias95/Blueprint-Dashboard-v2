-- fix-167 (2026-06-16): project On-Hold — Phase 1 (data model + RPCs + seed).
--
-- Lets a project be put On Hold — a dated interval with a reason — so anyone
-- can see WHY permits aren't issuing (waiting on closing, selling, financing…).
--
-- PHASE 1 ONLY: data + display. Holds are recorded and fully visible but change
-- NO calculations. Phase 2 (separate, later) wires the clock/projection math
-- (exclude hold windows from turnaround clocks, overdue flags, target_submit,
-- estimator, DA report). This migration deliberately touches none of that.
--
-- Scope (Bobby): a hold applies to the WHOLE project (all permits) — no
-- per-permit scope. A project may have MANY holds over time (history); the
-- ACTIVE hold is the one with hold_end IS NULL, and there is at most one active
-- hold per project (enforced by a partial unique index).
--
-- Conventions mirrored:
--   * Table: consultant_firms (fix-139) — uuid PK, tenant_id FK ON DELETE
--     CASCADE, RLS FOR ALL USING (tenant_id = ANY auth_tenant_ids()),
--     updated_at set explicitly in the RPCs (no trigger, matching that table).
--   * RPC tenant gate: fix-163 — app-callable, KEEP authenticated grant; a
--     cross-tenant p_tenant_id raises 42501. service_role (scraper) bypasses.
--   * Audit: paired rows in audit_log (the scraper's existing review log) under
--     project_hold_* actions, so hold open/lift/edit are attributable.
--   * Hold Reasons list: app_config key 'holdReasonOptions' (string[]), the same
--     editable-list mechanism as productTypeOptions / projectTagOptions. Seeded
--     for every existing tenant; add/edit/remove in Settings → Projects.
--
-- Applied to prod via MCP. This file is the repo-of-record backstop.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_holds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reason      text        NOT NULL,
  note        text,
  hold_start  date        NOT NULL DEFAULT current_date,
  hold_end    date,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_holds_dates_chk CHECK (hold_end IS NULL OR hold_end >= hold_start)
);

-- At most one ACTIVE hold (hold_end IS NULL) per project.
CREATE UNIQUE INDEX IF NOT EXISTS project_holds_one_active_per_project
  ON public.project_holds (project_id) WHERE hold_end IS NULL;

CREATE INDEX IF NOT EXISTS project_holds_tenant_project_idx
  ON public.project_holds (tenant_id, project_id);

ALTER TABLE public.project_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_holds_tenant_policy ON public.project_holds;
CREATE POLICY project_holds_tenant_policy ON public.project_holds
  FOR ALL USING (tenant_id = ANY (public.auth_tenant_ids()));

-- Grants: app reads the table directly (RLS-gated); writes go through the
-- SECURITY DEFINER RPCs below. anon stays revoked (fix-157 security model).
REVOKE ALL ON public.project_holds FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_holds TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. RPCs (SECURITY DEFINER, fix-163 tenant gate, audited)
-- ─────────────────────────────────────────────────────────────────────────────

-- Open an active hold. Rejects if one is already active (also backstopped by
-- the partial unique index). hold_start defaults to today but is backdatable.
CREATE OR REPLACE FUNCTION public.bp_set_project_hold(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_reason     text,
  p_note       text DEFAULT NULL,
  p_hold_start date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start date := COALESCE(p_hold_start, current_date);
  v_row   public.project_holds;
BEGIN
  -- fix-163: app-callable tenant gate (service_role bypasses).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_set_project_hold: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NULLIF(trim(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'bp_set_project_hold: reason is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'bp_set_project_hold: project % not found in tenant %', p_project_id, p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_holds
    WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND hold_end IS NULL
  ) THEN
    RAISE EXCEPTION 'bp_set_project_hold: project % already has an active hold', p_project_id
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.project_holds (tenant_id, project_id, reason, note, hold_start, created_by)
  VALUES (p_tenant_id, p_project_id, trim(p_reason), NULLIF(trim(COALESCE(p_note, '')), ''), v_start, auth.uid())
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_hold_set', 'project_holds', v_row.id::text,
    jsonb_build_object('project_id', p_project_id, 'reason', v_row.reason, 'hold_start', v_row.hold_start)
  );

  RETURN NEXT v_row;
END;
$function$;

-- Lift the active hold: set hold_end (defaults today, backdatable). Raises if
-- there is no active hold.
CREATE OR REPLACE FUNCTION public.bp_lift_project_hold(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_hold_end   date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_end date := COALESCE(p_hold_end, current_date);
  v_row public.project_holds;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_lift_project_hold: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_holds
  SET hold_end = v_end, updated_at = now()
  WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND hold_end IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_lift_project_hold: project % has no active hold', p_project_id;
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_hold_lifted', 'project_holds', v_row.id::text,
    jsonb_build_object('project_id', p_project_id, 'hold_end', v_row.hold_end)
  );

  RETURN NEXT v_row;
END;
$function$;

-- Edit a hold's reason / note / start / end (so dates can be corrected —
-- Phase 2's math depends on accurate intervals). Identified by hold id.
CREATE OR REPLACE FUNCTION public.bp_update_project_hold(
  p_tenant_id  uuid,
  p_hold_id    uuid,
  p_reason     text DEFAULT NULL,
  p_note       text DEFAULT NULL,
  p_hold_start date DEFAULT NULL,
  p_hold_end   date DEFAULT NULL
)
 RETURNS SETOF public.project_holds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.project_holds;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_update_project_hold: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_holds
  SET reason     = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), reason),
      note       = NULLIF(trim(COALESCE(p_note, '')), ''),
      hold_start = COALESCE(p_hold_start, hold_start),
      hold_end   = p_hold_end,
      updated_at = now()
  WHERE id = p_hold_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_update_project_hold: hold % not found in tenant %', p_hold_id, p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF v_row.hold_end IS NOT NULL AND v_row.hold_end < v_row.hold_start THEN
    RAISE EXCEPTION 'bp_update_project_hold: hold_end (%) cannot precede hold_start (%)',
      v_row.hold_end, v_row.hold_start USING ERRCODE = '22008';
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'project_hold_updated', 'project_holds', v_row.id::text,
    jsonb_build_object('reason', v_row.reason, 'hold_start', v_row.hold_start, 'hold_end', v_row.hold_end)
  );

  RETURN NEXT v_row;
END;
$function$;

-- Grants: app-callable (fix-163 — keep authenticated). anon/PUBLIC revoked.
REVOKE EXECUTE ON FUNCTION public.bp_set_project_hold(uuid, uuid, text, text, date)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bp_lift_project_hold(uuid, uuid, date)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bp_update_project_hold(uuid, uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bp_set_project_hold(uuid, uuid, text, text, date)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.bp_lift_project_hold(uuid, uuid, date)               TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.bp_update_project_hold(uuid, uuid, text, text, date, date) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Seed Hold Reasons (settings-editable list — app_config key).
-- app_config.key is the PRIMARY KEY (global, single-tenant deployment), so this
-- is one row; Settings edits it via bp_set_app_config_key (ON CONFLICT key).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.app_config (tenant_id, key, value)
SELECT (SELECT id FROM public.tenants ORDER BY id LIMIT 1), 'holdReasonOptions',
  '["Waiting on closing / fee timing","Selling / assigning to external client","Design or scope change pending","Financing / capital decision","MHA"]'::jsonb
ON CONFLICT (key) DO NOTHING;
