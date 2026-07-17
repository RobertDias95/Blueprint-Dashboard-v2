-- fix-notes-3 (2026-07-17): Weekly Updates report — grouped, editable notes.
--
-- Adds:
--   1. bp_list_all_notes() — tenant-wide bulk read of public.notes (the
--      single source from fix-notes-1) with author_name resolved server-side.
--      Mirrors bp_list_project_notes but WITHOUT the project filter, so the
--      report loads every project's notes in ONE round trip (120 active
--      projects, only 41 with notes — a per-project fan-out would be 120
--      queries). Reads only; all WRITES still go through the fix-notes-1
--      hooks (useAddNote/useUpdateNote → direct notes DML), single source.
--   2. The weekly_updates builtin saved_report under the existing "Weekly
--      Updates" category, seeded idempotently for every tenant.
--
-- No new tables; additive functions + data seed only.

-- ---------------------------------------------------------------------------
-- 1. bp_list_all_notes() — every note in the caller's tenant, newest first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_list_all_notes()
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    permit_id integer,
    body text,
    completed boolean,
    completed_at timestamptz,
    created_by uuid,
    author_name text,
    created_at timestamptz,
    updated_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT n.id, n.project_id, n.permit_id, n.body, n.completed, n.completed_at,
         n.created_by,
         COALESCE(NULLIF(TRIM(pr.name), ''), NULLIF(TRIM(pr.full_name), ''), pr.email) AS author_name,
         n.created_at, n.updated_at
  FROM public.notes n
  LEFT JOIN public.profiles pr ON pr.id = n.created_by
  WHERE n.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY n.created_at DESC, n.id DESC;
$$;

REVOKE ALL ON FUNCTION public.bp_list_all_notes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_all_notes()
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Seed the weekly_updates builtin. Based on the LIVE bp_ensure_report_hub_seed
--    (prod source of truth) + a third idempotent insert under "Weekly Updates".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_ensure_report_hub_seed(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat      uuid;
  v_pipeline uuid;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_ensure_report_hub_seed: tenant % not in caller scope', p_tenant
      USING ERRCODE = '42501';
  END IF;

  -- Weekly Updates category + Weekly DA Update builtin.
  SELECT id INTO v_cat
  FROM public.report_categories
  WHERE tenant_id = p_tenant AND name = 'Weekly Updates' AND parent_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
    VALUES (p_tenant, NULL, 'Weekly Updates', 0)
    RETURNING id INTO v_cat;
  END IF;

  INSERT INTO public.saved_reports
    (tenant_id, category_id, name, description, kind, builtin_key, position)
  VALUES (
    p_tenant, v_cat, 'Weekly DA Update',
    'Per-DA one-pager: permits in corrections (with the date corrections came out), carry-forward notes, and upcoming intakes for the week. Printable / send-ready.',
    'builtin', 'weekly_da_update', 0
  )
  ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
  DO NOTHING;

  -- fix-notes-3: Weekly Updates builtin — grouped, editable project/permit
  -- notes (public.notes single source). Same "Weekly Updates" category.
  INSERT INTO public.saved_reports
    (tenant_id, category_id, name, description, kind, builtin_key, position)
  VALUES (
    p_tenant, v_cat, 'Weekly Updates',
    'Every project''s running notes in one place — holistic project notes plus each permit''s active notes, newest first. Edit, add, and complete notes inline; changes write straight back to the project and permit views.',
    'builtin', 'weekly_updates', 1
  )
  ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
  DO NOTHING;

  -- fix-221: Pipeline category + Approved – Awaiting Issuance builtin.
  SELECT id INTO v_pipeline
  FROM public.report_categories
  WHERE tenant_id = p_tenant AND name = 'Pipeline' AND parent_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF v_pipeline IS NULL THEN
    INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
    VALUES (p_tenant, NULL, 'Pipeline', 1)
    RETURNING id INTO v_pipeline;
  END IF;

  INSERT INTO public.saved_reports
    (tenant_id, category_id, name, description, kind, builtin_key, position)
  VALUES (
    p_tenant, v_pipeline, 'Approved – Awaiting Issuance',
    'Permits the city has approved (approval date set) but not yet issued — sitting in Issuance Prep. Sorted by days-since-approval; each row opens the permit in Project View.',
    'builtin', 'approved_awaiting_issuance', 0
  )
  ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
  DO NOTHING;
END;
$function$;

-- Back-seed the weekly_updates builtin for every existing tenant. Direct
-- inserts (NOT a bp_ensure_report_hub_seed call) because that function's
-- tenant-scope guard raises when run as the migration role (no service_role /
-- no auth_tenant_ids) — same reason fix-221 seeds directly. Idempotent via
-- ON CONFLICT + the "Weekly Updates" category reuse.
DO $seed$
DECLARE
  v_t   uuid;
  v_cat uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    SELECT id INTO v_cat
    FROM public.report_categories
    WHERE tenant_id = v_t AND name = 'Weekly Updates' AND parent_id IS NULL
    ORDER BY position, created_at
    LIMIT 1;
    IF v_cat IS NULL THEN
      INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
      VALUES (v_t, NULL, 'Weekly Updates', 0)
      RETURNING id INTO v_cat;
    END IF;

    INSERT INTO public.saved_reports
      (tenant_id, category_id, name, description, kind, builtin_key, position)
    VALUES (
      v_t, v_cat, 'Weekly Updates',
      'Every project''s running notes in one place — holistic project notes plus each permit''s active notes, newest first. Edit, add, and complete notes inline; changes write straight back to the project and permit views.',
      'builtin', 'weekly_updates', 1
    )
    ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$seed$;
