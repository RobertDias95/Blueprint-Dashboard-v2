-- fix-304 §18 (register #18): expose permit_tasks.created_at on the task wire.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-14 via MCP apply_migration.
--
-- The merge rule is "same permit + bot-authored task + created within ~15
-- minutes of the status change → one row". bp_list_tasks already SELECTed
-- t.created_at (it orders by it) but never put it in the jsonb object, so the
-- client had the auto_event and the permit but NO TIMESTAMP — the rule was not
-- implementable client-side.
--
-- Purely additive: one new key on an existing object. Every current consumer
-- (My Tasks, My Board) reads by name and ignores unknown keys, so nothing else
-- changes. Rebuilt from the LIVE pg_get_functiondef rather than the committed
-- .sql, per the migrations-are-partial rule.
--
-- Why the timestamp is worth a migration: measured on prod, all 86 bot
-- corr_issued tasks match a cycle flip on the same permit and the p95 gap is
-- 0.22 SECONDS. Without a timestamp the merge would have had to pair on
-- (permit, auto_event) alone, which mis-pairs across a permit's successive
-- correction cycles.

CREATE OR REPLACE FUNCTION public.bp_list_tasks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
        -- fix-304: the only addition.
        'created_at',      t.created_at,
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
