-- ===========================================================================
-- ★★★ fix-363 — who gave me this, and who closed it
-- ===========================================================================
--
-- Bobby: "In the task, who created it, assigned it… you should be able to open
-- up the task and see who created it and who assigned it to you, because you
-- want to be able to reach out to that person… And then who marked it complete,
-- kind of like a timestamp."
--
-- ---------------------------------------------------------------------------
-- ★★★ MEASURED FIRST, and it decides the shape of the whole ticket
-- ---------------------------------------------------------------------------
-- Prod, 2026-08-20:
--
--     tasks                                    1,361
--     …with ANY audit row                        737   (capture began 2026-08-04)
--     …with none, and never will have             636
--     completions with done_at                    884
--     …audited                                    455
--     …audited WITH an actor                      295
--     bot-created tasks (is_auto_generated)       597
--     machine-closed tasks (auto_closed_reason)   173
--
-- ★★★ AND THE HEADLINE FACT: `assigned_to` IS NOT IN THE AUDIT AT ALL. The one
-- sentence Bobby asked for — "Briana assigned you a task" — could not be built
-- from anything stored, because the column that would answer it was never
-- watched. So recording it IS the ticket; the display is what follows.
--
-- ★★ NO BACKFILL, AND NONE IS HONEST. fix-272 wrote the same sentence for the
-- same reason: the prior values exist nowhere. 636 tasks have no history and a
-- plausible guess — the permit's ENT lead, the current assignee, the nearest
-- creation in time — would be worse than a gap, because nobody checks a name
-- that looks right. Every statement below is DDL. Not one row is written.

-- ---------------------------------------------------------------------------
-- ★ A. The two new pairs
-- ---------------------------------------------------------------------------
--
-- ★★ CO-ASSIGNEES NEEDED A SECOND TRIGGER, and the brief anticipated the
-- question ("if it cannot see it, say so"). fix-224 moved co-assignment onto the
-- `permit_task_assignees` JOIN TABLE, so a row trigger on `permit_tasks` cannot
-- see it — there is no OLD/NEW to compare. The answer was not to half-do it but
-- to put a sibling trigger on the table where the fact actually lives, writing
-- into this same audit so one query still answers a task's whole history.
ALTER TABLE public.permit_task_audit
  ADD COLUMN IF NOT EXISTS assigned_to_from   text,
  ADD COLUMN IF NOT EXISTS assigned_to_to     text,
  ADD COLUMN IF NOT EXISTS co_assignee_added   text,
  ADD COLUMN IF NOT EXISTS co_assignee_removed text;

COMMENT ON COLUMN public.permit_task_audit.assigned_to_to IS
  'fix-363: the PRIMARY assignee after the change. NULL on every row written '
  'before 2026-08-20 — an absent value means "not recorded", never "nobody".';
COMMENT ON COLUMN public.permit_task_audit.co_assignee_added IS
  'fix-363: written by the permit_task_assignees trigger, not the permit_tasks '
  'one — co-assignment lives on a join table (fix-224) and has no OLD/NEW on '
  'the task row.';

-- ---------------------------------------------------------------------------
-- ★ B. The task trigger — fix-272's, plus assigned_to
-- ---------------------------------------------------------------------------
--
-- ★ Re-emitted from migrations/fix_272_permit_task_audit.sql with THREE edits:
-- `assigned_to` joins the UPDATE guard, and the pair is written on all three
-- ops. Every other rule — the early return, AFTER-not-BEFORE, the denormalised
-- project_id, one row per statement — is fix-272's and is unchanged.
-- (`pg_get_functiondef` comes back truncated through the MCP tool, so this was
-- rebuilt from the committed migration, not from the live definition.)
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
    -- fix-272's guard, with fix-363's field added. A rename of the task text
    -- still writes nothing.
    IF NEW.target_date       IS NOT DISTINCT FROM OLD.target_date
       AND NEW.start_date        IS NOT DISTINCT FROM OLD.start_date
       AND NEW.completion_status IS NOT DISTINCT FROM OLD.completion_status
       AND NEW.waiting_on        IS NOT DISTINCT FROM OLD.waiting_on
       AND NEW.assigned_to       IS NOT DISTINCT FROM OLD.assigned_to THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT p.project_id INTO v_project FROM public.permits p WHERE p.id = v_permit;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to,
      assigned_to_from, assigned_to_to)
    VALUES (
      txid_current()::text, OLD.tenant_id, OLD.id, OLD.permit_id, v_project,
      'DELETE', auth.uid(), v_source,
      OLD.target_date, NULL,
      OLD.start_date, NULL,
      OLD.completion_status, NULL,
      OLD.waiting_on, NULL,
      OLD.assigned_to, NULL);
    RETURN NULL;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to,
      assigned_to_from, assigned_to_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.id, NEW.permit_id, v_project,
      'INSERT', auth.uid(), v_source,
      NULL, NEW.target_date,
      NULL, NEW.start_date,
      NULL, NEW.completion_status,
      NULL, NEW.waiting_on,
      NULL, NEW.assigned_to);
    RETURN NULL;
  ELSE
    INSERT INTO public.permit_task_audit (
      txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
      target_date_from, target_date_to,
      start_date_from, start_date_to,
      completion_status_from, completion_status_to,
      waiting_on_from, waiting_on_to,
      assigned_to_from, assigned_to_to)
    VALUES (
      txid_current()::text, NEW.tenant_id, NEW.id, NEW.permit_id, v_project,
      'UPDATE', auth.uid(), v_source,
      OLD.target_date, NEW.target_date,
      OLD.start_date, NEW.start_date,
      OLD.completion_status, NEW.completion_status,
      OLD.waiting_on, NEW.waiting_on,
      OLD.assigned_to, NEW.assigned_to);
    RETURN NULL;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.bp_audit_permit_task() IS
  'fix-272 + fix-363: old/new history for the five permit_tasks fields that '
  'describe consultant turnaround AND ownership (target_date, start_date, '
  'completion_status, waiting_on, assigned_to). No backfill is possible: prior '
  'values exist nowhere.';

-- ---------------------------------------------------------------------------
-- ★★ C. The co-assignee trigger — a different table, the same audit
-- ---------------------------------------------------------------------------
--
-- ★ `permit_task_assignees.source` already distinguishes fix-346's automatic
-- design-manager rows (`dm_of_da`) from a person's choice (`manual`), and it is
-- carried through so the display never has to guess. Measured: 312 rows, both
-- values present.
--
-- ★ INSERT and DELETE only. The table is an association: an assignee is added or
-- removed, never edited in place.
CREATE OR REPLACE FUNCTION public.bp_audit_task_assignee()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row     public.permit_task_assignees := COALESCE(NEW, OLD);
  v_permit  integer;
  v_project uuid;
BEGIN
  -- The task may already be gone on DELETE (permit_task_assignees.task_id is
  -- ON DELETE CASCADE), which is fine: task_id still identifies the row, and a
  -- cascade is not an assignment event anybody will read.
  SELECT t.permit_id, p.project_id INTO v_permit, v_project
    FROM public.permit_tasks t
    LEFT JOIN public.permits p ON p.id = t.permit_id
   WHERE t.id = v_row.task_id;

  INSERT INTO public.permit_task_audit (
    txid, tenant_id, task_id, permit_id, project_id, op, actor_uid, source,
    co_assignee_added, co_assignee_removed)
  VALUES (
    txid_current()::text, v_row.tenant_id, v_row.task_id, v_permit, v_project,
    CASE WHEN TG_OP = 'INSERT' THEN 'COASSIGN' ELSE 'COUNASSIGN' END,
    auth.uid(),
    -- ★ THE MACHINE'S OWN MARK. fix-346's trigger writes `dm_of_da`; a person
    -- writes `manual`. Carried here so the panel can say "added automatically"
    -- instead of showing a blank where a name goes — which would send Bobby to
    -- ask somebody who never touched it.
    v_row.source,
    CASE WHEN TG_OP = 'INSERT' THEN v_row.assignee END,
    CASE WHEN TG_OP = 'DELETE' THEN v_row.assignee END);
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.bp_audit_task_assignee() IS
  'fix-363: co-assignment history into permit_task_audit. A separate trigger '
  'because fix-224 put co-assignees on a join table, where a permit_tasks row '
  'trigger has no OLD/NEW to compare.';

DROP TRIGGER IF EXISTS permit_task_assignee_audit_trg ON public.permit_task_assignees;
CREATE TRIGGER permit_task_assignee_audit_trg
  AFTER INSERT OR DELETE ON public.permit_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.bp_audit_task_assignee();

-- ---------------------------------------------------------------------------
-- ★★★ D. The read — RAW FACTS, never a verdict
-- ---------------------------------------------------------------------------
--
-- ★ This returns EVENTS, and the three states (a person / the machine / not
-- recorded) are decided in `src/lib/taskProvenance.ts`. Deciding them here would
-- put the rule this ticket turns on where no test in the repo can reach it —
-- fix-360 made the same call about its emoji tally, for the same reason.
--
-- ★ `actor_name` comes from `bp_profile_display_name`, which already carries
-- fix-330's lesson: profiles.name is NULL for all 29 logins, so it falls through
-- to team_members matched on email. Never re-derive that here.
CREATE OR REPLACE FUNCTION public.bp_task_provenance(p_task_id uuid)
  RETURNS TABLE (
    kind       text,
    at         timestamptz,
    actor_uid  uuid,
    actor_name text,
    detail     text,
    auto_mark  text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  -- ★ Each branch is PARENTHESISED: a branch of a UNION may not carry its own
  -- ORDER BY / LIMIT unless it is wrapped, and two of these must ("the newest
  -- assignment", "the completion that stuck").
  -- 1. Created. The task's own created_at is the WHEN and is never missing; the
  --    audit supplies the WHO, for the 737 tasks that have any history at all.
  (SELECT 'created'::text,
         t.created_at,
         a.actor_uid,
         public.bp_profile_display_name(a.actor_uid),
         t.text,
         -- ★ The machine signal for creation, straight off the task: 597 of
         -- 1,361 tasks were raised by the bot, and that is knowable for every
         -- one of them whether or not the audit was running.
         CASE WHEN t.is_auto_generated THEN COALESCE(t.auto_event, 'bot') END
    FROM public.permit_tasks t
    LEFT JOIN LATERAL (
      SELECT x.actor_uid FROM public.permit_task_audit x
       WHERE x.task_id = t.id AND x.op = 'INSERT'
       ORDER BY x.changed_at ASC, x.id ASC
       LIMIT 1
    ) a ON true
   WHERE t.id = p_task_id
     AND t.tenant_id = ANY (public.auth_tenant_ids()))

  UNION ALL

  -- 2. Assigned. The newest row where the PRIMARY assignee actually moved.
  --    Nothing before 2026-08-20 can appear here, by construction.
  (SELECT 'assigned'::text,
         x.changed_at,
         x.actor_uid,
         public.bp_profile_display_name(x.actor_uid),
         x.assigned_to_to,
         NULL
    FROM public.permit_task_audit x
    JOIN public.permit_tasks t ON t.id = x.task_id
   WHERE x.task_id = p_task_id
     AND t.tenant_id = ANY (public.auth_tenant_ids())
     AND x.assigned_to_to IS DISTINCT FROM x.assigned_to_from
     AND x.assigned_to_to IS NOT NULL
   ORDER BY x.changed_at DESC, x.id DESC
   LIMIT 1)

  UNION ALL

  -- 3. Completed. `done_at` answers WHEN for all 884; the audit answers WHO for
  --    295 of them; `auto_closed_reason` answers "the machine did it" for 173.
  (SELECT 'completed'::text,
         t.done_at,
         a.actor_uid,
         public.bp_profile_display_name(a.actor_uid),
         t.completion_status,
         t.auto_closed_reason
    FROM public.permit_tasks t
    LEFT JOIN LATERAL (
      SELECT x.actor_uid FROM public.permit_task_audit x
       WHERE x.task_id = t.id
         AND x.op = 'UPDATE'
         AND x.completion_status_to IS DISTINCT FROM x.completion_status_from
         AND x.completion_status_to IN ('Resolved', 'Cancelled')
       ORDER BY x.changed_at DESC, x.id DESC
       LIMIT 1
    ) a ON true
   WHERE t.id = p_task_id
     AND t.tenant_id = ANY (public.auth_tenant_ids())
     AND t.done_at IS NOT NULL)

  UNION ALL

  -- 4. Co-assignment, newest first. One row per person still on the task, with
  --    the mark that says whether a person or fix-346's trigger put them there.
  (SELECT 'coassigned'::text,
         c.created_at,
         x.actor_uid,
         public.bp_profile_display_name(x.actor_uid),
         c.assignee,
         c.source
    FROM public.permit_task_assignees c
    JOIN public.permit_tasks t ON t.id = c.task_id
    LEFT JOIN LATERAL (
      SELECT y.actor_uid FROM public.permit_task_audit y
       WHERE y.task_id = c.task_id
         AND y.co_assignee_added = c.assignee
       ORDER BY y.changed_at DESC, y.id DESC
       LIMIT 1
    ) x ON true
   WHERE c.task_id = p_task_id
     AND t.tenant_id = ANY (public.auth_tenant_ids()))
   ORDER BY 2 DESC;
$$;

COMMENT ON FUNCTION public.bp_task_provenance(uuid) IS
  'fix-363: one task''s provenance as EVENTS — created / assigned / completed / '
  'coassigned — with the actor where recorded and the machine mark where a '
  'trigger did it. Returns facts; src/lib/taskProvenance.ts decides the three '
  'states, so the rule the ticket turns on is testable.';

REVOKE ALL ON FUNCTION public.bp_task_provenance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_task_provenance(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★★ E. The notification's sentence — "Briana assigned you a task"
-- ---------------------------------------------------------------------------
--
-- ★ A SEPARATE, SMALL BULK READ rather than a column on `bp_list_tasks`. That
-- RPC feeds every task surface in the app; widening it for a field that is NULL
-- on all 1,361 existing tasks would be a large blast radius for no present
-- benefit. This follows fix-354's and fix-360's pattern instead: one narrow
-- query the board model folds in as an optional input.
--
-- ★ Scoped to the audit's own window. Nothing older can have an answer.
CREATE OR REPLACE FUNCTION public.bp_task_assigners(p_days integer DEFAULT 30)
  RETURNS TABLE (task_id uuid, actor_name text, assigned_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (x.task_id)
         x.task_id,
         public.bp_profile_display_name(x.actor_uid),
         x.changed_at
    FROM public.permit_task_audit x
    JOIN public.permit_tasks t ON t.id = x.task_id
   WHERE t.tenant_id = ANY (public.auth_tenant_ids())
     AND x.changed_at > now() - make_interval(days => GREATEST(p_days, 1))
     AND x.assigned_to_to IS DISTINCT FROM x.assigned_to_from
     AND x.assigned_to_to IS NOT NULL
     AND x.actor_uid IS NOT NULL
   ORDER BY x.task_id, x.changed_at DESC, x.id DESC;
$$;

COMMENT ON FUNCTION public.bp_task_assigners(integer) IS
  'fix-363: recent PRIMARY-assignment actors, for the notification that names '
  'them. Only rows with an actor — an absent task means "not recorded", and the '
  'title degrades to the wording it has today rather than inventing a name.';

REVOKE ALL ON FUNCTION public.bp_task_assigners(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_task_assigners(integer) TO authenticated, service_role;
