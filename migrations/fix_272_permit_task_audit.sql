-- fix-272 (2026-08-03): capture consultant date-change history.
--
-- ############################################################################
-- ## NOT APPLIED. Written for review. Apply with MCP apply_migration (which   ##
-- ## records provenance AND statement text) once reviewed.                    ##
-- ############################################################################
--
-- WHY, AND WHY IT IS TIME-SENSITIVE
-- Bobby wants to measure consultant slippage: "say we put a target of 1.15, then
-- 1.20, then 1.25, then 1.30 — 3 changes and 15 days delay. How often and how
-- long and how many delays occur with consultants."
--
-- HALF OF THAT IS ALREADY RECORDED. public.user_activity has logged permit_tasks
-- edits since 2026-07-14 and stores WHICH FIELDS changed. Measured 2026-08-03
-- over 20 days: 1055 task events (762 UPDATE / 262 INSERT / 31 DELETE), of which
-- 182 touched target_date. So the COUNT of changes is answerable today.
--
-- THE OTHER HALF IS BEING LOST DAILY. user_activity.changed_fields is an array of
-- COLUMN NAMES with no old/new values, so the "15 days of delay" magnitude cannot
-- be reconstructed for any change already made. Every day without capture is a
-- day of magnitude data that never comes back. Hence: capture now, report later.
--
-- A USEFUL PROPERTY OF THIS BOUNDARY: because user_activity has been counting
-- target_date changes since 2026-07-14, the COUNT series stays CONTINUOUS across
-- the day this migration lands. Only the magnitudes begin here. A future report
-- can honestly say "N changes since mid-July, of which we can size those after
-- <apply date>".
--
-- NO BACKFILL, AND NONE IS POSSIBLE. The from/to values for past changes do not
-- exist anywhere — not in user_activity, not in permit_tasks (which holds only
-- the current value), not in any snapshot. They cannot be invented, and a
-- plausible-looking guess in a slippage metric would be worse than a gap.
--
-- MIRRORS fix-207 (draw_schedule_audit): from/to column pairs, an early-return
-- guard so unrelated updates write nothing, denormalised project_id, one row per
-- statement whatever the op.
--
-- ONE DELIBERATE DIVERGENCE FROM fix-207 — GRANTS. draw_schedule_audit grants
-- ALL privileges to anon AND authenticated (verified on prod 2026-08-03),
-- including TRUNCATE, because fix-207 never revoked and Supabase's
-- ALTER DEFAULT PRIVILEGES applied. RLS does NOT govern TRUNCATE, so that audit
-- trail is wipeable by any role that can reach it. This table follows the STATED
-- fix-157/163 model instead: PUBLIC and anon revoked, authenticated gets SELECT
-- only, writes exclusively via the SECURITY DEFINER trigger. draw_schedule_audit
-- is left alone here — out of scope for this PR, flagged separately.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permit_task_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  txid        text,
  tenant_id   uuid,
  task_id     uuid,
  permit_id   integer,
  -- DENORMALISED on purpose: reporting on consultant slippage should not need a
  -- three-table join back through permits to projects, and fix-207 already made
  -- that call for the draw schedule. Resolved at write time; see the trigger for
  -- the DELETE caveat.
  project_id  uuid,
  op          text NOT NULL,
  actor_uid   uuid,
  source      text,

  -- THE ASK: how often the promised-back date moves, and how far.
  target_date_from        date, target_date_to        date,
  -- When it actually went out. Gives promised-vs-actual turnaround rather than
  -- just a slippage tally. Since fix-268 this is auto-stamped on the first move
  -- to In Progress, so it IS the send event — this audit is an AFTER trigger and
  -- therefore sees the stamped value, not the pre-trigger NULL.
  start_date_from         date, start_date_to         date,
  -- When it actually came back (the move to Resolved).
  completion_status_from  text, completion_status_to  text,
  -- WHICH CONSULTANT. Without it, a task that switches discipline is
  -- unattributable — and this has to work for survey and civil, not just
  -- structural. Survey currently has more open items than structural.
  waiting_on_from         text, waiting_on_to         text
);

COMMENT ON TABLE public.permit_task_audit IS
  'fix-272: old/new history for the four permit_tasks fields that describe '
  'consultant turnaround (target_date, start_date, completion_status, '
  'waiting_on). Captures magnitude, which user_activity cannot — it records only '
  'which columns changed. No backfill is possible: prior values exist nowhere.';

-- Reporting reads: "this project's / this task's history, newest first".
CREATE INDEX IF NOT EXISTS idx_permit_task_audit_project
  ON public.permit_task_audit (project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_task_audit_task
  ON public.permit_task_audit (task_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_task_audit_changed_at
  ON public.permit_task_audit (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_task_audit_txid
  ON public.permit_task_audit (txid);
-- The slippage query itself: only rows where the promised date actually moved.
CREATE INDEX IF NOT EXISTS idx_permit_task_audit_target_moves
  ON public.permit_task_audit (project_id, changed_at DESC)
  WHERE target_date_from IS DISTINCT FROM target_date_to;

-- ---------------------------------------------------------------------------
-- B. RLS + grants (fix-157/163 model — NOT a copy of fix-207's grants)
-- ---------------------------------------------------------------------------
ALTER TABLE public.permit_task_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permit_task_audit_tenant_select ON public.permit_task_audit;
CREATE POLICY permit_task_audit_tenant_select ON public.permit_task_audit
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS permit_task_audit_service ON public.permit_task_audit;
CREATE POLICY permit_task_audit_service ON public.permit_task_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Name `authenticated` explicitly. A bare REVOKE ... FROM PUBLIC, anon leaves the
-- ALTER DEFAULT PRIVILEGES grant in place — the fix-265 lesson, and exactly what
-- left draw_schedule_audit truncatable.
REVOKE ALL ON TABLE public.permit_task_audit FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.permit_task_audit FROM authenticated;
GRANT SELECT ON TABLE public.permit_task_audit TO authenticated;
GRANT ALL    ON TABLE public.permit_task_audit TO service_role;

-- ---------------------------------------------------------------------------
-- C. The trigger
-- ---------------------------------------------------------------------------
-- AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, NO WHEN CLAUSE — nothing can
-- bypass it, the same guarantee fix-207 gives on the draw schedule. The filtering
-- is an EARLY RETURN inside the function so the rule lives in one readable place.
--
-- AFTER rather than BEFORE is deliberate: it sees NEW as the other five triggers
-- left it, so the fix-268 start_date auto-stamp is already applied. A BEFORE
-- trigger could have observed a NULL start_date and missed the send event.
--
-- Ordering against bp_log_user_activity (the only other AFTER trigger) does not
-- matter — both only read OLD/NEW and write to different tables.
--
-- INSERT IS CAPTURED so a task's whole life sits in one place. NOTE: the task
-- templates create tasks with a NULL target_date, so the "original promise" is
-- almost always the first UPDATE to a non-null value, NOT the INSERT. A report
-- counting "changes" should not treat the INSERT row as the first promise.
CREATE OR REPLACE FUNCTION public.bp_audit_permit_task()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source  text := current_setting('app.ds_source', true);
  v_project uuid;
  v_permit  integer := COALESCE(NEW.permit_id, OLD.permit_id);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The guard. Measured on prod 2026-08-03: 126 of 762 logged updates touched
    -- none of these four and must write nothing.
    IF NEW.target_date       IS NOT DISTINCT FROM OLD.target_date
       AND NEW.start_date        IS NOT DISTINCT FROM OLD.start_date
       AND NEW.completion_status IS NOT DISTINCT FROM OLD.completion_status
       AND NEW.waiting_on        IS NOT DISTINCT FROM OLD.waiting_on THEN
      RETURN NULL;
    END IF;
  END IF;

  -- project_id is denormalised, so resolve it here. On DELETE the permit may
  -- already be gone: permit_tasks.permit_id is ON DELETE CASCADE, so deleting a
  -- permit deletes its tasks in the same statement and this lookup can miss.
  -- A NULL project_id on such a row is correct and expected — the task_id and
  -- permit_id still identify it, and a cascade-delete is not a consultant event.
  SELECT p.project_id INTO v_project FROM public.permits p WHERE p.id = v_permit;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to)
    VALUES (
      txid_current()::text, OLD.tenant_id, OLD.id, OLD.permit_id, v_project,
      'DELETE', auth.uid(), v_source,
      OLD.target_date, NULL,
      OLD.start_date, NULL,
      OLD.completion_status, NULL,
      OLD.waiting_on, NULL);
    RETURN NULL;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.id, NEW.permit_id, v_project,
      'INSERT', auth.uid(), v_source,
      NULL, NEW.target_date,
      NULL, NEW.start_date,
      NULL, NEW.completion_status,
      NULL, NEW.waiting_on);
    RETURN NULL;
  ELSE
    -- ONE row per UPDATE, with every watched pair populated — including the
    -- unchanged ones, so a reader never has to join back to find context. Two
    -- fields moving together (marking a task started writes completion_status
    -- AND, via fix-268, start_date) is one event, not two.
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.id, NEW.permit_id, v_project,
      'UPDATE', auth.uid(), v_source,
      OLD.target_date, NEW.target_date,
      OLD.start_date, NEW.start_date,
      OLD.completion_status, NEW.completion_status,
      OLD.waiting_on, NEW.waiting_on);
    RETURN NULL;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.bp_audit_permit_task() IS
  'fix-272: writes public.permit_task_audit on any permit_tasks change that '
  'moves target_date, start_date, completion_status or waiting_on. Early-returns '
  'on every other update so unrelated edits cost one comparison and no row.';

DROP TRIGGER IF EXISTS permit_task_audit_trg ON public.permit_tasks;
CREATE TRIGGER permit_task_audit_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_permit_task();

COMMIT;

-- ---------------------------------------------------------------------------
-- EXPECTED VOLUME (measured, not guessed)
-- ---------------------------------------------------------------------------
-- Replaying 20 days of user_activity through this trigger's guard:
--     636 UPDATE + 262 INSERT + 31 DELETE = 929 rows / 20 days ≈ 325 rows/week
-- That is 3-5x the original 60-100/week estimate. The estimate assumed most
-- updates would be filtered; in fact only 126 of 762 (17%) touch none of the
-- four, largely because completion_status alone moved 333 times and — since
-- fix-268 — starting a task writes start_date in the same statement.
--
-- ~17k rows/year needs no design change. But the guard's justification is
-- "cheap insurance against future unrelated edits", not "it filters most
-- traffic", and this comment exists so nobody re-derives the wrong reason.
