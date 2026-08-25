-- ===========================================================================
-- fix-405 — ONLY WHAT IS VALID, CURRENT AND APPLICABLE
-- ===========================================================================
--
-- Bobby, 2026-08-26: *"There is that much volume of tasks being created and
-- some of those are stale, and dont apply — i.e. first round corrections, but
-- now in the 2nd or 3rd round etc. we only want what is valid and current and
-- applicable. and to remove the noise."*
--
-- ★★★ THE BRIEF'S PREMISE WAS 730 OPEN. IT IS 730 EVER. Measured on prod
-- 2026-08-26: 730 bot tasks in total, 543 ALREADY CLOSED (74%), 187 open. The
-- per-kind figures in the brief (222/189/99/69/52/52/36/11) are the total-ever
-- column exactly — the same numbers fix-395 measured — not the open one. The
-- machinery is not missing three quarters of its job.
--
-- ★★★ AND THERE IS NO BUCKET (a). The existing closer was run over every permit
-- holding an open bot task inside a rolled-back transaction: it would have
-- closed ZERO. No rule's condition is already met and unfired, so the
-- trigger-coverage gap class fix-395 found does not exist here. Every one of
-- the 187 is a shape no rule covers, or real undone work.
--
-- ---------------------------------------------------------------------------
-- THE THREE NEW RULES
-- ---------------------------------------------------------------------------
--
-- ★★★ 1. `superseded_next_cycle` FOR intake_accepted AND corr_issued — BOBBY'S
-- OWN EXAMPLE. The rule already existed, wired ONLY to `resubmitted`. These two
-- kinds ask the same question about the same cycle and were never connected to
-- it, so a task about round 1 sat open forever once the permit reached round 2.
-- 23 of the 24 open intake_accepted tasks are in exactly that state.
--
-- ★★ NOTE WHAT THE DATA SAYS ABOUT HIS EXAMPLE: he described first-round
-- CORRECTIONS, and all 13 open corr_issued tasks are on their permit's current
-- cycle with no later cycle — the shape is presently zero for corrections and
-- 23 for intake_accepted. The rule covers both; only one of them has a backlog.
--
-- ★★ 2. `superseded_permit_withdrawn` — a withdrawn permit expects nothing of
-- anybody (fix-388's rule, which the board already applies to chips). 1 task.
--
-- ★★ 3. `superseded_project_cancelled` — a cancelled project is off live work
-- (fix-262). 2 tasks, and see the sibling migration for why they existed.
--
-- ★★★ ORDERING: the two "the permit is dead" rules come FIRST. They are a
-- stronger statement than "the cycle moved on", and they read better on the
-- row than any per-event reason would — a chase task on a withdrawn permit
-- closing as "the city responded (Withdrawn)" is technically true and useless.
--
-- ★★ EVERY EXISTING CONTRACT HOLDS: bp_task_touched_by_person still guards
-- every close (a rule must never close a task a human picked up), the ledger is
-- written at its existing one-row-per-permit-per-recipient grain, and no
-- pre-existing rule's condition changed.
--
-- ★ NO ROW IS CLOSED BY THIS MIGRATION. It changes the rules; the standing pile
-- is a separate, unapplied sweep reported in the PR body.
-- ===========================================================================

ALTER TABLE public.permit_tasks
  DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check;
ALTER TABLE public.permit_tasks
  ADD CONSTRAINT permit_tasks_auto_closed_reason_check
  CHECK (auto_closed_reason IS NULL OR auto_closed_reason IN (
    'permit_issued',
    'superseded_by_intake_acceptance',
    'superseded_next_cycle',
    'superseded_resubmitted',
    'superseded_status_matched',
    'superseded_number_present',
    'superseded_city_responded',
    'superseded_target_changed',
    'superseded_permit_withdrawn',
    'superseded_project_cancelled'
  ));

-- The closer, re-emitted whole from the LIVE body so this file is the function
-- and not a description of it. Only the marked arms are new.

CREATE OR REPLACE FUNCTION public.bp_supersede_stale_bot_tasks(p_permit_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := 0;
  v_now   timestamptz := now();
BEGIN
  WITH candidate AS (
    SELECT t.id, t.tenant_id, t.permit_id, t.assigned_to, t.auto_event,
           t.cycle_idx, t.text, t.created_at, t.auto_anchor,
           p.num, p.status, p.project_id,
           p.updated_at    AS permit_updated_at,
           p.approval_date, p.actual_issue,
           c.intake_accepted, c.resubmitted, c.corr_issued,
           c.city_target   AS cycle_city_target,
           (SELECT count(*) FROM public.permit_cycles n
             WHERE n.permit_id = t.permit_id
               AND n.cycle_index > t.cycle_idx
               AND (n.submitted IS NOT NULL
                    OR n.corr_issued IS NOT NULL
                    OR n.intake_accepted IS NOT NULL)) AS later_city_cycle,
           -- ★★ fix-405: the project's own life, read once per candidate. A
           -- cancelled project is off live work (fix-262) and its permits'
           -- open bot tasks are noise by definition.
           EXISTS (SELECT 1 FROM public.project_holds h
                    WHERE h.project_id = p.project_id
                      AND h.hold_end IS NULL AND h.kind = 'cancelled') AS project_cancelled
      FROM public.permit_tasks t
      JOIN public.permits p ON p.id = t.permit_id
      LEFT JOIN public.permit_cycles c
             ON c.permit_id = t.permit_id AND c.cycle_index = t.cycle_idx
     WHERE t.permit_id = p_permit_id
       AND t.auto_event IS NOT NULL
       AND t.completion_status <> 'Resolved'
       AND COALESCE(t.done, false) = false
       AND NOT public.bp_task_touched_by_person(t.id)
  ),
  ruled AS (
    SELECT c.*,
           CASE
             -- ★★★ fix-405: the two rules about the PERMIT being dead come
             -- first. They are a stronger statement than "the cycle moved on",
             -- and they read better on the row than any per-event reason.
             WHEN c.project_cancelled
               THEN 'superseded_project_cancelled'
             WHEN btrim(COALESCE(c.status,'')) IN ('Withdrawn', 'Application Withdrawn')
               THEN 'superseded_permit_withdrawn'
             WHEN c.auto_event = 'corr_issued' AND c.resubmitted IS NOT NULL
               THEN 'superseded_resubmitted'
             WHEN c.auto_event = 'resubmitted' AND c.later_city_cycle > 0
               THEN 'superseded_next_cycle'
             -- ★★★ fix-405: BOBBY'S OWN EXAMPLE. The permit moved to a later
             -- review cycle while a task about an EARLIER one sat open. The
             -- rule already existed for 'resubmitted'; these two kinds ask the
             -- same question about the same cycle and were never wired to it.
             WHEN c.auto_event IN ('intake_accepted', 'corr_issued')
              AND c.later_city_cycle > 0
               THEN 'superseded_next_cycle'
             WHEN c.auto_event = 'intake_submitted'
              AND c.intake_accepted IS NOT NULL
              AND (c.later_city_cycle > 0
                   OR c.approval_date IS NOT NULL
                   OR c.actual_issue IS NOT NULL)
               THEN 'superseded_by_intake_acceptance'
             WHEN c.auto_event = 'scrape_reconcile'
              AND lower(COALESCE(c.status, '')) =
                  lower(COALESCE(btrim(substring(c.text from 'portal shows (.*?) — dashboard shows')), ''))
              AND c.permit_updated_at > c.created_at
               THEN 'superseded_status_matched'
             WHEN c.auto_event = 'number_entry'
              AND NULLIF(btrim(c.num), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.permit_cycles z
                           WHERE z.permit_id = c.permit_id AND z.submitted IS NOT NULL)
               THEN 'superseded_number_present'
             WHEN c.auto_event = 'city_target_chase'
              AND (c.approval_date IS NOT NULL
                   OR c.actual_issue IS NOT NULL
                   OR c.corr_issued IS NOT NULL
                   OR NOT public.bp_city_owes_review(c.status))
               THEN 'superseded_city_responded'
             WHEN c.auto_event = 'city_target_chase'
              AND c.cycle_city_target::text IS DISTINCT FROM c.auto_anchor
               THEN 'superseded_target_changed'
             ELSE NULL
           END AS rule
      FROM candidate c
  ),
  explained AS (
    SELECT r.*,
           CASE r.rule
             WHEN 'superseded_resubmitted' THEN
               'the city recorded a resubmission on ' || r.resubmitted::text
             WHEN 'superseded_next_cycle' THEN
               'the permit has moved to a later review cycle'
             WHEN 'superseded_by_intake_acceptance' THEN
               'the city accepted the intake on ' || r.intake_accepted::text
             WHEN 'superseded_status_matched' THEN
               'the dashboard now shows what the portal showed (' ||
               COALESCE(btrim(substring(r.text from 'portal shows (.*?) — dashboard shows')), '?') || ')'
             WHEN 'superseded_number_present' THEN
               'the permit number ' || COALESCE(btrim(r.num), '') || ' is on file'
             WHEN 'superseded_city_responded' THEN
               'the city responded (' || COALESCE(NULLIF(btrim(r.status), ''), 'status unrecorded') || ')'
             WHEN 'superseded_target_changed' THEN
               'the city moved its review target to ' ||
               COALESCE(r.cycle_city_target::text, 'no date')
             -- ★★ fix-405: both new reasons get their own clause. The ledger
             -- entry is what the person reads on the board, so "the permit was
             -- withdrawn (Application Withdrawn)" has to say the actual status.
             WHEN 'superseded_permit_withdrawn' THEN
               'the permit was withdrawn (' || COALESCE(NULLIF(btrim(r.status), ''), '?') || ')'
             WHEN 'superseded_project_cancelled' THEN
               'the project was cancelled'
             ELSE NULL
           END AS clause
      FROM ruled r
     WHERE r.rule IS NOT NULL
  ),
  closed AS (
    UPDATE public.permit_tasks t
       SET completion_status = 'Resolved',
           auto_closed_reason = e.rule
      FROM explained e
     WHERE t.id = e.id
    RETURNING t.id, e.tenant_id, e.permit_id, e.assigned_to, e.rule, e.clause
  ),
  routed AS (
    SELECT cl.id, cl.tenant_id, cl.permit_id,
           public.bp_auto_close_recipient(cl.assigned_to, cl.permit_id) AS recipient,
           cl.rule, cl.clause
      FROM closed cl
  ),
  ids AS (
    SELECT tenant_id, permit_id, recipient, array_agg(id) AS task_ids
      FROM routed WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient
  ),
  per_rule AS (
    SELECT tenant_id, permit_id, recipient, rule,
           max(clause) AS clause, count(*)::integer AS n
      FROM routed WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient, rule
  ),
  grouped AS (
    SELECT tenant_id, permit_id, recipient,
           sum(n)::integer AS task_count,
           string_agg(clause, '; ' ORDER BY clause) AS detail
      FROM per_rule GROUP BY tenant_id, permit_id, recipient
  ),
  logged AS (
    INSERT INTO public.permit_task_auto_closures
      (tenant_id, permit_id, reason, recipient, task_count, closed_at, detail, task_ids)
    SELECT g.tenant_id, g.permit_id, 'superseded', g.recipient, g.task_count,
           v_now, 'Closed because ' || g.detail || '.', i.task_ids
      FROM grouped g
      JOIN ids i ON i.tenant_id = g.tenant_id AND i.permit_id = g.permit_id
                AND i.recipient = g.recipient
    RETURNING 1
  )
  SELECT COALESCE((SELECT sum(task_count) FROM grouped), 0)::integer INTO v_count;

  RETURN v_count;
END;
$function$;
