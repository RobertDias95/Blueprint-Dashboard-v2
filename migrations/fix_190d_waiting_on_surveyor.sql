-- fix-190d (2026-06-23): canonicalize the survey discipline term to "Surveyor".
--
-- One concept had two terms: tasks stored permit_tasks.waiting_on = "Survey"
-- while the external-team blob (projects.external_team) keyed survey firms under
-- "Surveyor" (e.g. {"Surveyor":"Emerald"}). So a task "Waiting on Survey" never
-- matched the project's "Surveyor" firm → My Tasks Waiting showed "no firm
-- assigned". Bobby's call: canonical term = "Surveyor".
--
-- The blob already uses "Surveyor"/"Structural"/"Civil" — no blob migration. The
-- shared TS vocab (WAITING_ON_OPTIONS) is updated to "Surveyor" in the same PR.
-- This migration aligns the existing task rows. Idempotent (only rows still on
-- the old term match). No DB CHECK on waiting_on, so no constraint change.
--
-- Applied to PROD via Supabase MCP apply_migration; this file is the repo record.

UPDATE public.permit_tasks
SET waiting_on = 'Surveyor'
WHERE waiting_on = 'Survey';
