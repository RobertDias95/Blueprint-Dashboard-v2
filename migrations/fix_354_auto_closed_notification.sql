-- fix-354: the machine closed 103 tasks and told nobody.
--
-- Register #100, Bobby: *"maybe it checks off that milestone but then gives a
-- notification back to that entitlement lead that says, hey, as an FYI,
-- milestone was marked complete because the permit has progressed. So you're
-- still at least getting a check and balance of a notification."*
--
-- ★★★ AND THE WARNING WRITTEN BESIDE IT, IN THE REGISTER: *"Do not ship the
-- auto-completion without the notification — they are one feature, and shipping
-- the writer alone would be exactly the silent data mutation his rule exists to
-- prevent."* fix-337 shipped the writer alone. Measured on prod 2026-08-19:
-- 103 tasks closed across 58 permits and 36 projects, on 18 and 19 August, and
-- nobody was told.
--
-- ★★ THE MODEL IS CLOSE-FIRST, AND THAT IS A DECISION, NOT AN OVERSIGHT.
-- Asked whether the machine should close-and-tell or only propose, Bobby chose
-- *"close it, and make it a notification."* This SUPERSEDES register #105,
-- which had the acknowledgement BE the check-off. The task is closed at the
-- moment the machine decides — exactly as fix-337 does today, unchanged — and
-- the notification is a REPORT, not a proposal. Do not rebuild this toward #105.
--
-- ★ WHAT THIS WRITES: one new table, and rows in it only for closures that
-- happen from now on. ★★ NO BACKFILL — Bobby's explicit decision on the 103
-- already closed: *"Leave them — start clean going forward."* There is no
-- INSERT in this file outside the trigger's own function, and a test asserts it.

-- ---------------------------------------------------------------------------
-- ★★★ 1. THE LEDGER — one row per (permit, closure, recipient)
-- ---------------------------------------------------------------------------
--
-- ★★ GROUPED BY PERMIT AND EVENT, NEVER BY TASK. 103 tasks over 58 permits is
-- 58 notifications, not 103 — *"6 tasks on 7112264-DM were closed because the
-- permit issued"*. One row per task would be a flood on day one, and a flood is
-- how a bell gets ignored, which is fix-307's lesson and returns you to silence
-- by a different route.
--
-- ★★★ …WITH ONE HONEST COMPLICATION: RECIPIENT. Tasks on one permit do not all
-- route to the same person — 12 of the 103 carry an assignee and 91 do not.
-- Measured, the real shape is 58 permits → **61 notifications**, because three
-- permits split across two recipients. Grouping by permit ALONE would either
-- drop a person's notice or hand them somebody else's tasks, so the grain is
-- (permit, closure instant, recipient). It collapses to one row per permit in
-- every case where the tasks share an owner, which is 55 of the 58.
--
-- ★ THE KEY IS THIS TABLE'S OWN uuid. The board's key scheme requires a stable
-- database identity, and says why: *"a key built from a date, a name or a status
-- would silently re-notify the moment that value changed."* A count of tasks or
-- a list of task ids can both grow; a primary key cannot.
CREATE TABLE IF NOT EXISTS public.permit_task_auto_closures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permit_id   integer NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  -- ★ Mirrors permit_tasks.auto_closed_reason. One value today, and the CHECK
  -- is what makes adding a second one a deliberate act — §5 of the brief is a
  -- MEASUREMENT, not a licence for new automatic writers.
  reason      text NOT NULL CHECK (reason IN ('permit_issued')),
  -- ★ Who this is FOR: a roster NAME, resolved at closure time. Never null —
  -- see the resolver below. A notification with no recipient is the same
  -- silence in a new table.
  recipient   text NOT NULL CHECK (btrim(recipient) <> ''),
  task_count  integer NOT NULL CHECK (task_count > 0),
  closed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permit_task_auto_closures_recent_idx
  ON public.permit_task_auto_closures (tenant_id, closed_at DESC);

ALTER TABLE public.permit_task_auto_closures ENABLE ROW LEVEL SECURITY;

-- ★ Tenant-readable. The client filters to the viewer by NAME, exactly as every
-- other board source does (flips, tasks, permits all arrive whole and are
-- matched against the viewer's roster name in buildNewItems). Read state is
-- per-person and lives in fix-307's board_item_reads, which is already scoped
-- to auth.uid() — so one person reading this cannot clear it for another.
DROP POLICY IF EXISTS permit_task_auto_closures_tenant_select
  ON public.permit_task_auto_closures;
CREATE POLICY permit_task_auto_closures_tenant_select
  ON public.permit_task_auto_closures
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★★ NO WRITE POLICY AT ALL. A missing policy is a denial, so this IS the gate
-- rather than a decoration on one: the only writer is the SECURITY DEFINER
-- function below, which runs as the closure happens. Nobody hand-writes an FYI
-- about work the machine did.
REVOKE ALL ON public.permit_task_auto_closures FROM PUBLIC, anon;
GRANT SELECT ON public.permit_task_auto_closures TO authenticated;
GRANT ALL ON public.permit_task_auto_closures TO service_role;

COMMENT ON TABLE public.permit_task_auto_closures IS
  'fix-354: one row per (permit, closure, recipient) when the machine closes '
  'tasks by itself. The board derives a personal notification from it — the '
  'close is not a proposal (register #105 superseded), it is a report.';

-- ---------------------------------------------------------------------------
-- ★★★ 2. WHO IT REACHES — the SQL twin of fix-238's resolver
-- ---------------------------------------------------------------------------
--
-- ★★ "NOTIFY THE OWNER" DOES NOT WORK AS WRITTEN, and that was measured before
-- anything was built: **91 of the 103 closed tasks had no assignee at all**, and
-- three of the remaining 12 carry a ROLE STRING rather than a person
-- (`Entitlements` 4, `Design Manager` 1, `Architecture` 1).
--
-- ★ So the rule is the one fix-308 already decided — ENT is the default owner of
-- unowned work — with fix-238's role resolution in front of it:
--
--     1. the task's assignee, if it names a real person
--     2. …resolved, if it names a ROLE:
--          Entitlements      → the ent lead
--          Design Associate  → the DA        (and legacy 'Architecture')
--          Design Manager    → dm_da_groups(da), then project.design_manager,
--                              then permit.dm — the same chain useTaskOwnership
--                              walks
--          Schematic Team    → project.schematic_designer[1]
--     3. otherwise the permit's ENT lead
--     4. otherwise the PROJECT's entitlement lead
--
-- ★★ STEP 4 IS NOT DECORATION. One of the 103 sits on a permit with no ent_lead,
-- no da and no dm — 215 31st Ave, whose PROJECT has entitlement_lead 'Miles'.
-- Without step 4 that notification would have had nowhere to go, which is the
-- failure this ticket exists to fix, reappearing one row deep. Measured with all
-- four steps: **0 of 103 unroutable.**
--
-- ★ A TWIN, not a second opinion — kept in lockstep with
-- src/lib/taskTeam.ts's resolvePrimaryAssignee. A test asserts the same five
-- role tokens appear in both.
CREATE OR REPLACE FUNCTION public.bp_auto_close_recipient(
  p_assigned_to text,
  p_permit_id integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_da        text;
  v_ent       text;
  v_dm        text;
  v_sd        text;
  v_assigned  text := NULLIF(btrim(p_assigned_to), '');
  v_out       text;
BEGIN
  SELECT NULLIF(btrim(p.da), ''),
         COALESCE(NULLIF(btrim(p.ent_lead), ''), NULLIF(btrim(pr.entitlement_lead), '')),
         COALESCE(
           (SELECT NULLIF(btrim(g.dm_name), '') FROM public.dm_da_groups g
             WHERE g.da_name = p.da LIMIT 1),
           NULLIF(btrim(pr.design_manager), ''),
           NULLIF(btrim(p.dm), '')
         ),
         (pr.schematic_designer)[1]
    INTO v_da, v_ent, v_dm, v_sd
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   WHERE p.id = p_permit_id;

  v_out := CASE
    WHEN v_assigned IS NULL                            THEN NULL
    WHEN v_assigned IN ('Design Associate', 'Architecture') THEN v_da
    WHEN v_assigned = 'Entitlements'                   THEN v_ent
    WHEN v_assigned = 'Design Manager'                 THEN v_dm
    WHEN v_assigned = 'Schematic Team'                 THEN v_sd
    ELSE v_assigned                                    -- a specific person
  END;

  -- ★ Steps 3 and 4: never nobody.
  RETURN NULLIF(btrim(COALESCE(v_out, v_ent)), '');
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_auto_close_recipient(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_auto_close_recipient(text, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.bp_auto_close_recipient(text, integer) IS
  'fix-354: who an auto-closed task''s FYI reaches — the assignee when it names '
  'a person, the role''s holder when it names a role (fix-238''s five tokens), '
  'otherwise the permit''s ENT lead, otherwise the project''s. SQL twin of '
  'resolvePrimaryAssignee in src/lib/taskTeam.ts; keep the two in lockstep.';

-- ---------------------------------------------------------------------------
-- ★★★ 3. THE CLOSE AND THE TELLING, IN ONE TRANSACTION
-- ---------------------------------------------------------------------------
--
-- ★★ SAME TRANSACTION, NOT A FOLLOW-UP JOB. A close that commits while its
-- notification fails is the bug this ticket exists to fix, reappearing as a
-- race. The INSERT is inside the function that does the UPDATE, so either both
-- happen or neither does.
--
-- Re-emitted from migrations/fix_337_stale_work.sql:91 — the closure predicate
-- is byte-for-byte what it was, including the `results_ready` carve-out, because
-- fix-337's BEHAVIOUR is explicitly unchanged by this ticket. What is added is
-- the RETURNING, the grouping, and the ledger insert.
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
    SELECT c.tenant_id,
           c.permit_id,
           public.bp_auto_close_recipient(c.assigned_to, c.permit_id) AS recipient
      FROM closed c
  ),
  grouped AS (
    SELECT tenant_id, permit_id, recipient, count(*)::integer AS task_count
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
      (tenant_id, permit_id, reason, recipient, task_count, closed_at)
    SELECT tenant_id, permit_id, 'permit_issued', recipient, task_count, v_now
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

REVOKE ALL ON FUNCTION public.bp_clear_tasks_for_issued_permit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_clear_tasks_for_issued_permit(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.bp_clear_tasks_for_issued_permit(integer) IS
  'fix-337 closes the tasks; fix-354 records who to tell, in the same '
  'transaction. Grain is (permit, closure, recipient) — never one row per task. '
  'The closure predicate is unchanged, results_ready carve-out included.';

-- ★ The trigger and its function are UNCHANGED and are not re-emitted here.
-- permits_issued_clear_tasks still fires AFTER UPDATE OF actual_issue and still
-- calls the function above, which now does both halves.
--
-- ★★ AND NOTHING IS BACKFILLED. The 103 rows already carrying
-- auto_closed_reason = 'permit_issued' were closed before this table existed, so
-- there is no ledger row for any of them and the board derives nothing. That is
-- Bobby's decision — *"Leave them — start clean going forward"* — and it is why
-- the notification is derived from THIS table rather than from
-- permit_tasks.auto_closed_reason, which would have produced all 103 on first
-- load. A test asserts the file contains no INSERT reading permit_tasks.

-- ---------------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------------
-- ★ fix-336's lesson: a subscription to an UNPUBLISHED table is silent. The FYI
-- should reach an open bell without a reload, which is register #101's whole
-- point — *"we could just see the bell and just acknowledge it."*
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'permit_task_auto_closures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_task_auto_closures;
  END IF;
END $$;
