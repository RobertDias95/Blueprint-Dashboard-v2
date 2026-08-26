-- ===========================================================================
-- fix-410 — "Regular shape" on the site information
-- ===========================================================================
--
-- APPLIED TO PROD 2026-08-26 via apply_migration (name: fix_410_is_regular_shape).
-- This file is the record; the database is the source of truth.
--
-- Bobby, 2026-08-26 (register P-040): a yes/no site field — is the lot a
-- regular rectangle (equal widths, equal lengths) or irregular? It belongs in
-- the Site step of setup, the Site section of the project overview, and the
-- Library (column + filter). "default should be yes, the other option is no."
--
-- ---------------------------------------------------------------------------
-- ★★★ THE TRAP, VERIFIED ON PROD BEFORE WRITING A LINE
-- ---------------------------------------------------------------------------
--
-- `bp_create_project_with_permits` has an EXPLICIT `INSERT INTO projects (…)`
-- column list. A key in p_project_data that the list does not name is SILENTLY
-- DROPPED: the UI says "saved", the row does not change, nothing errors. The
-- same is true of `bp_update_project_with_permits`, whose every column is
-- `col = CASE WHEN v_patch ? 'col' THEN … ELSE col END`.
--
-- Both were confirmed by reading pg_get_functiondef() on 2026-08-26, and both
-- learn the key below — otherwise the whole feature is a no-op.
--
-- ★★ ONE CORRECTION TO THE BRIEF, FOUND WHILE VERIFYING. `is_corner_lot`,
-- `num_lots` and `closing_date` are NOT in the UPDATE RPC's SET list and never
-- were. The Project Overview Site section does not save through that function —
-- it uses a direct PostgREST table UPDATE with row-level OCC
-- (hooks/useUpdateProject). The RPC serves the Project SETTINGS MODAL, which
-- edits a different subset of columns. `is_regular_shape` is added to the RPC
-- anyway: it costs nothing (the `?` guard means an absent key leaves the column
-- alone) and it means the field cannot become a silent no-op if it is ever
-- added to that modal.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY THE TWO FUNCTION BLOCKS PATCH THE LIVE TEXT INSTEAD OF RETYPING IT
-- ---------------------------------------------------------------------------
--
-- migrations/ is partial and prod is ahead of it, so pasting a full
-- CREATE OR REPLACE from a file risks silently REVERTING whatever shipped since.
-- Each block below reads pg_get_functiondef(), does an EXACT substring replace,
-- and RAISES if the anchor is not present exactly once — so a drifted function
-- fails loudly instead of being overwritten. Everything else, including
-- SECURITY DEFINER and the search_path, is preserved byte-for-byte.

-- ---------------------------------------------------------------------------
-- 1. the column
-- ---------------------------------------------------------------------------
-- ★★ NULLABLE, AND NO COLUMN DEFAULT. A DDL default would rewrite every
-- existing row into a claim as a side effect of DDL. The FORM carries the
-- "default Yes"; the column does not — so a create path that omits the key
-- records "not answered" rather than asserting a shape nobody looked at.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_regular_shape boolean;

COMMENT ON COLUMN public.projects.is_regular_shape IS
  'fix-410 (P-040): is the lot a regular rectangle — equal widths, equal '
  'lengths? NULL = nobody has said. Nullable with NO column default on '
  'purpose: the FORM carries the "default Yes", the column does not, so a '
  'create path that omits the key records "not answered" rather than a claim.';

-- ---------------------------------------------------------------------------
-- 2. bp_create_project_with_permits — the INSERT column list + VALUES
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def  text;
  v_new  text;
  c_cols_old CONSTANT text := E'    num_lots, is_corner_lot, closing_date,\n';
  c_cols_new CONSTANT text := E'    num_lots, is_corner_lot, is_regular_shape, closing_date,\n';
  c_vals_old CONSTANT text :=
    E'    CASE WHEN v_pd ? ''is_corner_lot'' THEN (v_pd->>''is_corner_lot'')::boolean ELSE NULL END,\n'
    || E'    NULLIF(v_pd->>''closing_date'', '''')::date,\n';
  c_vals_new CONSTANT text :=
    E'    CASE WHEN v_pd ? ''is_corner_lot'' THEN (v_pd->>''is_corner_lot'')::boolean ELSE NULL END,\n'
    || E'    CASE WHEN v_pd ? ''is_regular_shape'' THEN (v_pd->>''is_regular_shape'')::boolean ELSE NULL END,\n'
    || E'    NULLIF(v_pd->>''closing_date'', '''')::date,\n';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_create_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-410: bp_create_project_with_permits not found';
  END IF;
  IF position('is_regular_shape' in v_def) > 0 THEN
    RAISE NOTICE 'fix-410: create RPC already knows is_regular_shape — skipping';
    RETURN;
  END IF;

  -- ★ Exactly one occurrence of each anchor, asserted before the replace.
  IF (length(v_def) - length(replace(v_def, c_cols_old, ''))) / length(c_cols_old) <> 1 THEN
    RAISE EXCEPTION 'fix-410: create RPC column-list anchor not found exactly once';
  END IF;
  IF (length(v_def) - length(replace(v_def, c_vals_old, ''))) / length(c_vals_old) <> 1 THEN
    RAISE EXCEPTION 'fix-410: create RPC VALUES anchor not found exactly once';
  END IF;

  v_new := replace(replace(v_def, c_cols_old, c_cols_new), c_vals_old, c_vals_new);

  -- ★ The column list and the VALUES list must BOTH have grown; a patch that
  --   added to one and not the other would fail at runtime, not here.
  IF position('is_regular_shape, closing_date' in v_new) = 0
     OR position('v_pd ? ''is_regular_shape''' in v_new) = 0 THEN
    RAISE EXCEPTION 'fix-410: create RPC patch did not take';
  END IF;

  EXECUTE v_new;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3. bp_update_project_with_permits — the guarded SET line
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text;
  v_new text;
  c_old CONSTANT text :=
    E'        is_backfill      = CASE WHEN v_patch ? ''is_backfill''       THEN (v_patch->>''is_backfill'')::boolean       ELSE is_backfill END\n';
  c_new CONSTANT text :=
    E'        is_regular_shape = CASE WHEN v_patch ? ''is_regular_shape''  THEN (v_patch->>''is_regular_shape'')::boolean  ELSE is_regular_shape END,\n'
    || E'        is_backfill      = CASE WHEN v_patch ? ''is_backfill''       THEN (v_patch->>''is_backfill'')::boolean       ELSE is_backfill END\n';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_update_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-410: bp_update_project_with_permits not found';
  END IF;
  IF position('is_regular_shape' in v_def) > 0 THEN
    RAISE NOTICE 'fix-410: update RPC already knows is_regular_shape — skipping';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fix-410: update RPC is_backfill anchor not found exactly once';
  END IF;

  v_new := replace(v_def, c_old, c_new);
  IF position('v_patch ? ''is_regular_shape''' in v_new) = 0 THEN
    RAISE EXCEPTION 'fix-410: update RPC patch did not take';
  END IF;

  EXECUTE v_new;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. THE BACKFILL — approved by Bobby, 2026-08-26
-- ---------------------------------------------------------------------------
-- "set every existing project to Regular." The only data write in this
-- migration. 193 rows at the time of writing.
--
-- ★★★ TWO TRIGGERS ARE SUPPRESSED FOR IT, AND BOTH FOR A STATED REASON:
--
--   projects_set_updated_at — BEFORE UPDATE, bumps the OCC token. Letting it
--     fire would (a) tell every client with the app open that all 193 projects
--     were "modified by someone else" — fix-341's exact false alarm, which is
--     defined there as "a bulk write bumping sibling updated_at" — and
--     (b) permanently claim every project was edited on the migration date.
--     `updated_at` means "when a person last changed this"; a schema backfill
--     is not that, and several surfaces read it as if it were.
--
--   bp_log_user_activity — AFTER UPDATE, writes an activity row per project.
--     193 rows of "a project changed" would bury a day of real scraper
--     activity in the feed.
--
-- ★ ALTER TABLE takes ACCESS EXCLUSIVE, so a concurrent writer WAITS rather
--   than slipping through while the triggers are off. Both are re-enabled in
--   the same transaction, so a failure anywhere rolls the whole thing back —
--   there is no state in which the app runs with them disabled.
--
-- ★ VERIFIED AFTER APPLYING: 193 rows written, all true, 0 false, 0 null,
--   grouped by `juris` (a dimension the UPDATE did not filter on):
--     Seattle 162 · Kirkland 17 · Edmonds 5 · Scottsdale 3 · Bellevue 2 ·
--     Phoenix 2 · Redmond 2.
--   And `updated_at::date = current_date` stayed at 4 rows — the four projects
--   people actually edited today — proving the token suppression worked.
ALTER TABLE public.projects DISABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects DISABLE TRIGGER bp_log_user_activity;

UPDATE public.projects SET is_regular_shape = true WHERE is_regular_shape IS NULL;

ALTER TABLE public.projects ENABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects ENABLE TRIGGER bp_log_user_activity;

-- ★ Fail the migration rather than ship a half-backfilled table.
DO $mig$
DECLARE v_null int; v_false int;
BEGIN
  SELECT count(*) FILTER (WHERE is_regular_shape IS NULL),
         count(*) FILTER (WHERE is_regular_shape IS FALSE)
    INTO v_null, v_false FROM public.projects;
  IF v_null <> 0 THEN
    RAISE EXCEPTION 'fix-410: backfill left % NULL rows', v_null;
  END IF;
  IF v_false <> 0 THEN
    RAISE EXCEPTION 'fix-410: % rows read false — nobody has flagged one yet', v_false;
  END IF;
END
$mig$;
