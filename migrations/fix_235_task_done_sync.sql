-- fix-235: unify permit_tasks.done with completion_status on the write path.
--
-- Ground truth before this change: bp_trg_task_done_at (a BEFORE INSERT OR
-- UPDATE OF completion_status trigger) already kept `done_at` consistent with
-- completion_status — stamping now() on the transition into 'Resolved' and
-- NULLing it on any move out of 'Resolved'. The sibling `done` BOOLEAN, however,
-- was never touched by any write path, so it drifted: 186 'Resolved' rows in
-- prod carried done=false.
--
-- This extends the SAME trigger — the single choke point every completion_status
-- write already flows through (the two client controls added in fix-235, the
-- bp_upsert_permit_task RPC, the scraper, and any future writer) — to also keep
-- `done` in lockstep: done := (completion_status = 'Resolved'). One trigger, no
-- divergent write paths, no table-schema change.
--
-- The pre-existing 186 desynced rows are backfilled separately in prod AFTER
-- this deploys; with the trigger in place, the write path can no longer
-- re-corrupt them.
--
-- Base: prod pg_get_functiondef(bp_trg_task_done_at) as of 2026-07-10 (prod is
-- source of truth; migrations/ is partial). Only the `done` line is new.

CREATE OR REPLACE FUNCTION public.bp_trg_task_done_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- done_at: stamp on entry into Resolved, clear on any exit (unchanged).
  IF NEW.completion_status = 'Resolved'
     AND (OLD IS NULL OR OLD.completion_status <> 'Resolved') THEN
    NEW.done_at := now();
  ELSIF NEW.completion_status <> 'Resolved' THEN
    NEW.done_at := NULL;
  END IF;

  -- fix-235: `done` boolean now follows completion_status uniformly on every
  -- write, so 'Resolved' rows are always done=true and everything else is
  -- done=false.
  NEW.done := (NEW.completion_status = 'Resolved');

  RETURN NEW;
END $function$;
