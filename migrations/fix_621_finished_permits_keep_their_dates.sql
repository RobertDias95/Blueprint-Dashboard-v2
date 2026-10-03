-- ===========================================================================
-- fix-621 — A BLOCK MOVE LEAVES FINISHED PERMITS' DATES ALONE          P-316
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-03 (popup): **"Approved/issued keep them"**
--
-- Every block write — drag/resize (`bp_update_draw_schedule_with_dd_sync`),
-- Push Down (`bp_resolve_da_overlap`), the DD-dates editor
-- (`bp_set_bp_dd_dates`), a lane move (`bp_move_draw_schedule_da`), the gap
-- compactor (`bp_shift_da_blocks_up`) and first placement
-- (`bp_place_new_project_on_da`) — rewrote `dd_start` / `dd_end` on **all** of
-- the project's permits and `target_submit` on its Building Permit, whatever
-- their status. A `dd_*` change also fires `bp_trg_set_target_submit_manual_flag`,
-- which clears `target_submit_is_manual`.
--
-- Those dates are history, and `bp_learn_target_submit_days` learns the
-- dd_end → submitted offset from them, so a block move was quietly editing the
-- evidence the estimator reasons from.
--
-- **THE RULE.** A block move never changes `dd_start`, `dd_end`,
-- `target_submit` or `target_submit_is_manual` on a permit that is **approved
-- (`approval_date`) or issued (`actual_issue`)**. Open permits keep syncing
-- exactly as today, and the BLOCK ITSELF still moves — only the finished permit
-- ROWS are left alone.
--
-- ---------------------------------------------------------------------------
-- ★★★ HOW THIS FILE IS BUILT, AND WHY IT MATTERS
-- ---------------------------------------------------------------------------
-- It does NOT retype seven function bodies. `migrations/` is partial and prod is
-- ahead of it, so a hand-copied `CREATE OR REPLACE` is how a later fix gets
-- silently reverted. Instead the DO block below reads each body from
-- `pg_get_functiondef`, replaces an exact anchor, and re-executes it —
-- fix-410/fix-425's pattern.
--
-- ★★ EVERY ANCHOR IS COUNTED BEFORE IT IS REPLACED. If a body has drifted so
--    that an anchor appears zero times (or twice), this RAISES rather than
--    patching the wrong statement or silently patching nothing. A migration that
--    can no-op is worse than one that fails.
--
-- ---------------------------------------------------------------------------
-- ★★ THIS FILE CHANGES NO DATA. Every statement is a function definition or a
--    grant. The rewrites already made are NOT repaired — ⚖️ Bobby, 2026-10-02
--    and 10-03. `approval_date` / `actual_issue` have no history, so which rows
--    were finished at the time of each past write is not recoverable anyway.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ★★★ THE ONE PREDICATE
-- ---------------------------------------------------------------------------
-- ★★ IT TAKES THE TWO DATES, NOT A PERMIT ID. Called with the columns of the
--    row being updated it is part of the UPDATE's own WHERE clause — so it reads
--    the row the statement is about, under that statement's snapshot. A
--    `bp_permit_is_finished(p_id integer)` would re-SELECT the row and be
--    IMMUTABLE in name only.
--
-- ★★★ THIS IS *NOT* fix-245's `isPermitDone`, AND THE DIFFERENCE IS DELIBERATE.
--     fix-245 answers "is this permit off the live board?" and counts the
--     terminal STATUSES (Issued · Completed · Finaled · Closed · Withdrawn).
--     Bobby's rule here names two FACTS — approved, or issued — because the
--     question is a different one: "did something real happen on this permit
--     that these dates are now the record of?"
--
--     ★★★ AND THE TWO DISAGREE IN BOTH DIRECTIONS, measured 2026-10-03 over
--         prod's permits. This predicate holds for 590; fix-245's holds for 532:
--
--           · 63 permits are APPROVED but not `isPermitDone` — no issue date and
--             no terminal status. **Those 63 are the heart of Bobby's sentence**
--             and borrowing fix-245 here would have left every one of them
--             getting rewritten.
--           ·  5 permits are `isPermitDone` but not approved or issued — a
--             terminal status (withdrawn, closed) with neither date. Nothing
--             happened on those; their DD window is still the plan it was, and
--             freezing it would be freezing a guess.
--
--     So this is a second predicate on purpose, not a missed chance to reuse
--     one. It is named and commented at both ends so the next reader does not
--     "tidy" them together.
CREATE OR REPLACE FUNCTION public.bp_permit_is_finished(
  p_approval_date date,
  p_actual_issue  date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT p_approval_date IS NOT NULL OR p_actual_issue IS NOT NULL;
$function$;

COMMENT ON FUNCTION public.bp_permit_is_finished(date, date) IS
  'fix-621 (P-316): is this permit approved or issued? The one predicate behind '
  '"a block move leaves finished permits dates alone". NOT fix-245 isPermitDone '
  '— that one also counts terminal statuses; this one names the two facts Bobby '
  'ruled on. TS twin: isFinishedPermit in src/lib/finishedPermits.ts.';

REVOKE ALL ON FUNCTION public.bp_permit_is_finished(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_permit_is_finished(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- THE PATCHES
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  r         record;
  v_def     text;
  v_fn      text := NULL;
  v_hits    int;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      -- ═══ drag / resize ═══════════════════════════════════════════════════
      ('bp_update_draw_schedule_with_dd_sync', 1,
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end\n  WHERE project_id = p_project_id;',
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end\n  WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_update_draw_schedule_with_dd_sync', 2,
       E'    UPDATE permits SET target_submit = v_new_target\n    WHERE project_id = p_project_id AND type = ''Building Permit'';',
       E'    UPDATE permits SET target_submit = v_new_target\n    WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_update_draw_schedule_with_dd_sync', 3,
       E'      UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id;',
       E'      UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),

      -- ═══ Push Down ═══════════════════════════════════════════════════════
      ('bp_resolve_da_overlap', 1,
       E'  UPDATE public.permits\n  SET dd_start = v_anchor_dd_start, dd_end = v_anchor_dd_end\n  WHERE project_id = p_anchor_project_id;',
       E'  UPDATE public.permits\n  SET dd_start = v_anchor_dd_start, dd_end = v_anchor_dd_end\n  WHERE project_id = p_anchor_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_resolve_da_overlap', 2,
       E'      UPDATE public.permits SET target_submit = v_anchor_target\n      WHERE project_id = p_anchor_project_id AND type = ''Building Permit'';',
       E'      UPDATE public.permits SET target_submit = v_anchor_target\n      WHERE project_id = p_anchor_project_id AND type = ''Building Permit''\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_resolve_da_overlap', 3,
       E'        UPDATE public.permits SET target_submit = v_anchor_target WHERE id = v_pushed_anchor_id;',
       E'        UPDATE public.permits SET target_submit = v_anchor_target WHERE id = v_pushed_anchor_id\n          AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_resolve_da_overlap', 4,
       E'      UPDATE public.permits\n      SET dd_start = v_new_start_date, dd_end = v_new_end_date + 4\n      WHERE project_id = v_block.project_id;',
       E'      UPDATE public.permits\n      SET dd_start = v_new_start_date, dd_end = v_new_end_date + 4\n      WHERE project_id = v_block.project_id\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_resolve_da_overlap', 5,
       E'        UPDATE public.permits SET target_submit = v_new_target\n        WHERE project_id = v_block.project_id AND type = ''Building Permit'';',
       E'        UPDATE public.permits SET target_submit = v_new_target\n        WHERE project_id = v_block.project_id AND type = ''Building Permit''\n          AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_resolve_da_overlap', 6,
       E'          UPDATE public.permits SET target_submit = v_new_target WHERE id = v_pushed_anchor_id;',
       E'          UPDATE public.permits SET target_submit = v_new_target WHERE id = v_pushed_anchor_id\n            AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),

      -- ═══ the DD-dates editor ═════════════════════════════════════════════
      -- ★★ BOTH PATHS, INCLUDING CLEAR. Clearing DD dates to NULL is as much a
      --    rewrite of a finished permit's history as moving them.
      ('bp_set_bp_dd_dates', 1,
       E'    UPDATE permits SET dd_start = NULL, dd_end = NULL WHERE project_id = p_project_id;',
       E'    UPDATE permits SET dd_start = NULL, dd_end = NULL WHERE project_id = p_project_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_set_bp_dd_dates', 2,
       E'  UPDATE permits SET dd_start = v_start_week_monday, dd_end = v_ds_dd_end\n    WHERE project_id = p_project_id;',
       E'  UPDATE permits SET dd_start = v_start_week_monday, dd_end = v_ds_dd_end\n    WHERE project_id = p_project_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),

      -- ═══ a lane move ═════════════════════════════════════════════════════
      -- ★ `da` / `dm` are NOT touched by this ticket: who owns the permit is a
      --   live fact, not a date, and fix-379 derives `dm` from `da`.
      ('bp_move_draw_schedule_da', 1,
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end WHERE project_id = p_project_id;',
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_move_draw_schedule_da', 2,
       E'    UPDATE permits SET target_submit = v_new_target WHERE project_id = p_project_id AND type = ''Building Permit'';',
       E'    UPDATE permits SET target_submit = v_new_target WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_move_draw_schedule_da', 3,
       E'    IF v_anchor_id IS NOT NULL THEN UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id; END IF;',
       E'    IF v_anchor_id IS NOT NULL THEN UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue); END IF;  -- fix-621'),

      -- ═══ the gap compactor ═══════════════════════════════════════════════
      ('bp_shift_da_blocks_up', 1,
       E'    UPDATE permits SET dd_start = v_candidate_start, dd_end = v_candidate_end + 4\n    WHERE project_id = r.project_id;',
       E'    UPDATE permits SET dd_start = v_candidate_start, dd_end = v_candidate_end + 4\n    WHERE project_id = r.project_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_shift_da_blocks_up', 2,
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE project_id = r.project_id AND type = ''Building Permit'';',
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE project_id = r.project_id AND type = ''Building Permit''\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_shift_da_blocks_up', 3,
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE id = (SELECT id FROM permits WHERE project_id = r.project_id ORDER BY id LIMIT 1);',
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE id = (SELECT id FROM permits WHERE project_id = r.project_id ORDER BY id LIMIT 1)\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),

      -- ═══ first placement ═════════════════════════════════════════════════
      -- ★ It early-returns `placed=false` when the project already has a lane,
      --   so it only ever writes a project with no block yet. A BACKFILLED
      --   project can be exactly that AND have an approved permit, which is why
      --   it is guarded rather than argued away.
      ('bp_place_new_project_on_da', 1,
       E'  UPDATE permits SET dd_start = v_start, dd_end = v_end + 4\n  WHERE project_id = p_project_id;',
       E'  UPDATE permits SET dd_start = v_start, dd_end = v_end + 4\n  WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),
      ('bp_place_new_project_on_da', 2,
       E'  UPDATE permits SET target_submit = v_end + 14\n  WHERE project_id = p_project_id AND type = ''Building Permit'';',
       E'  UPDATE permits SET target_submit = v_end + 14\n  WHERE project_id = p_project_id AND type = ''Building Permit''\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621'),

      -- ═══ the target-submit engine ════════════════════════════════════════
      -- ★★★ HALF OF THIS RULE WAS ALREADY HERE, AND THE HALF THAT MATTERED MOST
      --     WAS MISSING. fix-585 added *"done is done. An approved or issued
      --     permit's target is history."* — but ONLY to the second loop, the one
      --     over `type <> 'Building Permit'`. The Building Permit's own two
      --     paths had no such check, so the engine kept recomputing
      --     `target_submit = dd_end + learned_offset` on a BP that was already
      --     issued. Measured 2026-10-03: 220 of 267 projects with a Building
      --     Permit have a FINISHED one, so this was the common case, not a
      --     corner.
      ('bp_recompute_target_submits', 1,
       E'  v_bp_actual         date;',
       E'  v_bp_actual         date;\n  v_bp_approval       date;  -- fix-621'),
      ('bp_recompute_target_submits', 2,
       E'  SELECT id, dd_end, actual_issue, target_submit, target_submit_is_manual\n    INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_target, v_bp_is_manual',
       E'  SELECT id, dd_end, actual_issue, approval_date, target_submit, target_submit_is_manual\n    INTO v_bp_id, v_bp_dd_end, v_bp_actual, v_bp_approval, v_bp_target, v_bp_is_manual'),
      ('bp_recompute_target_submits', 3,
       E'  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false) THEN',
       E'  -- ★★★ fix-621: a FINISHED Building Permit keeps its target. `v_bp_target`\n  --     then stays the value read from the row above, so the G&C / LSM mirrors\n  --     below still follow the BP''s real, historical target rather than a\n  --     freshly recomputed one.\n  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false)\n     AND NOT public.bp_permit_is_finished(v_bp_approval, v_bp_actual) THEN'),
      ('bp_recompute_target_submits', 4,
       E'    SELECT id, dd_end, target_submit, target_submit_is_manual\n    FROM permits WHERE project_id = p_project_id AND type = ''Building Permit''\n    ORDER BY id ASC\n  LOOP\n    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;',
       E'    SELECT id, dd_end, target_submit, target_submit_is_manual, approval_date, actual_issue\n    FROM permits WHERE project_id = p_project_id AND type = ''Building Permit''\n    ORDER BY id ASC\n  LOOP\n    IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;\n    -- ★★★ fix-621: done is done, for the Building Permit too. This skips the\n    --     `target_submit_is_projected := false` write below as well, which is a\n    --     no-op either way: measured 2026-10-03, ZERO Building Permits carry\n    --     that flag true, and this loop is the only thing that writes it for a\n    --     BP. One guard, one rule, rather than two half-rules.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue) THEN CONTINUE; END IF;'),
      ('bp_recompute_target_submits', 5,
       E'    -- fix-585: done is done. An approved or issued permit''s target is history.\n    IF v_permit.approval_date IS NOT NULL OR v_permit.actual_issue IS NOT NULL THEN CONTINUE; END IF;',
       E'    -- fix-585: done is done. An approved or issued permit''s target is history.\n    -- ★ fix-621 swapped the inline test for the shared predicate so this and the\n    --   BP guard above cannot drift. The rule is unchanged.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue) THEN CONTINUE; END IF;')
    ) AS t(fn, seq, anchor, repl)
    ORDER BY fn, seq
  LOOP
    -- A new function: flush the previous one, then load this one.
    IF v_fn IS DISTINCT FROM r.fn THEN
      IF v_fn IS NOT NULL THEN
        EXECUTE v_def;
      END IF;
      v_fn := r.fn;
      SELECT pg_get_functiondef(p.oid) INTO v_def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn;
      IF v_def IS NULL THEN
        RAISE EXCEPTION 'fix-621: public.% not found', r.fn;
      END IF;
      -- ★★ CRLF FIRST. `pg_get_functiondef` hands back whatever was stored, and
      --    some bodies on this database carry \r\n (fix-608 lost a whole sweep
      --    to exactly that). Every anchor below is written with LF.
      v_def := replace(v_def, chr(13), '');
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION
        'fix-621: anchor %/% matched % times in public.% (expected exactly 1). The body has drifted — re-read pg_get_functiondef and update this migration.',
        r.fn, r.seq, v_hits, r.fn;
    END IF;
    v_def := replace(v_def, r.anchor, r.repl);
  END LOOP;

  IF v_fn IS NOT NULL THEN
    EXECUTE v_def;
  END IF;
END
$patch$;

-- ---------------------------------------------------------------------------
-- ACLs restated. CREATE OR REPLACE preserves them, so these are no-ops today
-- and exist so the file describes the end state completely. `FROM public, anon`
-- and never `FROM anon` alone — anon inherits the PUBLIC grant (fix-157).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_update_draw_schedule_with_dd_sync(uuid, text, text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_update_draw_schedule_with_dd_sync(uuid, text, text, text, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_resolve_da_overlap(uuid, text, text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_resolve_da_overlap(uuid, text, text, text, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_set_bp_dd_dates(uuid, date, date, timestamptz, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_set_bp_dd_dates(uuid, date, date, timestamptz, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_move_draw_schedule_da(uuid, text, text, text, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_move_draw_schedule_da(uuid, text, text, text, text, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_shift_da_blocks_up(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_shift_da_blocks_up(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_place_new_project_on_da(uuid, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_place_new_project_on_da(uuid, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_recompute_target_submits(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_recompute_target_submits(uuid) TO authenticated;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. ★★★ IT CHANGES NO DATA. Every statement is a function body or a grant.
--    Bobby ruled the rewrites already made are not repaired, and
--    `approval_date` / `actual_issue` carry no history, so which rows were
--    finished at the time of each past write cannot be recovered.
--
-- 2. It does not touch `bp_create_project_with_permits`. Its two permit UPDATEs
--    only reach rows it INSERTED in the same call, which cannot already be
--    approved or issued. (It shows up large in a naive 30-day count only
--    because that count asks which of the project's permits are finished TODAY
--    — see the PR's §0 note on what that figure can and cannot mean.)
--
-- 3. It does not touch `bp_update_project_with_permits`. That is a person
--    typing a date into a permit, not a consequence of a block move, and taking
--    it away would remove the only way to correct a finished permit's target.
--
-- 4. It does not touch `bp_update_redesign_dd_phase`, which writes
--    `draw_schedule` only and never `permits`.
--
-- 5. It does not touch `bp_trg_set_target_submit_manual_flag`. That trigger
--    clears `target_submit_is_manual` when `dd_start`/`dd_end` change — and
--    after this migration a block move never changes those on a finished
--    permit, so the flag cannot be cleared by one. Guarding the write is the
--    rule; guarding the consequence as well would be two half-rules that can
--    disagree.
--
-- 6. It adds no overlap/bypass escape hatch. There is no block path that is
--    allowed to rewrite a finished permit's dates.
