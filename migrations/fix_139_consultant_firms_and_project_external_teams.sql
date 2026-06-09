-- fix-139 (2026): Waiting On foundation — consultant_firms + project_external_teams.
--
-- Applied to PROD via Supabase MCP apply_migration (two records:
--   fix_139_consultant_firms_and_project_external_teams
--   fix_139_external_team_member_variable_conflict
-- ). This file is the consolidated, final state for the repo record.
--
-- Bobby's model: each project assigns a consultant firm per discipline (Civil =
-- Prism, Structural = SSS, …). When a task's waiting_on is a discipline, the
-- responsible firm is implicit from the project's external team. Internal
-- assigned_to is unchanged — firms enter via the waiting_on discipline.
--
-- FOUNDATION ONLY (tables + RPCs). The discipline-grouped Waiting On view in
-- My Tasks is fix-140. The discipline vocab is owned by the TypeScript layer
-- (WAITING_ON_OPTIONS, 13 values) — no DB CHECK, matching the fix-138 pattern.
--
-- Tenant pattern matches the repo: auth_tenant_ids() resolves the caller's
-- tenant uuids; RLS uses tenant_id = ANY(auth_tenant_ids()). RPCs are SECURITY
-- DEFINER (bypass RLS) and filter tenant EXPLICITLY.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- consultant_firms: tenant-scoped list of external firms, one row per
-- (firm, discipline). A firm covering multiple disciplines gets multiple
-- records (e.g. "Prism" Civil + "Prism" Structural). Trade-off chosen for
-- simplicity; revisit with disciplines text[] if multi-discipline firms
-- become common.
CREATE TABLE IF NOT EXISTS public.consultant_firms (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text          NOT NULL,
  discipline  text          NOT NULL,
  active      boolean       NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, discipline)
);

CREATE INDEX IF NOT EXISTS consultant_firms_tenant_discipline_idx
  ON public.consultant_firms (tenant_id, discipline) WHERE active = true;

-- project_external_teams: composite PK on (project_id, discipline). At most one
-- firm per (project, discipline). Setting firm_id NULL clears the pairing
-- (the upsert RPC DELETEs the row in that case).
CREATE TABLE IF NOT EXISTS public.project_external_teams (
  project_id  uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  discipline  text          NOT NULL,
  firm_id     uuid          REFERENCES public.consultant_firms(id) ON DELETE SET NULL,
  tenant_id   uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, discipline)
);

CREATE INDEX IF NOT EXISTS project_external_teams_firm_idx
  ON public.project_external_teams (firm_id) WHERE firm_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.consultant_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_external_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consultant_firms_tenant_policy ON public.consultant_firms;
CREATE POLICY consultant_firms_tenant_policy ON public.consultant_firms
  FOR ALL USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS project_external_teams_tenant_policy ON public.project_external_teams;
CREATE POLICY project_external_teams_tenant_policy ON public.project_external_teams
  FOR ALL USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 3. RPCs (SECURITY DEFINER, explicit tenant gate)
-- ---------------------------------------------------------------------------

-- List firms for the caller tenant, sorted discipline then name. Excludes
-- inactive unless p_include_inactive.
CREATE OR REPLACE FUNCTION public.bp_list_consultant_firms(
  p_include_inactive boolean DEFAULT false
)
 RETURNS SETOF public.consultant_firms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
BEGIN
  RETURN QUERY
    SELECT *
    FROM public.consultant_firms cf
    WHERE cf.tenant_id = ANY (v_tenants)
      AND (p_include_inactive OR cf.active = true)
    ORDER BY cf.discipline ASC, cf.name ASC;
END;
$function$;

-- Create (p_id NULL) or update a firm. OCC via p_expected_updated_at on update
-- — raises CONCURRENT_UPDATE when the token is stale. Returns the full row.
CREATE OR REPLACE FUNCTION public.bp_upsert_consultant_firm(
  p_id                  uuid,
  p_name                text,
  p_discipline          text,
  p_active              boolean,
  p_notes               text,
  p_expected_updated_at timestamptz
)
 RETURNS SETOF public.consultant_firms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_primary uuid   := (public.auth_tenant_ids())[1];
  v_existing timestamptz;
  v_id      uuid;
BEGIN
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'firm name is required';
  END IF;
  IF COALESCE(TRIM(p_discipline), '') = '' THEN
    RAISE EXCEPTION 'discipline is required';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.consultant_firms (tenant_id, name, discipline, active, notes)
    VALUES (
      v_primary,
      TRIM(p_name),
      TRIM(p_discipline),
      COALESCE(p_active, true),
      NULLIF(TRIM(COALESCE(p_notes, '')), '')
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT updated_at INTO v_existing
    FROM public.consultant_firms
    WHERE id = p_id AND tenant_id = ANY (v_tenants);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consultant firm % not found in caller tenant', p_id;
    END IF;
    IF p_expected_updated_at IS NOT NULL
       AND v_existing IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'CONCURRENT_UPDATE';
    END IF;
    UPDATE public.consultant_firms
      SET name       = TRIM(p_name),
          discipline = TRIM(p_discipline),
          active     = COALESCE(p_active, active),
          notes      = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
          updated_at = now()
    WHERE id = p_id AND tenant_id = ANY (v_tenants)
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY SELECT * FROM public.consultant_firms WHERE id = v_id;
END;
$function$;

-- Soft-delete a firm (active = false). OCC via p_expected_updated_at. Returns
-- the updated row.
--
-- TRADE-OFF (fix-139, documented): this does NOT cascade to clear
-- project_external_teams.firm_id — existing assignments keep pointing at the
-- archived firm. The Project Settings dropdown filters by active = true so an
-- archived firm simply stops being assignable. Revisit (cascade-clear) only if
-- it confuses users in production.
CREATE OR REPLACE FUNCTION public.bp_archive_consultant_firm(
  p_id                  uuid,
  p_expected_updated_at timestamptz
)
 RETURNS SETOF public.consultant_firms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_existing timestamptz;
BEGIN
  SELECT updated_at INTO v_existing
  FROM public.consultant_firms
  WHERE id = p_id AND tenant_id = ANY (v_tenants);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultant firm % not found in caller tenant', p_id;
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_existing IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONCURRENT_UPDATE';
  END IF;

  RETURN QUERY
    UPDATE public.consultant_firms
      SET active = false, updated_at = now()
    WHERE id = p_id AND tenant_id = ANY (v_tenants)
    RETURNING *;
END;
$function$;

-- One row per (discipline, firm) pairing assigned to the project, with the
-- firm name for display. Disciplines WITHOUT an assignment are NOT returned —
-- the UI fills the gaps from WAITING_ON_OPTIONS.
CREATE OR REPLACE FUNCTION public.bp_get_project_external_team(
  p_project_id uuid
)
 RETURNS TABLE (
   project_id uuid,
   discipline text,
   firm_id    uuid,
   firm_name  text,
   tenant_id  uuid,
   updated_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
BEGIN
  RETURN QUERY
    SELECT pet.project_id, pet.discipline, pet.firm_id, cf.name AS firm_name,
           pet.tenant_id, pet.updated_at
    FROM public.project_external_teams pet
    LEFT JOIN public.consultant_firms cf ON cf.id = pet.firm_id
    WHERE pet.project_id = p_project_id
      AND pet.tenant_id = ANY (v_tenants)
    ORDER BY pet.discipline ASC;
END;
$function$;

-- Upsert a (project, discipline) -> firm pairing. p_firm_id NULL DELETEs the
-- row (clears the pairing) and returns no rows. Otherwise inserts/updates and
-- returns the resulting row (with firm_name).
--
-- #variable_conflict use_column: the RETURNS TABLE OUT columns (project_id,
-- discipline, …) collide with the table columns referenced in the INSERT …
-- ON CONFLICT (project_id, discipline) clause; the pragma resolves ambiguous
-- bare names to columns.
CREATE OR REPLACE FUNCTION public.bp_upsert_project_external_team_member(
  p_project_id uuid,
  p_discipline text,
  p_firm_id    uuid
)
 RETURNS TABLE (
   project_id uuid,
   discipline text,
   firm_id    uuid,
   firm_name  text,
   tenant_id  uuid,
   updated_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
BEGIN
  IF COALESCE(TRIM(p_discipline), '') = '' THEN
    RAISE EXCEPTION 'discipline is required';
  END IF;

  SELECT p.tenant_id INTO v_tenant
  FROM public.projects p
  WHERE p.id = p_project_id AND p.tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found in caller tenant', p_project_id;
  END IF;

  IF p_firm_id IS NULL THEN
    DELETE FROM public.project_external_teams pet
    WHERE pet.project_id = p_project_id AND pet.discipline = TRIM(p_discipline);
    RETURN; -- no rows = cleared
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.consultant_firms cf
    WHERE cf.id = p_firm_id AND cf.tenant_id = ANY (v_tenants)
  ) THEN
    RAISE EXCEPTION 'consultant firm % not found in caller tenant', p_firm_id;
  END IF;

  INSERT INTO public.project_external_teams (project_id, discipline, firm_id, tenant_id, updated_at)
  VALUES (p_project_id, TRIM(p_discipline), p_firm_id, v_tenant, now())
  ON CONFLICT (project_id, discipline)
    DO UPDATE SET firm_id = EXCLUDED.firm_id, updated_at = now();

  RETURN QUERY
    SELECT pet.project_id, pet.discipline, pet.firm_id, cf.name AS firm_name,
           pet.tenant_id, pet.updated_at
    FROM public.project_external_teams pet
    LEFT JOIN public.consultant_firms cf ON cf.id = pet.firm_id
    WHERE pet.project_id = p_project_id AND pet.discipline = TRIM(p_discipline);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.bp_list_consultant_firms(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_consultant_firm(uuid, text, text, boolean, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_archive_consultant_firm(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_get_project_external_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_project_external_team_member(uuid, text, uuid) TO authenticated;
