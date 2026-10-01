-- fix-603 (P-172): a task made from a chat message shows what happened to it.
--
-- ⚠️ STAGED, NOT APPLIED BY THE PR. Claude applies it from Cowork.
--    ADDITIVE: the current client ignores the extra columns, so it is safe to
--    apply as soon as the PR is up, and the client renders exactly as before
--    until it is.
--
-- bp_list_project_messages gains five columns AFTER the existing eighteen,
-- read from the same LEFT JOIN LATERAL onto permit_tasks:
--   task_status      text         permit_tasks.completion_status
--   task_done        boolean      permit_tasks.done
--   task_done_at     timestamptz  permit_tasks.done_at
--   task_assigned_to text         permit_tasks.assigned_to  (a NAME or a ROLE)
--   task_due_date    date         permit_tasks.due_date
--
-- A changed RETURNS TABLE is a changed return type, which CREATE OR REPLACE
-- refuses — hence DROP + CREATE, in one transaction. Body otherwise IDENTICAL to
-- the live pg_get_functiondef read 2026-09-30: same SECURITY DEFINER, same
-- search_path, same tenant filter, same ordering.
--
-- DEPENDENCY CHECK (prod, 2026-09-30): pg_depend has no rows referencing the
-- function, no view definition names it, and no other function's body calls
-- it. The only caller is the client RPC (hooks/useProjectMessages.ts). The
-- guard below re-checks at apply time and aborts if that has changed.
--
-- ACL before: {postgres=X, authenticated=X, service_role=X} — no anon, no
-- PUBLIC. A DROP loses grants, so they are restated exactly; a missing grant is
-- a chat that will not load.

BEGIN;

DO $guard$
DECLARE
  v_oid oid := to_regprocedure('public.bp_list_project_messages(uuid)');
  v_n   integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'fix-603: bp_list_project_messages(uuid) not found';
  END IF;
  SELECT count(*) INTO v_n FROM pg_depend
   WHERE refobjid = v_oid AND deptype <> 'i';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fix-603: % object(s) depend on bp_list_project_messages — STOP', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_views
   WHERE definition ILIKE '%bp_list_project_messages%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fix-603: % view(s) reference bp_list_project_messages — STOP', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname <> 'bp_list_project_messages'
     AND p.prosrc ILIKE '%bp_list_project_messages%';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'fix-603: % function(s) call bp_list_project_messages — STOP', v_n;
  END IF;
END;
$guard$;

DROP FUNCTION public.bp_list_project_messages(uuid);

CREATE FUNCTION public.bp_list_project_messages(p_project_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, parent_message_id uuid, title text, author_id uuid, author_name text, body text, mentions uuid[], attachments jsonb, created_at timestamp with time zone, edited_at timestamp with time zone, deleted_at timestamp with time zone, revisions jsonb, task_id uuid, task_text text, task_permit_id integer, reply_count integer, last_activity_at timestamp with time zone, task_status text, task_done boolean, task_done_at timestamp with time zone, task_assigned_to text, task_due_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.project_id, m.parent_message_id, m.title, m.author_id,
         public.bp_profile_display_name(m.author_id) AS author_name,
         m.body, m.mentions, m.attachments, m.created_at,
         m.edited_at, m.deleted_at, m.revisions,
         t.id AS task_id, t.text AS task_text, t.permit_id AS task_permit_id,
         CASE WHEN m.parent_message_id IS NULL THEN (
           SELECT count(*)::int FROM public.project_messages r
           WHERE r.parent_message_id = m.id AND r.deleted_at IS NULL
         ) END AS reply_count,
         CASE WHEN m.parent_message_id IS NULL THEN (
           SELECT max(x.created_at) FROM (
             SELECT m.created_at
             UNION ALL
             SELECT r.created_at FROM public.project_messages r
             WHERE r.parent_message_id = m.id AND r.deleted_at IS NULL
           ) x
         ) END AS last_activity_at,
         t.completion_status AS task_status,
         t.done AS task_done,
         t.done_at AS task_done_at,
         t.assigned_to AS task_assigned_to,
         t.due_date AS task_due_date
  FROM public.project_messages m
  LEFT JOIN LATERAL (
    SELECT pt.id, pt.text, pt.permit_id,
           pt.completion_status, pt.done, pt.done_at, pt.assigned_to, pt.due_date
    FROM public.permit_tasks pt
    WHERE pt.source_message_id = m.id
    ORDER BY pt.created_at
    LIMIT 1
  ) t ON true
  WHERE m.project_id = p_project_id
    AND m.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY m.created_at ASC, m.id ASC;
$function$;

-- Restate the old ACL exactly.
REVOKE ALL ON FUNCTION public.bp_list_project_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_project_messages(uuid) TO authenticated, service_role;

-- Post-condition: the grants landed and anon has none (fix-540).
DO $check$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.bp_list_project_messages(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.bp_list_project_messages(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-603: grants did not land';
  END IF;
  IF has_function_privilege('anon', 'public.bp_list_project_messages(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-603: anon can execute bp_list_project_messages';
  END IF;
END;
$check$;

COMMIT;
