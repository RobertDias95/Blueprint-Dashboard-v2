-- fix-194: sub/child permits.
--
-- Some projects have a permit that does all the reviewing plus a sibling that's
-- just a placeholder for a separate structure / fee schedule. The placeholder
-- ("sub-permit") must not carry its own review status or skew metrics. We mark
-- it by pointing parent_permit_id at the reviewing sibling.
--
--   * NULL                → standalone / parent permit (normal behaviour).
--   * NOT NULL            → child placeholder, "reviewed under <parent #>".
--                           Excluded from every dashboard metric/rollup via the
--                           canonical isSubPermit() predicate; the scraper is
--                           UNCHANGED and keeps scraping the child — its data is
--                           simply ignored by the UI/metrics.
--
-- A child must reference a sibling in the SAME project; that is enforced
-- app-side (the marker UI only offers same-project permits). At the DB level we
-- only guard against self-reference and keep the FK self-referential so a child
-- can never dangle. ON DELETE SET NULL: deleting the reviewing parent simply
-- restores the child to standalone rather than blocking the delete or cascading.

ALTER TABLE public.permits
  ADD COLUMN IF NOT EXISTS parent_permit_id integer NULL
    REFERENCES public.permits(id) ON DELETE SET NULL;

-- A permit can't be its own parent.
ALTER TABLE public.permits
  DROP CONSTRAINT IF EXISTS permits_parent_not_self;
ALTER TABLE public.permits
  ADD CONSTRAINT permits_parent_not_self
    CHECK (parent_permit_id IS NULL OR parent_permit_id <> id);

COMMENT ON COLUMN public.permits.parent_permit_id IS
  'fix-194: sub/child permit marker. When set, this permit is a placeholder '
  'reviewed under the referenced sibling permit (same project, enforced '
  'app-side). Excluded from all dashboard metrics/rollups via isSubPermit(); '
  'the scraper still scrapes it normally.';

-- Partial index for the (rare) child rows — keeps "children of permit X"
-- lookups and the exclusion filters cheap without bloating the common NULL case.
CREATE INDEX IF NOT EXISTS permits_parent_permit_id_idx
  ON public.permits (parent_permit_id)
  WHERE parent_permit_id IS NOT NULL;
