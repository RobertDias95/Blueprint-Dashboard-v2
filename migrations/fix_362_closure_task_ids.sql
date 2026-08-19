-- ===========================================================================
-- ★★ fix-362 § 1 — the ledger records WHICH tasks, not only how many
-- ===========================================================================
--
-- Bobby: "anytime you get a notification, you can click it and go to where that
-- item is occurring."
--
-- ★★★ `permit_task_auto_closures` is the ONE notification source that could
-- not answer that from what it already stored. Its grain is (permit, closure,
-- recipient) over N tasks, and it kept `task_count` — enough to say "1 task
-- closed", not enough to take you to it. MEASURED on prod: 48 of the 55
-- closures covered exactly one task, so the case the brief names is the common
-- one, and the missing fact is one column wide.
--
-- ★ NO ROW IS EDITED. The column is added nullable and left NULL on all 55
-- existing rows; those notifications keep landing on the permit, which is
-- exactly where they landed before. Backfilling them is impossible honestly
-- anyway — the closing transaction is the only moment that knows which rows it
-- closed, and reconstructing it later from "resolved tasks on this permit"
-- would sweep up everything closed since for any other reason.
--
-- ★ Both writers are re-emitted VERBATIM from migrations/fix_354 and fix_355
-- with only the CTE changes below. `pg_get_functiondef` comes back truncated
-- through the MCP tool (fix-337's lesson), so the committed migrations are the
-- source these were rebuilt from, not the live definition.

ALTER TABLE public.permit_task_auto_closures
  ADD COLUMN IF NOT EXISTS task_ids uuid[];

COMMENT ON COLUMN public.permit_task_auto_closures.task_ids IS
  'fix-362: the permit_tasks rows this closure covered, recorded by the closing '
  'transaction. NULL on rows written before fix-362 — those notifications land '
  'on the permit. One id means the notification opens that task; several means '
  'it opens the permit, because a grouped item gets ONE destination.';

-- ---------------------------------------------------------------------------
-- ★ The two writers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_clear_tasks_for_issued_permit(p_permit_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count  integer := 0;
  v_now    timestamptz := now();
BEGIN
  -- ★ RETURNING feeds the ledger, so the notification is built from the rows
  -- that were ACTUALLY closed rather than from a second query that could see a
  -- different world.
  WITH closed AS (
    UPDATE public.permit_tasks t
       SET completion_status = 'Resolved',
           auto_closed_reason = 'permit_issued'
     WHERE t.permit_id = p_permit_id
       AND t.completion_status <> 'Resolved'
       AND COALESCE(t.done, false) = false
       -- ★ The exception that makes the rule honest: this task EXISTS because
       -- the permit issued. (fix-337, unchanged.)
       AND t.auto_event IS DISTINCT FROM 'results_ready'
       AND EXISTS (
         SELECT 1 FROM public.permits p
         WHERE p.id = t.permit_id AND p.actual_issue IS NOT NULL
       )
    RETURNING t.id, t.tenant_id, t.permit_id, t.assigned_to
  ),
  routed AS (
    SELECT c.id,
           c.tenant_id,
           c.permit_id,
           public.bp_auto_close_recipient(c.assigned_to, c.permit_id) AS recipient
      FROM closed c
  ),
  grouped AS (
    SELECT tenant_id, permit_id, recipient,
           count(*)::integer AS task_count,
           -- ★★ fix-362: WHICH tasks, not just how many. The ledger already
           -- knew the count; the notification could therefore say "1 task
           -- closed" and still only be able to take you to the permit. These
           -- are the ids of the rows this very statement closed, aggregated in
           -- the same transaction — not a later guess from a permit and a
           -- count, which would pick up anything else closed since.
           array_agg(id) AS task_ids
      FROM routed
     -- ★ A row with no recipient is dropped rather than written with a null:
     -- the table would refuse it anyway (NOT NULL), and measured on the real
     -- 103 this branch is never taken. It is here so a permit stripped of its
     -- whole team cannot abort somebody's issuance.
     WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient
  ),
  logged AS (
    INSERT INTO public.permit_task_auto_closures
      (tenant_id, permit_id, reason, recipient, task_count, closed_at, task_ids)
    SELECT tenant_id, permit_id, 'permit_issued', recipient, task_count, v_now,
           task_ids
      FROM grouped
    RETURNING 1
  )
  SELECT COALESCE((SELECT sum(task_count) FROM grouped), 0)::integer INTO v_count;

  -- ★ The count this returns is unchanged in meaning: tasks closed. It is read
  -- by fix-337's one-time backfill block, which must keep reporting tasks and
  -- not notifications.
  RETURN v_count;
END;
$function$;

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
    SELECT t.id,
           t.tenant_id,
           t.permit_id,
           t.assigned_to,
           t.auto_event,
           t.cycle_idx,
           t.text,
           t.created_at,
           p.num,
           p.status,
           p.updated_at    AS permit_updated_at,
           p.approval_date,
           p.actual_issue,
           c.intake_accepted,
           c.resubmitted,
           (SELECT count(*) FROM public.permit_cycles n
             WHERE n.permit_id = t.permit_id
               AND n.cycle_index > t.cycle_idx
               AND (n.submitted IS NOT NULL
                    OR n.corr_issued IS NOT NULL
                    OR n.intake_accepted IS NOT NULL)) AS later_city_cycle
      FROM public.permit_tasks t
      JOIN public.permits p ON p.id = t.permit_id
      LEFT JOIN public.permit_cycles c
             ON c.permit_id = t.permit_id AND c.cycle_index = t.cycle_idx
     WHERE t.permit_id = p_permit_id
       AND t.auto_event IS NOT NULL
       AND t.completion_status <> 'Resolved'
       AND COALESCE(t.done, false) = false
       -- ★ Never a task somebody is working on.
       AND NOT public.bp_task_touched_by_person(t.id)
  ),
  ruled AS (
    SELECT c.*,
           CASE
             -- ★ The city recorded our resubmission, so "send the corrections
             -- to the consultants" is a round we have already been through.
             WHEN c.auto_event = 'corr_issued' AND c.resubmitted IS NOT NULL
               THEN 'superseded_resubmitted'
             -- ★ A later cycle the city has acted on — the resubmission this
             -- asks about was plainly accepted.
             WHEN c.auto_event = 'resubmitted' AND c.later_city_cycle > 0
               THEN 'superseded_next_cycle'
             -- ★★ THE 16-JUNE SHAPE. The city accepted the intake, and the
             -- permit has moved on since.
             WHEN c.auto_event = 'intake_submitted'
              AND c.intake_accepted IS NOT NULL
              AND (c.later_city_cycle > 0
                   OR c.approval_date IS NOT NULL
                   OR c.actual_issue IS NOT NULL)
               THEN 'superseded_intake_accepted'
             -- ★ The mismatch resolved itself: the dashboard now shows the
             -- PORTAL'S OWN WORDS, captured in the task when it was raised, and
             -- the scraper has looked at this permit since.
             WHEN c.auto_event = 'scrape_reconcile'
              AND lower(COALESCE(c.status, '')) =
                  lower(COALESCE(btrim(substring(c.text from 'portal shows (.*?) — dashboard shows')), ''))
              AND c.permit_updated_at > c.created_at
               THEN 'superseded_status_matched'
             -- ★ The number is in, and the city has a submitted record of it.
             WHEN c.auto_event = 'number_entry'
              AND NULLIF(btrim(c.num), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.permit_cycles z
                           WHERE z.permit_id = c.permit_id AND z.submitted IS NOT NULL)
               THEN 'superseded_number_present'
             ELSE NULL
           END AS rule
      FROM candidate c
  ),
  -- ★★ The sentence a reader can CHECK, with the city's own date in it.
  explained AS (
    SELECT r.*,
           CASE r.rule
             WHEN 'superseded_resubmitted' THEN
               'the city recorded a resubmission on ' || r.resubmitted::text
             WHEN 'superseded_next_cycle' THEN
               'the permit has moved to a later review cycle'
             WHEN 'superseded_intake_accepted' THEN
               'the city accepted the intake on ' || r.intake_accepted::text
             WHEN 'superseded_status_matched' THEN
               'the dashboard now shows what the portal showed (' ||
               COALESCE(btrim(substring(r.text from 'portal shows (.*?) — dashboard shows')), '?') || ')'
             WHEN 'superseded_number_present' THEN
               'the permit number ' || COALESCE(btrim(r.num), '') || ' is on file'
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
    SELECT cl.id,
           cl.tenant_id,
           cl.permit_id,
           public.bp_auto_close_recipient(cl.assigned_to, cl.permit_id) AS recipient,
           cl.rule,
           cl.clause
      FROM closed cl
  ),
  -- ★★ fix-362: the ids, gathered ONCE from `routed` rather than carried
  -- through `per_rule`. That CTE groups by rule so a permit closed under two
  -- rules is two of its rows, and threading arrays through it would mean
  -- concatenating arrays in an aggregate — which Postgres has no built-in for,
  -- and which would be three lines of cleverness in the middle of the one
  -- statement that must not go wrong on an issuance.
  ids AS (
    SELECT tenant_id, permit_id, recipient, array_agg(id) AS task_ids
      FROM routed
     WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient
  ),
  -- ★★ ONE CLAUSE PER RULE, not one per task. Two corrections rounds closed on
  -- one permit are two rows with two dates, and saying "the city recorded a
  -- resubmission on 21 Jul; the city recorded a resubmission on 29 Jul" is
  -- accurate and unreadable. `max(clause)` picks the latest, because every
  -- date-bearing clause ends in an ISO date and ISO dates sort as text.
  per_rule AS (
    SELECT tenant_id, permit_id, recipient, rule,
           max(clause) AS clause,
           count(*)::integer AS n
      FROM routed
     WHERE recipient IS NOT NULL
     GROUP BY tenant_id, permit_id, recipient, rule
  ),
  grouped AS (
    SELECT tenant_id,
           permit_id,
           recipient,
           sum(n)::integer AS task_count,
           -- ★ Every rule that fired on this permit, once each, in one sentence.
           string_agg(clause, '; ' ORDER BY clause) AS detail
      FROM per_rule
     GROUP BY tenant_id, permit_id, recipient
  ),
  logged AS (
    INSERT INTO public.permit_task_auto_closures
      (tenant_id, permit_id, reason, recipient, task_count, closed_at, detail,
       task_ids)
    SELECT g.tenant_id, g.permit_id, 'superseded', g.recipient, g.task_count,
           v_now, 'Closed because ' || g.detail || '.', i.task_ids
      FROM grouped g
      JOIN ids i
        ON i.tenant_id = g.tenant_id
       AND i.permit_id = g.permit_id
       AND i.recipient = g.recipient
    RETURNING 1
  )
  SELECT COALESCE((SELECT sum(task_count) FROM grouped), 0)::integer INTO v_count;

  RETURN v_count;
END;
$function$;
