-- ===========================================================================
-- fix-402 §2 — ARCHIVE THEN CLEAR the project-level parking columns
-- ===========================================================================
--
-- Bobby, 2026-08-25: *"Remove [parking] from the holistic site and merge that
-- under the units for proposal … by unit it's broken down: is it a garage, is
-- it surface, is it both, and how many stalls per unit."*
--
-- ★★★ HE RULED "ARCHIVE THEN CLEAR", NOT DELETE, and the reason matters: the
-- site-level answers are the only record of what the team believed before the
-- per-unit book exists. 231 unit rows across 102 projects start NULL and are
-- backfilled BY HAND — and the person doing that backfill will want to see what
-- the site said. Deleting would have destroyed the only crib sheet.
--
-- ★★ MEASURED BEFORE: 186 projects · 181 with parking_type · 180 with
-- parking_stalls · 182 with at least one. Distinct values: Both, Garage, None,
-- Surface — which map exactly onto the new per-unit closed set, so the backfill
-- is a transcription rather than a re-interpretation.
--
-- ★★★ SELF-VERIFYING. archived = cleared = expected, live columns empty
-- afterwards, and every archive row carries a value — or it raises and rolls
-- back. Idempotent: a populated archive means it already ran, and it returns.
--
-- ★ NOTHING PRE-FILLS THE NEW UNIT FIELDS. No unit row is touched here. The
-- temptation to seed each unit from its project's old site value was
-- deliberately refused: a site that said "Garage" says nothing about whether
-- unit 3 of 4 has one, and a guess that looks like an answer is worse than a
-- NULL (fix-386's rule, which this whole ticket turns on).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public._parking_site_archive_2026_08_25 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL,
  parking_type  text,
  parking_stalls integer,
  archived_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public._parking_site_archive_2026_08_25 IS
  'fix-402: the project-level parking_type / parking_stalls values as they stood on 2026-08-25, immediately before those columns were cleared. Parking became a PER-UNIT property (projects.unit_types[].parking_kind / parking_stalls). Read-only record; the per-unit book is backfilled by hand and this is what the team checks against while doing it.';

ALTER TABLE public._parking_site_archive_2026_08_25 ENABLE ROW LEVEL SECURITY;

DO $go$
DECLARE
  v_expected integer;
  v_archived integer;
  v_cleared  integer;
  v_left     integer;
BEGIN
  SELECT count(*) INTO v_expected
  FROM public.projects
  WHERE parking_type IS NOT NULL OR parking_stalls IS NOT NULL;

  IF (SELECT count(*) FROM public._parking_site_archive_2026_08_25) > 0 THEN
    RAISE NOTICE 'fix-402: archive already populated, nothing to do';
    RETURN;
  END IF;

  INSERT INTO public._parking_site_archive_2026_08_25
    (project_id, parking_type, parking_stalls)
  SELECT id, parking_type, parking_stalls
  FROM public.projects
  WHERE parking_type IS NOT NULL OR parking_stalls IS NOT NULL;
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  UPDATE public.projects
     SET parking_type = NULL, parking_stalls = NULL
   WHERE parking_type IS NOT NULL OR parking_stalls IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SELECT count(*) INTO v_left
  FROM public.projects
  WHERE parking_type IS NOT NULL OR parking_stalls IS NOT NULL;

  IF v_archived <> v_expected OR v_cleared <> v_expected OR v_left <> 0 THEN
    RAISE EXCEPTION
      'fix-402: expected %, archived %, cleared %, still set % — aborting',
      v_expected, v_archived, v_cleared, v_left;
  END IF;

  RAISE NOTICE 'fix-402: archived and cleared % projects', v_archived;
END
$go$;

-- Prove the archive carries the ORIGINAL values, not empties.
DO $verify$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public._parking_site_archive_2026_08_25
  WHERE parking_type IS NULL AND parking_stalls IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'fix-402: % archive rows carry no value', v_bad;
  END IF;
END
$verify$;
