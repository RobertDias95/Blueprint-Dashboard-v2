-- ===========================================================================
-- fix-521 §C (P-222) — drop `draw_schedule.color_override`
-- ===========================================================================
--
-- ⚠️⚠️ **NOT APPLIED.** Written for Cowork. `DROP COLUMN` is irreversible and
--       the data it removes cannot be reconstructed, so it does not get run by
--       the ticket that writes it.
--
-- ---------------------------------------------------------------------------
-- WHY, AND WHY THE EARLIER REPORT WAS WRONG
-- ---------------------------------------------------------------------------
--
-- fix-515 reported `color_override` "set on 14 rows and read nowhere", which
-- read as a feature somebody had used and nothing honoured. **Measured
-- properly on 2026-09-10 it is worse and simpler: all fourteen are the EMPTY
-- STRING. Not one holds a colour. Nobody has ever set one.**
--
--   color_override    14 × ''    205 × NULL
--   status_override   14 × ''    205 × NULL     ← the identical 14 rows
--   notes             14 × ''    ← and a THIRD column P-222 did not name
--
-- All 14 are rows that have been through the drag / manual-placement editor
-- (13 are `manually_placed`). The writer — `useUpdateDsRow` — serialised every
-- null as `''` before sending it to `bp_upsert_draw_schedule_row`, which writes
-- these text columns RAW while it wraps the date columns in `NULLIF(…,'')`.
-- **A field written as `''` where it means *nothing* is how a dead field looks
-- alive.** The client is fixed in this ticket; this file removes the column.
--
-- ---------------------------------------------------------------------------
-- SAFE TO DROP — checked, not assumed (2026-09-10)
-- ---------------------------------------------------------------------------
--
--   · nothing in `src/` reads it (only the write path named it);
--   · **no other function reads it** — a scan of every `pg_proc` in `public`
--     finds the string in `bp_upsert_draw_schedule_row` and nowhere else;
--   · no view depends on it (0 rewrite dependencies on that attribute);
--   · no index covers it;
--   · `draw_schedule_audit_trg` does not name it.
--
-- ⚠️ SO STEP 2 IS NOT OPTIONAL. `bp_upsert_draw_schedule_row` WRITES the
--    column, so dropping it without patching the function first leaves every
--    draw-schedule save raising `column "color_override" does not exist`.
--    Run both statements together or neither.
--
-- ---------------------------------------------------------------------------
-- ⏸ `status_override` DOES NOT RIDE ALONG
-- ---------------------------------------------------------------------------
--
-- It is empty on the same 14 rows and, on the same scan, nothing in `src/` or
-- in any other function reads it either. **It is still not dropped here.** The
-- block's real manual state lives in `manual_status` / `status`, and P-222
-- asks for `color_override` specifically; a second irreversible drop on the
-- strength of the same scan is a decision for its own ticket with its own
-- report. Reported, not acted on.
--
-- ---------------------------------------------------------------------------
-- ⏸ THE 14 EMPTY STRINGS IN `notes` ARE LEFT ALONE
-- ---------------------------------------------------------------------------
--
-- Normalising them is one statement (below, commented out) and it is a DATA
-- change, not a schema one. The client fix stops new ones; whether to tidy the
-- existing 14 is Bobby's call, and an empty note reads the same as no note on
-- every surface that shows it.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Patch the only writer, BEFORE the column goes
-- ---------------------------------------------------------------------------
--
-- ★ By ANCHOR on the live definition, never retyped — `migrations/` is partial
--   and prod is ahead of it. The fix-425 / fix-517 pattern.

DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bp_upsert_draw_schedule_row';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'bp_upsert_draw_schedule_row not found';
  END IF;

  IF position('color_override' in v_def) = 0 THEN
    RAISE NOTICE 'fix-521: already patched, nothing to do';
    RETURN;
  END IF;

  -- The INSERT's column list and its VALUES entry.
  v_def := replace(v_def, E'      color_override, status_override\n', E'      status_override\n');
  v_def := replace(v_def, E"      p_data->>'color_override',\n", '');
  -- The UPDATE's assignment, whichever spelling it carries.
  v_def := replace(v_def, E"      color_override = p_data->>'color_override',\n", '');
  v_def := replace(v_def, E"        color_override = p_data->>'color_override',\n", '');

  IF position('color_override' in v_def) > 0 THEN
    RAISE EXCEPTION
      'fix-521: bp_upsert_draw_schedule_row still names color_override after patching — '
      'the anchors below did not match its current text. Re-derive them from '
      'pg_get_functiondef and re-run; do NOT drop the column with the writer still on it.';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE 'fix-521: bp_upsert_draw_schedule_row no longer writes color_override';
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. Drop the column
-- ---------------------------------------------------------------------------

ALTER TABLE public.draw_schedule DROP COLUMN IF EXISTS color_override;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. OPTIONAL, and deliberately not run: normalise the `notes` empty strings
-- ---------------------------------------------------------------------------
--
-- UPDATE public.draw_schedule SET notes = NULL WHERE notes = '';
--
-- ⚠️ If this is ever run, suppress the OCC/updated_at trigger first the way
--    fix-410 and fix-425's backfills do — otherwise 14 rows get a new
--    `updated_at` and the next person with the board open gets a spurious
--    "modified by someone else" (fix-341).
