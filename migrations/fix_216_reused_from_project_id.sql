-- fix-216: projects.reused_from_project_id — REUSE provenance link.
--
-- REUSE vs REDESIGN:
--   redesign_of_project_id = a new VERSION of the SAME project (parcel).
--   reused_from_project_id = a NEW project templated off a DIFFERENT one. On
--     reuse the source's product_types + unit_types are COPIED ONCE into the new
--     project at creation; the new project then owns its own values (manual edits
--     always win). This column records the LINK only — for provenance + the
--     per-DA reuse metric.
--
-- Already applied + validated on prod (eibnmwthkcuumyclyxoe); committed here for
-- repo parity only. Idempotent (safe to re-run).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reused_from_project_id uuid;

-- Self-FK: dropping a source project detaches its reuse children (their copied
-- product/units stay — the link was provenance only).
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
