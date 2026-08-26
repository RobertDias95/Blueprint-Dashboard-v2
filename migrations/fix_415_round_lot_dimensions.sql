-- ===========================================================================
-- fix-415 SCOPE B — lot dimensions round IN THE DATABASE
-- ===========================================================================
--
-- APPLIED TO PROD 2026-08-26 via apply_migration (name
-- fix_415_round_lot_dimensions). This file is the record; the database is the
-- source of truth.
--
-- Bobby, 2026-08-26: "we want the unrounded numbers to match their updated UI
-- number, so that everything is matching and aligning. We just don't want to
-- display decimals moving forward… you can update the stored values to also
-- reflect that." This write is approved.
--
-- fix-411 §2 rounded these on SCREEN only and said in as many words that the
-- stored value must not move. That was right for a display ticket; Bobby has
-- now asked for the stored value to follow, so the display rule becomes
-- belt-and-braces rather than the only thing between him and a decimal.
--
-- Measured read-only before this ran: 14 projects with a fractional lot_width,
-- 23 with a fractional lot_depth, 29 distinct rows affected (8 carry both).
-- Max scale 2. 189 projects have both dimensions set.
--
-- ★ RESULT, verified after applying: 29 rows backed up, 29 rounded, 0
--   fractional lot dimensions remain, 0 dimensions lost to NULL, and 0 OCC
--   tokens bumped.
--
-- ★★ ROUNDING IS HALF-UP: 100.47 → 100, 120.5 → 121. Postgres `round(numeric)`
-- rounds half AWAY FROM ZERO, which for a non-negative lot dimension is exactly
-- JavaScript's `Math.round` — the same rule lib/lotDimensions applies on
-- screen, so the two cannot disagree. (They differ only on negative halves, and
-- a lot has no negative width.)

-- ---------------------------------------------------------------------------
-- 0. THE BACKUP — same grant model as the zone one
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._fix415_lot_round_backup_2026_08_26 (
  project_id       uuid        NOT NULL,
  address          text,
  lot_width_before numeric,
  lot_depth_before numeric,
  taken_at         timestamptz NOT NULL DEFAULT now()
);

-- ★★★ anon NOTHING, authenticated SELECT, service_role ALL — permit_task_audit's
-- model. NOT the default privileges, which hand anon full DML.
REVOKE ALL ON public._fix415_lot_round_backup_2026_08_26 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public._fix415_lot_round_backup_2026_08_26 TO authenticated;
GRANT ALL    ON public._fix415_lot_round_backup_2026_08_26 TO service_role;
ALTER TABLE public._fix415_lot_round_backup_2026_08_26 ENABLE ROW LEVEL SECURITY;

-- ★ Only the rows that actually carry a fraction. Unlike the zone backup (191
--   rows, cheap) this one is scoped to what changes, because the untouched rows
--   already equal their rounded selves — there is nothing to restore.
INSERT INTO public._fix415_lot_round_backup_2026_08_26
  (project_id, address, lot_width_before, lot_depth_before)
SELECT p.id, p.address, p.lot_width, p.lot_depth
FROM public.projects p
WHERE (p.lot_width IS NOT NULL AND p.lot_width <> round(p.lot_width))
   OR (p.lot_depth IS NOT NULL AND p.lot_depth <> round(p.lot_depth));

-- ---------------------------------------------------------------------------
-- ★★★ THE TWO TRIGGERS ARE SUPPRESSED, AND THIS TIME DELIBERATELY.
-- ---------------------------------------------------------------------------
--   projects_set_updated_at — BEFORE UPDATE, bumps the OCC token. Rounding a
--     stored value is not "a person edited this project": letting it fire gives
--     anyone with one of these 29 open a false "modified by someone else"
--     (fix-341's shape) and claims a human edited them today.
--   bp_log_user_activity — AFTER UPDATE, an activity row per project.
--
-- ★ THE SIBLING ZONE MIGRATION DID NOT DO THIS AND SHOULD HAVE. It bumped 18
--   projects' updated_at (0 activity rows — that trigger no-ops without an
--   authenticated user). Small and self-correcting (fix-99 auto-retries an OCC
--   once), unrecoverable because the pre-bump timestamps were not snapshotted,
--   and reported in the fix-415 PR rather than left to be discovered.
ALTER TABLE public.projects DISABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects DISABLE TRIGGER bp_log_user_activity;

-- ---------------------------------------------------------------------------
-- B1. the backfill
-- ---------------------------------------------------------------------------
-- ★ Each column is rounded only when it HAS a fraction, so a row carrying one
--   fractional dimension and one whole one does not have the whole one
--   rewritten to itself. NULL stays NULL — a missing dimension is missing, not
--   zero.
UPDATE public.projects p
SET lot_width = CASE WHEN p.lot_width IS NULL THEN NULL ELSE round(p.lot_width) END,
    lot_depth = CASE WHEN p.lot_depth IS NULL THEN NULL ELSE round(p.lot_depth) END
WHERE (p.lot_width IS NOT NULL AND p.lot_width <> round(p.lot_width))
   OR (p.lot_depth IS NOT NULL AND p.lot_depth <> round(p.lot_depth));

ALTER TABLE public.projects ENABLE TRIGGER projects_set_updated_at;
ALTER TABLE public.projects ENABLE TRIGGER bp_log_user_activity;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_frac int; v_moved int; v_backed int; v_nulled int;
BEGIN
  SELECT count(*) INTO v_frac FROM public.projects
  WHERE (lot_width IS NOT NULL AND lot_width <> round(lot_width))
     OR (lot_depth IS NOT NULL AND lot_depth <> round(lot_depth));

  SELECT count(*) INTO v_backed FROM public._fix415_lot_round_backup_2026_08_26;

  SELECT count(*) INTO v_moved
  FROM public._fix415_lot_round_backup_2026_08_26 b
  JOIN public.projects p ON p.id = b.project_id
  WHERE p.lot_width IS DISTINCT FROM b.lot_width_before
     OR p.lot_depth IS DISTINCT FROM b.lot_depth_before;

  -- ★ A dimension that was set must not have become NULL. Rounding is not
  --   clearing, and a CASE that fell through would look like a clean run.
  SELECT count(*) INTO v_nulled
  FROM public._fix415_lot_round_backup_2026_08_26 b
  JOIN public.projects p ON p.id = b.project_id
  WHERE (b.lot_width_before IS NOT NULL AND p.lot_width IS NULL)
     OR (b.lot_depth_before IS NOT NULL AND p.lot_depth IS NULL);

  IF v_frac <> 0 THEN
    RAISE EXCEPTION 'fix-415: % rows still carry a fractional lot dimension', v_frac;
  END IF;
  IF v_backed <> 29 THEN
    RAISE EXCEPTION 'fix-415: backed up % rows, expected 29', v_backed;
  END IF;
  IF v_moved <> 29 THEN
    RAISE EXCEPTION 'fix-415: rounded % rows, expected 29', v_moved;
  END IF;
  IF v_nulled <> 0 THEN
    RAISE EXCEPTION 'fix-415: % rows lost a dimension to NULL', v_nulled;
  END IF;
END
$mig$;
