-- fix-268 (2026-08-03): design-phase transmit state for the vendor forecast.
--
-- APPLIED to prod (eibnmwthkcuumyclyxoe) on 2026-08-03 via MCP apply_migration
-- as `fix_268_transmit_state`, which records the provenance row AND the full
-- statement text. Bobby approved section C (the system-wide start_date trigger)
-- before it was applied. This file is the repo-of-record backstop and matches
-- what was applied byte for byte.
--
-- WHY
-- The vendor forecast could say what is COMING to the structural engineer, but
-- not whether a package had actually been SENT. Bobby: "the DD end phase is
-- really around 9/18, and that's when we're planning on sending backgrounds out.
-- How do we know when they are sent? That way they can be tracked from sent to
-- received."
--
-- The answer already exists as a base task: "Structural - Transmitted"
-- (default_team 'Design Associate'). That task IS the design-phase handoff —
--     start_date  = when the package was sent
--     target_date = when we expect it back
--     Resolved    = received
-- DESIGN phase is the transmit task; PERMITTING phase is corrections. They never
-- blur. This migration makes that task carry the vendor link and gives
-- start_date a mechanism so it actually gets filled in.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. The transmit template gains its vendor link
-- ---------------------------------------------------------------------------
-- Verified on prod 2026-08-03: default_waiting_on is NULL on this template, so
-- every transmit task seeded from it carries no vendor link at all and is
-- invisible to bp_list_waiting_on_tasks — which is exactly the data source the
-- forecast reads. Without this, section 4 can never populate.
UPDATE public.task_templates
   SET default_waiting_on = 'Structural',
       updated_at = now()
 WHERE text = 'Structural - Transmitted'
   AND default_waiting_on IS DISTINCT FROM 'Structural';

-- NOTE for whoever does civil / survey / architect next: the same gap exists on
-- 'Civil Engineer (In-house/Out-Sourced) - - Transmitted', 'Energy - -
-- Transmitted' and 'Landscape - Transmitted' (all default_waiting_on NULL).
-- Deliberately NOT touched here — this migration ships the structural vendor
-- only, and each of those wants its own discipline value.

-- ---------------------------------------------------------------------------
-- B. Backfill waiting_on on existing structural tasks
-- ---------------------------------------------------------------------------
-- 8 rows on prod at time of writing, listed in the fix-268 PR body rather than
-- touched silently. Restricted to waiting_on IS NULL, so a task somebody has
-- already pointed at a different discipline is never re-pointed.
--
-- Resolved rows are included deliberately: they are historical structural work
-- and tagging them makes the data consistent. isTaskLive keeps them out of every
-- live section regardless, so this changes no report output for them.
UPDATE public.permit_tasks
   SET waiting_on = 'Structural',
       updated_at = now()
 WHERE waiting_on IS NULL
   AND text ILIKE '%structural%';

-- ---------------------------------------------------------------------------
-- C. start_date auto-stamp  ★ SYSTEM-WIDE — READ THIS ★
-- ---------------------------------------------------------------------------
-- ★ THIS AFFECTS EVERY TASK IN THE SYSTEM, not just structural ones. ★
--
-- That is deliberate, and it is the point: "when did we start this" is useful
-- everywhere, and it is the only way "mark it started" can mean "sent" without
-- asking a DA to type a date they will not type. start_date is currently a field
-- with no consequence, which is exactly why nobody fills it in — the same reason
-- reuse provenance sits at 2 of 124 projects. This gives it one.
--
-- If that is not wanted, this section is the only part to drop: the trigger is
-- deliberately SEPARATE from bp_trg_task_done_at rather than folded into it, so
-- it can be reverted on its own with
--     DROP TRIGGER permit_tasks_start_date ON public.permit_tasks;
-- without disturbing the fix-235 done/done_at contract.
--
-- RULES (mirrored in TS by applyStartDateTrigger, which the tests assert
-- against — CI has no live DB, so the mirror is the contract):
--   * Stamp current_date when a task FIRST transitions INTO 'In Progress'.
--   * Also on a transition into 'Resolved' — a task can go Open -> Resolved
--     directly and it was still clearly sent at some point.
--   * NEVER overwrite an existing start_date. A manually entered date is the
--     user's; this must never argue with it.
--   * Transition-based, so re-saving a row that is ALREADY In Progress does not
--     stamp. Idempotent on repeat transitions by construction.
--   * 'Cancelled' (fix-262 sweep) never stamps.
--
-- Known edge, accepted: bp_restore_project returning a task from 'Cancelled' to
-- 'In Progress' is a transition, so a task with no start_date will be stamped
-- with the restore date. That is a task genuinely being worked again with no
-- date on file — a defensible guess, and the user can still overwrite it.
CREATE OR REPLACE FUNCTION public.bp_trg_task_start_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Never argue with a date a human already entered.
  IF NEW.start_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.completion_status IN ('In Progress', 'Resolved')
     AND (TG_OP = 'INSERT'
          OR OLD.completion_status IS DISTINCT FROM NEW.completion_status)
  THEN
    NEW.start_date := current_date;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.bp_trg_task_start_date() IS
  'fix-268: stamp permit_tasks.start_date on the first transition into '
  '''In Progress'' (or straight into ''Resolved''), never overwriting an '
  'existing value. Gives start_date a consequence so "mark it started" can mean '
  '"package sent" for the vendor forecast. SYSTEM-WIDE: applies to every task.';

DROP TRIGGER IF EXISTS permit_tasks_start_date ON public.permit_tasks;
CREATE TRIGGER permit_tasks_start_date
  BEFORE INSERT OR UPDATE OF completion_status ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_task_start_date();

-- Deliberately NO backfill of start_date on existing In Progress / Resolved
-- tasks. current_date would be a lie about when they started, and a wrong date
-- in a vendor-facing "sent" column is worse than a blank one.

COMMIT;
