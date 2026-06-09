-- fix-140 (2026): enumerate every task whose waiting_on is set, joined to its
-- permit, project, and (via project_external_teams + consultant_firms) the
-- assigned firm for that discipline. Powers the My Tasks "Waiting On" reporting
-- view (discipline -> firm grouping).
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_140_list_waiting_on_tasks". This file is the repo record.
--
-- Tasks whose project has no firm assigned for the relevant discipline still
-- appear (firm_id + firm_name = NULL) so Bobby sees "this is waiting on Civil
-- but we haven't assigned a Civil firm yet."
--
-- The LEFT JOIN to consultant_firms (NOT inner) means archived firms
-- (active = false) still surface via the firm_active flag — the UI labels them
-- "(archived)" so Bobby can spot stale assignments.
CREATE OR REPLACE FUNCTION public.bp_list_waiting_on_tasks(
  p_include_completed boolean DEFAULT false
)
 RETURNS TABLE (
   task_id           uuid,
   task_text         text,
   bucket            text,
   waiting_on        text,
   firm_id           uuid,
   firm_name         text,
   firm_active       boolean,
   project_id        uuid,
   project_address   text,
   project_juris     text,
   permit_id         integer,
   permit_type       text,
   assigned_to       text,
   priority          boolean,
   start_date        date,
   due_date          date,
   target_date       date,
   completion_status text,
   done              boolean,
   done_at           timestamptz,
   notes             text,
   created_at        timestamptz,
   updated_at        timestamptz
 )
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
      cf.id AS firm_id, cf.name AS firm_name, cf.active AS firm_active,
      p.id  AS project_id, p.address AS project_address, p.juris AS project_juris,
      pm.id AS permit_id, pm.type AS permit_type,
      pt.assigned_to, pt.priority, pt.start_date, pt.due_date, pt.target_date,
      pt.completion_status, pt.done, pt.done_at, pt.notes,
      pt.created_at, pt.updated_at
    FROM public.permit_tasks pt
    JOIN public.permits  pm ON pm.id = pt.permit_id
    JOIN public.projects p  ON p.id  = pm.project_id
    LEFT JOIN public.project_external_teams pet
           ON pet.project_id = p.id AND pet.discipline = pt.waiting_on
    LEFT JOIN public.consultant_firms cf
           ON cf.id = pet.firm_id
    WHERE pt.tenant_id = ANY (v_tenants)
      AND pt.waiting_on IS NOT NULL
      AND (p_include_completed OR pt.completion_status IS DISTINCT FROM 'Resolved')
    ORDER BY pt.waiting_on ASC, cf.name ASC NULLS LAST, pt.due_date ASC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bp_list_waiting_on_tasks(boolean) TO authenticated;
