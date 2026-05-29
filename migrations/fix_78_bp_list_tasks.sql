-- fix-78 (2026-05-29): bp_list_tasks — return every permit_task in the caller's
-- tenant with the same shape bp_my_tasks (fix-70) used. The frontend narrows
-- via filter chips client-side.
--
-- Why: fix-70 walled My Tasks down to "primary OR co-assigned" per Bobby's
-- spec at the time. That broke the manager workflow he relied on in v1 —
-- filtering across ALL tasks to find every Open Corrections task, every task
-- on project X, every task assigned to Miles, etc. fix-78 reverts to v1's
-- "show all with filters" model. The Assignee=Me filter chip preset preserves
-- the personal-scope shortcut without making it a wall.
--
-- bp_my_tasks intentionally STAYS callable (some niche consumer may exist).
-- Frontend just stops calling it. Same return shape so the consuming hook can
-- swap with minimal churn.
--
-- ADDITIVE + SAFE: one new function. No table changes.

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
        'parent_task_id',  t.parent_task_id,
        'discipline',      COALESCE(t.discipline, 'ent'),
        'text',            t.text,
        'status',          t.completion_status,
        'start_date',      t.start_date,
        'target_date',     t.target_date,
        'done_at',         t.done_at,
        'sort_order',      t.sort_order,
        -- Derived primary assignee: arch → permits.da, ent → permits.ent_lead.
        -- Frontend filters can match against this OR against co_assignees.
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

GRANT EXECUTE ON FUNCTION public.bp_list_tasks() TO authenticated;
