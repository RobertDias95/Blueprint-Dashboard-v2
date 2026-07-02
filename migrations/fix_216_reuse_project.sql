-- fix-216 (2026-07-02): REUSE — template a new project's product type + units
-- off an existing project, with a per-DA reuse metric.
--
-- REUSE vs REDESIGN:
--   redesign_of_project_id = a new VERSION of the SAME project (parcel).
--   reused_from_project_id = a NEW project templated off a DIFFERENT one. On
--     reuse the source's product_types + unit_types are COPIED ONCE into the new
--     project at creation; the new project then owns its own values (manual edits
--     always win). This column records the LINK only — for provenance + the metric.
--
-- ⚠️ APPLICATION NOTE (fix-216): this migration was authored in a session whose
-- Supabase MCP was authenticated to a DIFFERENT org, so it was NOT applied to
-- prod (eibnmwthkcuumyclyxoe) and the RPC change below could NOT be validated
-- against the live definition. Apply Part 1 (idempotent) directly. For Part 2,
-- follow the documented one-line patch against the LIVE
-- bp_create_project_with_permits definition (per the "migrations/ is partial;
-- prod is source of truth" rule) rather than pasting a blind CREATE OR REPLACE.

-- ===========================================================================
-- Part 1 — schema (runnable, idempotent).
-- ===========================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reused_from_project_id uuid;

-- Self-FK: dropping a source project detaches its reuse children (keeps their
-- copied data — the link was provenance only).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_reused_from_project_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_reused_from_project_id_fkey
      FOREIGN KEY (reused_from_project_id)
      REFERENCES public.projects (id) ON DELETE SET NULL;
  END IF;
END $$;

-- A project can't be reused from itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_reused_from_not_self'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_reused_from_not_self
      CHECK (id <> reused_from_project_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_reused_from_project_id
  ON public.projects (reused_from_project_id)
  WHERE reused_from_project_id IS NOT NULL;

-- ===========================================================================
-- Part 2 — bp_create_project_with_permits: store reused_from_project_id.
-- ===========================================================================
-- The wizard sends it inside p_project_data as 'reused_from_project_id'. Teach
-- the RPC to read + store it. Because prod is ahead of migrations/, DO NOT paste
-- a full CREATE OR REPLACE from a stale committed copy — instead, on the LIVE
-- definition:
--
--   1. In the INSERT INTO public.projects (...) column list, add:
--          reused_from_project_id
--   2. In the matching VALUES (...) list, add (mirroring how redesign_of_project_id
--      is read from the jsonb payload — it is NULLIF/cast the same way):
--          NULLIF(p_project_data->>'reused_from_project_id', '')::uuid
--
-- The column is nullable, so existing callers that omit the key insert NULL —
-- no behavior change for non-reuse creates. Validate with a rolled-back probe
-- (a create with reused_from_project_id set, asserting projects.reused_from_project_id,
-- then RAISE EXCEPTION to roll back) before relying on it, per the fix-208 rule.
--
-- Until Part 2 is applied, the wizard still records the reuse (the copied
-- product_types + unit_types persist normally); only the provenance LINK is
-- dropped by the RPC, so the badge + DA metric stay empty for new creates.
-- The Project Settings "set reuse" path (fix-216 PR2) writes the column directly
-- via useUpdateProject and is unaffected by this RPC gap.
