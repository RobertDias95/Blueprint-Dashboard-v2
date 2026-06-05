-- fix-126-a: redesign concept foundation.
--
-- Bobby's framing: a redesign is by definition tied to an original (same
-- site, different proposal). The original stays intact; the redesign is
-- a new project row with redesign_of_project_id pointing at the parent.
-- 8 controlled trigger values capture WHY we redesigned. The reuse flag
-- gates whether the redesign creates new permits or is metadata + draw-
-- schedule block only.
--
-- Four new columns + a CHECK on trigger vocab + a partial index for the
-- "Redesigns (N)" reverse lookup on Project Overview.
--
-- Sandbox-verified via BEGIN/ROLLBACK before applying to prod:
--   1. bad trigger value rejected by check_violation
--   2. valid trigger value accepted
--   3. parent → child chain accepted (FK + reuse flag set)
--   4. reverse lookup (children where redesign_of_project_id = parent) hits the index
--   5. nonexistent parent uuid rejected by foreign_key_violation
--
-- Applied to prod via mcp__claude_ai_Supabase__apply_migration
-- (fix_126_a_redesign_concept_columns).
--
-- NOT a CHECK constraint: "redesign with no trigger" is technically valid
-- during INSERT (wizard could write the FK first then patch trigger) and
-- existing data is all NULL. Enforce trigger-required at the UI/RPC layer.

BEGIN;

ALTER TABLE projects
  ADD COLUMN redesign_of_project_id uuid REFERENCES projects(id),
  ADD COLUMN redesign_trigger text,
  ADD COLUMN redesign_reuses_original_permit boolean,
  ADD COLUMN redesign_notes text;

ALTER TABLE projects ADD CONSTRAINT redesign_trigger_vocab
  CHECK (redesign_trigger IS NULL OR redesign_trigger IN (
    'builder', 'ceo', 'acquisitions', 'design_mgmt',
    'design_associate', 'city_correction', 'market', 'other'
  ));

CREATE INDEX projects_redesign_of_project_id_idx
  ON projects(redesign_of_project_id)
  WHERE redesign_of_project_id IS NOT NULL;

COMMENT ON COLUMN projects.redesign_of_project_id IS 'fix-126: parent project this row redesigns. NULL = standalone (not a redesign). Site facts (lot dims, corner, juris) are shared by convention — the redesign carries its own copy of those columns but the original remains canonical for the parcel.';
COMMENT ON COLUMN projects.redesign_trigger IS 'fix-126: why this redesign exists. Controlled vocab via redesign_trigger_vocab CHECK. NULL allowed at insert (RPC/UI may write FK first, patch trigger second).';
COMMENT ON COLUMN projects.redesign_reuses_original_permit IS 'fix-126: when true the redesign is metadata only (draw schedule block + project row) — no new permits. When false the redesign gets its own permit set. NULL = unset at insert time.';
COMMENT ON COLUMN projects.redesign_notes IS 'fix-126: free-form context on the redesign (what changed, who decided, market signal, etc.).';

COMMIT;
