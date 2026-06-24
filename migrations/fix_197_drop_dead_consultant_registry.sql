-- fix-197: drop the dead Consultant Firms registry (UI + hooks already removed).
--
-- External team consolidated onto the projects.external_team BLOB (fix-195/196).
-- The normalized registry — consultant_firms + project_external_teams — is
-- orphaned: both tables are EMPTY and NO live surface reads them (Settings panel,
-- Project Overview editor, and My Tasks Waiting all resolve firms from the blob
-- via resolveExternalFirm). This migration drops the registry RPCs + tables.
--
-- GUARDED: re-checks both tables are empty in the migration body and ABORTS if
-- either has rows, so the drop can never destroy data. (Probed with a
-- rolled-back transaction against prod before applying; row counts 0/0.)
--
-- Drop order: project_external_teams first (it has an FK → consultant_firms),
-- then consultant_firms. No external dependents, so no CASCADE is needed.

-- 1. Abort unless both tables are empty.
DO $$
DECLARE
  v_cf  integer;
  v_pet integer;
BEGIN
  SELECT count(*) INTO v_cf  FROM public.consultant_firms;
  SELECT count(*) INTO v_pet FROM public.project_external_teams;
  IF v_cf <> 0 OR v_pet <> 0 THEN
    RAISE EXCEPTION
      'fix-197 ABORT: consultant_firms=% project_external_teams=% (expected 0/0) — data present, not dropping',
      v_cf, v_pet;
  END IF;
END $$;

-- 2. Drop the registry RPCs (no longer called — useConsultantFirms removed).
DROP FUNCTION IF EXISTS public.bp_list_consultant_firms(boolean);
DROP FUNCTION IF EXISTS public.bp_upsert_consultant_firm(uuid, text, text, boolean, text, timestamptz);
DROP FUNCTION IF EXISTS public.bp_archive_consultant_firm(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.bp_get_project_external_team(uuid);
DROP FUNCTION IF EXISTS public.bp_upsert_project_external_team_member(uuid, text, uuid);

-- 3. Drop the tables (child first — FK project_external_teams.firm_id → consultant_firms).
DROP TABLE IF EXISTS public.project_external_teams;
DROP TABLE IF EXISTS public.consultant_firms;
