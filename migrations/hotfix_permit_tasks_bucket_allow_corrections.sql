-- Hotfix (2026-06-09): the permit_tasks_bucket_check constraint was last set
-- when only 'de' (D&E) and 'pm' (Permitting) buckets existed. 'co' (Corrections)
-- is a real third bucket in the UI (Dashboard's Corrections column) and 5
-- legitimate task_templates rows seed permit_tasks with bucket='co'. The stale
-- check broke project creation as soon as a wizard tried to seed a 'co'
-- template. Applied to prod via MCP apply_migration as
-- "hotfix_permit_tasks_bucket_allow_corrections". This file is the repo backstop
-- so a fresh apply-from-zero reaches the same schema as prod.

ALTER TABLE public.permit_tasks
  DROP CONSTRAINT permit_tasks_bucket_check;

ALTER TABLE public.permit_tasks
  ADD CONSTRAINT permit_tasks_bucket_check
  CHECK (bucket = ANY (ARRAY['de'::text, 'pm'::text, 'co'::text]));
