-- fix-355: 56 bot tasks are asking for work the permit already did.
--
-- Register #102, Bobby: *"I think that goes to the bot tasks as well — like, did
-- this get accepted and it's out for corrections? If there's conflicting stuff
-- like that, we want to mark it off and create a notification for it. That way,
-- things are progressing, tasks aren't piling up if they're not applicable."*
--
-- ★★ THIS IS fix-354'S SECOND WRITER, and it uses fix-354's mechanism rather
-- than growing a second one: the same ledger, the same grouping, the same
-- routing ladder, the same personal board item.
--
-- ★★★ THE SHAPE OF WHAT THIS FIXES, in one row: a task created 2026-06-16
-- asking somebody to verify that 7133442-CN's intake was submitted — on a
-- permit whose intake the city had ACCEPTED on 2026-06-15, the day before. It
-- has been open for 64 days asking a question the city had already answered.
--
-- ---------------------------------------------------------------------------
-- ★★ WHAT WAS DELIBERATELY LEFT OUT
-- ---------------------------------------------------------------------------
-- ★ `intake_accepted` IS NOT A RULE. fix-354 §5 measured it at 0 of 17 — it
-- would never have fired. A rule that never fires is a rule nobody can audit
-- and nobody can trust, and its absence here is a decision, not an omission.
-- Re-adding it should be a deliberate act with a fresh measurement behind it.
--
-- ★ `results_ready` is likewise untouched. fix-337 decided that task exists
-- BECAUSE the permit issued, and 65 are open. Nothing here closes one.

-- ---------------------------------------------------------------------------
-- ★★★ 1. FIVE RULES, EACH SEPARATELY NAMED AND SEPARATELY COUNTABLE
-- ---------------------------------------------------------------------------
--
-- ★ NOT ONE `superseded` BUCKET on the task. When one of these is wrong — and
-- one will be — Bobby must be able to name it and it must be disableable
-- without touching the other four. So each closed task carries its own reason,
-- and the run report below counts them separately.
--
-- ★★★ AND EVERY RULE FIRES ON EVIDENCE THE CITY PRODUCED. The field-ownership
-- policy settles which columns those are: `permit_cycles.submitted`,
-- `.resubmitted`, `.corr_issued` and `permits.approval_date` / `.actual_issue`
-- are PORTAL-CANONICAL (the scraper overwrites the DB whenever the portal
-- differs). `permit_cycles.intake_accepted` is portal fill-only-when-NULL.
--
-- ★★ TWO COLUMNS IN THIS TICKET ARE CLIENT-WRITABLE AND I AM SAYING SO, because
-- §3 asks for exactly that: `permits.num` and `permits.status` both reach the
-- database through useUpdatePermit's `Partial<Permit>` patch, so a person can
-- type either. Neither rule below rests on one alone:
--
--     number_present   the number is present AND some cycle carries a
--                      portal-canonical `submitted` — the city has a record of
--                      the thing the task is asking about.
--     status_matched   the dashboard status now equals the PORTAL'S OWN WORDS,
--                      captured in the task's text when the mismatch was
--                      raised, AND the permit has been scraped since that task
--                      was created (permits.updated_at > created_at — the
--                      column fix-298 already relies on for "the portal moved").
--
-- Measured: strengthening those two cost nothing — 7 and 15 rows either way.
ALTER TABLE public.permit_tasks
  DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check;
ALTER TABLE public.permit_tasks
  ADD CONSTRAINT permit_tasks_auto_closed_reason_check
  CHECK (auto_closed_reason IS NULL OR auto_closed_reason IN (
    'permit_issued',                -- fix-337
    'superseded_intake_accepted',   -- the city accepted the intake this asks about
    'superseded_next_cycle',        -- the city moved to a later cycle
    'superseded_resubmitted',       -- the city recorded our resubmission
    'superseded_status_matched',    -- the dashboard now matches the portal
    'superseded_number_present'     -- the number is in, and the city has the permit
  ));

-- ---------------------------------------------------------------------------
-- 2. The ledger learns a second reason, and a sentence
-- ---------------------------------------------------------------------------
--
-- ★★ THE NOTIFICATION GRAIN STAYS ONE PER PERMIT PER PERSON — fix-354's rule,
-- unchanged. Measured: 56 tasks over 46 permits. Grouping by (permit, rule,
-- recipient) would have given 54, which is a flood wearing a hat; grouping by
-- (permit, recipient) gives 46.
--
-- ★★★ SO THE RULE NAMES MOVE INTO A SENTENCE, not into the grouping key. §2 is
-- explicit that the reader must be able to check the judgement: *"closed because
-- the permit was resubmitted on 2026-08-11, which is past this task's cycle"*.
-- fix-354's items report a FACT (the permit issued — you cannot argue with it);
-- these report a JUDGEMENT, and a judgement the reader cannot check is one they
-- cannot overturn. `detail` carries that sentence, with the city's own dates in
-- it, and names every rule that fired on that permit.
ALTER TABLE public.permit_task_auto_closures
  DROP CONSTRAINT IF EXISTS permit_task_auto_closures_reason_check;
ALTER TABLE public.permit_task_auto_closures
  ADD CONSTRAINT permit_task_auto_closures_reason_check
  CHECK (reason IN ('permit_issued', 'superseded'));

ALTER TABLE public.permit_task_auto_closures
  ADD COLUMN IF NOT EXISTS detail text;

COMMENT ON COLUMN public.permit_task_auto_closures.detail IS
  'fix-355: the sentence that lets a reader CHECK the judgement — which rule '
  'fired and what the city did, with its date. Null for fix-354''s permit_issued '
  'rows, which report a fact rather than a judgement.';

-- ---------------------------------------------------------------------------
-- ★★★ 3. WHAT COUNTS AS "A PERSON HAS TOUCHED THIS"
-- ---------------------------------------------------------------------------
--
-- ★★ Somebody working on a task disagrees with the machine, and they are the one
-- with hands on the problem. So a touched task is left alone and reported.
--
-- ★★★ AND `start_date` IS NOT ONE OF THE SIGNALS, which is a correction to the
-- obvious list and the single most important thing in this file.
--
-- ALL 56 of the candidates carry a start_date — not because anyone touched them
-- but because fix-292 and then fix-349 set it AT CREATION, from the city's own
-- date. On a HUMAN's task a start_date means somebody started it (fix-268's
-- trigger stamps it on the first transition into In Progress). On a BOT task it
-- means the row was born. Using it here would have spared all 56 and shipped a
-- writer that closes nothing — the exact failure mode of a guard written from
-- first principles instead of from the data.
--
-- ★ The signals that ARE meaningful on a bot task:
--     completion_status = 'In Progress'   somebody moved it
--     notes                               somebody wrote on it
--     a co-assignee a person added        (source='manual' — fix-346's own
--                                          dm_of_da rows are the machine's)
--     a human UPDATE in permit_task_audit somebody edited it (fix-272, capturing
--                                          since 2026-08-03, actor_uid non-null)
--
-- Measured against the 56 today: NOT ONE is touched by any of those. Nobody has
-- opened any of them, which is the finding as much as the count is.
CREATE OR REPLACE FUNCTION public.bp_task_touched_by_person(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.permit_tasks t
     WHERE t.id = p_task_id
       AND (
         t.completion_status = 'In Progress'
         OR NULLIF(btrim(t.notes), '') IS NOT NULL
         OR COALESCE(array_length(t.co_assignees, 1), 0) > 0
         OR EXISTS (SELECT 1 FROM public.permit_task_assignees a
                     WHERE a.task_id = t.id AND a.source = 'manual')
         OR EXISTS (SELECT 1 FROM public.permit_task_audit u
                     WHERE u.task_id = t.id AND u.op = 'UPDATE'
                       AND u.actor_uid IS NOT NULL)
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.bp_task_touched_by_person(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_task_touched_by_person(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.bp_task_touched_by_person(uuid) IS
  'fix-355: has a person worked on this task? Deliberately NOT start_date — '
  'fix-292/fix-349 set that at creation on every bot task, so it says the row '
  'was born, not that anyone started it.';

-- ---------------------------------------------------------------------------
-- ★★★ 4. THE WRITER — one permit, all five rules, close and tell together
-- ---------------------------------------------------------------------------
--
-- ★★ SAME TRANSACTION AS THE CLOSE, exactly as fix-354. A close that commits
-- while its notification fails is fix-337's failure returning as a race.
--
-- ★ Returns the number of TASKS closed, matching fix-354's convention.
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
    SELECT cl.tenant_id,
           cl.permit_id,
           public.bp_auto_close_recipient(cl.assigned_to, cl.permit_id) AS recipient,
           cl.rule,
           cl.clause
      FROM closed cl
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
      (tenant_id, permit_id, reason, recipient, task_count, closed_at, detail)
    SELECT tenant_id, permit_id, 'superseded', recipient, task_count, v_now,
           'Closed because ' || detail || '.'
      FROM grouped
    RETURNING 1
  )
  SELECT COALESCE((SELECT sum(task_count) FROM grouped), 0)::integer INTO v_count;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_supersede_stale_bot_tasks(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_supersede_stale_bot_tasks(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.bp_supersede_stale_bot_tasks(integer) IS
  'fix-355: closes bot tasks the permit has moved past, five separately-named '
  'rules, each on city-produced evidence, never a task a person has worked on. '
  'Writes fix-354''s ledger in the same transaction — one row per permit per '
  'recipient, carrying a sentence the reader can check.';

-- ---------------------------------------------------------------------------
-- ★★ 5. THE FORWARD HALF — two triggers, on the two tables the evidence lives in
-- ---------------------------------------------------------------------------
--
-- ★ A trigger fires on WRITE, and a stale task is stale precisely because
-- nobody writes to it. So the evidence side is what has to be watched: the
-- cycle the city advances, and the permit whose status or number changes.
CREATE OR REPLACE FUNCTION public.bp_trg_supersede_on_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.bp_supersede_stale_bot_tasks(NEW.permit_id);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bp_trg_supersede_on_permit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.bp_supersede_stale_bot_tasks(NEW.id);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_supersede_on_cycle() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_trg_supersede_on_permit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_supersede_on_cycle() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_trg_supersede_on_permit() TO authenticated, service_role;

DROP TRIGGER IF EXISTS permit_cycles_supersede_tasks ON public.permit_cycles;
CREATE TRIGGER permit_cycles_supersede_tasks
  AFTER INSERT OR UPDATE OF submitted, intake_accepted, corr_issued, resubmitted
  ON public.permit_cycles
  FOR EACH ROW
  EXECUTE FUNCTION public.bp_trg_supersede_on_cycle();

DROP TRIGGER IF EXISTS permits_supersede_tasks ON public.permits;
CREATE TRIGGER permits_supersede_tasks
  AFTER UPDATE OF status, num ON public.permits
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status OR NEW.num IS DISTINCT FROM OLD.num)
  EXECUTE FUNCTION public.bp_trg_supersede_on_permit();

-- ---------------------------------------------------------------------------
-- ★★★ 6. THE ONE-TIME RUN — the 56 Bobby is signing off
-- ---------------------------------------------------------------------------
--
-- ★★ A TRIGGER ALONE WOULD FIX ONLY THE FUTURE. It fires on write, and a task
-- nobody touches is never written — the 64-day-old one would still be sitting
-- there. Both halves, or the ticket half-lands.
--
-- ★ It runs the SAME function the triggers call, so the one-time close and every
-- future close cannot diverge — and every row it closes gets its notification in
-- the same transaction, like any other.
DO $$
DECLARE
  v_permit RECORD;
  v_total  integer := 0;
BEGIN
  FOR v_permit IN
    SELECT DISTINCT t.permit_id
      FROM public.permit_tasks t
     WHERE t.auto_event IS NOT NULL
       AND t.completion_status <> 'Resolved'
       AND COALESCE(t.done, false) = false
  LOOP
    v_total := v_total + public.bp_supersede_stale_bot_tasks(v_permit.permit_id);
  END LOOP;
  RAISE NOTICE 'fix-355: closed % superseded bot tasks', v_total;
END $$;
