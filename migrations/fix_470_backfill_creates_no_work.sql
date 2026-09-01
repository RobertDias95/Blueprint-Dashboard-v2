-- ===========================================================================
-- fix-470 §1 (P-110) — A BACKFILLED PROJECT MINTS NO LIFECYCLE TASKS
-- ===========================================================================
--
-- ★★★ THIS MIGRATION WRITES NO ROWS. It changes one function. There is no
-- INSERT, no UPDATE and no DELETE of existing data anywhere in this file — see
-- "FORWARD-ONLY" below, which is Bobby's explicit ruling and not an omission.
--
-- ---------------------------------------------------------------------------
-- WHY, AND THE CLOCK
-- ---------------------------------------------------------------------------
-- Bobby, 2026-08-31: *"in the add new project, at the very top, backfill
-- historical project, when checking this, we dont want tasks or milestones
-- created."*
--
-- He is about to enter a year of 2024 projects by hand. MEASURED ON PROD
-- 2026-09-01, before anything was written:
--
--   projects with is_backfill = true          16   (0 false, 186 NULL)
--   permits on them                           41
--   permit_tasks on them                      44
--   ...of which auto-generated                44   ← every single one
--   ...created by a person                     0
--
-- ~2.75 auto-tasks per backfilled project, so a forty-project backfill mints
-- roughly 110 tasks onto live boards that somebody then closes by hand. Which
-- is exactly what happened: all 44 have since been closed by hand.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE CHOKEPOINT — CONFIRMED AGAINST LIVE pg_proc, NOT AGAINST THE REPO
-- ---------------------------------------------------------------------------
-- Every lifecycle auto-task is minted by ONE function, and it has exactly
-- three callers:
--
--   bp_generate_city_chase_tasks
--   bp_generate_number_entry_tasks
--   bp_permit_results_ready_autotask
--
-- ★★ ALL THREE ARE UNCHANGED BY THIS FILE. One chokepoint cannot drift; three
-- copies of a rule can, and this rule already drifted once — fix-395 wrote
-- `AND COALESCE(pr.is_backfill, false) = false` into the chase generator's own
-- query and it was never applied to the other two. The guard below makes that
-- line redundant rather than contradicted, which is why fix-395's version is
-- also left exactly where it is.
--
-- ★ The other functions that INSERT into permit_tasks were checked and are
--   deliberately NOT gated:
--     · bp_upsert_permit_task / _row, bp_replace_permit_tasks — a person
--       typing a task on a historical project is doing so on purpose.
--     · bp_create_project_with_permits — the wizard's TEMPLATE checklist. Not
--       a lifecycle task, chosen on screen in Step 4, and out of this ticket's
--       scope. See the PR body: it is a real second creation path and it is
--       reported rather than silently widened into here.
--
-- ---------------------------------------------------------------------------
-- ★★★ EXPLICITLY TICKED ONLY — `COALESCE(is_backfill, false) = false`
-- ---------------------------------------------------------------------------
-- Matching fix-395's existing predicate EXACTLY, so the two rules never have to
-- be reconciled. **NULL keeps meaning "nobody was asked", not "this is
-- historical"** (fix-363's three-state rule; fix-386 recorded it for this very
-- column). The 186 NULL projects behave today exactly as they did yesterday —
-- a careless `IS NOT TRUE` would have silenced every one of them.
--
-- ---------------------------------------------------------------------------
-- ★★★ FORWARD-ONLY. NO DATA WRITE. — Bobby, 2026-09-01
-- ---------------------------------------------------------------------------
-- He took the strictest option over a recommended sweep. This is a CREATION
-- rule, not a cleanup: existing auto-tasks on backfilled projects are left
-- exactly as they are, and P-037's stale-task sweep inherits them.
--
-- ★ The brief recorded 2 such tasks still open (both on 19118 100th Ave NE).
--   Re-measured 2026-09-01: **0 open** — both were resolved by hand at 19:20
--   that day, after the brief was written. So "backfilled projects have no
--   auto-tasks" now happens to be true of prod as well as of the code. That is
--   a coincidence of timing, not something this file did.
--
-- ---------------------------------------------------------------------------
-- ★★ PATCHED BY ANCHOR, NOT RETYPED (fix-410 / fix-425's rule)
-- ---------------------------------------------------------------------------
-- bp_create_lifecycle_task is ~200 lines of title-building and three
-- conditional INSERTs. Re-stating it here to add four lines would put every one
-- of those lines at risk of a transcription error, and the diff would hide the
-- change. So this reads the LIVE definition, asserts both anchors are present
-- exactly once, splices, and re-creates. If prod has drifted from what this was
-- written against, it RAISES instead of guessing.

DO $migration$
DECLARE
  v_def         text;
  v_new         text;
  -- Anchor 1: the last DECLARE line, so the new variable joins the block.
  v_decl_anchor text := E'  v_anchor         text;                    -- fix-395\n';
  -- Anchor 2: the project SELECT the guard needs widened. It is already
  -- reading the right row — fix-386 put `is_backfill` on that table.
  v_sel_anchor  text := E'  SELECT address INTO v_project_addr\n  FROM public.projects WHERE id = v_permit.project_id;\n';
  v_decl_new    text;
  v_sel_new     text;
BEGIN
  -- ★ Built with explicit `||`. Postgres does NOT implicitly concatenate
  --   adjacent E'' literals the way it does plain ones, and the syntax error
  --   that produces is at the SECOND literal, which reads as a problem with
  --   the wrong line.
  v_decl_new := v_decl_anchor
             || E'  v_is_backfill    boolean := false;         -- fix-470\n';

  v_sel_new  := E'  -- fix-470 (P-110): the project row was already being read here for\n'
             || E'  -- its address; it now also answers whether this is a historical entry.\n'
             || E'  SELECT address, COALESCE(is_backfill, false)\n'
             || E'    INTO v_project_addr, v_is_backfill\n'
             || E'  FROM public.projects WHERE id = v_permit.project_id;\n'
             || E'\n'
             || E'  -- fix-470 -- A BACKFILLED PROJECT MINTS NO LIFECYCLE TASKS.\n'
             || E'  -- Bobby: "when checking this, we dont want tasks or milestones\n'
             || E'  -- created." Sits beside the actual_issue early-return a few lines\n'
             || E'  -- above, which has exactly this shape and exactly this meaning:\n'
             || E'  -- there is nothing here worth asking a person to do.\n'
             || E'  --\n'
             || E'  -- COALESCE, not IS NOT TRUE. NULL means "nobody was asked"\n'
             || E'  -- (fix-363) and 186 of 202 projects are NULL. Matches fix-395''s\n'
             || E'  -- predicate verbatim so the two rules cannot disagree.\n'
             || E'  --\n'
             || E'  -- ONE CHOKEPOINT, not three guards in three callers: every\n'
             || E'  -- lifecycle event passes through here, so a new caller inherits\n'
             || E'  -- the rule instead of having to remember it.\n'
             || E'  IF v_is_backfill THEN\n'
             || E'    RETURN NULL;\n'
             || E'  END IF;\n';

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'bp_create_lifecycle_task';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-470: bp_create_lifecycle_task not found';
  END IF;

  -- ★ Idempotent: applying twice is a no-op, not a double guard.
  IF position('fix-470' in v_def) > 0 THEN
    RAISE NOTICE 'fix-470: guard already present - nothing to do';
    RETURN;
  END IF;

  -- ★★ Both anchors must appear EXACTLY ONCE. If prod has drifted from what
  --    this was written against, this raises rather than splicing blindly.
  IF (length(v_def) - length(replace(v_def, v_decl_anchor, ''))) / length(v_decl_anchor) <> 1 THEN
    RAISE EXCEPTION 'fix-470: DECLARE anchor not found exactly once - prod has drifted';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_sel_anchor, ''))) / length(v_sel_anchor) <> 1 THEN
    RAISE EXCEPTION 'fix-470: project SELECT anchor not found exactly once - prod has drifted';
  END IF;

  v_new := replace(v_def, v_decl_anchor, v_decl_new);
  v_new := replace(v_new, v_sel_anchor,  v_sel_new);

  -- ★ Everything else is untouched: same signature, same SECURITY DEFINER and
  --   search_path, same three ON CONFLICT inserts, same event vocabulary, same
  --   tenant check.
  EXECUTE v_new;
END
$migration$;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ---------------------------------------------------------------------------
-- ★ The guard is present, once:
-- select position('fix-470' in pg_get_functiondef(p.oid)) > 0
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='bp_create_lifecycle_task';   -- t
--
-- ★ The three callers are byte-identical to before:
-- select proname, md5(pg_get_functiondef(oid)) from pg_proc
--  where proname in ('bp_generate_city_chase_tasks',
--                    'bp_generate_number_entry_tasks',
--                    'bp_permit_results_ready_autotask');
--
-- ★ NOTHING WAS WRITTEN. These must be unchanged by this file:
-- select count(*) from public.permit_tasks t
--   join public.permits p on p.id=t.permit_id
--   join public.projects pr on pr.id=p.project_id
--  where pr.is_backfill is true;                                        -- 44
-- select count(*) filter (where is_backfill is true)  as t,
--        count(*) filter (where is_backfill is false) as f,
--        count(*) filter (where is_backfill is null)  as n
--   from public.projects;                                    -- 16 / 0 / 186
