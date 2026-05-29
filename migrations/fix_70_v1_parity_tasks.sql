-- fix-70 (2026-05-29): v1-parity task system.
--
-- Brings back the v1 task model on top of the existing permit_tasks table:
--   1. A discipline bucket (arch | ent). The PRIMARY assignee is DERIVED at
--      read time, never stored:
--        discipline='arch' -> permits.da
--        discipline='ent'  -> permits.ent_lead
--      So when a project's DA changes (draw-schedule sync updates permits.da),
--      every Architecture task reattributes on the next read — no sync trigger.
--   2. Explicit co-assignees in a new join table (permit_task_assignees) — any
--      tenant member. Co-assignees DON'T move when the implicit primary does.
--   3. Single-level subtasks via parent_task_id (self-FK, ON DELETE CASCADE).
--   4. Status workflow reusing the EXISTING completion_status column
--      ('Open' | 'In Progress' | 'Resolved'); a trigger auto-stamps done_at on
--      resolve and clears it on revert.
--
-- DESIGN NOTES (reconciled against the live schema, not the brief's idealized
-- column names):
--   * permit_tasks already has `bucket` ('de'|'pm'|'co') + `stage` driving the
--     phase tabs, and `assigned_to` driving the old Entitlements/Architecture
--     column split. We do NOT touch those — the discipline is a NEW column so
--     the existing phase logic keeps working. New rows set bucket/stage='de' as
--     inert defaults (NOT NULL on the schema).
--   * Status reuses `completion_status` (already 'Open'/'In Progress'/
--     'Resolved') rather than adding a duplicate `status` column.
--   * start_date / target_date already exist — not re-added.
--
-- Tenant pattern matches the rest of the repo: auth_tenant_ids() resolves the
-- caller's tenant uuids; RLS uses `tenant_id = ANY(auth_tenant_ids())`; the
-- default_tenant_id_to_caller BEFORE INSERT trigger stamps tenant_id on direct
-- inserts. RPCs are SECURITY DEFINER (bypass RLS) so they filter tenant
-- EXPLICITLY.
--
-- ADDITIVE + SAFE: new columns (with defaults / nullable), a new table, new
-- functions. Existing rows stay valid; existing assigned_to values are
-- preserved (consultant names copied into the new join table, role labels
-- captured by the derived discipline).

-- ---------------------------------------------------------------------------
-- 1. permit_tasks column extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS done_at        timestamptz,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.permit_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS discipline     text;

-- discipline is constrained to arch|ent. Use a NOT VALID-friendly add: the
-- column is nullable (the RPC always sets it; reads COALESCE to 'ent'), so a
-- plain CHECK that also permits NULL is safe for existing rows.
DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permit_tasks_discipline_chk'
  ) THEN
    ALTER TABLE public.permit_tasks
      ADD CONSTRAINT permit_tasks_discipline_chk
      CHECK (discipline IS NULL OR discipline IN ('arch','ent'));
  END IF;
END
$ck$;

-- Backfill discipline for existing rows from the old assigned_to role label:
-- 'Architecture' -> arch, everything else -> ent. (The role label is captured
-- here, so we don't also copy it as a co-assignee below.)
UPDATE public.permit_tasks
  SET discipline = CASE WHEN assigned_to = 'Architecture' THEN 'arch' ELSE 'ent' END
  WHERE discipline IS NULL;

CREATE INDEX IF NOT EXISTS permit_tasks_parent_idx
  ON public.permit_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS permit_tasks_tenant_status_idx
  ON public.permit_tasks(tenant_id, completion_status);

-- Auto-stamp done_at when completion_status transitions to 'Resolved', and
-- clear it on revert. BEFORE INSERT OR UPDATE OF completion_status: on INSERT
-- OLD is NULL (handled), on UPDATE only fires when completion_status changes.
CREATE OR REPLACE FUNCTION public.bp_trg_task_done_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.completion_status = 'Resolved'
     AND (OLD IS NULL OR OLD.completion_status <> 'Resolved') THEN
    NEW.done_at := now();
  ELSIF NEW.completion_status <> 'Resolved' THEN
    NEW.done_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS permit_tasks_done_at ON public.permit_tasks;
CREATE TRIGGER permit_tasks_done_at
  BEFORE INSERT OR UPDATE OF completion_status ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_task_done_at();

-- Backfill done_at for rows already resolved (so historical resolves have a
-- stamp; uses updated_at as the best available proxy for when it happened).
UPDATE public.permit_tasks
  SET done_at = updated_at
  WHERE completion_status = 'Resolved' AND done_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. permit_task_assignees — explicit co-assignees (implicit primary stays
--    derived). One row per (task, assignee).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permit_task_assignees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  task_id     uuid NOT NULL REFERENCES public.permit_tasks(id) ON DELETE CASCADE,
  assignee    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, assignee)
);
CREATE INDEX IF NOT EXISTS permit_task_assignees_assignee_idx
  ON public.permit_task_assignees(tenant_id, assignee);
CREATE INDEX IF NOT EXISTS permit_task_assignees_task_idx
  ON public.permit_task_assignees(task_id);

DROP TRIGGER IF EXISTS permit_task_assignees_default_tenant ON public.permit_task_assignees;
CREATE TRIGGER permit_task_assignees_default_tenant
  BEFORE INSERT ON public.permit_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.permit_task_assignees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permit_task_assignees_tenant_select ON public.permit_task_assignees;
CREATE POLICY permit_task_assignees_tenant_select ON public.permit_task_assignees
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS permit_task_assignees_tenant_insert ON public.permit_task_assignees;
CREATE POLICY permit_task_assignees_tenant_insert ON public.permit_task_assignees
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS permit_task_assignees_tenant_update ON public.permit_task_assignees;
CREATE POLICY permit_task_assignees_tenant_update ON public.permit_task_assignees
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
  WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS permit_task_assignees_tenant_delete ON public.permit_task_assignees;
CREATE POLICY permit_task_assignees_tenant_delete ON public.permit_task_assignees
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 3. Preserve existing assigned_to: copy real person/consultant names into the
--    new join table as co-assignees. Role labels ('Entitlements',
--    'Architecture') are intentionally skipped — they're captured by the
--    derived discipline, so nothing is lost.
-- ---------------------------------------------------------------------------
INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
SELECT t.tenant_id, t.id, TRIM(t.assigned_to)
FROM public.permit_tasks t
WHERE COALESCE(TRIM(t.assigned_to), '') <> ''
  AND t.assigned_to NOT IN ('Entitlements', 'Architecture')
ON CONFLICT (task_id, assignee) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- Create (p_id NULL) or update a permit task. Writes the discipline bucket,
-- status (completion_status), dates, and parent linkage. tenant_id is set
-- explicitly from the caller's primary tenant on insert. Returns the row id.
CREATE OR REPLACE FUNCTION public.bp_upsert_permit_task(
  p_id             uuid,
  p_permit_id      integer,
  p_parent_task_id uuid,
  p_bucket         text,
  p_text           text,
  p_status         text,
  p_start_date     date,
  p_target_date    date,
  p_sort_order     integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_bucket  text   := CASE WHEN p_bucket = 'arch' THEN 'arch' ELSE 'ent' END;
  v_status  text   := CASE
                        WHEN p_status IN ('Open','In Progress','Resolved') THEN p_status
                        ELSE 'Open'
                      END;
  v_id      uuid;
BEGIN
  IF COALESCE(TRIM(p_text), '') = '' THEN
    RAISE EXCEPTION 'task text is required';
  END IF;

  -- A supplied parent must be a top-level task on the same permit + tenant
  -- (single-level subtasks: a subtask can't itself have subtasks).
  IF p_parent_task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.permit_tasks
    WHERE id = p_parent_task_id
      AND tenant_id = ANY (v_tenants)
      AND parent_task_id IS NULL
  ) THEN
    RAISE EXCEPTION 'parent task % is not a valid top-level task in caller tenant', p_parent_task_id;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, parent_task_id, discipline, bucket, stage,
      text, completion_status, start_date, target_date, sort_order
    )
    VALUES (
      v_primary, p_permit_id, p_parent_task_id, v_bucket, 'de', 'de',
      TRIM(p_text), v_status, p_start_date, p_target_date, COALESCE(p_sort_order, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.permit_tasks
      SET parent_task_id    = p_parent_task_id,
          discipline        = v_bucket,
          text              = TRIM(p_text),
          completion_status = v_status,
          start_date        = p_start_date,
          target_date       = p_target_date,
          sort_order        = COALESCE(p_sort_order, sort_order),
          updated_at        = now()
    WHERE id = p_id
      AND tenant_id = ANY (v_tenants)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'task % not found in caller tenant', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

-- Delete a task. Subtasks cascade via the parent_task_id FK; assignees cascade
-- via the task_id FK on permit_task_assignees.
CREATE OR REPLACE FUNCTION public.bp_delete_permit_task(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_rows    integer;
BEGIN
  DELETE FROM public.permit_tasks
  WHERE id = p_id AND tenant_id = ANY (v_tenants);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'task % not found in caller tenant', p_id;
  END IF;
END;
$function$;

-- Atomically replace a task's co-assignees with p_assignees (dedup + trim;
-- blanks dropped). Implicit primary is NOT stored here.
CREATE OR REPLACE FUNCTION public.bp_set_task_assignees(
  p_task_id   uuid,
  p_assignees text[]
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM public.permit_tasks
  WHERE id = p_task_id AND tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'task % not found in caller tenant', p_task_id;
  END IF;

  DELETE FROM public.permit_task_assignees WHERE task_id = p_task_id;

  INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
  SELECT v_tenant, p_task_id, a
  FROM (
    SELECT DISTINCT TRIM(x) AS a
    FROM unnest(COALESCE(p_assignees, ARRAY[]::text[])) AS x
    WHERE COALESCE(TRIM(x), '') <> ''
  ) s
  ON CONFLICT (task_id, assignee) DO NOTHING;
END;
$function$;

-- List top-level tasks for a permit with subtasks nested. Each task carries:
--   primary_assignee : DERIVED (discipline='arch' -> permit.da; else ent_lead)
--   co_assignees     : text[] from permit_task_assignees
CREATE OR REPLACE FUNCTION public.bp_list_permit_tasks(p_permit_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_da      text;
  v_ent     text;
  v_result  jsonb;
BEGIN
  SELECT da, ent_lead INTO v_da, v_ent
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = ANY (v_tenants);

  SELECT COALESCE(jsonb_agg(task_obj ORDER BY sort_order, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'permit_id', t.permit_id,
        'parent_task_id', t.parent_task_id,
        'discipline', COALESCE(t.discipline, 'ent'),
        'text', t.text,
        'status', t.completion_status,
        'start_date', t.start_date,
        'target_date', t.target_date,
        'done_at', t.done_at,
        'sort_order', t.sort_order,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch' THEN v_da ELSE v_ent END,
        'co_assignees', public.bp_task_co_assignees(t.id),
        'subtasks', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'permit_id', s.permit_id,
              'parent_task_id', s.parent_task_id,
              'discipline', COALESCE(s.discipline, COALESCE(t.discipline,'ent')),
              'text', s.text,
              'status', s.completion_status,
              'start_date', s.start_date,
              'target_date', s.target_date,
              'done_at', s.done_at,
              'sort_order', s.sort_order,
              'primary_assignee',
                CASE WHEN COALESCE(s.discipline, COALESCE(t.discipline,'ent')) = 'arch'
                     THEN v_da ELSE v_ent END,
              'co_assignees', public.bp_task_co_assignees(s.id)
            )
            ORDER BY s.sort_order, s.created_at
          )
          FROM public.permit_tasks s
          WHERE s.parent_task_id = t.id AND s.tenant_id = ANY (v_tenants)
        ), '[]'::jsonb)
      ) AS task_obj
    FROM public.permit_tasks t
    WHERE t.permit_id = p_permit_id
      AND t.tenant_id = ANY (v_tenants)
      AND t.parent_task_id IS NULL
  ) ranked;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- Helper: co-assignee names for a task as a sorted text[] (jsonb array).
CREATE OR REPLACE FUNCTION public.bp_task_co_assignees(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    jsonb_agg(a.assignee ORDER BY a.assignee),
    '[]'::jsonb
  )
  FROM public.permit_task_assignees a
  WHERE a.task_id = p_task_id
    AND a.tenant_id = ANY (public.auth_tenant_ids());
$function$;

-- All tasks (top-level + subtasks) where p_user_name is the implicit primary
-- (bucket-scoped) OR an explicit co-assignee. THE VISIBILITY RULE: being the
-- DA does NOT surface ENT tasks — the primary is bucket-scoped, so an arch
-- task is "yours" only if you're the permit's DA; an ent task only if you're
-- the ent_lead. Cross-bucket visibility requires explicit co-assignment.
CREATE OR REPLACE FUNCTION public.bp_my_tasks(p_user_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_name    text   := TRIM(COALESCE(p_user_name, ''));
  v_result  jsonb;
BEGIN
  IF v_name = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(obj ORDER BY project_address, permit_id, sort_order, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      pr.address AS project_address,
      t.permit_id,
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id', t.id,
        'permit_id', t.permit_id,
        'project_id', p.project_id,
        'project_address', pr.address,
        'permit_type', p.type,
        'parent_task_id', t.parent_task_id,
        'discipline', COALESCE(t.discipline, 'ent'),
        'text', t.text,
        'status', t.completion_status,
        'start_date', t.start_date,
        'target_date', t.target_date,
        'done_at', t.done_at,
        'sort_order', t.sort_order,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch' THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id)
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)
      AND (
        (COALESCE(t.discipline, 'ent') = 'arch' AND p.da = v_name)
        OR (COALESCE(t.discipline, 'ent') = 'ent' AND p.ent_lead = v_name)
        OR EXISTS (
          SELECT 1 FROM public.permit_task_assignees a
          WHERE a.task_id = t.id AND a.assignee = v_name
        )
      )
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.bp_upsert_permit_task(uuid, integer, uuid, text, text, text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_delete_permit_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_set_task_assignees(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_list_permit_tasks(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_task_co_assignees(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_my_tasks(text) TO authenticated;
