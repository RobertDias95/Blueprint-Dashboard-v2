-- ===========================================================================
-- fix-624 — A FINISHED PERMIT'S BLANK DATES GET FILLED, NEVER OVERWRITTEN
--                                                                      P-320
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-05 (popup): **"Fill blanks, never overwrite."**
--
-- fix-621 locked `dd_start`, `dd_end`, `target_submit` and
-- `target_submit_is_manual` on an approved/issued permit across seven block
-- paths and the target-submit engine. It locked them **including when they were
-- blank**, so placing the block on a finished permit that had never had a DD
-- window left it blank forever.
--
-- Measured 2026-10-05: 592 finished permits, **193 with no DD dates** (38 of
-- them created in the last 30 days — Shire's backfill), 4 of those Building
-- Permits, and **all 193 sit on a project that already has a lane with weeks**,
-- so every one of them is a blank a block move could fill.
--
-- **THE RULE.** On a finished permit a block move may write `dd_start`,
-- `dd_end` or `target_submit` **only where that field is currently NULL**, per
-- field independently. A value already there never changes.
-- `target_submit_is_manual` is never changed on a finished permit at all. Open
-- permits sync exactly as today.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY THE WHERE CLAUSE KEEPS A FINISHED-ROW TEST AT ALL
-- ---------------------------------------------------------------------------
-- The obvious reading of "fill blanks" is to drop fix-621's `AND NOT finished`
-- and let `bp_fill_if_blank` decide per field. That would be wrong, and the
-- reason is `bp_set_updated_at`: it stamps `updated_at = now()` on every UPDATE
-- that reaches it. A finished permit whose window is already recorded would then
-- be **written with its own value** on every block move — no visible change, but
-- a fresh `updated_at` on every sibling, which is exactly fix-341's "modified by
-- someone else" with nobody there.
--
-- ★★ So each statement keeps a cheap guard that means "is there anything here to
--    fill?", and `bp_fill_if_blank` decides per field once the row is in scope.
--    An open permit always passes, a finished-and-complete permit never does.
--
-- ---------------------------------------------------------------------------
-- ★★★ AND THE MANUAL FLAG NOW NEEDS GUARDING, WHICH fix-621 ARGUED IT DID NOT
-- ---------------------------------------------------------------------------
-- fix-621 deliberately left `bp_trg_set_target_submit_manual_flag` alone, with
-- this reasoning: *"Guarding the write is the rule; guarding the consequence as
-- well would be two half-rules that can disagree."* That was sound **while no
-- block path ever changed a finished permit's dd dates.** fix-624 makes them
-- change (a fill is a change), so the consequence is now reachable:
--
--     BEFORE INSERT OR UPDATE OF target_submit, dd_end, dd_start ON permits
--       IF v_dd_changed THEN NEW.target_submit_is_manual := false;
--
-- ★★★ MEASURED: **36 of the 193 blank-DD finished permits carry
--     `target_submit_is_manual = true`.** Filling their window without touching
--     this trigger would silently clear the flag on all 36 — the exact field
--     Bobby's rule says is never changed on a finished permit. Not theoretical;
--     36 rows.
--
-- ---------------------------------------------------------------------------
-- ★★ THIS FILE CHANGES NO DATA. Every statement is a function definition or a
--    grant. It does NOT bulk-fill the 193 existing blanks — that is a data
--    change nobody has asked for, and Bobby has not been asked. They fill the
--    next time somebody moves the block, one project at a time, visibly.
--
-- ★★ Built the fix-621 way: the DO block reads each body from
--    `pg_get_functiondef`, replaces an exact anchor, and asserts the anchor
--    matched EXACTLY ONCE before replacing. No body is retyped.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ★★★ THE FILL RULE, AS ONE FUNCTION
-- ---------------------------------------------------------------------------
-- ★★ IT TAKES THE TWO FACTS AND THE TWO VALUES, so a call site reads as one
--    line per field and the rule lives in exactly one place:
--
--      dd_start = public.bp_fill_if_blank(approval_date, actual_issue,
--                                         dd_start, v_new_dd_start)
--
--    Open permit  → the new value, always (today's behaviour, unchanged).
--    Finished, blank  → the new value. **This is the fix.**
--    Finished, filled → the value already there, untouched.
--
-- ★ PER FIELD, and that is the point of passing `p_current` rather than testing
--   the row once: a blank `dd_end` beside a filled `dd_start` fills only
--   `dd_end`. Measured 2026-10-05 no permit is currently half-blank (all 193
--   have both NULL), so this is a latent case — implemented because Bobby ruled
--   it, not because it fires today.
CREATE OR REPLACE FUNCTION public.bp_fill_if_blank(
  p_approval_date date,
  p_actual_issue  date,
  p_current       date,
  p_new           date
)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN public.bp_permit_is_finished(p_approval_date, p_actual_issue)
             THEN COALESCE(p_current, p_new)
           ELSE p_new
         END;
$function$;

COMMENT ON FUNCTION public.bp_fill_if_blank(date, date, date, date) IS
  'fix-624 (P-320): Bobby, "fill blanks, never overwrite". On a finished permit '
  '(bp_permit_is_finished) returns the value already there, or the new one when '
  'that is NULL; on an open permit always the new one. Per field. TS twin: '
  'fillIfBlank in src/lib/finishedPermits.ts.';

REVOKE ALL ON FUNCTION public.bp_fill_if_blank(date, date, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_fill_if_blank(date, date, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- THE PATCHES
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  r      record;
  v_def  text;
  v_fn   text := NULL;
  v_hits int;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      -- ═══ drag / resize ═══════════════════════════════════════════════════
      ('bp_update_draw_schedule_with_dd_sync', 1,
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end\n  WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE permits SET\n    dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_new_dd_start),\n    dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_new_dd_end)\n  WHERE project_id = p_project_id\n    -- fix-624: a finished permit is in scope ONLY when something here is blank.\n    --   Writing a recorded window with its own value would bump updated_at and\n    --   raise fix-341''s false "modified by someone else" on every sibling.\n    AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n         OR dd_start IS NULL OR dd_end IS NULL);'),
      ('bp_update_draw_schedule_with_dd_sync', 2,
       E'    UPDATE permits SET target_submit = v_new_target\n    WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'    UPDATE permits SET target_submit =\n      public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n    WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n           OR target_submit IS NULL);  -- fix-624'),
      ('bp_update_draw_schedule_with_dd_sync', 3,
       E'      UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'      UPDATE permits SET target_submit =\n        public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n      WHERE id = v_anchor_id\n        AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n             OR target_submit IS NULL);  -- fix-624'),

      -- ═══ Push Down ═══════════════════════════════════════════════════════
      ('bp_resolve_da_overlap', 1,
       E'  UPDATE public.permits\n  SET dd_start = v_anchor_dd_start, dd_end = v_anchor_dd_end\n  WHERE project_id = p_anchor_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE public.permits\n  SET dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_anchor_dd_start),\n      dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_anchor_dd_end)\n  WHERE project_id = p_anchor_project_id\n    AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n         OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),
      ('bp_resolve_da_overlap', 2,
       E'      UPDATE public.permits SET target_submit = v_anchor_target\n      WHERE project_id = p_anchor_project_id AND type = ''Building Permit''\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'      UPDATE public.permits SET target_submit =\n        public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_anchor_target)\n      WHERE project_id = p_anchor_project_id AND type = ''Building Permit''\n        AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n             OR target_submit IS NULL);  -- fix-624'),
      ('bp_resolve_da_overlap', 3,
       E'        UPDATE public.permits SET target_submit = v_anchor_target WHERE id = v_pushed_anchor_id\n          AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'        UPDATE public.permits SET target_submit =\n          public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_anchor_target)\n        WHERE id = v_pushed_anchor_id\n          AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n               OR target_submit IS NULL);  -- fix-624'),
      ('bp_resolve_da_overlap', 4,
       E'      UPDATE public.permits\n      SET dd_start = v_new_start_date, dd_end = v_new_end_date + 4\n      WHERE project_id = v_block.project_id\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'      UPDATE public.permits\n      SET dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_new_start_date),\n          dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_new_end_date + 4)\n      WHERE project_id = v_block.project_id\n        AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n             OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),
      ('bp_resolve_da_overlap', 5,
       E'        UPDATE public.permits SET target_submit = v_new_target\n        WHERE project_id = v_block.project_id AND type = ''Building Permit''\n          AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'        UPDATE public.permits SET target_submit =\n          public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n        WHERE project_id = v_block.project_id AND type = ''Building Permit''\n          AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n               OR target_submit IS NULL);  -- fix-624'),
      ('bp_resolve_da_overlap', 6,
       E'          UPDATE public.permits SET target_submit = v_new_target WHERE id = v_pushed_anchor_id\n            AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'          UPDATE public.permits SET target_submit =\n            public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n          WHERE id = v_pushed_anchor_id\n            AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n                 OR target_submit IS NULL);  -- fix-624'),

      -- ═══ the DD-dates editor — the SET path only ══════════════════════════
      -- ★★★ THE CLEAR PATH IS DELIBERATELY NOT TOUCHED. `dd_start = NULL` on a
      --     finished permit is either a no-op (it was already blank) or an
      --     OVERWRITE of a recorded window with nothing — which is the one thing
      --     "fill blanks, never overwrite" forbids most plainly. fix-621's
      --     `AND NOT finished` is exactly right there and stays.
      ('bp_set_bp_dd_dates', 1,
       E'  UPDATE permits SET dd_start = v_start_week_monday, dd_end = v_ds_dd_end\n    WHERE project_id = p_project_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE permits SET\n    dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_start_week_monday),\n    dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_ds_dd_end)\n    WHERE project_id = p_project_id\n      AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n           OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),

      -- ═══ a lane move ═════════════════════════════════════════════════════
      ('bp_move_draw_schedule_da', 1,
       E'  UPDATE permits SET dd_start = v_new_dd_start, dd_end = v_new_dd_end WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE permits SET\n    dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_new_dd_start),\n    dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_new_dd_end)\n  WHERE project_id = p_project_id\n    AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n         OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),
      ('bp_move_draw_schedule_da', 2,
       E'    UPDATE permits SET target_submit = v_new_target WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'    UPDATE permits SET target_submit =\n      public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n    WHERE project_id = p_project_id AND type = ''Building Permit''\n      AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n           OR target_submit IS NULL);  -- fix-624'),
      ('bp_move_draw_schedule_da', 3,
       E'    IF v_anchor_id IS NOT NULL THEN UPDATE permits SET target_submit = v_new_target WHERE id = v_anchor_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue); END IF;  -- fix-621',
       E'    IF v_anchor_id IS NOT NULL THEN UPDATE permits SET target_submit =\n      public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_new_target)\n    WHERE id = v_anchor_id\n      AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n           OR target_submit IS NULL); END IF;  -- fix-624'),

      -- ═══ the gap compactor ═══════════════════════════════════════════════
      ('bp_shift_da_blocks_up', 1,
       E'    UPDATE permits SET dd_start = v_candidate_start, dd_end = v_candidate_end + 4\n    WHERE project_id = r.project_id\n      AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'    UPDATE permits SET\n      dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_candidate_start),\n      dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_candidate_end + 4)\n    WHERE project_id = r.project_id\n      AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n           OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),
      ('bp_shift_da_blocks_up', 2,
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE project_id = r.project_id AND type = ''Building Permit''\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'      UPDATE permits SET target_submit =\n        public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_candidate_end + 14)\n      WHERE project_id = r.project_id AND type = ''Building Permit''\n        AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n             OR target_submit IS NULL);  -- fix-624'),
      ('bp_shift_da_blocks_up', 3,
       E'      UPDATE permits SET target_submit = v_candidate_end + 14\n      WHERE id = (SELECT id FROM permits WHERE project_id = r.project_id ORDER BY id LIMIT 1)\n        AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'      UPDATE permits SET target_submit =\n        public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_candidate_end + 14)\n      WHERE id = (SELECT id FROM permits WHERE project_id = r.project_id ORDER BY id LIMIT 1)\n        AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n             OR target_submit IS NULL);  -- fix-624'),

      -- ═══ first placement ═════════════════════════════════════════════════
      ('bp_place_new_project_on_da', 1,
       E'  UPDATE permits SET dd_start = v_start, dd_end = v_end + 4\n  WHERE project_id = p_project_id\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE permits SET\n    dd_start = public.bp_fill_if_blank(approval_date, actual_issue, dd_start, v_start),\n    dd_end   = public.bp_fill_if_blank(approval_date, actual_issue, dd_end,   v_end + 4)\n  WHERE project_id = p_project_id\n    AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n         OR dd_start IS NULL OR dd_end IS NULL);  -- fix-624'),
      ('bp_place_new_project_on_da', 2,
       E'  UPDATE permits SET target_submit = v_end + 14\n  WHERE project_id = p_project_id AND type = ''Building Permit''\n    AND NOT public.bp_permit_is_finished(approval_date, actual_issue);  -- fix-621',
       E'  UPDATE permits SET target_submit =\n    public.bp_fill_if_blank(approval_date, actual_issue, target_submit, v_end + 14)\n  WHERE project_id = p_project_id AND type = ''Building Permit''\n    AND (NOT public.bp_permit_is_finished(approval_date, actual_issue)\n         OR target_submit IS NULL);  -- fix-624'),

      -- ═══ the target-submit engine ════════════════════════════════════════
      -- ★★ fix-621 made the engine SKIP a finished permit. It now skips only a
      --    finished permit whose target is already recorded — a blank one was
      --    never a record of anything, which is the whole of Bobby's ruling.
      --    `bp_set_bp_dd_dates` has no target_submit write of its own (removed
      --    in fix-25-feat-j); the engine is the only thing that can fill a
      --    finished BP's blank target from that path, so this is load-bearing.
      ('bp_recompute_target_submits', 1,
       E'  -- fix-621: a FINISHED Building Permit keeps its target. v_bp_target then\n  --   stays the value read from the row above, so the G&C / LSM mirrors below\n  --   still follow the BP''s real, historical target rather than a freshly\n  --   recomputed one.\n  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false)\n     AND NOT public.bp_permit_is_finished(v_bp_approval, v_bp_actual) THEN',
       E'  -- fix-621: a FINISHED Building Permit keeps its target. v_bp_target then\n  --   stays the value read from the row above, so the G&C / LSM mirrors below\n  --   still follow the BP''s real, historical target rather than a freshly\n  --   recomputed one.\n  -- fix-624: ...unless it has NO target yet. A blank is not history, so it is\n  --   filled. The block below can only be entered by a finished BP when\n  --   v_bp_target IS NULL, so it can only ever fill, never overwrite.\n  IF v_bp_id IS NOT NULL AND NOT COALESCE(v_bp_is_manual, false)\n     AND (NOT public.bp_permit_is_finished(v_bp_approval, v_bp_actual)\n          OR v_bp_target IS NULL) THEN'),
      ('bp_recompute_target_submits', 2,
       E'    -- fix-621: done is done, for the Building Permit too. This skips the\n    --   target_submit_is_projected := false write below as well, which is a\n    --   no-op either way: measured 2026-10-03, ZERO Building Permits carry that\n    --   flag true, and this loop is the only thing that writes it for a BP.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue) THEN CONTINUE; END IF;',
       E'    -- fix-621: done is done, for the Building Permit too. This skips the\n    --   target_submit_is_projected := false write below as well, which is a\n    --   no-op either way: measured 2026-10-03, ZERO Building Permits carry that\n    --   flag true, and this loop is the only thing that writes it for a BP.\n    -- fix-624: and "done" now means done AND RECORDED. A finished BP with no\n    --   target yet is filled; one that has a target is left exactly as it was.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue)\n       AND v_permit.target_submit IS NOT NULL THEN CONTINUE; END IF;'),
      ('bp_recompute_target_submits', 3,
       E'    -- fix-585: done is done. An approved or issued permit''s target is history.\n    -- fix-621 swapped the inline test for the shared predicate so this and the\n    --   BP guard above cannot drift. The rule is unchanged.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue) THEN CONTINUE; END IF;',
       E'    -- fix-585: done is done. An approved or issued permit''s target is history.\n    -- fix-621 swapped the inline test for the shared predicate so this and the\n    --   BP guard above cannot drift. The rule is unchanged.\n    -- fix-624 NARROWS it rather than reversing it: a target that was never set\n    --   is not history, so it is filled. A recorded one is still untouchable.\n    IF public.bp_permit_is_finished(v_permit.approval_date, v_permit.actual_issue)\n       AND v_permit.target_submit IS NOT NULL THEN CONTINUE; END IF;'),

      -- ═══ the manual flag ═════════════════════════════════════════════════
      -- ★★★ See the header: fix-621 argued this trigger needed no guard because
      --     no block path changed a finished permit's dd dates. fix-624 makes
      --     them change, and 36 live rows would have had their flag cleared.
      ('bp_trg_set_target_submit_manual_flag', 1,
       E'BEGIN\n  IF TG_OP = ''UPDATE'' THEN\n    v_dd_changed := (NEW.dd_end IS DISTINCT FROM OLD.dd_end) OR (NEW.dd_start IS DISTINCT FROM OLD.dd_start);',
       E'BEGIN\n  -- fix-624 (P-320): ON A FINISHED PERMIT THIS TRIGGER CHANGES NOTHING.\n  --\n  -- Bobby, 2026-10-05: target_submit_is_manual is never changed on a finished\n  -- permit. fix-624 lets a block move FILL a finished permit''s blank dd dates,\n  -- and the dd branch below clears this flag on any dd change -- which would\n  -- have silently cleared it on the 36 blank-DD finished permits that carry it\n  -- true (measured 2026-10-05).\n  --\n  -- It costs nothing to preserve: the flag''s only reader is\n  -- bp_recompute_target_submits, which for a finished permit now does nothing\n  -- unless the target is NULL -- and a NULL target with the flag set is a\n  -- deliberate "leave it alone" that this honours.\n  IF TG_OP = ''UPDATE''\n     AND public.bp_permit_is_finished(NEW.approval_date, NEW.actual_issue) THEN\n    NEW.target_submit_is_manual := OLD.target_submit_is_manual;\n    RETURN NEW;\n  END IF;\n  IF TG_OP = ''UPDATE'' THEN\n    v_dd_changed := (NEW.dd_end IS DISTINCT FROM OLD.dd_end) OR (NEW.dd_start IS DISTINCT FROM OLD.dd_start);')
    ) AS t(fn, seq, anchor, repl)
    ORDER BY fn, seq
  LOOP
    IF v_fn IS DISTINCT FROM r.fn THEN
      IF v_fn IS NOT NULL THEN
        EXECUTE v_def;
      END IF;
      v_fn := r.fn;
      SELECT pg_get_functiondef(p.oid) INTO v_def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn;
      IF v_def IS NULL THEN
        RAISE EXCEPTION 'fix-624: public.% not found', r.fn;
      END IF;
      -- ★★ CRLF first: `pg_get_functiondef` returns whatever was stored, and
      --    some bodies here carry \r\n (fix-608 lost a whole sweep to that).
      v_def := replace(v_def, chr(13), '');
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION
        'fix-624: anchor %/% matched % times in public.% (expected exactly 1). The body has drifted — re-read pg_get_functiondef and update this migration.',
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
-- 1. ★★★ IT CHANGES NO DATA, and in particular it does NOT fill the 193 blanks
--    it exists to make fillable. Bobby ruled the behaviour, not a backfill, and
--    §0 says so explicitly. They fill one project at a time, when somebody moves
--    the block, where that person can see it happen.
--
-- 2. It does not touch `bp_set_bp_dd_dates`' CLEAR path. Writing NULL over a
--    recorded window is the plainest possible overwrite; fix-621's
--    `AND NOT finished` is correct there and stays.
--
-- 3. It does not loosen `bp_permit_is_finished`. "Finished" still means approved
--    or issued, and still is not fix-245's `isPermitDone` — see fix-621's note.
--
-- 4. It does not change `target_submit_is_projected`. It is not one of the four
--    protected fields, and a target filled from a projection genuinely is one.
--
-- 5. It adds no escape hatch. There is no block path that may overwrite a
--    recorded date on a finished permit.
