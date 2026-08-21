-- ===========================================================================
-- fix-377 — reassigning a project moves nobody's work
-- ===========================================================================
--
-- APPLIED to prod (eibnmwthkcuumyclyxoe) on 2026-08-21 via MCP apply_migration
-- as `fix_377_lead_cascade`, which records the provenance row AND the full
-- statement text. This file is the repo-of-record copy.
--
-- ★★★ THE BACKFILL IS NOT HERE AND IS NOT APPLIED. The 19 already-drifted
-- permits (22 field changes) are a DATA change and need Bobby's approval on the
-- ROWS, not just on the rule — see
-- migrations/fix_377_backfill_PENDING_APPROVAL.sql.
--
-- ---------------------------------------------------------------------------
-- §4 — WHY THIS IS IN THE DATABASE AND NOT IN A REACT HANDLER
-- ---------------------------------------------------------------------------
-- A project's leads are writable from more than one place: the project settings
-- modal, the project overview, and the scraper's service-role writes. A handler
-- in ProjectSettingsModal would miss the others BY CONSTRUCTION. On the row is
-- the only place that sees every writer.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE SAFETY PROPERTY THAT MAKES THIS SURVIVABLE — fix-312's line
-- ---------------------------------------------------------------------------
-- fix-302 tried something adjacent and was REVERTED by fix-312, because it
-- *created* design-associate assignments: it put a DA on 102 permits that
-- should not have had one. Bobby: "A design associate and/or design manager
-- should never be assigned to a ULS."
--
-- ★★★ THIS CANNOT DO THAT, and the reason is the WHERE clause, not a permit-
-- type exclusion list. Every statement below is keyed on
--     WHERE <field> = OLD.<name>
-- so it only ever RENAMES a value that is already there. A permit whose
-- ent_lead IS NULL matches nothing and stays NULL. A permit deliberately
-- assigned to somebody other than the project lead matches nothing and keeps
-- that person. The cascade can never GIVE a permit a lead it did not already
-- have — it can only follow one that moved. That is the whole difference from
-- fix-302, and it is asserted in the suite.
--
-- ---------------------------------------------------------------------------
-- ★★ WHICH PROJECT ROLE MAPS TO WHICH PERMIT FIELD — and what was excluded
-- ---------------------------------------------------------------------------
-- projects has four people-ish columns; permits has five. Only two pairs are
-- the same fact recorded twice, and only those two cascade:
--
--   projects.entitlement_lead   →  permits.ent_lead   ✔ cascades
--   projects.design_manager     →  permits.dm         ✔ cascades
--
--   projects.acq_lead           →  no permit counterpart exists      excluded
--   projects.schematic_designer →  text[], no permit column          excluded
--   permits.architect           →  'Francesca' on 11 rows: the architect of
--                                  record, a firm-side fact with no project
--                                  counterpart                      excluded
--   permits.permit_owner        →  'Architecture' | 'Entitlements' | 'Split'
--                                  on 158 rows — a TEAM, not a person; there
--                                  is nothing to rename             excluded
--
-- ★★ THERE IS NO projects.da COLUMN, so a design associate cannot cascade DOWN
-- from a project — which is exactly right, because fix-312 settled that DA
-- assignment is manual, by a human, per permit. `da` appears below only as a
-- SOURCE: when somebody changes the DA ON A PERMIT, that person's open tasks on
-- that permit follow them. That is moving work that already exists, never
-- creating an assignment.
--
-- ---------------------------------------------------------------------------
-- ★★★ NO LOOP WITH THE DRAW SCHEDULE — structurally, not by a flag
-- ---------------------------------------------------------------------------
-- bp_sync_draw_schedule_da fires AFTER UPDATE OF da ON permits and writes
-- draw_schedule.da_assigned. The question is whether this ticket closes a
-- cycle. It does not, and the reason is that the graph is acyclic:
--
--     projects → permits → draw_schedule
--     permits  → permit_tasks → permit_task_assignees
--
-- Verified on prod: neither draw_schedule nor permit_task_assignees carries a
-- trigger that writes back to permits or projects. So a cascade terminates
-- after at most two hops whatever it touches.
--
-- ★ And the draw-schedule sync firing is DESIRABLE, not collateral: if a DA
-- rename reaches a Building Permit, the draw board should show the new name
-- too. The existing `app.bp_skip_da_sync` escape hatch is deliberately NOT set
-- here — it belongs to fix-225's handoff freeze, where the board must stay put,
-- and borrowing it would erode that meaning.
--
-- ---------------------------------------------------------------------------
-- ★★ THE BOUNDARY FOR "OPEN" — two signals, on purpose
-- ---------------------------------------------------------------------------
-- Permits: a permit is done when actual_issue IS NOT NULL. Nothing moves on an
-- issued permit — the lead named on it is the record of who took it through,
-- and rewriting that falsifies a finished file. (fix-221's approved-awaiting-
-- issuance permits are NOT issued and DO move: they are still live work.)
--
-- Tasks: completion_status NOT IN ('Resolved','Cancelled') AND done IS NOT
-- TRUE. ★ Both, even though the two agree on all 1,420 rows today — fix-235
-- found 186 rows where they disagreed, and a task that is finished by either
-- measure is not somebody's work to move.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHAT HAPPENS TO fix-368's CO-ASSIGN WHEN AN ASSIGNEE CHANGES
-- ---------------------------------------------------------------------------
-- Two rules, and they are not the same rule:
--
--  1. RENAMING permit_tasks.assigned_to fires permit_tasks_coassign_dm, whose
--     "identical value" guard does NOT trip (the value really changed), so it
--     recomputes the manager for the NEW assignee and withdraws the stale auto
--     row. That is correct, and nothing here suppresses it.
--
--  2. ★★ RENAMING A CO-ASSIGNEE ROW IS RESTRICTED TO source = 'manual'. A
--     'dm_of_da' or 'dm_of_project' row is DERIVED — the output of
--     bp_coassign_for_task, not a name anybody typed. Renaming one would write
--     a value the derivation does not produce, and the next task write would
--     silently flip it back. fix-368 promises a machine never withdraws a name
--     a person chose; this is the same promise read the other way round — a
--     person's rename never overwrites a name a machine derived. Derived rows
--     are re-asserted by their own triggers, which is where they belong.
--
-- ---------------------------------------------------------------------------
-- ★ ORDERING — this trigger is named to sort BEFORE projects_dm_coassign
-- ---------------------------------------------------------------------------
-- Postgres fires same-event triggers in NAME order. `projects_cascade_lead`
-- sorts before `projects_dm_coassign`, so the leads move first and fix-368's
-- invariant re-assertion gets the LAST word over the co-assignee table. Both
-- converge on the same state either way; fixing the order makes it testable
-- rather than incidental. Do not rename this trigger without re-reading this.
--
-- ---------------------------------------------------------------------------
-- ★ ONE KNOWN SIDE EFFECT, AND IT IS THE fix-341 CLASS
-- ---------------------------------------------------------------------------
-- permits_set_updated_at bumps permits.updated_at, so changing a project lead
-- now bumps the updated_at of its unissued permits — a sibling write, which is
-- exactly what produced fix-341's "modified by someone else" with nobody there.
-- fix-341's fix was to read the OCC token from the cache at execution rather
-- than at render, which holds here too; this note is so the next person to see
-- that banner knows a project edit is now one of its causes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The shared predicate for "a task that is still somebody's work"
-- ---------------------------------------------------------------------------
-- ★ One definition, used by the trigger AND by the pending backfill, so the two
-- cannot disagree about which tasks are in scope.
CREATE OR REPLACE FUNCTION public.bp_task_is_open(
  p_status text,
  p_done   boolean
)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(p_status, 'Open') NOT IN ('Resolved', 'Cancelled')
     AND COALESCE(p_done, false) = false;
$$;

COMMENT ON FUNCTION public.bp_task_is_open(text, boolean) IS
  'fix-377: the boundary for "still somebody''s work". Reads BOTH completion_status and done because fix-235 found 186 rows where they disagreed; a task finished by either measure is out of scope.';

REVOKE ALL ON FUNCTION public.bp_task_is_open(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_task_is_open(text, boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★★ 2. permits → open tasks: a lead changes ON A PERMIT, their work follows
-- ---------------------------------------------------------------------------
-- This is the second half of the cascade and it also stands on its own: the
-- permit bar can change ent_lead, dm or da directly, with no project edit
-- involved, and the same thing should happen.
CREATE OR REPLACE FUNCTION public.bp_trg_permit_lead_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_olds text[] := ARRAY[
    NULLIF(btrim(COALESCE(OLD.ent_lead, '')), ''),
    NULLIF(btrim(COALESCE(OLD.dm,       '')), ''),
    NULLIF(btrim(COALESCE(OLD.da,       '')), '')
  ];
  v_news text[] := ARRAY[
    NULLIF(btrim(COALESCE(NEW.ent_lead, '')), ''),
    NULLIF(btrim(COALESCE(NEW.dm,       '')), ''),
    NULLIF(btrim(COALESCE(NEW.da,       '')), '')
  ];
  v_old text;
  v_new text;
  i     integer;
BEGIN
  -- ★ An issued permit is a finished file. Its tasks do not move — and
  -- permits_issued_clear_tasks has already closed them anyway.
  IF NEW.actual_issue IS NOT NULL THEN
    RETURN NULL;
  END IF;

  FOR i IN 1 .. 3 LOOP
    v_old := v_olds[i];
    v_new := v_news[i];

    -- ★★ NOTHING HAPPENS WITHOUT AN OLD NAME. A permit that had no lead has no
    -- work filed under one, so there is nothing to move — and writing the new
    -- name anywhere here would be fix-302 again.
    CONTINUE WHEN v_old IS NULL;
    CONTINUE WHEN v_new IS NULL;
    CONTINUE WHEN v_new IS NOT DISTINCT FROM v_old;

    -- 2a. The primary owner of every open task filed under the old name.
    --     ★ Exact match on the OLD name only. A task assigned to a ROLE token
    --     ('Entitlements', 'Design Manager') or to a third person is not this
    --     person's work and is not touched — 45 open tasks sit on
    --     'Entitlements' today and none of them may move.
    UPDATE public.permit_tasks t
       SET assigned_to = v_new
     WHERE t.permit_id = NEW.id
       AND lower(btrim(COALESCE(t.assigned_to, ''))) = lower(v_old)
       AND public.bp_task_is_open(t.completion_status, t.done);

    -- 2b. Co-assignees. ★★ manual rows ONLY — see the header.
    --
    --     ★ DELETE-then-INSERT rather than UPDATE, deliberately.
    --     permit_task_assignee_audit_trg fires AFTER INSERT OR DELETE and NOT
    --     on UPDATE, so an in-place rename would move a person's work with no
    --     audit row anywhere — the one thing fix-363 exists to prevent. The
    --     pair is also what makes a collision harmless: if the incoming person
    --     is already a co-assignee on that task, ON CONFLICT DO NOTHING leaves
    --     the single row that should exist instead of raising on the unique
    --     (task_id, assignee).
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
    SELECT a.tenant_id, a.task_id, v_new, 'manual'
      FROM public.permit_task_assignees a
      JOIN public.permit_tasks t ON t.id = a.task_id
     WHERE t.permit_id = NEW.id
       AND a.source = 'manual'
       AND lower(btrim(a.assignee)) = lower(v_old)
       AND public.bp_task_is_open(t.completion_status, t.done)
       -- ★ never co-assign somebody to their own task (fix-346 rule 4)
       AND lower(btrim(COALESCE(t.assigned_to, ''))) <> lower(v_new)
    ON CONFLICT (task_id, assignee) DO NOTHING;

    DELETE FROM public.permit_task_assignees a
     USING public.permit_tasks t
     WHERE a.task_id = t.id
       AND t.permit_id = NEW.id
       AND a.source = 'manual'
       AND lower(btrim(a.assignee)) = lower(v_old)
       AND public.bp_task_is_open(t.completion_status, t.done);

    -- ★ 2a can also trip fix-346's rule 4 from the other side: if the incoming
    -- person was ALREADY a manual co-assignee on a task that has just become
    -- theirs, they are now co-assigned to their own work. Scoped to the tasks
    -- this iteration touched, so it withdraws nothing it did not cause.
    DELETE FROM public.permit_task_assignees a
     USING public.permit_tasks t
     WHERE a.task_id = t.id
       AND t.permit_id = NEW.id
       AND lower(btrim(COALESCE(t.assigned_to, ''))) = lower(v_new)
       AND lower(btrim(a.assignee)) = lower(v_new)
       AND public.bp_task_is_open(t.completion_status, t.done);

    -- 2c. ★ permit_tasks.co_assignees — the LEGACY array column. It is empty on
    --     all 1,420 rows and every live co-assignment lives in
    --     permit_task_assignees; the brief's "edit within it, do not rebuild
    --     it" is honoured literally by array_replace, which changes the one
    --     element and leaves the rest of the array, and its order, alone. If
    --     anything ever writes to that column again, this keeps up with it.
    UPDATE public.permit_tasks t
       SET co_assignees = array_replace(t.co_assignees, v_old, v_new)
     WHERE t.permit_id = NEW.id
       AND t.co_assignees IS NOT NULL
       AND v_old = ANY (t.co_assignees)
       AND public.bp_task_is_open(t.completion_status, t.done);
  END LOOP;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.bp_trg_permit_lead_cascade() IS
  'fix-377: when a lead changes ON A PERMIT, that person''s open work on that permit follows them. Keyed on an exact match with the OLD name, so it can only rename an assignment that already exists — never create one (fix-312).';

REVOKE ALL ON FUNCTION public.bp_trg_permit_lead_cascade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_permit_lead_cascade()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS permits_lead_cascade ON public.permits;
CREATE TRIGGER permits_lead_cascade
  AFTER UPDATE OF ent_lead, dm, da ON public.permits
  FOR EACH ROW
  WHEN (   NEW.ent_lead IS DISTINCT FROM OLD.ent_lead
        OR NEW.dm       IS DISTINCT FROM OLD.dm
        OR NEW.da       IS DISTINCT FROM OLD.da)
  EXECUTE FUNCTION public.bp_trg_permit_lead_cascade();

-- ---------------------------------------------------------------------------
-- ★★★ 3. projects → permits: the ticket's actual subject
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_project_lead_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old text;
  v_new text;
BEGIN
  -- entitlement_lead → permits.ent_lead
  v_old := NULLIF(btrim(COALESCE(OLD.entitlement_lead, '')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.entitlement_lead, '')), '');
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.permits p
       SET ent_lead = v_new
     WHERE p.project_id = NEW.id
       AND p.actual_issue IS NULL
       AND lower(btrim(COALESCE(p.ent_lead, ''))) = lower(v_old);
  END IF;

  -- design_manager → permits.dm
  v_old := NULLIF(btrim(COALESCE(OLD.design_manager, '')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.design_manager, '')), '');
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.permits p
       SET dm = v_new
     WHERE p.project_id = NEW.id
       AND p.actual_issue IS NULL
       AND lower(btrim(COALESCE(p.dm, ''))) = lower(v_old);
  END IF;

  -- ★★ Each of those UPDATEs fires permits_lead_cascade above, which moves the
  -- open tasks. Two hops, then it stops — permit_tasks has no trigger writing
  -- back to permits.
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.bp_trg_project_lead_cascade() IS
  'fix-377: a project''s entitlement_lead / design_manager change follows onto its UNISSUED permits, and from there (via permits_lead_cascade) onto open tasks. Renames only — a permit whose lead is NULL, or is deliberately somebody else, is untouched.';

REVOKE ALL ON FUNCTION public.bp_trg_project_lead_cascade() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_project_lead_cascade()
  TO authenticated, service_role;

-- ★ Named to sort before projects_dm_coassign — see the header.
DROP TRIGGER IF EXISTS projects_cascade_lead ON public.projects;
CREATE TRIGGER projects_cascade_lead
  AFTER UPDATE OF entitlement_lead, design_manager ON public.projects
  FOR EACH ROW
  WHEN (   NEW.entitlement_lead IS DISTINCT FROM OLD.entitlement_lead
        OR NEW.design_manager   IS DISTINCT FROM OLD.design_manager)
  EXECUTE FUNCTION public.bp_trg_project_lead_cascade();

-- ---------------------------------------------------------------------------
-- ★★ 4. The standing drift report — so this never needs measuring by hand again
-- ---------------------------------------------------------------------------
-- ★ The trigger fixes the future; 24 unissued permits already disagree with
-- their project, of which 19 are drift and 5 are deliberate, and the fix for
-- the 19 is a data change awaiting approval. This makes the number visible
-- rather than something somebody has to think to go and look for — the same
-- reasoning as fix-368's bp_coassign_gap_report.
--
-- ★★ NOT EVERY ROW IT RETURNS IS AN ERROR, and that is the point of having it
-- rather than a count: a permit deliberately assigned to somebody who is never
-- a project lead is a real assignment, which is exactly how 55 rows under one
-- name were separated from the 6 genuine ent_lead drifts.
CREATE OR REPLACE FUNCTION public.bp_lead_drift_report()
RETURNS TABLE (
  field         text,
  address       text,
  permit_label  text,
  permit_lead   text,
  project_lead  text,
  lead_is_ever_a_project_lead boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT f.field,
         pr.address,
         COALESCE(p.num, '(' || COALESCE(p.type, 'no type') || ')'),
         f.permit_lead,
         f.project_lead,
         EXISTS (
           SELECT 1 FROM public.projects x
            WHERE lower(btrim(COALESCE(
                    CASE WHEN f.field = 'ent_lead'
                         THEN x.entitlement_lead ELSE x.design_manager END, '')))
                = lower(btrim(f.permit_lead))
         )
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
   CROSS JOIN LATERAL (
     VALUES ('ent_lead', p.ent_lead, pr.entitlement_lead),
            ('dm',       p.dm,       pr.design_manager)
   ) AS f(field, permit_lead, project_lead)
   WHERE pr.tenant_id = ANY (public.auth_tenant_ids())
     AND p.actual_issue IS NULL
     AND NULLIF(btrim(COALESCE(f.permit_lead,  '')), '') IS NOT NULL
     AND NULLIF(btrim(COALESCE(f.project_lead, '')), '') IS NOT NULL
     AND lower(btrim(f.permit_lead)) <> lower(btrim(f.project_lead))
   ORDER BY 1, 2, 3;
$$;

COMMENT ON FUNCTION public.bp_lead_drift_report() IS
  'fix-377 §5: unissued permits whose ent_lead / dm disagrees with the project. lead_is_ever_a_project_lead is the discriminator — FALSE means the name is never used as a project lead anywhere, so the permit was deliberately assigned rather than left behind.';

REVOKE ALL ON FUNCTION public.bp_lead_drift_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_lead_drift_report() TO authenticated, service_role;
