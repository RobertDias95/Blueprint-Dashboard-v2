-- ===========================================================================
-- fix-523 §C (P-237) — A PROJECT WITH DD DATES ALWAYS GETS A BLOCK
-- ===========================================================================
--
-- ⚠️  NOT APPLIED. Cowork applies migrations. Copied to
--     Brain/briefs/migrations/ for that.
--
-- Ruled 2026-09-10: DD dates mint a `draw_schedule` row, NO DA NEEDED.
--
-- ★★★ THE CAUSE, and it is exactly what fix-521 §A described: the block
--     insert at the end of `bp_create_project_with_permits` is THREE BRANCHES
--     AND NO `ELSE`.
--
--       IF    p_redesign_dd_phase IS NOT NULL      → insert, DA from the phase
--       ELSIF v_auto_placed                        → insert, needs v_lead_da
--       ELSIF v_manual_dd_start IS NOT NULL
--         AND v_manual_dd_end   IS NOT NULL
--         AND v_lead_da         IS NOT NULL        → insert
--       (no ELSE)                                  → NOTHING
--
--     So a project created with DD dates typed in and no lead DA chosen falls
--     off the end and gets no row at all. This deletes the `v_lead_da` clause
--     from the third branch, which turns it into the fourth: the same INSERT
--     runs, `da_assigned` takes `v_lead_da` and is therefore NULL, and the
--     board renders an unassigned block — a state it already draws.
--
-- ★★★ FALLING BACK TO THE PERMIT'S DA WAS REJECTED, AND THE REASON MATTERS: a
--     project with permits under two DAs would land in whichever column the
--     query returned first, with nothing on the block saying it was inferred.
--     **An unassigned block is honest; a wrongly-assigned one is not.**
--
-- ★★ THE EDIT PATH ALREADY DOES THIS AND HAS ALL ALONG. `bp_set_bp_dd_dates`
--    ends with `IF v_ds_updated_at IS NULL THEN INSERT … SELECT … p.da …` with
--    no guard on the DA at all, so setting DD dates on an EXISTING project has
--    always minted a row, unassigned if need be. The gap is creation only,
--    which is why the population is small and forward-only.
--
-- ★ MEASURED ON PROD 2026-09-11, before the change:
--     207 projects carry DD dates on a permit
--       0 of them have no `draw_schedule` row
--     220 draw_schedule rows for 220 projects  (every project has one)
--       0 rows with a null/blank `da_assigned`
--       0 rows with a null week
--   fix-521 §A's visibility invariant is holding; **that is the invariant
--   holding, not the cause being fixed.** This is the cause.
--
-- ★★★ PATCHED BY ANCHOR, NEVER RETYPED. `migrations/` is partial and prod is
--     ahead of it (bp_create_project_with_permits is ~15 kB and this repo has
--     no current copy), so the function text comes from the live
--     `pg_get_functiondef` and exactly one clause is removed from it. Retyping
--     the body would silently revert whatever else has landed on it.
-- ===========================================================================

do $mig$
declare
  v_src  text;
  v_new  text;
  v_hits int;
  c_anchor constant text :=
    'v_manual_dd_start IS NOT NULL AND v_manual_dd_end IS NOT NULL AND v_lead_da IS NOT NULL THEN';
  c_fixed  constant text :=
    'v_manual_dd_start IS NOT NULL AND v_manual_dd_end IS NOT NULL THEN';
begin
  select pg_get_functiondef(p.oid)
    into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'bp_create_project_with_permits';

  if v_src is null then
    raise exception 'fix-523 §C: bp_create_project_with_permits not found';
  end if;

  -- ★ Count first. A zero means somebody has already changed the clause (or
  --   this has run before); a two means the anchor is not unique and a blind
  --   replace would edit something it was not aimed at. Both are stop
  --   conditions, and neither is visible if you just call `replace`.
  v_hits := (length(v_src) - length(replace(v_src, c_anchor, ''))) / length(c_anchor);
  if v_hits <> 1 then
    raise exception
      'fix-523 §C: expected exactly 1 occurrence of the lead_da guard, found %', v_hits;
  end if;

  v_new := replace(v_src, c_anchor, c_fixed);
  execute v_new;

  -- ★★ AND ASSERT THE RESULT, rather than trusting that the statement
  --    succeeded. §0 of this ticket's brief is the whole reason: the first
  --    apply of fix_523_plan_share_links ran `revoke … from anon`, reported
  --    `{"success": true}`, and left the grant in place, because `anon`
  --    inherits from `PUBLIC`. **A statement that succeeds is not a statement
  --    that did something.**
  select pg_get_functiondef(p.oid)
    into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'bp_create_project_with_permits';

  if position(c_anchor in v_src) > 0 then
    raise exception 'fix-523 §C: the lead_da guard is still there after the replace';
  end if;
  if position(c_fixed in v_src) = 0 then
    raise exception 'fix-523 §C: the fourth branch is not in the installed body';
  end if;

  raise notice 'fix-523 §C: DD dates now mint a block with no DA required.';
end
$mig$;

-- ---------------------------------------------------------------------------
-- Verify (run after applying)
-- ---------------------------------------------------------------------------
--
--   select position('AND v_lead_da IS NOT NULL THEN' in prosrc) = 0 as fixed
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'bp_create_project_with_permits';
--
-- ★ NO BACKFILL. The population is 0 today and this is forward-only: it changes
--   what happens the next time somebody creates a project with DD dates and no
--   lead DA. There is nothing to repair behind it.
