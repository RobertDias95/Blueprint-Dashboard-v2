-- fix-224: unify task assignment on co_assignees (the permit_task_assignees join
-- table) + let My Tasks resolve co-assignee role tokens.
--
-- Two parts (both additive/safe — the client works against current prod, this
-- just backfills existing assignments + surfaces the permit DA):
--   1. Backfill permit_task_assignees from permit_tasks.assigned_to so no
--      existing assignment is lost when My Tasks stops reading assigned_to.
--      assigned_to mostly holds the TEAM KEYS 'Entitlements' / 'Architecture'
--      (a pointer to the permit's ent_lead / da), plus a few literal names —
--      resolve the team keys to the actual person, exactly like the app derives
--      primary_assignee, so a real person lands in the join table (not the
--      literal word "Entitlements").
--   2. bp_get / bp_list_tasks emits permit_da so My Tasks can resolve fix-222
--      co-assignee role tokens (design_associate / design_manager via
--      dm_da_groups) for DISPLAY, the same way the permit bar already does.
--
-- The assigned_to column is LEFT IN PLACE, unused by the task views (mirror the
-- fix-222 cat retirement). bp_list_tasks base is the LIVE pg_get_functiondef.

-- ---------------------------------------------------------------------------
-- 1. Backfill the join table from assigned_to (team keys resolved to people).
-- ---------------------------------------------------------------------------
INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee)
SELECT t.tenant_id, t.id, r.assignee
FROM public.permit_tasks t
JOIN public.permits p ON p.id = t.permit_id
CROSS JOIN LATERAL (
  SELECT btrim(CASE t.assigned_to
    WHEN 'Entitlements' THEN p.ent_lead   -- team key → the permit's ENT lead
    WHEN 'Architecture' THEN p.da         -- team key → the permit's DA
    ELSE t.assigned_to                    -- already a literal person name
  END) AS assignee
) r
WHERE t.assigned_to IS NOT NULL
  AND btrim(t.assigned_to) <> ''
  AND COALESCE(r.assignee, '') <> ''
  -- only tasks with NO co-assignees yet (don't disturb ones already set)
  AND NOT EXISTS (
    SELECT 1 FROM public.permit_task_assignees a WHERE a.task_id = t.id
  )
ON CONFLICT (task_id, assignee) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. bp_list_tasks — add permit_da for client-side role-token resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_list_tasks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_result  jsonb;
BEGIN
  SELECT COALESCE(
           jsonb_agg(obj ORDER BY project_address, permit_id, sort_order, created_at),
           '[]'::jsonb
         )
    INTO v_result
  FROM (
    SELECT
      pr.address AS project_address,
      t.permit_id,
      t.sort_order,
      t.created_at,
      jsonb_build_object(
        'id',              t.id,
        'permit_id',       t.permit_id,
        'project_id',      p.project_id,
        'project_address', pr.address,
        'permit_type',     p.type,
        'permit_da',       p.da,
        'parent_task_id',  t.parent_task_id,
        'discipline',      COALESCE(t.discipline, 'ent'),
        'bucket',          t.bucket,
        'text',            t.text,
        'status',          t.completion_status,
        'start_date',      t.start_date,
        'target_date',     t.target_date,
        'due_date',        t.due_date,
        'done_at',         t.done_at,
        'sort_order',      t.sort_order,
        'assigned_to',     t.assigned_to,
        'waiting_on',      t.waiting_on,
        'priority',        COALESCE(t.priority, false),
        'notes',           t.notes,
        'is_auto_generated', COALESCE(t.is_auto_generated, false),
        'auto_event',      t.auto_event,
        'primary_assignee',
          CASE WHEN COALESCE(t.discipline, 'ent') = 'arch'
               THEN p.da ELSE p.ent_lead END,
        'co_assignees', public.bp_task_co_assignees(t.id)
      ) AS obj
    FROM public.permit_tasks t
    JOIN public.permits  p  ON p.id = t.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE t.tenant_id = ANY (v_tenants)
  ) rows;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
