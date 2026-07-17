-- fix-notes-5 (2026-07-17): dashboard "waiting on" card groups by DISCIPLINE,
-- not bucket.
--
-- fix-notes-2 picked the card's next-open task per permit_tasks.bucket
-- (de → "Entitlement", pm → "Architecture"), but bucket is the lifecycle
-- PHASE axis (D&E vs Permitting), not ownership: on prod 134 of 235 open
-- 'ent'-discipline tasks sit in bucket 'pm' and were mislabeled Architecture
-- ("Civil by the EOW" et al). The permit detail groups its two task columns
-- by DISCIPLINE (bp_list_permit_tasks), so the card disagreed with it.
--
-- Now: ent_task = earliest open task with discipline 'ent', arch_task = with
-- discipline 'arch'. NULL discipline folds into ENT — the exact
-- COALESCE(t.discipline,'ent') rule bp_list_permit_tasks uses, so the card
-- and the permit-detail columns always agree. Ordering unchanged
-- (target_date → due_date NULLS LAST → sort_order → id). Client labels
-- shorten to ENT / ARCH / NOTE.

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
      AND COALESCE(t.discipline, 'ent') = 'ent'
      AND t.done = false
    ORDER BY t.permit_id, t.target_date NULLS LAST, t.due_date NULLS LAST,
             t.sort_order, t.id
  ),
  arch AS (
    SELECT DISTINCT ON (t.permit_id) t.permit_id, t.text
    FROM public.permit_tasks t
    WHERE t.tenant_id = ANY (public.auth_tenant_ids())
      AND t.discipline = 'arch'
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
