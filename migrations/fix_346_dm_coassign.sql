-- ===========================================================================
-- fix-346 §2 — a design associate's tasks are co-assigned to their design manager
-- ===========================================================================
--
-- Bobby: "We want all design associate tasks to automatically be co-assigned to
-- their design manager. So all tasks that are for the design associate
-- automatically get co-assigned to the design manager."
--
-- ---------------------------------------------------------------------------
-- ★★★ WHY A TRIGGER AND NOT AN APP-SIDE HOOK
-- ---------------------------------------------------------------------------
-- The brief named bp_upsert_permit_task as "the shared write path" and asked
-- for a justified choice. It is shared by the CLIENT, and that is all: measured
-- on prod, three different things insert permit_tasks rows —
--
--   · bp_upsert_permit_task      the task editors (permit bar, My Tasks)
--   · bp_upsert_permit_task_row  the OCC row editor (useUpsertPermitTask)
--   · bp_replace_permit_tasks    the v1-parity bulk path (delete + reinsert)
--   · bp_create_project_with_permits  project seeding — where MOST tasks are born
--
-- plus anything the indexer or a future automation writes directly. A rule
-- installed in one RPC would be silently absent from the other three, and the
-- silence is the problem: nobody would ever see the co-assignee that did not
-- get added.
--
-- ★ AN AFTER-INSERT TRIGGER ON permit_tasks IS THE ONLY PLACE ALL FOUR PASS
-- THROUGH. It cannot be bypassed by a new writer, and a co-assignee row needs
-- the task row to exist first (FK), so AFTER — not BEFORE — is the correct
-- timing.
--
-- ★ WHAT IT DOES NOT COVER, stated plainly:
--   · Nothing retroactive. It fires on rows written FROM NOW ON. Bobby: "So
--     update moving forward." No backfill ships with this migration.
--   · A co-assignee a person REMOVES by hand stays removed. Withdrawing a name
--     the app added is a decision, and the rule does not re-litigate it on the
--     next unrelated save (see the "did it actually change" guard below).
--   · An UNASSIGNED task (assigned_to IS NULL — the majority of rows) gets
--     nothing, and neither does a task assigned to a ROLE. See below.
--
-- ---------------------------------------------------------------------------
-- ★★ THE KEY IS THE ASSIGNEE'S NAME, NEVER THE DISCIPLINE
-- ---------------------------------------------------------------------------
-- Measured on prod: Derry, a design MANAGER, holds 3 open `discipline = 'arch'`
-- tasks and Ana (schematic) holds 1. Keying off discipline would co-assign
-- Derry to her own task. The only question this rule asks is "is this assignee
-- a da_name in dm_da_groups?" — a lookup in the routing table itself.
--
-- ★ ROLE-VALUED ASSIGNEES GET NOTHING, and this is the decision the brief asked
-- for: the rule acts on the LITERAL stored value, BEFORE fix-238's role→person
-- resolution — which is to say it never resolves a role at all. Open today:
-- 'Design Manager' (8), 'Design Associate' (1), 'Schematic Team' (1),
-- 'Architecture' (1). "Design Associate" names no particular DA; the person it
-- displays as is derived at READ time from permits.da and changes when the
-- project changes hands. A permit_task_assignees row cannot follow a derivation
-- — it is a stored fact — so resolving one here would freeze today's answer and
-- quietly go wrong later. The same argument covers assigned_to IS NULL, whose
-- displayed owner is derived from the task's DISCIPLINE, which this rule is
-- forbidden to key off.
--
-- ★ UNMAPPED DAs GET NOTHING EITHER — Bobby's call for Cam, Shire and George,
-- who are active DAs with no row in dm_da_groups. No manager is invented. The
-- gap is NOT silent: Settings → Team → Team Structure names them, with their
-- open task counts, and says what it costs (TeamStructureEditor.tsx).
--
-- ---------------------------------------------------------------------------
-- ★ REASSIGNMENT — the decision, stated so it is not accidental
-- ---------------------------------------------------------------------------
-- THE CO-ASSIGNEE FOLLOWS THE ASSIGNEE, not the project. The trigger fires on
-- UPDATE OF assigned_to as well as INSERT, so any change of assignee swaps the
-- manager in the same transaction: Nicky → Marc drops Derry and adds Brittani,
-- and clearing the assignee drops the manager rather than stranding them as the
-- lone co-assignee on a task nobody owns.
--
-- ★ fix-225's "Reassign DA" is therefore untouched, deliberately. It moves
-- ownership at the PROJECT level (permits.da) and re-points co-assignee ROWS
-- from_da → to_da; it does not rewrite permit_tasks.assigned_to. A task that
-- still says "Nicky" is still Nicky's, and Nicky's manager is still Derry —
-- swapping in Marc's manager there would pair a task with a manager who manages
-- nobody on it. If fix-225 is ever extended to rewrite assigned_to, this rule
-- swaps the manager for free, because it watches that column and nothing else.
--
-- ---------------------------------------------------------------------------
-- ★ WHY THE `source` COLUMN EXISTS
-- ---------------------------------------------------------------------------
-- The trigger has to be able to WITHDRAW what it added — on a swap, and when
-- the assignee is cleared. Without a marker it would be guessing, and the guess
-- has a victim: a manager somebody added BY HAND would be deleted by a
-- reassignment that has nothing to do with them. `source` makes the question
-- exact — "did we add this row?" — and every existing row answers 'manual',
-- which is true: none of them were added by this rule.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. permit_task_assignees.source — who put this row here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.permit_task_assignees
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.permit_task_assignees'::regclass
      AND conname = 'permit_task_assignees_source_check'
  ) THEN
    ALTER TABLE public.permit_task_assignees
      ADD CONSTRAINT permit_task_assignees_source_check
      CHECK (source IN ('manual', 'dm_of_da'));
  END IF;
END $$;

COMMENT ON COLUMN public.permit_task_assignees.source IS
  'fix-346: manual = a person put this name here (the default, and what every pre-fix-346 row is); dm_of_da = added by bp_trg_task_coassign_dm because the task assignee is a DA in dm_da_groups. Only dm_of_da rows are ever withdrawn automatically.';

-- ---------------------------------------------------------------------------
-- 2. bp_dm_for_da — the one lookup, so the rule cannot drift from the table.
-- ---------------------------------------------------------------------------
-- ★ Its TS twin is dmForDa() in src/lib/dmCoAssign.ts — KEEP IN LOCKSTEP, the
--   fix-214 / fix-244 pattern. Same trim, same case-fold, same tie-break:
--   (dm_order, da_order, dm_name, da_name), which is the order useDmDaGroups
--   already reads the table in, so a duplicated da_name resolves to the same
--   manager on the server as in the Settings editor ("the first row wins").
CREATE OR REPLACE FUNCTION public.bp_dm_for_da(p_da text, p_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.dm_name
  FROM public.dm_da_groups g
  WHERE g.tenant_id = p_tenant
    AND COALESCE(btrim(p_da), '') <> ''
    AND COALESCE(btrim(g.dm_name), '') <> ''
    AND lower(btrim(g.da_name)) = lower(btrim(p_da))
  ORDER BY g.dm_order, g.da_order, g.dm_name, g.da_name
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.bp_dm_for_da(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_dm_for_da(text, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_task_coassign_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_da text := NULLIF(btrim(COALESCE(NEW.assigned_to, '')), '');
  v_old_da text;
  v_new_dm text;
  v_old_dm text;
BEGIN
  -- ★ "UPDATE OF assigned_to" fires whenever the column is in the SET list,
  --   even when the value is identical — and bp_upsert_permit_task* always set
  --   it. Without this guard, editing a due date would resurrect a manager the
  --   user had deliberately removed. The rule acts on a CHANGE of assignee.
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NULL;
  END IF;

  v_new_dm := public.bp_dm_for_da(v_new_da, NEW.tenant_id);

  -- 3a. Withdraw the previous assignee's manager — but only the row THIS rule
  --     added ('dm_of_da'), never a name a person chose.
  IF TG_OP = 'UPDATE' THEN
    v_old_da := NULLIF(btrim(COALESCE(OLD.assigned_to, '')), '');
    v_old_dm := public.bp_dm_for_da(v_old_da, OLD.tenant_id);
    IF v_old_dm IS NOT NULL AND v_old_dm IS DISTINCT FROM v_new_dm THEN
      DELETE FROM public.permit_task_assignees
       WHERE task_id  = NEW.id
         AND assignee = v_old_dm
         AND source   = 'dm_of_da';
    END IF;
  END IF;

  -- 3b. Add the current assignee's manager.
  --     · NULL v_new_dm  → not a mapped DA (a role, a DM, an unmapped DA, or
  --       nobody at all). Nothing happens, and nothing errors.
  --     · v_new_dm = v_new_da → never co-assign somebody to their own task.
  --     · ON CONFLICT → never a duplicate; an existing row (including a
  --       'manual' one naming the same person) is left exactly as it is.
  IF v_new_dm IS NOT NULL AND v_new_dm <> v_new_da THEN
    INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
    VALUES (NEW.tenant_id, NEW.id, v_new_dm, 'dm_of_da')
    ON CONFLICT (task_id, assignee) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_trg_task_coassign_dm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_trg_task_coassign_dm()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS permit_tasks_coassign_dm ON public.permit_tasks;
CREATE TRIGGER permit_tasks_coassign_dm
  AFTER INSERT OR UPDATE OF assigned_to ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_task_coassign_dm();

-- ---------------------------------------------------------------------------
-- 4. bp_set_task_assignees — same behaviour, but it stops laundering `source`.
-- ---------------------------------------------------------------------------
-- ★ It replaces the whole set (delete-all + reinsert), so without this the
--   marker on an auto-added manager would silently become 'manual' the first
--   time anybody edited an UNRELATED co-assignee on the same task — and the
--   trigger would then refuse to withdraw it on a later reassignment.
--
-- ★ A manager the user DELETES here stays deleted: they are simply absent from
--   p_assignees, so no row comes back. That is the intended escape hatch.
CREATE OR REPLACE FUNCTION public.bp_set_task_assignees(p_task_id uuid, p_assignees text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_auto    text[];
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM public.permit_tasks
  WHERE id = p_task_id AND tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'task % not found in caller tenant', p_task_id;
  END IF;

  -- fix-346: remember which of the current names this app added, so a rewrite
  -- preserves the marker instead of relabelling them as somebody's choice.
  SELECT COALESCE(array_agg(assignee), ARRAY[]::text[]) INTO v_auto
  FROM public.permit_task_assignees
  WHERE task_id = p_task_id AND source = 'dm_of_da';

  DELETE FROM public.permit_task_assignees WHERE task_id = p_task_id;

  INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
  SELECT v_tenant, p_task_id, a,
         CASE WHEN a = ANY (v_auto) THEN 'dm_of_da' ELSE 'manual' END
  FROM (
    SELECT DISTINCT TRIM(x) AS a
    FROM unnest(COALESCE(p_assignees, ARRAY[]::text[])) AS x
    WHERE COALESCE(TRIM(x), '') <> ''
  ) s
  ON CONFLICT (task_id, assignee) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_set_task_assignees(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_set_task_assignees(uuid, text[])
  TO authenticated, service_role;
