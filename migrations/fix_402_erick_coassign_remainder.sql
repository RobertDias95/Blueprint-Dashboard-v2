-- ===========================================================================
-- fix-402 §6 — THE REMAINDER OF THE APPROVED ERICK MOVE
-- ===========================================================================
--
-- fix-401 moved Erick from Jade to Derry and re-derived permits.dm. Its report
-- named what it deliberately left behind: 9 open `dm_of_da` co-assignee rows on
-- Erick's permits still naming Jade, with Derry on none of them. Bobby approved
-- finishing it.
--
-- ★★★ WHY THE TRIGGER COULD NOT DO IT. bp_trg_task_coassign_dm fires on
-- `permit_tasks AFTER INSERT OR UPDATE OF assigned_to` and carries fix-346's
-- guard: it returns early when assigned_to is unchanged, so a bulk re-assert
-- cannot resurrect a manager somebody deliberately removed. `SET assigned_to =
-- assigned_to` is exactly that no-op — the same shape of guard that refused
-- fix-401's `SET dm = dm`.
--
-- ★★★ SO THIS USES THE GROUP C CONTRACT. The STATEMENT is written here, but
-- every VALUE comes from fix-368's own rule function, `bp_coassign_for_task` —
-- "the one rule, returning both the name and which fact it came from". No
-- manager's name is hand-written, and the withdraw-then-insert below is the
-- trigger's own invariant ("withdraw any auto row that is not the current
-- answer"), applied to a fixed set of rows instead of one at a time.
--
-- ★★ AND IT IS NOT A PRE-WRITTEN SANCTIONED STATEMENT, which is the judgement
-- worth seeing. fix-379 shipped GROUP C ready to run. fix-368's pending
-- backfill covers a DIFFERENT case — `dm_of_project` INSERTs for UNMAPPED DAs —
-- and Erick is mapped, so it does not apply. This is fix-379's contract applied
-- to a case fix-368 did not anticipate.
--
-- ★ MANUAL ROWS ARE UNTOUCHED. A name a person chose is never withdrawn by a
-- machine (fix-346's promise). Only source IN ('dm_of_da','dm_of_project').
-- ★ OPEN TASKS ONLY, for the reason fix-368's own backfill excludes closed
-- ones: a manager added to work that closed months ago is noise, which is what
-- fix-355 spent a ticket removing.
--
-- ★★ RESULT ON PROD: 9 Jade → 9 Derry, all `dm_of_da`, 0 left naming Jade.
-- ===========================================================================

DO $go$
DECLARE
  v_before_jade  integer;
  v_before_derry integer;
  v_withdrawn    integer;
  v_added        integer;
  v_after_jade   integer;
  v_after_derry  integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE lower(btrim(a.assignee)) = 'jade'),
    count(*) FILTER (WHERE lower(btrim(a.assignee)) = 'derry')
  INTO v_before_jade, v_before_derry
  FROM public.permit_task_assignees a
  JOIN public.permit_tasks t ON t.id = a.task_id
  JOIN public.permits p ON p.id = t.permit_id
  WHERE p.da = 'Erick' AND a.source IN ('dm_of_da', 'dm_of_project');

  CREATE TEMP TABLE _fix402_targets ON COMMIT DROP AS
  SELECT t.id AS task_id, t.tenant_id, c.manager, c.src
  FROM public.permit_tasks t
  JOIN public.permits p ON p.id = t.permit_id
  CROSS JOIN LATERAL public.bp_coassign_for_task(t.assigned_to, t.permit_id, t.tenant_id) c
  WHERE p.da = 'Erick'
    AND public.bp_task_is_open(t.completion_status, t.done)
    AND EXISTS (
      SELECT 1 FROM public.permit_task_assignees a
       WHERE a.task_id = t.id
         AND a.source IN ('dm_of_da', 'dm_of_project')
         AND a.assignee IS DISTINCT FROM c.manager
    );

  DELETE FROM public.permit_task_assignees a
   USING _fix402_targets g
   WHERE a.task_id = g.task_id
     AND a.source IN ('dm_of_da', 'dm_of_project')
     AND a.assignee IS DISTINCT FROM g.manager;
  GET DIAGNOSTICS v_withdrawn = ROW_COUNT;

  INSERT INTO public.permit_task_assignees (tenant_id, task_id, assignee, source)
  SELECT g.tenant_id, g.task_id, g.manager, g.src
    FROM _fix402_targets g
    JOIN public.permit_tasks t ON t.id = g.task_id
   WHERE g.manager IS NOT NULL
     AND lower(btrim(g.manager)) <> lower(btrim(COALESCE(t.assigned_to, '')))
  ON CONFLICT (task_id, assignee) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT
    count(*) FILTER (WHERE lower(btrim(a.assignee)) = 'jade'),
    count(*) FILTER (WHERE lower(btrim(a.assignee)) = 'derry')
  INTO v_after_jade, v_after_derry
  FROM public.permit_task_assignees a
  JOIN public.permit_tasks t ON t.id = a.task_id
  JOIN public.permits p ON p.id = t.permit_id
  WHERE p.da = 'Erick' AND a.source IN ('dm_of_da', 'dm_of_project');

  IF v_after_jade <> 0 THEN
    RAISE EXCEPTION 'fix-402: % derived rows still name Jade on Erick permits', v_after_jade;
  END IF;
  IF v_after_derry <> v_before_jade + v_before_derry THEN
    RAISE EXCEPTION
      'fix-402: expected % derived rows to name Derry, got % (before jade=%, derry=%)',
      v_before_jade + v_before_derry, v_after_derry, v_before_jade, v_before_derry;
  END IF;

  RAISE NOTICE 'fix-402: jade %->0, derry %->%; withdrew %, added %',
    v_before_jade, v_before_derry, v_after_derry, v_withdrawn, v_added;
END
$go$;
