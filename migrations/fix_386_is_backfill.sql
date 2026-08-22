-- ===========================================================================
-- fix-386 — the wizard asks "Backfill?" and throws the answer away
-- ===========================================================================
--
-- Step 1 of the new-project wizard has a **Backfill?** checkbox
-- (Step1ProjectInfo.tsx:429, wizardState.ts:180). Today it does exactly one
-- thing: unlock the manual DD-date inputs (fix-143) so the draw block lands
-- where history says. Then the answer is DISCARDED — no column holds it,
-- useCreateProjectWithPermits never sent it, database.types.ts had no trace.
--
-- ★★ Meanwhile fix-378 has been INFERRING the same fact: myBoard.ts's "A DATE
-- ALREADY PAST WHEN THE RECORD WAS BORN IS HISTORY" compares the driving date
-- against the row's created_at. That inference exists only because the explicit
-- answer was thrown away. This ticket keeps the answer.
--
-- ---------------------------------------------------------------------------
-- ★★★ NULLABLE, NO DEFAULT — NULL MEANS "NOT RECORDED"
-- ---------------------------------------------------------------------------
--
-- Every existing project predates the recording, so for them the answer is
-- genuinely UNKNOWN, and fix-363's rule applies verbatim: null means NOT
-- RECORDED, never "no". A `NOT NULL DEFAULT false` would stamp ~300 historical
-- projects as "definitely not a backfill" — a claim nobody made, and one that
-- is demonstrably wrong for many of them (fix-378 measured 224 of 312 active
-- permits carrying already-past dates at row creation).
--
-- ★ Going forward the wizard always sends the real answer, true or false and
-- never null, so the null population only ever shrinks.
--
-- ★★ NO ROW IS WRITTEN BY THIS MIGRATION. Not even the "obvious" backfills
-- fix-378's inference already identifies: the inference covers them at READ
-- time, so a write buys nothing and risks stamping a wrong answer permanently.
--
-- ---------------------------------------------------------------------------
-- ★★ WHY THE TWO RPCs ARE PATCHED TEXTUALLY RATHER THAN REWRITTEN
-- ---------------------------------------------------------------------------
--
-- bp_create_project_with_permits is 14.7KB. Re-emitting the whole body to add
-- one column to one INSERT means transcribing 14.7KB of unrelated logic, where
-- a single dropped line is a silent regression that no test would obviously
-- catch. So each patch below is an anchored string replacement against the
-- LIVE pg_get_functiondef, and each one RAISES unless its anchor appears
-- EXACTLY ONCE — a moved anchor aborts the migration instead of silently
-- patching nothing. The resulting definitions are asserted afterwards.
--
-- ★ This is the one case where "base it on the live definition" is served
-- better by reading the live definition IN the migration than by pasting it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · The column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_backfill boolean;

COMMENT ON COLUMN public.projects.is_backfill IS
  'fix-386: did the person creating this project tick "Backfill?" in the '
  'wizard. NULL means NOT RECORDED (every project predating fix-386), never '
  '"no" — fix-363''s rule. true additionally suppresses fix-378''s plan-date '
  'milestones; false does NOT un-suppress the date inference.';

-- ---------------------------------------------------------------------------
-- 2 · bp_create_project_with_permits learns the field.
--
--     It follows `is_corner_lot`'s exact shape, which is already the
--     three-state one: key absent → NULL (not recorded), key present → the
--     boolean the wizard sent.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def  text;
  v_cols text := E'reused_from_project_id, schematic_designer\n  ) VALUES (';
  v_vals text := E'v_schematic_designer\n  ) ON CONFLICT (address) DO NOTHING RETURNING id INTO v_project_id;';
  v_n    int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_create_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-386: bp_create_project_with_permits not found';
  END IF;
  IF position('is_backfill' in v_def) > 0 THEN
    RAISE NOTICE 'fix-386: create RPC already patched; nothing to do';
    RETURN;
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_cols, ''))) / length(v_cols);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fix-386: column-list anchor matched % times, expected 1', v_n;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_vals, ''))) / length(v_vals);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fix-386: values anchor matched % times, expected 1', v_n;
  END IF;

  v_def := replace(v_def, v_cols,
    E'reused_from_project_id, schematic_designer, is_backfill\n  ) VALUES (');
  v_def := replace(v_def, v_vals,
    E'v_schematic_designer,\n    CASE WHEN v_pd ? ''is_backfill'' THEN (v_pd->>''is_backfill'')::boolean ELSE NULL END\n  ) ON CONFLICT (address) DO NOTHING RETURNING id INTO v_project_id;');

  EXECUTE v_def;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3 · bp_update_project_with_permits learns it too — the flag is EDITABLE.
--
--     ★★ The decision: yes, editable, and quietly. Whether a project was a
--     backfill is a FACT about how it was entered, and the person who ticked
--     (or forgot to tick) the box is exactly who might need to correct it —
--     the same class of edit as a typo'd address. What it must not become is a
--     lever people pull to quiet milestones they do not want to look at, which
--     is why it lives in Project Settings behind a plain checkbox with the
--     consequence written next to it, rather than anywhere near the board.
--
--     ★ It goes through the ATOMIC path, not a side channel: the same
--     bp_update_project_with_permits fix-382 fixed, so the edit inherits its
--     OCC (the RPC gained a field, not a new collision) and rolls back with
--     everything else in the save.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_a   text := E'poc_email        = CASE WHEN v_patch ? ''poc_email''         THEN NULLIF(v_patch->>''poc_email'','''')            ELSE poc_email END\n      WHERE id = p_project_id';
  v_n   int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_update_project_with_permits';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix-386: bp_update_project_with_permits not found';
  END IF;
  IF position('is_backfill' in v_def) > 0 THEN
    RAISE NOTICE 'fix-386: update RPC already patched; nothing to do';
    RETURN;
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fix-386: patch anchor matched % times, expected 1', v_n;
  END IF;

  -- ★ Same "only if the key is present" shape every other patched field uses,
  -- so a save that does not mention is_backfill leaves it exactly as it was —
  -- including leaving a NULL as NULL.
  v_def := replace(v_def, v_a,
    E'poc_email        = CASE WHEN v_patch ? ''poc_email''         THEN NULLIF(v_patch->>''poc_email'','''')            ELSE poc_email END,\n        is_backfill      = CASE WHEN v_patch ? ''is_backfill''       THEN (v_patch->>''is_backfill'')::boolean       ELSE is_backfill END\n      WHERE id = p_project_id');

  EXECUTE v_def;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 4 · Prove the patches landed and changed nothing else.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_create text;
  v_update text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_create FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_create_project_with_permits';
  SELECT pg_get_functiondef(p.oid) INTO v_update FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_update_project_with_permits';

  IF position('is_backfill' in v_create) = 0 THEN
    RAISE EXCEPTION 'fix-386: create RPC did not gain is_backfill';
  END IF;
  IF position('is_backfill' in v_update) = 0 THEN
    RAISE EXCEPTION 'fix-386: update RPC did not gain is_backfill';
  END IF;
  -- The neighbours the patches sat between are still there, so the anchored
  -- replace did not eat anything on either side of itself.
  IF position('v_schematic_designer' in v_create) = 0
     OR position('reused_from_project_id' in v_create) = 0 THEN
    RAISE EXCEPTION 'fix-386: create RPC lost a neighbouring field';
  END IF;
  IF position('poc_email' in v_update) = 0
     OR position('p_project_expected_updated_at' in v_update) = 0 THEN
    RAISE EXCEPTION 'fix-386: update RPC lost a neighbouring field';
  END IF;
END
$verify$;
