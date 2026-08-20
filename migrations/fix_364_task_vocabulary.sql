-- ===========================================================================
-- fix-364 — three places a task describes itself badly
-- ===========================================================================
--
-- ★★ §1 RENAMES A STORED VALUE ON EXISTING ROWS, which is the one data change
-- this ticket makes and it is approved. Everything else here is DDL.
--
-- ---------------------------------------------------------------------------
-- ★★★ §1 · A reason code that reads like the rule Bobby EXCLUDED
-- ---------------------------------------------------------------------------
--
-- fix-355 named one of its closure rules `superseded_intake_accepted`. It
-- closed 13 tasks — all of them "Verify: intake submitted / fees paid" on
-- permits where the city has SINCE accepted intake. The name describes the
-- EVIDENCE.
--
-- ★★★ But Bobby's instruction for that ticket was literally "build it, minus
-- intake_accepted" — he excluded a DIFFERENT rule, one that would have closed
-- tasks whose own job IS intake_accepted (measured then: it would have closed
-- 0 of 17). Two different things, near-identical names, sitting next to each
-- other in the same feed.
--
-- ★ One concept, one term: `superseded_by_intake_acceptance`.
--
-- ★★ MEASURED before writing: exactly 13 rows carry the old value in
-- permit_tasks.auto_closed_reason, and nowhere else in the database does the
-- string appear as a CODE (the 13 matches in permit_task_auto_closures.detail
-- are fix-355's human evidence sentence — "the city accepted the intake on
-- 2026-07-21" — which is prose, reads correctly, and is deliberately left
-- alone). The brief's "~60 rows" is the count of ALL superseded_* rows
-- (15+15+13+8+7 = 58); this rule's share is 13.
--
-- ★ The CHECK constraint is replaced FIRST-CLASS rather than dropped: leaving
-- both spellings legal is exactly the "both in circulation" state this fixes.

-- The constraint has to allow the new value before any row can hold it.
ALTER TABLE public.permit_tasks
  DROP CONSTRAINT IF EXISTS permit_tasks_auto_closed_reason_check;

UPDATE public.permit_tasks
   SET auto_closed_reason = 'superseded_by_intake_acceptance'
 WHERE auto_closed_reason = 'superseded_intake_accepted';

ALTER TABLE public.permit_tasks
  ADD CONSTRAINT permit_tasks_auto_closed_reason_check
  CHECK (auto_closed_reason IS NULL OR auto_closed_reason IN (
    'permit_issued',                     -- fix-337
    -- ★ fix-364: renamed from superseded_intake_accepted. "by intake
    -- acceptance" says the city's acceptance OVERTOOK this task; the old name
    -- read as "the intake_accepted rule", which is the one that was excluded.
    'superseded_by_intake_acceptance',
    'superseded_next_cycle',             -- the city moved to a later cycle
    'superseded_resubmitted',            -- the city recorded our resubmission
    'superseded_status_matched',         -- the dashboard now matches the portal
    'superseded_number_present'          -- the number is in, and the city has it
  ));

-- ★ The WRITER, re-emitted from migrations/fix_362_closure_task_ids.sql (which
-- itself carries fix-355's body plus fix-362's task_ids) with ONE string
-- changed. pg_get_functiondef comes back truncated through the MCP tool
-- (fix-337's lesson), so the committed migration is the source.
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
               THEN 'superseded_by_intake_acceptance'
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
             WHEN 'superseded_by_intake_acceptance' THEN
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


-- ---------------------------------------------------------------------------
-- ★★ §2 · Four identical rows on one address
-- ---------------------------------------------------------------------------
--
-- ★ A LABELLING FIX, NOT A DUPLICATE BUG. Verified before touching anything:
-- 4 duplicate groups portfolio-wide, 6 excess rows, none of them open. There is
-- no de-duplication problem to hunt for.
--
-- ★★ NO EXISTING TASK TEXT IS REWRITTEN — the rule for this ticket is that only
-- §1 touches rows. The rows on somebody's board today are fixed by the DISPLAY
-- (src/lib/permitDiscriminator.ts, applied on the board and on My Tasks), and
-- this generator stops new ones being born ambiguous.
--
-- ★ Re-emitted from migrations/fix_349_par_template_and_wac.sql with the three
-- edits marked inside.

CREATE OR REPLACE FUNCTION public.bp_create_lifecycle_task(p_tenant_id uuid, p_permit_id integer, p_event text, p_cycle_idx integer DEFAULT NULL::integer, p_context jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_permit         public.permits%ROWTYPE;
  v_cycle          public.permit_cycles%ROWTYPE;
  v_project_addr   text;
  v_num_label      text;
  v_cycle_label    text;
  v_title          text;
  v_bucket         text;
  v_city_check     boolean := false;
  v_priority       boolean := false;
  v_notes          text;
  v_new_id         uuid;
  v_target_days    constant integer := 1;   -- fix-292
  -- fix-349: the date the CITY acted, filled in below per event. NULL until
  -- then; COALESCE'd to current_date at the point of use so it is never null.
  v_city_date      date;
  v_start          date;
  v_target         date;
  -- ★★ fix-364 §2: which of the siblings this is. NULL unless the permit
  -- actually HAS a same-type sibling on the same project — 484 of 542
  -- permits are the only one of their type, and a discriminator on those
  -- is noise on hundreds of rows to serve the 58 that need it.
  v_siblings       integer;
  v_discriminator  text;
BEGIN
  IF p_event NOT IN
     ('intake_submitted','intake_accepted','corr_issued','resubmitted','number_entry','scrape_reconcile','results_ready')
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: unknown event %', p_event
      USING ERRCODE = '22023';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_permit
  FROM public.permits
  WHERE id = p_permit_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bp_create_lifecycle_task: permit % not found in tenant %',
      p_permit_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ★★ fix-337: a verification task for a stage the permit has already left is
  -- work that no longer applies. Only the issuance's own task survives here.
  IF v_permit.actual_issue IS NOT NULL AND p_event <> 'results_ready' THEN
    RETURN NULL;
  END IF;

  SELECT address INTO v_project_addr
  FROM public.projects WHERE id = v_permit.project_id;

  -- ★★★ fix-349: the city's own date for THIS event. See the header for why
  -- number_entry and scrape_reconcile deliberately have none.
  IF p_cycle_idx IS NOT NULL
     AND p_event IN ('intake_submitted','intake_accepted','corr_issued','resubmitted')
  THEN
    SELECT * INTO v_cycle
    FROM public.permit_cycles
    WHERE permit_id = p_permit_id AND cycle_index = p_cycle_idx;
  END IF;

  v_city_date := CASE p_event
    WHEN 'intake_submitted' THEN v_cycle.submitted
    WHEN 'intake_accepted'  THEN v_cycle.intake_accepted
    WHEN 'corr_issued'      THEN v_cycle.corr_issued
    WHEN 'resubmitted'      THEN v_cycle.resubmitted
    WHEN 'results_ready'    THEN
      CASE WHEN COALESCE(p_context->>'basis', 'issued') = 'approved'
           THEN v_permit.approval_date
           ELSE v_permit.actual_issue
      END
    ELSE NULL                       -- number_entry, scrape_reconcile
  END;

  -- Never in the future, never null.
  v_start  := COALESCE(LEAST(v_city_date, current_date), current_date);
  -- ★ Anchored to today, NOT to v_start — see the header. A task is not born
  -- overdue because the scraper was catching up.
  v_target := current_date + v_target_days;

  -- ★★★ fix-364 §2 — FOUR IDENTICAL ROWS ON ONE ADDRESS.
  --
  -- "Enter permit number — was this submitted? — Building Permit @ 11231 NE
  -- 67th St", four times, because that address has FOUR Building Permits. The
  -- title carried the TYPE and the ADDRESS but not the PERMIT — and for a
  -- number_entry task the permit has no number yet, which is the point of the
  -- task.
  --
  -- ★ MEASURED: of the 58 permits that share a project AND a type with a
  -- sibling, 54 carry `struct_address` ("Cottage 1".."Cottage 4" at this very
  -- address), 51 carry a number, and NONE of the 542 permits in the portfolio
  -- carries a nickname. So struct_address is the working answer, nickname
  -- outranks it if anybody ever fills it in, and the permit id is the honest
  -- last resort.
  --
  -- ★★ EVERY CANDIDATE IS A STORED FIELD OR AN IMMUTABLE ID. Nothing here is
  -- derived from position or count: "the 2nd of 4" renumbers the moment a
  -- sibling is deleted, and a label that changes under a person is worse than
  -- a duplicate. The TS mirror of this rule is src/lib/permitDiscriminator.ts.
  SELECT count(*) INTO v_siblings
  FROM public.permits p
  WHERE p.project_id = v_permit.project_id
    AND lower(btrim(COALESCE(p.type, ''))) = lower(btrim(COALESCE(v_permit.type, '')));

  IF COALESCE(v_siblings, 0) > 1 THEN
    v_discriminator := COALESCE(
      NULLIF(btrim(v_permit.nickname), ''),
      NULLIF(btrim(v_permit.struct_address), ''),
      NULLIF(btrim(v_permit.num), ''),
      'Permit #' || v_permit.id::text);
  END IF;

  -- ★★ AND IT FIXES EVERY EVENT, not only number_entry. `v_num_label` falls
  -- back to 'no number yet', so four numberless siblings produced four
  -- identical "Verify: intake submitted / fees paid — no number yet" rows too.
  -- Naming the permit here fixes the whole family in one place.
  v_num_label   := COALESCE(
    NULLIF(btrim(v_permit.num), ''),
    CASE WHEN v_discriminator IS NOT NULL
         THEN 'no number yet — ' || v_discriminator
         ELSE 'no number yet' END);
  v_cycle_label := COALESCE(p_cycle_idx::text, '?');

  IF p_event = 'number_entry' THEN
    v_bucket := 'de';
  ELSIF p_event = 'scrape_reconcile' THEN
    SELECT CASE WHEN c.intake_accepted IS NOT NULL THEN 'pm' ELSE 'de' END
      INTO v_bucket
    FROM public.permit_cycles c
    WHERE c.permit_id = p_permit_id AND c.cycle_index = 0;
    v_bucket := COALESCE(v_bucket, 'de');
  ELSE
    v_bucket := 'pm';
  END IF;

  CASE p_event
    WHEN 'intake_submitted' THEN
      v_title := 'Verify: intake submitted / fees paid — ' || v_num_label;
      v_city_check := true;
    WHEN 'intake_accepted' THEN
      v_title := 'Verify: intake accepted — reviews starting — ' || v_num_label;
    WHEN 'corr_issued' THEN
      v_title := 'Corrections issued (cycle ' || v_cycle_label
                 || ') — send to consultants — ' || v_num_label;
      v_priority := true;
    WHEN 'resubmitted' THEN
      v_title := 'Verify: city accepted resubmission (cycle ' || v_cycle_label
                 || ') — ' || v_num_label;
      v_city_check := true;
    WHEN 'number_entry' THEN
      -- ★ This event's title names the TYPE and the ADDRESS rather than
      -- v_num_label, because the missing number is the subject of the task.
      -- The discriminator is appended, so four cottages read as four rows.
      v_title := 'Enter permit number — was this submitted? — '
                 || COALESCE(NULLIF(btrim(v_permit.type), ''), 'permit')
                 || ' @ ' || COALESCE(NULLIF(btrim(v_project_addr), ''), 'project')
                 || COALESCE(' — ' || v_discriminator, '');
    WHEN 'scrape_reconcile' THEN
      v_title := 'Reconcile: portal shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'observed_status'), 60), ''), '?')
                 || ' — dashboard shows '
                 || COALESCE(NULLIF(left(btrim(p_context->>'db_status'), 60), ''), '?')
                 || ' — ' || v_num_label;
      v_priority := true;
    WHEN 'results_ready' THEN
      IF COALESCE(p_context->>'basis', 'issued') = 'approved' THEN
        v_title := 'Permit approved — send out results — ' || v_num_label;
      ELSE
        v_title := 'Permit issued — send out approved plans / results — ' || v_num_label;
      END IF;
      v_priority := true;
  END CASE;

  v_notes := NULLIF(p_context->>'notes', '');

  IF p_event = 'scrape_reconcile' THEN
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_target                                          -- fix-349
    )
    ON CONFLICT (tenant_id, permit_id)
      WHERE is_auto_generated = true
        AND auto_event = 'scrape_reconcile'
        AND completion_status <> 'Resolved'
    DO NOTHING
    RETURNING id INTO v_new_id;
  ELSE
    INSERT INTO public.permit_tasks (
      tenant_id, permit_id, text, discipline, bucket, stage,
      completion_status, done, is_auto_generated, auto_event, cycle_idx,
      city_acceptance_check, priority, notes, sort_order,
      start_date, target_date
    ) VALUES (
      p_tenant_id, p_permit_id, v_title, 'ent', v_bucket, v_bucket,
      'Open', false, true, p_event, p_cycle_idx,
      v_city_check, v_priority, v_notes, 0,
      v_start, v_target                                          -- fix-349
    )
    ON CONFLICT (tenant_id, permit_id, auto_event, COALESCE(cycle_idx, -1))
      WHERE is_auto_generated = true AND auto_event <> 'scrape_reconcile'
    DO NOTHING
    RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END;
$function$;
