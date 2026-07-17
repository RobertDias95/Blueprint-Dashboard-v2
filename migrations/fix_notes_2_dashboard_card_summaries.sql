-- fix-notes-2 (2026-07-17): dashboard expanded-permit card = "what's this
-- waiting on?" + make fix-notes-1 notes searchable.
--
-- Two SECURITY DEFINER read RPCs (fix-70 bp_list_* pattern: explicit
-- tenant filter, search_path pinned, granted to authenticated + service_role,
-- anon revoked). No DDL on existing tables — additive functions only.

-- ---------------------------------------------------------------------------
-- 1. bp_dashboard_permit_cards() — per-permit "waiting on" summary.
--
-- For every permit in the caller's tenant that has at least one of:
--   * ent_task  = earliest OPEN (done=false) task in bucket 'de' (Entitlement)
--   * arch_task = earliest OPEN (done=false) task in bucket 'pm' (Architecture)
--   * note      = newest ACTIVE (completed=false) PERMIT note
-- returns one row. Permits with none of the three are omitted (the client
-- treats absence as "Nothing pending"). Task ordering matches the brief:
-- target_date, then due_date (NULLS LAST), then sort_order; id breaks ties.
-- The stray 'co' bucket is ignored (only 'de'/'pm' are read). Note bodies are
-- truncated to keep the payload small — the card shows a ~1-line snippet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_dashboard_permit_cards()
  RETURNS TABLE (
    permit_id integer,
    ent_task  text,
    arch_task text,
    note      text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  WITH ent AS (
    SELECT DISTINCT ON (t.permit_id) t.permit_id, t.text
    FROM public.permit_tasks t
    WHERE t.tenant_id = ANY (public.auth_tenant_ids())
      AND t.bucket = 'de'
      AND t.done = false
    ORDER BY t.permit_id, t.target_date NULLS LAST, t.due_date NULLS LAST,
             t.sort_order, t.id
  ),
  arch AS (
    SELECT DISTINCT ON (t.permit_id) t.permit_id, t.text
    FROM public.permit_tasks t
    WHERE t.tenant_id = ANY (public.auth_tenant_ids())
      AND t.bucket = 'pm'
      AND t.done = false
    ORDER BY t.permit_id, t.target_date NULLS LAST, t.due_date NULLS LAST,
             t.sort_order, t.id
  ),
  nte AS (
    SELECT DISTINCT ON (n.permit_id) n.permit_id, left(n.body, 280) AS body
    FROM public.notes n
    WHERE n.tenant_id = ANY (public.auth_tenant_ids())
      AND n.permit_id IS NOT NULL
      AND n.completed = false
    ORDER BY n.permit_id, n.created_at DESC, n.id DESC
  ),
  ids AS (
    SELECT permit_id FROM ent
    UNION SELECT permit_id FROM arch
    UNION SELECT permit_id FROM nte
  )
  SELECT ids.permit_id, ent.text, arch.text, nte.body
  FROM ids
  LEFT JOIN ent  ON ent.permit_id  = ids.permit_id
  LEFT JOIN arch ON arch.permit_id = ids.permit_id
  LEFT JOIN nte  ON nte.permit_id  = ids.permit_id;
$$;

REVOKE ALL ON FUNCTION public.bp_dashboard_permit_cards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_dashboard_permit_cards()
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. bp_project_note_search_index() — active note bodies keyed by project, so
-- the Project List free-text search can find a project by note text (fix-notes-1
-- moved notes off projects.notes into the notes table; the old haystack only
-- searched the now-unwritten legacy column). Includes BOTH holistic project
-- notes (permit_id NULL) and per-permit notes — notes.project_id is always set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_project_note_search_index()
  RETURNS TABLE (
    project_id uuid,
    body       text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT n.project_id, n.body
  FROM public.notes n
  WHERE n.tenant_id = ANY (public.auth_tenant_ids())
    AND n.completed = false;
$$;

REVOKE ALL ON FUNCTION public.bp_project_note_search_index() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_project_note_search_index()
  TO authenticated, service_role;
