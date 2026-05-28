-- fix-68 (2026-05-28): Reports hub Phase 2 — Settings -> Reporting.
--
-- Relocates the saved-reports library into a tenant-owned category tree.
-- Adds:
--   1. public.report_categories — collapsible folder tree (parent_id self-ref).
--   2. public.saved_reports — a report entry (builtin or custom) in a category.
--   3. RPCs to list the hub + CRUD categories/reports (metadata only in P2).
--
-- The Weekly DA Update report (fix-67) is unchanged — it keeps its own
-- report_notes table, its bp_get_weekly_da_report RPC, its WeeklyDaReport
-- component, and the /reports/weekly-da route. This migration only adds the
-- hub that *points at* it via a builtin saved_report row
-- (builtin_key = 'weekly_da_update').
--
-- Tenant pattern matches the rest of the repo: auth_tenant_ids() resolves the
-- caller's tenant uuids; RLS uses `tenant_id = ANY(auth_tenant_ids())`; the
-- default_tenant_id_to_caller BEFORE INSERT trigger stamps tenant_id on direct
-- inserts. The RPCs are SECURITY DEFINER (bypass RLS) so they filter tenant
-- EXPLICITLY.
--
-- ADDITIVE + SAFE: new tables + new functions only. Nothing existing changes.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  parent_id   uuid REFERENCES public.report_categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_categories_tenant_parent_idx
  ON public.report_categories(tenant_id, parent_id, position);

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  category_id  uuid REFERENCES public.report_categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  kind         text NOT NULL CHECK (kind IN ('builtin','custom')),
  builtin_key  text,
  spec         jsonb NOT NULL DEFAULT '{}'::jsonb,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_reports_tenant_category_idx
  ON public.saved_reports(tenant_id, category_id, position);
-- Each tenant owns at most one row per builtin_key.
CREATE UNIQUE INDEX IF NOT EXISTS saved_reports_tenant_builtin_uq
  ON public.saved_reports(tenant_id, builtin_key) WHERE builtin_key IS NOT NULL;

-- Default tenant_id to the caller's tenant on direct insert (parity with
-- other tenant-scoped tables; the RPCs set it explicitly too).
DROP TRIGGER IF EXISTS report_categories_default_tenant ON public.report_categories;
CREATE TRIGGER report_categories_default_tenant
  BEFORE INSERT ON public.report_categories
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

DROP TRIGGER IF EXISTS saved_reports_default_tenant ON public.saved_reports;
CREATE TRIGGER saved_reports_default_tenant
  BEFORE INSERT ON public.saved_reports
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

-- ---------------------------------------------------------------------------
-- 2. RLS — standard 4-policy shape (mirrors report_notes / permit_cycle_reviewers)
-- ---------------------------------------------------------------------------
ALTER TABLE public.report_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_categories_tenant_select ON public.report_categories;
CREATE POLICY report_categories_tenant_select ON public.report_categories
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS report_categories_tenant_insert ON public.report_categories;
CREATE POLICY report_categories_tenant_insert ON public.report_categories
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS report_categories_tenant_update ON public.report_categories;
CREATE POLICY report_categories_tenant_update ON public.report_categories
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
  WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS report_categories_tenant_delete ON public.report_categories;
CREATE POLICY report_categories_tenant_delete ON public.report_categories
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_reports_tenant_select ON public.saved_reports;
CREATE POLICY saved_reports_tenant_select ON public.saved_reports
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS saved_reports_tenant_insert ON public.saved_reports;
CREATE POLICY saved_reports_tenant_insert ON public.saved_reports
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS saved_reports_tenant_update ON public.saved_reports;
CREATE POLICY saved_reports_tenant_update ON public.saved_reports
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
  WITH CHECK (tenant_id = ANY (auth_tenant_ids()));
DROP POLICY IF EXISTS saved_reports_tenant_delete ON public.saved_reports;
CREATE POLICY saved_reports_tenant_delete ON public.saved_reports
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 3. Per-tenant seeding helper (idempotent)
-- ---------------------------------------------------------------------------
-- Ensures a tenant has the "Weekly Updates" category + the weekly_da_update
-- builtin saved_report. Idempotent: the unique partial index on
-- (tenant_id, builtin_key) makes the builtin insert a no-op once present, and
-- the category is created only when absent. Called by:
--   - the explicit seed loop below (for tenants that exist today), and
--   - bp_list_report_hub on first read (so future tenants self-seed without a
--     separate onboarding hook — the repo has no central tenant-onboarding
--     RPC to hang this off, so ensure-on-read is the robust choice).
CREATE OR REPLACE FUNCTION public.bp_ensure_report_hub_seed(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat uuid;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN;
  END IF;

  -- Already seeded? (the builtin is the marker)
  IF EXISTS (
    SELECT 1 FROM public.saved_reports
    WHERE tenant_id = p_tenant AND builtin_key = 'weekly_da_update'
  ) THEN
    RETURN;
  END IF;

  -- Reuse an existing "Weekly Updates" category if one's there; else make it.
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
END;
$function$;

-- Seed every tenant that exists today.
DO $seed$
DECLARE
  v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.bp_ensure_report_hub_seed(v_t);
  END LOOP;
END;
$seed$;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- List the whole hub for the caller's tenant(s). VOLATILE (not STABLE) because
-- it lazily seeds the builtin on first access for the primary tenant.
CREATE OR REPLACE FUNCTION public.bp_list_report_hub()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_result  jsonb;
BEGIN
  PERFORM public.bp_ensure_report_hub_seed(v_primary);

  SELECT jsonb_build_object(
    'categories',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'parent_id', c.parent_id,
          'name', c.name,
          'position', c.position
        )
        ORDER BY c.position, c.name
      )
      FROM public.report_categories c
      WHERE c.tenant_id = ANY (v_tenants)
    ), '[]'::jsonb),
    'reports',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'category_id', r.category_id,
          'name', r.name,
          'description', r.description,
          'kind', r.kind,
          'builtin_key', r.builtin_key,
          'position', r.position
        )
        ORDER BY r.position, r.name
      )
      FROM public.saved_reports r
      WHERE r.tenant_id = ANY (v_tenants)
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('categories', '[]'::jsonb, 'reports', '[]'::jsonb));
END;
$function$;

-- Create (p_id NULL) or rename/move/reposition (p_id set) a category.
CREATE OR REPLACE FUNCTION public.bp_upsert_report_category(
  p_id        uuid,
  p_parent_id uuid,
  p_name      text,
  p_position  integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_id      uuid;
BEGIN
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'category name is required';
  END IF;

  -- A supplied parent must belong to the caller's tenant.
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.report_categories
    WHERE id = p_parent_id AND tenant_id = ANY (v_tenants)
  ) THEN
    RAISE EXCEPTION 'parent category % not found in caller tenant', p_parent_id;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
    VALUES (v_primary, p_parent_id, TRIM(p_name), COALESCE(p_position, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.report_categories
      SET parent_id  = p_parent_id,
          name       = TRIM(p_name),
          position   = COALESCE(p_position, position),
          updated_at = now()
    WHERE id = p_id
      AND tenant_id = ANY (v_tenants)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'category % not found in caller tenant', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

-- Delete a category. Child reports' category_id and child categories'
-- parent_id are set to NULL automatically via the ON DELETE SET NULL FKs
-- (those reports become "uncategorized"; those subcategories become roots).
CREATE OR REPLACE FUNCTION public.bp_delete_report_category(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_rows    integer;
BEGIN
  DELETE FROM public.report_categories
  WHERE id = p_id AND tenant_id = ANY (v_tenants);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'category % not found in caller tenant', p_id;
  END IF;
END;
$function$;

-- Create (p_id NULL) or edit metadata (p_id set) of a saved report. Phase 2
-- only edits name / description / category / position. kind, builtin_key and
-- spec are set at create time and never edited here (a future
-- bp_upsert_custom_report_spec handles spec in Phase 3). New rows default to
-- kind='custom' (the UI's "+ New Report" is disabled in P2, so the only P2
-- callers are metadata edits of the seeded builtin).
CREATE OR REPLACE FUNCTION public.bp_upsert_saved_report(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_description text,
  p_position    integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_id      uuid;
BEGIN
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'report name is required';
  END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.report_categories
    WHERE id = p_category_id AND tenant_id = ANY (v_tenants)
  ) THEN
    RAISE EXCEPTION 'category % not found in caller tenant', p_category_id;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.saved_reports
      (tenant_id, category_id, name, description, kind, builtin_key, spec, position)
    VALUES (
      v_primary, p_category_id, TRIM(p_name), COALESCE(p_description, ''),
      'custom', NULL, '{}'::jsonb, COALESCE(p_position, 0)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.saved_reports
      SET category_id = p_category_id,
          name        = TRIM(p_name),
          description = COALESCE(p_description, ''),
          position    = COALESCE(p_position, position),
          updated_at  = now()
    WHERE id = p_id
      AND tenant_id = ANY (v_tenants)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'report % not found in caller tenant', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

-- Delete a saved report. Builtins are system-managed and cannot be deleted
-- from the UI (raises). Custom reports delete normally.
CREATE OR REPLACE FUNCTION public.bp_delete_saved_report(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_kind    text;
BEGIN
  SELECT kind INTO v_kind
  FROM public.saved_reports
  WHERE id = p_id AND tenant_id = ANY (v_tenants);

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'report % not found in caller tenant', p_id;
  END IF;
  IF v_kind = 'builtin' THEN
    RAISE EXCEPTION 'builtin reports cannot be deleted';
  END IF;

  DELETE FROM public.saved_reports
  WHERE id = p_id AND tenant_id = ANY (v_tenants);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants — callable by logged-in users (matches the other bp_* RPCs)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.bp_list_report_hub() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_report_category(uuid, uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_delete_report_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_saved_report(uuid, uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_delete_saved_report(uuid) TO authenticated;
