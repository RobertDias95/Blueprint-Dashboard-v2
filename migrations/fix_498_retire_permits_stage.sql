-- ===========================================================================
-- fix-498 (P-025) — retire `permits.stage`
-- ===========================================================================
--
-- Ruling (Bobby, 2026-09-04): *"Remove Stage from the builder and retire the
-- column."*
--
-- ★★★ WHY. A permit's stage is DERIVED — `effectiveStage(permit, cycles,
--     reviewers)` in src/lib/permitStage.ts. The stored column was seeded 'de'
--     at insert and then never maintained: no trigger, no scraper write, no
--     backfill. On prod 2026-09-04, 667 permits read de 583 / is 38 / pm 32 /
--     ap 10 / co 4, and **342 of 406 ISSUED permits still said 'de'**. Every
--     surface that derived the stage was right; the three that read the column
--     were wrong, and had been for as long as the column existed.
--
-- ★★★ THE THIRD READER, WHICH THE FIRST BRIEF MISSED. Besides the two client
--     readers (csvExport.ts, reportMetrics.ts — fixed in the same PR), the
--     Report Builder catalog published `stage` as a selectable, filterable
--     column. `_report_build_and_run` → `_report_col_sql('permits','stage')`
--     → literally `p.stage`, straight into the generated SQL.
--
-- ★★★ AND THE CATALOG HAS NO EXPRESSION ESCAPE HATCH. `_report_col_sql` can
--     only ever return `alias || '.' || col`, and it rejects anything that is
--     not `^[a-z_][a-z0-9_]*$`. So a catalog key MUST be a literal column.
--     There was no way to point that column at the derived stage — hence the
--     ruling: it leaves the catalog rather than being repaired in place.
--     Checked every row of `saved_reports` first: **0 reports** select, filter
--     or sort on `stage`, so nothing existing breaks.
--
-- ★★ PATCHED BY ANCHOR ON `pg_get_functiondef`, NEVER RETYPED. migrations/ is
--    partial and prod is ahead of it, so the live body is the canon. Each
--    patch below asserts its anchor appears EXACTLY ONCE and re-executes the
--    whole functiondef — which carries its own dollar-quoting, its RETURNS,
--    its volatility, its SET search_path and (fix-488's trap) its parameter
--    DEFAULTS, none of which we then have to reproduce by hand.
--
-- ★ `stage_override` is a DIFFERENT column and STAYS — computeStage honours
--   it. `permit_tasks.stage` (fix-79's phase mirror) is a different column on
--   a different table and is untouched.
--
-- ★ NOT PATCHED, DELIBERATELY: `public.migrate_to_relational()` also writes
--   permits.stage. It is the one-shot v1-JSON → v2-relational importer; it
--   already ran, the blob it reads no longer exists, and nothing in either
--   repo calls it. Editing dead code to keep a dead path plausible is worse
--   than leaving the record honest. (`migrate_auxiliary`'s `stage` mentions
--   are `task_t->>'stage'` — the task bucket, not this column.)
--
-- ===========================================================================

DO $mig$
DECLARE
  v_def  text;
  v_hits int;

  -- assert-and-replace: the anchor must appear exactly once, or we stop.
  v_note text := 'anchor must match the live body exactly';
BEGIN
  -- -------------------------------------------------------------------------
  -- §B.1 — "Stage" leaves the Report Builder catalog
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_get_report_builder_catalog';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-498: bp_get_report_builder_catalog not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def,
    E'        _rbcol(''stage'',''Stage'',''text'',true,''direct''),\n', '')))
    / length(E'        _rbcol(''stage'',''Stage'',''text'',true,''direct''),\n');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §B.1: catalog stage anchor found % times (want 1) — %',
      v_hits, v_note;
  END IF;

  v_def := replace(v_def,
    E'        _rbcol(''stage'',''Stage'',''text'',true,''direct''),\n', '');
  EXECUTE v_def;

  -- -------------------------------------------------------------------------
  -- §B.2 — the runner NAMES the missing column instead of hiding it
  --
  -- ★★★ THIS IS THE LINE THAT WOULD HAVE HIDDEN P-025's SUCCESSOR. Every SQL
  --     failure inside the generated report collapsed into the bare string
  --     'report execution failed' — no column, no table, nothing to chase. A
  --     spec whose column left the catalog is already caught earlier and by
  --     name (`_report_validate_spec` raises 'unknown column "%" for entity
  --     %'); this arm covers the residual case where a spec validates and the
  --     SQL still cannot resolve a column. SQLERRM for undefined_column is
  --     'column p.stage does not exist' — an alias and a catalog key the user
  --     chose, so naming it leaks nothing the builder did not already show.
  --     Every other failure keeps the deliberately generic message.
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_report_build_and_run';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-498: _report_build_and_run not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def,
    E'  EXCEPTION WHEN OTHERS THEN\n    RAISE EXCEPTION ''report execution failed'';\n', '')))
    / length(E'  EXCEPTION WHEN OTHERS THEN\n    RAISE EXCEPTION ''report execution failed'';\n');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §B.2: runner anchor found % times (want 1)', v_hits;
  END IF;

  v_def := replace(v_def,
    E'  EXCEPTION WHEN OTHERS THEN\n    RAISE EXCEPTION ''report execution failed'';\n',
    E'  EXCEPTION\n'
    || E'    WHEN undefined_column THEN\n'
    || E'      RAISE EXCEPTION ''report refers to a column that no longer exists (%)'', SQLERRM\n'
    || E'        USING HINT = ''Edit the report, remove that column, and save it again.'';\n'
    || E'    WHEN OTHERS THEN\n'
    || E'      RAISE EXCEPTION ''report execution failed'';\n');
  EXECUTE v_def;

  -- -------------------------------------------------------------------------
  -- §C.1 — bp_insert_permit stops writing stage
  --
  -- ★★★ A POSITIONAL INSERT: the column list and the VALUES list must both be
  --     patched, in one pass, or every column after `stage` shifts by one and
  --     the permit gets its stage_override written into its status. Two
  --     anchors, both asserted.
  -- ★★ This writer is `EXECUTE`-granted to service_role as well as
  --    authenticated, so it is reachable from the scraper, not just the app.
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_insert_permit';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-498: bp_insert_permit not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, E'    stage, stage_override, status,\n', '')))
          / length(E'    stage, stage_override, status,\n');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.1a: column-list anchor found % times (want 1)', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, E'    COALESCE(p_data->>''stage'', ''de''),\n', '')))
          / length(E'    COALESCE(p_data->>''stage'', ''de''),\n');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.1b: values-list anchor found % times (want 1)', v_hits;
  END IF;

  v_def := replace(v_def, E'    stage, stage_override, status,\n',
                          E'    stage_override, status,\n');
  v_def := replace(v_def, E'    COALESCE(p_data->>''stage'', ''de''),\n', '');
  EXECUTE v_def;

  -- -------------------------------------------------------------------------
  -- §C.2 — bp_create_project_with_permits stops writing stage
  -- (positional again: the list at the top, the literal 'de' in VALUES)
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_create_project_with_permits';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-498: bp_create_project_with_permits not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'kickoff_date, stage, status, notes', '')))
          / length('kickoff_date, stage, status, notes');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.2a: column-list anchor found % times (want 1)', v_hits;
  END IF;
  -- ★ The VALUES anchor deliberately stops BEFORE 'Pre-Submittal — GO': that
  --   string carries an em dash, and an anchor is only as reliable as its
  --   encoding survives.
  v_hits := (length(v_def) - length(replace(v_def, E'''kickoff_date'', '''')::date, ''de'', ', '')))
          / length(E'''kickoff_date'', '''')::date, ''de'', ');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.2b: values-list anchor found % times (want 1)', v_hits;
  END IF;

  v_def := replace(v_def, 'kickoff_date, stage, status, notes',
                          'kickoff_date, status, notes');
  v_def := replace(v_def, E'''kickoff_date'', '''')::date, ''de'', ',
                          E'''kickoff_date'', '''')::date, ');
  EXECUTE v_def;

  -- -------------------------------------------------------------------------
  -- §C.3 — bp_update_project_with_permits stops writing stage
  -- (its new-permit branch only; the existing-permit UPDATE never touched it)
  -- -------------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_update_project_with_permits';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-498: bp_update_project_with_permits not found';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, 'target_submit, stage, status', '')))
          / length('target_submit, stage, status');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.3a: column-list anchor found % times (want 1)', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, E'::date,\n          ''de'', ''Pre-Submittal', '')))
          / length(E'::date,\n          ''de'', ''Pre-Submittal');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fix-498 §C.3b: values-list anchor found % times (want 1)', v_hits;
  END IF;

  v_def := replace(v_def, 'target_submit, stage, status',
                          'target_submit, status');
  v_def := replace(v_def, E'::date,\n          ''de'', ''Pre-Submittal',
                          E'::date,\n          ''Pre-Submittal');
  EXECUTE v_def;
END;
$mig$;

-- ---------------------------------------------------------------------------
-- §C.4 — no writer is left. Prove it before dropping anything.
-- ---------------------------------------------------------------------------
DO $chk$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('bp_insert_permit', 'bp_create_project_with_permits',
                      'bp_update_project_with_permits',
                      'bp_get_report_builder_catalog')
    AND p.prosrc ~ '(^|[^_a-z])stage([^_a-z]|$)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'fix-498: these still mention a bare `stage`: %', v_bad;
  END IF;
END;
$chk$;

-- ---------------------------------------------------------------------------
-- §D — the column goes.
--
-- ★ `permits_stage_idx` and the `'de'` default go with it automatically; they
--   are the ONLY hard dependencies (checked pg_depend on the attribute — no
--   view, no matview, no constraint, no generated column), which is why this
--   is a plain DROP and not a CASCADE.
-- ★ No trigger suppression is needed: DROP COLUMN is a catalog change, so no
--   row triggers fire and no `updated_at` moves.
-- ---------------------------------------------------------------------------
ALTER TABLE public.permits DROP COLUMN stage;
