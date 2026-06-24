-- fix-197b: repo-of-record only — record the bp_list_waiting_on_tasks hotfix
-- that was already applied to prod via MCP.
--
-- fix-197 dropped the normalized project_external_teams + consultant_firms
-- tables (external team consolidated onto the projects.external_team blob), but
-- bp_list_waiting_on_tasks still LEFT JOINed them to populate firm_id /
-- firm_name / firm_active. After the drop, calling it raised
-- "relation public.project_external_teams does not exist" on /my-tasks Waiting On.
--
-- The hotfix (this body, already live in prod) removes those joins and returns
-- firm_id / firm_name / firm_active as NULL. The RETURN signature is UNCHANGED,
-- so nothing downstream breaks: useWaitingOnTasks resolves each task's firm from
-- the projects.external_team blob (resolveExternalFirm) and ignores the RPC's
-- firm columns. No behavior change — this commit only syncs the repo with prod.

CREATE OR REPLACE FUNCTION public.bp_list_waiting_on_tasks(p_include_completed boolean DEFAULT false)
 RETURNS TABLE(task_id uuid, task_text text, bucket text, waiting_on text, firm_id uuid, firm_name text, firm_active boolean, project_id uuid, project_address text, project_juris text, permit_id integer, permit_type text, assigned_to text, priority boolean, start_date date, due_date date, target_date date, completion_status text, done boolean, done_at timestamp with time zone, notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
BEGIN
  RETURN QUERY
    SELECT
      pt.id, pt.text, pt.bucket, pt.waiting_on,
      NULL::uuid AS firm_id, NULL::text AS firm_name, NULL::boolean AS firm_active,
      p.id  AS project_id, p.address AS project_address, p.juris AS project_juris,
      pm.id AS permit_id, pm.type AS permit_type,
      pt.assigned_to, pt.priority, pt.start_date, pt.due_date, pt.target_date,
      pt.completion_status, pt.done, pt.done_at, pt.notes,
      pt.created_at, pt.updated_at
    FROM public.permit_tasks pt
    JOIN public.permits  pm ON pm.id = pt.permit_id
    JOIN public.projects p  ON p.id  = pm.project_id
    WHERE pt.tenant_id = ANY (v_tenants)
      AND pt.waiting_on IS NOT NULL
      AND (p_include_completed OR pt.completion_status IS DISTINCT FROM 'Resolved')
    ORDER BY pt.waiting_on ASC, pt.due_date ASC NULLS LAST;
END;
$function$;
