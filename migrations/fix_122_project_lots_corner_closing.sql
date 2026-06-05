-- fix-122-a: three new project-level columns.
--
-- Bobby's spec (2026-06-05):
--   * num_lots — distinct concept from units. e.g. a 5-lot subdivision
--     yielding 20 units vs a 1-lot 4-plex. Used as a high-level annual
--     metric ("how many lots did we develop this year"). Coexists with
--     the existing `units` column — additive, not a replacement.
--   * is_corner_lot — same lot dimensions feel very different on a
--     corner because unit/parking layout options change. Used in the
--     Library so a 50x100 corner is comparable apples-to-apples to a
--     50x100 mid-block.
--   * closing_date — informational only. Surfaces "we have permits
--     but builder won't issue until closing." Display-only, no math.
--
-- All three nullable — data exists on legacy projects without these
-- fields. Check constraint on num_lots prevents the obvious nonsense
-- (zero or negative), but allows arbitrarily-high counts (no cap
-- beyond the Wizard dropdown's 1-20 — users can direct-edit higher
-- via Project Settings if needed).
--
-- Sandbox-verified via BEGIN/ROLLBACK before applying to prod
-- (probed NULL insert, positive insert, zero rejection by CHECK).
-- Applied to prod via mcp__claude_ai_Supabase__apply_migration.

BEGIN;

ALTER TABLE projects
  ADD COLUMN num_lots integer,
  ADD COLUMN is_corner_lot boolean,
  ADD COLUMN closing_date date;

ALTER TABLE projects ADD CONSTRAINT num_lots_positive
  CHECK (num_lots IS NULL OR num_lots >= 1);

COMMENT ON COLUMN projects.num_lots IS 'fix-122: count of distinct lots in the project (subdivisions, lot splits). Distinct from units (e.g. 5-lot subdivision yielding 20 units). Positive integer or null.';
COMMENT ON COLUMN projects.is_corner_lot IS 'fix-122: corner-lot flag. Same lot dimensions feel very different on a corner because unit/parking layout options change. Used in Library filtering so a 50x100 corner is comparable apples-to-apples to a 50x100 mid-block.';
COMMENT ON COLUMN projects.closing_date IS 'fix-122: informational only — date the project closes (escrow/sale). Surfaces "we have permits but builder wont issue until closing." Display-only, no math.';

COMMIT;
