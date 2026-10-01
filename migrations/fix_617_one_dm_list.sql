-- ===========================================================================
-- fix-617 — ONE LIST FOR WHO SITS UNDER WHICH DM
-- Settings decides; the Draw Schedule follows.   P-006 · P-166 step 4a
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-01: **"Settings decides; the Draw Schedule follows."**
--
-- `dm_da_groups` is the ONE list of who sits under which DM. It already routes
-- tasks (fix-346's co-assign trigger), derives `permits.dm` (fix-379's trigger),
-- groups the board lens and seeds a new quarter's layout. What it did NOT do is
-- move the DA in the Draw Schedule's own layout, where `group_label` is free
-- text — so the layout editor *looked* like it moved a DA between managers and
-- changed nothing about who manages them (TeamStructureEditor's fix-401 header
-- says exactly this).
--
-- ---------------------------------------------------------------------------
-- ★★★ WHAT §0 MEASURED, BECAUSE THREE OF THE BRIEF'S PREMISES DID NOT HOLD
-- ---------------------------------------------------------------------------
-- 1. **No live DA disagrees.** For 2026-Q4 (the only quarter at or after the
--    current one) all nine active DAs have `group_label` = their `dm_name`
--    already. The disagreements are: three Team-Structure rows with no layout
--    row (Alex, Nidhi, George — all departed/inactive) and one layout row with
--    no Team-Structure row (Jade, grouped under her own name).
--    → So the sync below changes **0 rows today**. It is the rule for the next
--      move, not a backfill.
--
-- 2. **A new quarter ALREADY takes its groups from Team Structure.**
--    `bp_seed_quarter_layout_from_current` selects `g.dm_name` as `group_label`
--    straight out of `dm_da_groups`. The free-text carry-over the brief names
--    is only on the CLONE path, which copies `group_label` from the source
--    quarter — so that is the one this migration changes (§A.3).
--
-- 3. **The stale rows cannot be removed, and that is a RULING not a bug.**
--    `dm_da_groups_guard_departed` (fix-379) already refuses a delete whose DA
--    is named by any permit, with this message:
--      *"A departed associate keeps their mapping — mark them inactive on the
--        roster instead."*
--    Alex is named by 4 permits, Nidhi by 3, George by 22. All three people are
--    already inactive on the roster, which is the remedy that message prescribes.
--    → §B removes NOTHING. See the PR body; it goes to Bobby.
--
-- ---------------------------------------------------------------------------
-- ⚠️ APPLIED BY CLAUDE AFTER MERGE, NOT BY COWORK. The function bodies below
--    contain UPDATE and DELETE, and the standing rule is that Cowork's Supabase
--    connector hangs on those. Read back after applying.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The current quarter, in the 'YYYY-Qn' shape the layout stores.
-- ---------------------------------------------------------------------------
-- ★★ LEXICAL COMPARE = CHRONOLOGICAL COMPARE, which is why the format was
--    chosen (fix-25-feat-b) and why "this quarter and every later one" is a
--    plain `>=` rather than date arithmetic.
--
-- ★ America/Los_Angeles, not UTC. fix-433's lesson: a UTC "today" goes silent on
--   exactly the day it must speak — 2026-12-31 20:11 PT is 2027-01-01 03:11Z,
--   which would make the app treat Q1 as current while people are still in Q4.
CREATE OR REPLACE FUNCTION public.bp_current_quarter()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY')
      || '-Q'
      || to_char(now() AT TIME ZONE 'America/Los_Angeles', 'Q');
$function$;

COMMENT ON FUNCTION public.bp_current_quarter() IS
  'fix-617: the current quarter as YYYY-Qn, in America/Los_Angeles. Lexical '
  'compare is chronological compare, so "this quarter and later" is a plain >=.';

-- ---------------------------------------------------------------------------
-- ★★★ THE PREVIEW — what a move would change, before it changes anything
-- ---------------------------------------------------------------------------
-- §A.4: the confirm dialog must say, in plain words with counts, that moving a
-- DA can change the derived DM on their permits and the co-assignee on their
-- tasks. This is where those counts come from, so the dialog cannot invent them
-- and cannot drift from what the move will do.
--
-- ★★ "OPEN" IS THE APP'S OWN DEFINITION, not a new one: `isPermitDone`
--    (fix-245) is `actual_issue IS NOT NULL OR status IN (Issued, Completed,
--    Finaled, Closed, Withdrawn)`, and fix-264's cancelled projects are off live
--    work. Inventing a second definition here is how a dialog comes to promise
--    a number no other screen shows.
CREATE OR REPLACE FUNCTION public.bp_preview_dm_move(
  p_da_name text,
  p_dm_name text
)
RETURNS TABLE(
  da                text,
  from_dm           text,
  to_dm             text,
  open_permits      integer,
  open_tasks        integer,
  layout_quarters   text[],
  layout_rows       integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_da     text := btrim(coalesce(p_da_name, ''));
  v_cur    text := public.bp_current_quarter();
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_preview_dm_move: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;

  da      := v_da;
  to_dm   := nullif(btrim(coalesce(p_dm_name, '')), '');
  from_dm := public.bp_dm_for_da(v_da, v_tenant);

  SELECT count(*) INTO open_permits
    FROM public.permits p
   WHERE p.tenant_id = v_tenant
     AND p.parent_permit_id IS NULL
     AND lower(btrim(coalesce(p.da, ''))) = lower(v_da)
     AND p.actual_issue IS NULL
     AND btrim(coalesce(p.status, '')) NOT IN
         ('Issued','Completed','Finaled','Closed','Withdrawn')
     AND NOT EXISTS (
           SELECT 1 FROM public.project_holds h
            WHERE h.project_id = p.project_id
              AND h.hold_end IS NULL
              AND h.kind = 'cancelled');

  -- ★ The co-assignee the fix-346 trigger would change: it keys off the task's
  --   LITERAL `assigned_to`, so only tasks assigned to this DA by name move.
  SELECT count(*) INTO open_tasks
    FROM public.permit_tasks t
   WHERE t.tenant_id = v_tenant
     AND lower(btrim(coalesce(t.assigned_to, ''))) = lower(v_da)
     AND coalesce(t.completion_status, '') NOT IN ('Resolved', 'Cancelled');

  SELECT coalesce(array_agg(DISTINCT l.quarter ORDER BY l.quarter), '{}'),
         count(*)
    INTO layout_quarters, layout_rows
    FROM public.draw_schedule_quarter_layout l
   WHERE l.tenant_id = v_tenant
     AND l.quarter >= v_cur
     -- ★★★ col_kind = 'da' IS LOAD-BEARING, NOT TIDINESS. A MANAGER'S OWN
     --     column stores the MANAGER's name in `da_name` (col_kind='dm',
     --     group_label = that same name), and **Jade is a design associate
     --     AND a design manager** — measured on prod 2026-10-01, 2026-Q4
     --     position 3 is (dm, 'Jade', 'Jade'). Without this line, moving the
     --     ASSOCIATE Jade would rewrite the MANAGER Jade's header to somebody
     --     else's name and break her group span on the board.
     AND l.col_kind = 'da'
     AND lower(btrim(coalesce(l.da_name, ''))) = lower(v_da);

  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.bp_preview_dm_move(text, text) IS
  'fix-617 §A.4: what moving a DA between managers would change — open permits '
  '(fix-245 isPermitDone, minus fix-264 cancelled), open tasks whose literal '
  'assigned_to is this DA, and the layout rows in this quarter and later. '
  'Read-only; the confirm dialog reads it so it cannot invent its own numbers.';

-- ---------------------------------------------------------------------------
-- ★★★ THE ONE SERVER CALL — §A.1
-- ---------------------------------------------------------------------------
-- A move in Team Structure writes `dm_da_groups` AND sets `group_label` on that
-- DA's layout rows for the current and every later quarter, atomically.
--
-- ★★★ PAST QUARTERS ARE NOT TOUCHED. That is history: the Q2 board showed Erick
--     under Jade because in Q2 he was, and rewriting it would make last
--     quarter's draw schedule a lie about last quarter. The `>=` is the whole
--     of that rule.
--
-- ★★ IT DOES NOT WRITE `permits.dm`. fix-379's trigger derives that, and §A.4
--    says so explicitly: *"Use the existing triggers — do not write permits.dm
--    from the client."* Writing it here would be a second source for a derived
--    column, which is the class of bug this ticket exists to remove.
--
-- ★ p_dm_name NULL or '' means UNMAP: the row is deleted. That path can be
--   refused by `dm_da_groups_guard_departed` (fix-379) when a permit still names
--   the DA — deliberately, and the caller shows that message.
CREATE OR REPLACE FUNCTION public.bp_set_dm_for_da(
  p_da_name text,
  p_dm_name text
)
RETURNS TABLE(
  out_group_rows      integer,
  out_layout_rows     integer,
  out_quarters        text[],
  out_unmapped        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_da     text := btrim(coalesce(p_da_name, ''));
  v_dm     text := nullif(btrim(coalesce(p_dm_name, '')), '');
  v_cur    text := public.bp_current_quarter();
  v_rows   integer := 0;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_set_dm_for_da: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  -- ★★ THE SAME GATE THE REST OF SETTINGS USES. `dm_da_groups` is tenant-admin
  --    write by RLS, but this function is SECURITY DEFINER and therefore bypasses
  --    it — so the check has to be here, or the definer rights would be the hole.
  IF NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'Only an admin can change who a design associate reports to.'
      USING ERRCODE = '42501';
  END IF;
  IF v_da = '' THEN
    RAISE EXCEPTION 'bp_set_dm_for_da: a design associate is required'
      USING ERRCODE = '22023';
  END IF;

  out_unmapped := v_dm IS NULL;

  IF v_dm IS NULL THEN
    -- UNMAP. The fix-379 guard may refuse this; its message is the answer.
    DELETE FROM public.dm_da_groups g
     WHERE g.tenant_id = v_tenant
       AND lower(btrim(coalesce(g.da_name, ''))) = lower(v_da);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.dm_da_groups g
       SET dm_name = v_dm
     WHERE g.tenant_id = v_tenant
       AND lower(btrim(coalesce(g.da_name, ''))) = lower(v_da);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      INSERT INTO public.dm_da_groups (tenant_id, dm_name, da_name)
      VALUES (v_tenant, v_dm, v_da);
      v_rows := 1;
    END IF;
  END IF;
  out_group_rows := v_rows;

  -- ---- the layout follows -------------------------------------------------
  -- ★ An UNMAP clears the label rather than leaving the old manager's name on a
  --   column nobody manages: a stale label is how the layout came to disagree
  --   with Settings in the first place.
  UPDATE public.draw_schedule_quarter_layout l
     SET group_label = v_dm
   WHERE l.tenant_id = v_tenant
     AND l.quarter >= v_cur
     -- ★★★ col_kind = 'da' IS LOAD-BEARING, NOT TIDINESS. A MANAGER'S OWN
     --     column stores the MANAGER's name in `da_name` (col_kind='dm',
     --     group_label = that same name), and **Jade is a design associate
     --     AND a design manager** — measured on prod 2026-10-01, 2026-Q4
     --     position 3 is (dm, 'Jade', 'Jade'). Without this line, moving the
     --     ASSOCIATE Jade would rewrite the MANAGER Jade's header to somebody
     --     else's name and break her group span on the board.
     AND l.col_kind = 'da'
     AND lower(btrim(coalesce(l.da_name, ''))) = lower(v_da)
     AND coalesce(l.group_label, '') IS DISTINCT FROM coalesce(v_dm, '');
  GET DIAGNOSTICS out_layout_rows = ROW_COUNT;

  SELECT coalesce(array_agg(DISTINCT l.quarter ORDER BY l.quarter), '{}')
    INTO out_quarters
    FROM public.draw_schedule_quarter_layout l
   WHERE l.tenant_id = v_tenant
     AND l.quarter >= v_cur
     AND l.col_kind = 'da'
     AND lower(btrim(coalesce(l.da_name, ''))) = lower(v_da);

  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.bp_set_dm_for_da(text, text) IS
  'fix-617 §A.1: Settings decides, the Draw Schedule follows. Writes '
  'dm_da_groups AND group_label on that DA''s layout rows for the CURRENT and '
  'every LATER quarter, atomically. Past quarters are history and untouched. '
  'Never writes permits.dm — fix-379''s trigger derives it.';

-- ---------------------------------------------------------------------------
-- §A.3 — a cloned quarter takes its DA groups from Team Structure
-- ---------------------------------------------------------------------------
-- ★★ THE SEED PATH ALREADY DID THIS; the clone path did not.
--    `bp_seed_quarter_layout_from_current` builds a quarter straight out of
--    `dm_da_groups`. `bp_clone_quarter_layout` copied `group_label` from the
--    source quarter — free text, so "copy last quarter" carried last quarter's
--    idea of who managed whom into a quarter Settings may already disagree with.
--
-- ★ Everything else about the clone is unchanged: column ORDER, label
--   overrides, top labels and OPEN lanes all still come from the source
--   quarter, because those are the layout's own business. Only the DA → manager
--   answer is taken from the one list.
--
-- ★ `COALESCE(..., src.group_label)` is deliberate: a DA with no Team-Structure
--   row keeps whatever the source quarter said rather than being silently
--   un-grouped. An unmapped DA is Settings' problem to show (gap 40), not a
--   reason for the clone to lose information.
CREATE OR REPLACE FUNCTION public.bp_clone_quarter_layout(
  p_from text,
  p_to text,
  p_force boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant   uuid := (public.auth_tenant_ids())[1];
  v_existing int;
  v_count    int;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_clone_quarter_layout: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'bp_clone_quarter_layout: distinct from/to quarters required'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.draw_schedule_quarter_layout
  WHERE quarter = p_to AND tenant_id = v_tenant;

  IF v_existing > 0 THEN
    IF NOT p_force THEN
      RAISE EXCEPTION
        'bp_clone_quarter_layout: target % already has % rows (pass p_force to overwrite)',
        p_to, v_existing
        USING ERRCODE = '23505';
    END IF;
    DELETE FROM public.draw_schedule_quarter_layout
    WHERE quarter = p_to AND tenant_id = v_tenant;
  END IF;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override, top_label)
  SELECT v_tenant,
         p_to,
         (row_number() OVER (ORDER BY src.position)) - 1,
         src.col_kind,
         src.da_name,
         -- ★★★ fix-617 §A.3: Settings decides. A DA column's group comes from
         --     dm_da_groups, falling back to the source quarter only when the
         --     DA has no mapping at all.
         CASE
           WHEN src.col_kind = 'da'
             THEN COALESCE(public.bp_dm_for_da(src.da_name, v_tenant), src.group_label)
           ELSE src.group_label
         END,
         src.label_override,
         src.top_label
  FROM public.draw_schedule_quarter_layout src
  LEFT JOIN public.team_members tm
    ON tm.tenant_id = v_tenant AND tm.role = 'da' AND tm.name = src.da_name
  WHERE src.quarter = p_from AND src.tenant_id = v_tenant
    AND (
      src.col_kind = 'open'
      OR public.bp_member_active_in_quarter(
           tm.active_start_quarter, tm.active_end_quarter, p_to)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;

-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
-- ★★★ `FROM public, anon` AND NEVER `FROM anon` ALONE — anon INHERITS the PUBLIC
--     grant, so revoking from anon by itself leaves the function callable by an
--     unauthenticated session (fix-157).
--
-- ★ `bp_clone_quarter_layout`'s ACL is restated rather than assumed: CREATE OR
--   REPLACE preserves it, so these lines are a no-op for it today and exist so
--   the file describes the end state completely.
REVOKE ALL ON FUNCTION public.bp_current_quarter() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_current_quarter() TO authenticated;

REVOKE ALL ON FUNCTION public.bp_preview_dm_move(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_preview_dm_move(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_set_dm_for_da(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_set_dm_for_da(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.bp_clone_quarter_layout(text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_clone_quarter_layout(text, text, boolean) TO authenticated;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. ★★★ It changes NO DATA. Every statement above is DDL or a grant; the
--    layout sync happens when somebody moves a DA, not when this is applied.
--    §0 measured zero disagreements among live DAs, so there is nothing to
--    backfill — and a backfill nobody asked for is how a "layout fix" rewrites
--    somebody's board.
-- 2. It does not remove the three departed mapping rows (§B). The fix-379 guard
--    refuses them and its message prescribes the remedy those three people are
--    already in. Reported for Bobby instead.
-- 3. It does not place Cam or Shire. Bobby does that on the screen after this
--    ships, and §0 is explicit: **do not place them.**
-- 4. It does not touch `bp_seed_quarter_layout_from_current` — it already reads
--    Team Structure, which is §A.3's requirement already met.
