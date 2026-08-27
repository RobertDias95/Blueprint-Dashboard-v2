-- ===========================================================================
-- ★★★ fix-425 — THE BUILDER CATALOG EXISTS AND NOTHING LINKS TO IT
-- ===========================================================================
--
-- Measured on prod, 2026-08-28, before anything was written:
--
--   202 projects · 147 with a builder company recorded
--    33 linked via builder_id — and ALL 33 were created 2026-05-01, the
--       initial import. Nothing has linked a project since.
--   115 with typed builder text and no link
--   114 of those 115 match an existing builders row EXACTLY on
--       lower(btrim(company)). One does not.
--    59 catalog rows, all active — the catalog is real and is being fed.
--
-- So this is not a data-quality problem and not a missing feature. The
-- registry, the FK, the hooks, the autocomplete and the fill handler all
-- exist. What never happens is the LINK.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY BOTH RPCs ALREADY DO 95% OF THIS
-- ---------------------------------------------------------------------------
--
-- fix-174 moved catalog creation server-side into these two functions on
-- purpose, and the block it added is already exactly right:
--
--     IF COALESCE(TRIM(… ->>'builder_name'), '') <> '' THEN
--       INSERT INTO public.builders (…)
--       ON CONFLICT (name, company) DO UPDATE
--         SET address = COALESCE(EXCLUDED.address, public.builders.address);
--     END IF;
--
-- It resolves-or-creates the catalog row and then throws the id away. This
-- migration keeps the id: `RETURNING id INTO v_builder_id`, then one UPDATE.
--
-- ★★ IT DOES NOT WIDEN WHEN A ROW IS CREATED, and that is the whole
-- constraint. fix-24b promoted a builder whenever any patch carried a name;
-- the Project Overview Builder/Owner cell commits on blur, so partial names
-- ("boy", "stas") were promoted on every intermediate keystroke-pause.
-- fix-174 reverted that. Catalog entry stays exactly where fix-174 put it —
-- an explicit, complete commit through one of these two functions. The link
-- is added at that same moment and nowhere else.
--
-- ★★★ AND CLEARING IS HANDLED SEPARATELY FROM NOT-MENTIONING. The `ELSIF …
-- ? 'builder_name'` branch is the difference between "this save cleared the
-- builder" (clear the link, never leave it dangling at a builder the project
-- no longer names) and "this save was about something else entirely" (leave
-- the link exactly as it was). A patch that never mentions the builder must
-- not touch builder_id — most saves are that.
--
-- ---------------------------------------------------------------------------
-- ★★★ PATCHED BY ANCHOR, NEVER RETYPED
-- ---------------------------------------------------------------------------
--
-- migrations/ is partial and prod is ahead of it (both functions have been
-- re-defined by fix-91/96/107/141/143/144/153/158/163/175/208/210/216b/222/
-- 244 and fix-382 since). Retyping 15KB of live PL/pgSQL to add four lines is
-- how a fix silently reverts fourteen others. So this reads
-- `pg_get_functiondef` off the live catalog, asserts each anchor appears
-- EXACTLY ONCE, substitutes, and EXECUTEs the result.
--
-- ★ Idempotent: if the definition already mentions builder_id, it stops.
-- ★ Fails loudly: a missing or duplicated anchor raises rather than silently
--   patching the wrong place or nothing at all.
-- ===========================================================================

DO $fix425$
DECLARE
  v_def   text;
  v_old   text;
  v_new   text;
  v_n     integer;

  -- ★ A tiny local helper would be nicer, but a DO block cannot declare one.
  --   The count-and-assert is inlined for each anchor instead.
BEGIN
  -- =========================================================================
  -- 1. bp_create_project_with_permits
  -- =========================================================================
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_create_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-425: bp_create_project_with_permits not found';
  END IF;

  IF position('builder_id' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-425: bp_create_project_with_permits already links; skipping';
  ELSE
    -- ---- 1a. declare the variable -----------------------------------------
    v_old := '  v_primary_dd_end   date;' || E'\n';
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-425: create/declare anchor found % times, expected 1', v_n;
    END IF;
    v_def := replace(
      v_def,
      v_old,
      v_old || '  v_builder_id    uuid;' || E'\n'
    );

    -- ---- 1b. keep the catalog row's id and link the project ----------------
    v_old :=
      '    ON CONFLICT (name, company) DO UPDATE' || E'\n' ||
      '      SET address = COALESCE(EXCLUDED.address, public.builders.address);' || E'\n' ||
      '  END IF;';
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-425: create/upsert anchor found % times, expected 1', v_n;
    END IF;
    v_new :=
      '    ON CONFLICT (name, company) DO UPDATE' || E'\n' ||
      '      SET address = COALESCE(EXCLUDED.address, public.builders.address)' || E'\n' ||
      '    RETURNING id INTO v_builder_id;' || E'\n' ||
      '    -- fix-425: the catalog row we just resolved or created IS this' || E'\n' ||
      '    -- project''s builder. DO UPDATE (not DO NOTHING) always returns a' || E'\n' ||
      '    -- row, so v_builder_id is set on both the insert and the conflict' || E'\n' ||
      '    -- path. Nothing about WHEN a catalog row is created changes here.' || E'\n' ||
      '    UPDATE public.projects SET builder_id = v_builder_id' || E'\n' ||
      '     WHERE id = v_project_id;' || E'\n' ||
      '  END IF;';
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
    RAISE NOTICE 'fix-425: bp_create_project_with_permits patched';
  END IF;

  -- =========================================================================
  -- 2. bp_update_project_with_permits
  -- =========================================================================
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_update_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-425: bp_update_project_with_permits not found';
  END IF;

  IF position('builder_id' IN v_def) > 0 THEN
    RAISE NOTICE 'fix-425: bp_update_project_with_permits already links; skipping';
  ELSE
    -- ---- 2a. declare the variable -----------------------------------------
    v_old := '  v_product_types text[];' || E'\n';
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-425: update/declare anchor found % times, expected 1', v_n;
    END IF;
    v_def := replace(
      v_def,
      v_old,
      v_old || '  v_builder_id   uuid;' || E'\n'
    );

    -- ---- 2b. link on save, clear on an explicit clear ----------------------
    --
    -- ★★ THE EXTRA UPDATE IS SAFE FOR OCC, AND THAT WAS CHECKED. fix-382
    --    reads the project's FINAL updated_at at the very end of the function
    --    ("SELECT updated_at INTO v_proj_ua … " after the permit rollup), so a
    --    write here is picked up by the token handed back to the client. The
    --    OCC guard itself has already passed by this point and the whole block
    --    is inside the subtransaction that rolls back on 'occ_conflict', so a
    --    losing save creates no catalog row and writes no link.
    v_old :=
      '        ON CONFLICT (name, company) DO UPDATE' || E'\n' ||
      '          SET address = COALESCE(EXCLUDED.address, public.builders.address);' || E'\n' ||
      '      END IF;';
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'fix-425: update/upsert anchor found % times, expected 1', v_n;
    END IF;
    v_new :=
      '        ON CONFLICT (name, company) DO UPDATE' || E'\n' ||
      '          SET address = COALESCE(EXCLUDED.address, public.builders.address)' || E'\n' ||
      '        RETURNING id INTO v_builder_id;' || E'\n' ||
      '        UPDATE public.projects SET builder_id = v_builder_id' || E'\n' ||
      '         WHERE id = p_project_id;' || E'\n' ||
      '      ELSIF v_patch ? ''builder_name'' THEN' || E'\n' ||
      '        -- fix-425: an EXPLICIT clear. The three states are different:' || E'\n' ||
      '        -- a name was given (link it), the name was cleared (drop the' || E'\n' ||
      '        -- link rather than leave it pointing at a builder this project' || E'\n' ||
      '        -- no longer names), or the patch never mentioned the builder at' || E'\n' ||
      '        -- all (leave it alone — most saves are that).' || E'\n' ||
      '        UPDATE public.projects SET builder_id = NULL' || E'\n' ||
      '         WHERE id = p_project_id;' || E'\n' ||
      '      END IF;';
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
    RAISE NOTICE 'fix-425: bp_update_project_with_permits patched';
  END IF;
END
$fix425$;

-- ===========================================================================
-- Verification (read-only; run after applying)
-- ===========================================================================
--   select p.proname,
--          pg_get_functiondef(p.oid) like '%builder_id%' as links_now
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public'
--     and p.proname in ('bp_create_project_with_permits',
--                       'bp_update_project_with_permits');
