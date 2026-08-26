-- ===========================================================================
-- fix-412 SCOPE A — rename "Existing" → "Remodel"
-- ===========================================================================
--
-- APPLIED TO PROD 2026-08-26 via apply_migration
-- (supabase_migrations.schema_migrations version 20260826205959,
--  name fix_412_existing_to_remodel). This file is the record; the database is
-- the source of truth.
--
-- Bobby, 2026-08-26: "rename approved — Existing → Remodel across
-- app_config.productTypeOptions, the 6 projects and the 2 unit rows."
--
-- Measured read-only immediately before this ran: 234 unit objects, 2 carrying
-- label 'Existing'; 6 of 196 projects carrying 'Existing' in product_types;
-- productTypeOptions = [SFR, Cottages, Duplex, Condo, ADU, DADU, SFR+ADU,
-- Existing].
--
-- ★★★ THREE WRITES, ONE VOCABULARY. The product type lives in three places and
-- they must move together or the registry and the data disagree: a project
-- would carry a value the dropdown no longer offers, and its unit rows would
-- render "Pick type…" over a label that used to be valid (resolveUnitLabel
-- shows the placeholder for any label not in the registry). Renaming the
-- registry alone would have looked like a one-line change and silently orphaned
-- 8 rows.
--
-- ★★ NOTHING ELSE MOVES. Only the exact string 'Existing'. Every statement is
-- equality-matched on that literal — no LIKE, no ILIKE, no prefix.

-- ---------------------------------------------------------------------------
-- 0. THE BACKUP, taken before anything is written
-- ---------------------------------------------------------------------------
-- ★ Every affected row, whole, so a revert needs no reconstruction: the
--   registry array as it was, and each project's FULL product_types and
--   unit_types (not just the changed element). 7 rows written: 1 config + 6
--   projects (the 2 unit-carrying projects are among those 6).
CREATE TABLE IF NOT EXISTS public._fix412_existing_to_remodel_backup_2026_08_26 (
  kind          text        NOT NULL,
  row_key       text        NOT NULL,
  product_types text[],
  unit_types    jsonb,
  config_value  jsonb,
  taken_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._fix412_existing_to_remodel_backup_2026_08_26
  (kind, row_key, config_value)
SELECT 'app_config', c.key, c.value
FROM public.app_config c
WHERE c.key = 'productTypeOptions';

INSERT INTO public._fix412_existing_to_remodel_backup_2026_08_26
  (kind, row_key, product_types, unit_types)
SELECT 'project', p.id::text, p.product_types, p.unit_types
FROM public.projects p
WHERE 'Existing' = ANY(p.product_types)
   OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p.unit_types) = 'array'
               THEN p.unit_types ELSE '[]'::jsonb END) e
        WHERE e->>'label' = 'Existing');

-- ---------------------------------------------------------------------------
-- ★★★ THE TWO TRIGGERS ARE SUPPRESSED FOR THE PROJECT WRITES
-- ---------------------------------------------------------------------------
--   projects_set_updated_at — BEFORE UPDATE, bumps the OCC token. A vocabulary
--     rename is not "a person edited this project": letting it fire would give
--     anyone with one of these 6 projects open a false "modified by someone
--     else" (fix-341's shape) and would claim a human edited them today.
--   bp_log_user_activity — AFTER UPDATE, one activity row per project for a
--     migration nobody performed.
-- Re-enabled in the same transaction, so a failure anywhere rolls back and
-- there is no state where the app runs with them off.
--
-- ★ VERIFIED AFTER APPLYING: none of the 6 renamed projects has an updated_at
--   inside the migration window — the suppression worked.
ALTER TABLE public.projects DISABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects DISABLE TRIGGER bp_log_user_activity;

-- ---------------------------------------------------------------------------
-- A1. the registry
-- ---------------------------------------------------------------------------
-- ★ ORDER IS PRESERVED (`ORDER BY ord`). This array is the dropdown's order;
--   rebuilding it unordered would silently reshuffle every product-type picker
--   in the app as a side effect of a rename.
UPDATE public.app_config c
SET value = (
  SELECT jsonb_agg(
           CASE WHEN v = '"Existing"'::jsonb THEN '"Remodel"'::jsonb ELSE v END
           ORDER BY ord)
  FROM jsonb_array_elements(c.value) WITH ORDINALITY AS t(v, ord)
)
WHERE c.key = 'productTypeOptions'
  AND c.value @> '["Existing"]'::jsonb;

-- ---------------------------------------------------------------------------
-- A2. projects.product_types  (6 projects)
-- ---------------------------------------------------------------------------
-- ★ array_replace touches only the matching element and keeps position.
UPDATE public.projects
SET product_types = array_replace(product_types, 'Existing', 'Remodel')
WHERE 'Existing' = ANY(product_types);

-- ---------------------------------------------------------------------------
-- A3. projects.unit_types  (2 unit objects)
-- ---------------------------------------------------------------------------
-- ★★ UNIT ORDER IS MEANINGFUL — the rows render in array order and the editor
--   addresses them by index (UnitRow is keyed by index). `jsonb_agg(... ORDER BY
--   ord)` rebuilds the array in place; without it a rename would reorder
--   somebody's unit list.
-- ★ jsonb_set on the ONE key, so every other key on the unit object (width_ft,
--   parking_kind, …) survives untouched.
UPDATE public.projects p
SET unit_types = (
  SELECT jsonb_agg(
           CASE WHEN ut->>'label' = 'Existing'
                THEN jsonb_set(ut, '{label}', '"Remodel"'::jsonb)
                ELSE ut END
           ORDER BY ord)
  FROM jsonb_array_elements(p.unit_types) WITH ORDINALITY AS t(ut, ord)
)
WHERE jsonb_typeof(p.unit_types) = 'array'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.unit_types) e
        WHERE e->>'label' = 'Existing');

ALTER TABLE public.projects ENABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects ENABLE TRIGGER bp_log_user_activity;

-- ---------------------------------------------------------------------------
-- VERIFY — fail the migration rather than ship a half-rename
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_cfg_existing int; v_cfg_remodel int;
  v_proj_existing int; v_proj_remodel int;
  v_unit_existing int; v_unit_remodel int;
  v_other_types int;
BEGIN
  SELECT count(*) FILTER (WHERE value @> '["Existing"]'::jsonb),
         count(*) FILTER (WHERE value @> '["Remodel"]'::jsonb)
    INTO v_cfg_existing, v_cfg_remodel
    FROM public.app_config WHERE key = 'productTypeOptions';

  SELECT count(*) FILTER (WHERE 'Existing' = ANY(product_types)),
         count(*) FILTER (WHERE 'Remodel'  = ANY(product_types))
    INTO v_proj_existing, v_proj_remodel FROM public.projects;

  SELECT count(*) FILTER (WHERE ut->>'label' = 'Existing'),
         count(*) FILTER (WHERE ut->>'label' = 'Remodel')
    INTO v_unit_existing, v_unit_remodel
    FROM public.projects p,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(p.unit_types)='array' THEN p.unit_types
                ELSE '[]'::jsonb END) ut;

  -- ★ The registry must still hold the SAME NUMBER of options: a rename, not
  --   an add or a drop.
  SELECT jsonb_array_length(value) INTO v_other_types
    FROM public.app_config WHERE key = 'productTypeOptions';

  IF v_cfg_existing <> 0 OR v_cfg_remodel <> 1 THEN
    RAISE EXCEPTION 'fix-412: registry not renamed (existing=%, remodel=%)',
      v_cfg_existing, v_cfg_remodel;
  END IF;
  IF v_proj_existing <> 0 OR v_proj_remodel <> 6 THEN
    RAISE EXCEPTION 'fix-412: projects not renamed (existing=%, remodel=%)',
      v_proj_existing, v_proj_remodel;
  END IF;
  IF v_unit_existing <> 0 OR v_unit_remodel <> 2 THEN
    RAISE EXCEPTION 'fix-412: unit rows not renamed (existing=%, remodel=%)',
      v_unit_existing, v_unit_remodel;
  END IF;
  IF v_other_types <> 8 THEN
    RAISE EXCEPTION 'fix-412: registry length changed to % — a rename must not add or drop', v_other_types;
  END IF;
END
$mig$;
