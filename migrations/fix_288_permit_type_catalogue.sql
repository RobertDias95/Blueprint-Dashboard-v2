-- fix-288: safe permit-type rename, and descriptions out of the bundle.
--
-- Two things the Settings permit-type editor needs and the database did not
-- have.
--
-- ---------------------------------------------------------------------------
-- 1. bp_rename_permit_type — rename WITHOUT orphaning the permits.
-- ---------------------------------------------------------------------------
-- ★ WHY THIS EXISTS AT ALL. The catalogue is joined to permits BY STRING:
-- permits.type holds 'Building Permit', not a foreign key. So "rename" done the
-- obvious client-side way — bp_upsert_permit_type(new) then
-- bp_delete_permit_type(old) — would leave every permit still carrying the OLD
-- string, pointing at a catalogue row that no longer exists. 143 permits say
-- 'Building Permit'. That is precisely the failure this ticket's ★ warns about:
-- it looks fine on the day and surfaces months later as an unexplained blank.
--
-- So the rename is ONE transaction that moves both: the catalogue row and every
-- permit referencing it. It returns how many permits were repointed so the UI
-- can say what it just did rather than claiming a silent success.
--
-- Plain SECURITY INVOKER with a pinned search_path, matching the surrounding
-- bp_upsert_permit_type / bp_delete_permit_type: RLS on `permits` scopes the
-- repoint to the caller's own tenant, and the catalogue is global (permit_types
-- has no tenant_id — name, is_builtin, notes only).
--
-- Idempotent: CREATE OR REPLACE, and renaming to a name that already exists is
-- refused rather than silently merging two types into one.

CREATE OR REPLACE FUNCTION public.bp_rename_permit_type(p_old text, p_new text)
 RETURNS TABLE(out_name text, out_permits_repointed integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text := btrim(COALESCE(p_old, ''));
  v_new text := btrim(COALESCE(p_new, ''));
  v_moved integer := 0;
BEGIN
  IF v_old = '' OR v_new = '' THEN
    RAISE EXCEPTION 'bp_rename_permit_type: both names are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_old = v_new THEN
    -- Not an error; nothing to do. Returning the row keeps the client's
    -- success path uniform.
    RETURN QUERY SELECT v_new, 0;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.permit_types WHERE name = v_old) THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % is not a permit type', v_old
      USING ERRCODE = 'P0002';
  END IF;

  -- ★ Refuse to merge. Renaming A to an existing B would silently fold two
  -- catalogue entries — and every permit of both — into one, with no way back.
  IF EXISTS (SELECT 1 FROM public.permit_types WHERE name = v_new) THEN
    RAISE EXCEPTION 'bp_rename_permit_type: % already exists', v_new
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.permit_types SET name = v_new WHERE name = v_old;

  -- The whole point: the permits move with the name, in the same transaction.
  UPDATE public.permits SET type = v_new WHERE type = v_old;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN QUERY SELECT v_new, v_moved;
END; $function$;

GRANT EXECUTE ON FUNCTION public.bp_rename_permit_type(text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Seed app_config.permitTypeDescriptions.
-- ---------------------------------------------------------------------------
-- The wizard's Step 2 descriptions were a hardcoded constant
-- (src/components/wizard/wizardState.ts PERMIT_DESCRIPTIONS), so changing a
-- line of help text needed a deploy. They move to app_config alongside
-- productTypeOptions and the other registries, and the Settings editor writes
-- them.
--
-- ★ THE SEEDED VALUE IS THE CURRENT TEXT, with two keys DROPPED because they
-- match no permit type and therefore have never rendered:
--
--     'PPR (Post-Permit Revision)'   the live type is 'PPR'
--     'SDOT'                         the live type is 'SDOT Tree'
--
-- Both are the same class of bug as the one this ticket was written about: a
-- key that matches nothing looks exactly like a type that simply has no
-- description, so nobody notices. The TS constant keeps them out too, and a new
-- test asserts every key names a real type so the next one fails CI instead.
--
-- (The brief cited 'Grading \ Clearing' with a BACKSLASH as the never-rendering
-- key. That is not in this codebase and never has been — `git log -S` over the
-- full history finds nothing; the constant has always read 'Grading / Clearing'
-- with a forward slash, which matches the live type. The two above are the real
-- instances of the bug it describes.)
--
-- Only seeded when absent, so re-running cannot revert an edit made in the UI.
--
-- app_config is TENANT-SCOPED (tenant_id NOT NULL, normally filled by the
-- default_tenant_id_to_caller trigger from auth.uid()). A migration has no
-- authenticated caller, so the tenant is named explicitly — seeded for every
-- tenant that already has config, rather than assuming there is only one.
INSERT INTO public.app_config (tenant_id, key, value)
SELECT t.tenant_id, 'permitTypeDescriptions', jsonb_build_object(
  'Building Permit',    'Required for new construction or major structural work',
  'Demolition',         'Tearing down an existing structure before construction',
  'Grading / Clearing', 'Earthwork, cut/fill, retaining walls, tree clearing at scale',
  'TRAO',               'Tree Removal Authorization — protected trees impacted',
  'ECA Waiver',         'Environmentally Critical Area on site',
  'ULS',                'Utility local service connections — water/sewer/storm',
  'LSM',                'Lot size modification or boundary adjustment',
  'PPR',                'Pre-application or post-permit design revisions',
  'PAR/Pre-Sub',        'Pre-application review submission',
  'SDOT Tree',          'Seattle Dept of Transportation tree review — ROW, curbs, trees'
)
FROM (SELECT DISTINCT tenant_id FROM public.app_config) t
-- app_config's primary key is `key` ALONE (not (tenant_id, key)), so a key is
-- global even though the row carries a tenant. DO NOTHING therefore also means
-- "leave whatever is already there", which is the re-run guarantee above.
ON CONFLICT (key) DO NOTHING;
