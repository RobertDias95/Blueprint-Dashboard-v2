-- ===========================================================================
-- fix-488 §A (P-142) — LOT SIZE, AND "VARIES"
-- ===========================================================================
--
-- ★★★ BOBBY, 2026-09-02:
--
--   *"if I put width 100 and depth 100, lot size is 10,000 — quick math. But if
--    I put width 100 and lot size 10,000 and leave depth blank, that's because
--    the depth is irregular… in Seattle lots are regular, in other
--    jurisdictions there's a lot of multi-angled parcels… instead of Target it
--    would say Varies. What was that 9,000-square-foot lot in Kirkland?"*
--
-- ---------------------------------------------------------------------------
-- MEASURED ON PROD 2026-09-03, BEFORE THIS RAN
-- ---------------------------------------------------------------------------
--   projects                                  211
--   lot_width AND lot_depth both set          205
--   lot_width only / lot_depth only           0 / 0
--   neither                                   6
--   ★ NO `lot_size` COLUMN OF ANY SPELLING (the brief's claim, verified).
--
-- ★★★ SO THE "VARIES" CASE HAS ZERO OCCURRENCES TODAY, and that is the point
--     of the ticket rather than an argument against it: nobody can record an
--     irregular lot, so nobody has. The Kirkland lot Bobby is describing is
--     currently either absent or entered as a rectangle that is not one.
--
-- ---------------------------------------------------------------------------
-- ★★★ NO BACKFILL. NOTHING IS DERIVED AND WRITTEN.
-- ---------------------------------------------------------------------------
-- The brief is explicit and the reason is the whole feature: a stored
-- `width × depth` would be indistinguishable from a size somebody TYPED, and
-- the difference between those two is exactly what "varies" exists to express.
-- The app DISPLAYS the product where both dimensions exist; it never stores it.
--
-- ★ Hence no DEFAULT either — unlike fix-487's `construction_admin`, where a
--   column default was right because every project genuinely has the same
--   answer. Here the empty state is a real answer.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 — THE COLUMN
-- ---------------------------------------------------------------------------
-- ★★ INTEGER, not numeric. `lot_width`/`lot_depth` are numeric because they
--    were surveyed values with real halves (fix-411 measured 14 fractional
--    widths and 23 fractional depths). A lot SIZE is a whole number of square
--    feet in every document it is ever read off — Bobby's own examples are
--    "10,000" and "7,200" — and an integer column is what stops the display
--    layer having to decide how many decimals a square foot has.
alter table public.projects
  add column if not exists lot_size_sf integer;

comment on column public.projects.lot_size_sf is
  'fix-488 (P-142): the lot area in whole square feet, TYPED — never derived '
  'and never written from lot_width * lot_depth. When it is set and a '
  'dimension is blank, the blank dimension reads "varies" (an irregular '
  'parcel), which is the state this column exists to make expressible.';

-- ---------------------------------------------------------------------------
-- 2 — THE TWO ATOMIC RPCs LEARN THE COLUMN
-- ---------------------------------------------------------------------------
-- ★★ fix-410's FOUR-PLACE RULE, all four of them live this time: the column,
--    `bp_create_project_with_permits`, `bp_update_project_with_permits`, and
--    `useProjects`' explicit select list (in `src/`). Three fail SILENTLY —
--    the wizard would write nothing, the settings modal would drop the field,
--    and every read surface would render "not set" for ever.
--
-- ★★★ PATCHED BY ANCHOR, NEVER RETYPED, and the body goes back as a QUOTED
--     LITERAL rather than inside a $tag$ block: these are 15 KB and 12.9 KB of
--     live plpgsql carrying their own dollar-quoting, and a tag collision is a
--     silent truncation.
--
-- ★★★ AND THE SIGNATURE COMES FROM `pg_get_function_arguments`, NOT
--     `pg_get_function_identity_arguments`. The identity form STRIPS PARAMETER
--     DEFAULTS, and `bp_create_project_with_permits` has them — so a CREATE OR
--     REPLACE built from it is rejected outright with *"cannot remove parameter
--     defaults from existing function"*. It failed LOUDLY rather than silently,
--     which is the only reason this is a note and not a bug; fix-487 patched a
--     function that happens to have no defaults and never met it.
do $$
declare
  v_src  text;
  v_cols text;
  v_vals text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bp_create_project_with_permits';

  v_cols := '    go_date, units, zone, lot_width, lot_depth, unit_types,';
  v_vals := '    NULLIF(v_pd->>''lot_width'', '''')::numeric, NULLIF(v_pd->>''lot_depth'', '''')::numeric,';

  if position(v_cols in v_src) = 0 or position(v_vals in v_src) = 0 then
    raise exception 'fix-488: the lot_width anchors are not in bp_create_project_with_permits — refusing to guess';
  end if;

  if position('lot_size_sf' in v_src) > 0 then
    raise notice 'fix-488: bp_create_project_with_permits already knows lot_size_sf — skipping';
  else
    -- ★★★ THE COLUMN LIST AND THE VALUE LIST ARE POSITIONAL. Both anchors are
    --     replaced in ONE pass so the new name and the new value land at the
    --     same index; patching one and not the other would shift every column
    --     after it by one and write the unit_types array into `lot_depth`.
    execute
      'CREATE OR REPLACE FUNCTION public.bp_create_project_with_permits(' ||
      pg_get_function_arguments('public.bp_create_project_with_permits'::regproc) ||
      ') RETURNS ' || pg_get_function_result('public.bp_create_project_with_permits'::regproc) ||
      ' LANGUAGE plpgsql' ||
      (select case when p.prosecdef then ' SECURITY DEFINER' else '' end
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'bp_create_project_with_permits') ||
      ' SET search_path TO ''public'', ''pg_temp'' AS ' ||
      quote_literal(
        replace(
          replace(v_src, v_cols,
                  '    go_date, units, zone, lot_width, lot_depth, lot_size_sf, unit_types,'),
          v_vals,
          v_vals || E'\n' || '    NULLIF(v_pd->>''lot_size_sf'', '''')::int,'
        )
      );
  end if;
end $$;

do $$
declare
  v_src    text;
  v_anchor text;
  v_add    text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bp_update_project_with_permits';

  v_anchor := '        lot_depth        = CASE WHEN v_patch ? ''lot_depth''         THEN NULLIF(v_patch->>''lot_depth'','''')::numeric    ELSE lot_depth END,';
  v_add    := '        lot_size_sf      = CASE WHEN v_patch ? ''lot_size_sf''       THEN NULLIF(v_patch->>''lot_size_sf'','''')::int      ELSE lot_size_sf END,';

  if position(v_anchor in v_src) = 0 then
    raise exception 'fix-488: the lot_depth anchor is not in bp_update_project_with_permits — refusing to guess';
  end if;

  if position('lot_size_sf' in v_src) > 0 then
    raise notice 'fix-488: bp_update_project_with_permits already knows lot_size_sf — skipping';
  else
    execute
      'CREATE OR REPLACE FUNCTION public.bp_update_project_with_permits(' ||
      pg_get_function_arguments('public.bp_update_project_with_permits'::regproc) ||
      ') RETURNS ' || pg_get_function_result('public.bp_update_project_with_permits'::regproc) ||
      ' LANGUAGE plpgsql' ||
      (select case when p.prosecdef then ' SECURITY DEFINER' else '' end
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'bp_update_project_with_permits') ||
      ' SET search_path TO ''public'', ''pg_temp'' AS ' ||
      quote_literal(replace(v_src, v_anchor, v_anchor || E'\n' || v_add));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 — NOTHING FOR `unit_types[].size_sf`, DELIBERATELY
-- ---------------------------------------------------------------------------
-- ★★★ §B needs no migration at all. `projects.unit_types` is a jsonb array and
--     both RPCs pass it through WHOLESALE (`v_pd->'unit_types'`), so the
--     database has no opinion about which keys a unit row carries.
--
-- ★★ WHICH MEANS `parseUnitTypes` IS THE ONLY GATE, and it is a WHITELIST:
--    a key it does not name is DELETED from the row the next time anybody edits
--    any other field on that unit (fix-412 discovered it, fix-486 used it
--    deliberately to retire `work_scope`). Adding `size_sf` to that list is
--    what makes the field persist at all — there is nothing else to add it to.
--
-- ★ Measured 2026-09-03: 245 unit rows, and the distinct key set across all of
--   them is exactly `label, width_ft, depth_ft, qty, stories, parking_kind,
--   parking_stalls, roof_deck` — no stray `size_sf` from an earlier attempt.

-- ---------------------------------------------------------------------------
-- 4 — VERIFY
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects'
                    and column_name='lot_size_sf' and data_type='integer') then
    raise exception 'fix-488: projects.lot_size_sf is missing or not an integer';
  end if;

  -- ★ NOTHING was written. The whole point of "no backfill".
  select count(*) into v_n from public.projects where lot_size_sf is not null;
  if v_n <> 0 then
    raise exception 'fix-488: % projects already carry a lot_size_sf — this migration writes none', v_n;
  end if;

  for v_n in
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('bp_create_project_with_permits', 'bp_update_project_with_permits')
       and p.prosrc not like '%lot_size_sf%'
  loop
    raise exception 'fix-488: an atomic project RPC did not take the patch';
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- ★ VERIFIED AFTER COMMIT, 2026-09-03 — measured, not predicted
-- ---------------------------------------------------------------------------
--   projects.lot_size_sf         integer, DEFAULT none
--   rows carrying a value        0 of 211  (the whole point of "no backfill")
--   bp_update_project_with_permits   patched, the SET line sits directly after
--                                    lot_depth's
--   bp_create_project_with_permits   patched — and the risky half VERIFIED:
--
--     ★★★ THE INSERT'S COLUMN LIST AND VALUE LIST ARE POSITIONAL, and patching
--         one without the other would have shifted every column after it by one
--         and written the `unit_types` jsonb array into `lot_depth` on every new
--         project. Counted against the LIVE function text after the run:
--         **37 columns, 37 top-level values**, `lot_size_sf` present in both,
--         each sitting between `lot_depth` and `unit_types`.
--
--   ★ A direct rolled-back RPC probe was attempted and correctly REFUSED —
--     `bp_update_project_with_permits` raises "tenant not in caller scope"
--     because the MCP connection carries no JWT and `auth_tenant_ids()` is
--     empty. That guard working is itself worth recording; the structural
--     verification above is what stands in its place.
