-- ===========================================================================
-- fix-620 (P-315) — finished blocks never move, and an overlap asks to be fixed
-- ===========================================================================
--
-- Bobby, 2026-10-02: "we dont want past blocks to move, and we dont want
-- overlapping, because then we cannot see if something is over one another.
-- so if something were to overlap, an error or prompt needs to appear to fix
-- it".
--
-- What happened (10-01 22:53:58 UTC, txid 659081046): a backfilled 2024 block
-- on Marc's lane went through bp_resolve_da_overlap, which pushes EVERY block
-- on the lane that overlaps the frontier — started or not — and 37 finished
-- 2024–2026 blocks landed as late as 2029-01-29.
--
-- §A  "Started" = start_week before the current week's Monday (Pacific — the
--     office's week; bp_draw_current_monday). bp_resolve_da_overlap no longer
--     moves a started block, and a still-running started block is an OBSTACLE
--     the push jumps past, exactly like an NP block (fix-24a, unchanged).
--     bp_shift_da_blocks_up already never moves one (its earliest slot is the
--     current Monday, so a started block takes the "candidate >= original"
--     branch and stays) — left as it is. bp_place_new_project_on_da only ever
--     places after the lane's last block. Nothing else moves OTHER blocks.
--
-- §B  An overlap with a STARTED block is refused by the server, whichever path
--     wrote it (drag, resize, DA move, DD dates, wizard, backfill, the blob
--     save): a DEFERRED constraint trigger checks every written row at COMMIT,
--     so the push inside bp_resolve_da_overlap (anchor first, then the
--     displaced blocks) is judged on the FINAL state, never the transient one.
--     ★ Only an overlap that GREW is refused — compared with the row's own
--       previous position — so a status/notes edit, or editing one of an
--       existing overlapping pair without growing it, is never blocked.
--     ★ Overlaps between two UPCOMING blocks are untouched: Push Down clears
--       those, as today.
--     SQLSTATE P0620 + a plain sentence naming the other project(s) and weeks;
--     the client shows it as a prompt and does not file it to Triage.
--
-- ★ UPDATE statements appear only INSIDE function bodies. This migration
--   writes no rows.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: bp_resolve_da_overlap is the body read on 2026-10-02.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.bp_resolve_da_overlap(uuid,text,text,text,text,timestamptz)'::regprocedure;
  IF v_src LIKE '%fix-620%' THEN
    RAISE NOTICE 'fix-620: bp_resolve_da_overlap already patched';
  ELSIF md5(v_src) <> '0b62647588e351bc585a13ffe1421869' THEN
    RAISE EXCEPTION 'fix-620: bp_resolve_da_overlap is not the body read on 2026-10-02 — STOP';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. The current week's Monday, in the office's time zone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_draw_current_monday()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ★ fix-620: Pacific, because the team's week is. CURRENT_DATE is UTC on
  --   Supabase, which turns Sunday 17:00 PT into "next week".
  SELECT date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles'))::date
$function$;

-- ---------------------------------------------------------------------------
-- 2. The one sentence — NULL when the write may stand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_draw_overlap_refusal(
  p_tenant_id uuid,
  p_project_id uuid,
  p_lane text,
  p_start_week text,
  p_end_week text,
  p_old_lane text,
  p_old_start_week text,
  p_old_end_week text
)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- fix-620 (P-315): a project block may not newly overlap a STARTED project
  -- block in its lane. "Grew" is judged against the row's own previous
  -- position (same lane only), so an edit that leaves an existing overlap no
  -- bigger is allowed.
  v_monday date := public.bp_draw_current_monday();
  v_s  date;
  v_e  date;
  v_os date;
  v_oe date;
  x    record;
  v_ov  int;
  v_oov int;
  v_n   int := 0;
  v_parts text[] := ARRAY[]::text[];
  v_list text;
BEGIN
  IF p_lane IS NULL OR btrim(p_lane) = '' OR p_start_week IS NULL OR p_end_week IS NULL THEN
    RETURN NULL;
  END IF;
  v_s := public.bp_week_key_to_date(p_start_week);
  v_e := public.bp_week_key_to_date(p_end_week);
  IF v_s IS NULL OR v_e IS NULL THEN RETURN NULL; END IF;
  IF p_old_lane IS NOT DISTINCT FROM p_lane
     AND p_old_start_week IS NOT NULL AND p_old_end_week IS NOT NULL THEN
    v_os := public.bp_week_key_to_date(p_old_start_week);
    v_oe := public.bp_week_key_to_date(p_old_end_week);
  END IF;

  FOR x IN
    SELECT COALESCE(NULLIF(btrim(p.address), ''), 'another project') AS addr,
           public.bp_week_key_to_date(ds.start_week) AS xs,
           public.bp_week_key_to_date(ds.end_week)   AS xe
      FROM public.draw_schedule ds
      LEFT JOIN public.projects p ON p.id = ds.project_id
     WHERE ds.tenant_id IS NOT DISTINCT FROM p_tenant_id
       AND ds.da_assigned = p_lane
       AND ds.project_id <> p_project_id
       AND ds.start_week IS NOT NULL
       AND ds.end_week IS NOT NULL
       AND public.bp_week_key_to_date(ds.start_week) <= v_e
       AND public.bp_week_key_to_date(ds.end_week)   >= v_s
       AND public.bp_week_key_to_date(ds.start_week) <  v_monday   -- started
     ORDER BY 2, 1
  LOOP
    v_ov := (LEAST(v_e, x.xe) - GREATEST(v_s, x.xs)) / 7 + 1;
    v_oov := CASE
      WHEN v_os IS NOT NULL AND v_os <= x.xe AND x.xs <= v_oe
        THEN (LEAST(v_oe, x.xe) - GREATEST(v_os, x.xs)) / 7 + 1
      ELSE 0
    END;
    IF v_ov > v_oov THEN
      v_n := v_n + 1;
      IF v_n <= 3 THEN
        v_parts := v_parts || (
          x.addr || ' (' ||
          CASE WHEN date_part('year', x.xs) = date_part('year', x.xe)
            THEN to_char(x.xs, 'Mon FMDD') || ' – ' || to_char(x.xe, 'Mon FMDD, YYYY')
            ELSE to_char(x.xs, 'Mon FMDD, YYYY') || ' – ' || to_char(x.xe, 'Mon FMDD, YYYY')
          END || ')'
        );
      END IF;
    END IF;
  END LOOP;

  IF v_n = 0 THEN RETURN NULL; END IF;

  IF v_n > 3 THEN
    v_list := array_to_string(v_parts, ', ') || ' and ' || (v_n - 3) || ' more';
  ELSIF v_n = 1 THEN
    v_list := v_parts[1];
  ELSE
    v_list := array_to_string(v_parts[1:v_n - 1], ', ') || ' and ' || v_parts[v_n];
  END IF;

  RETURN 'This overlaps ' || v_list
      || '. Finished blocks don''t move — choose other weeks or another lane.';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The trigger — judged at COMMIT, on the final state of the row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_draw_schedule_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r     record;
  v_msg text;
BEGIN
  -- fix-620: re-read the row — at COMMIT, NEW is this statement's value, not
  -- necessarily the final one.
  SELECT ds.tenant_id, ds.project_id, ds.da_assigned, ds.start_week, ds.end_week
    INTO r
    FROM public.draw_schedule ds
   WHERE ds.project_id = NEW.project_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    v_msg := public.bp_draw_overlap_refusal(
      r.tenant_id, r.project_id, r.da_assigned, r.start_week, r.end_week,
      OLD.da_assigned, OLD.start_week, OLD.end_week);
  ELSE
    v_msg := public.bp_draw_overlap_refusal(
      r.tenant_id, r.project_id, r.da_assigned, r.start_week, r.end_week,
      NULL, NULL, NULL);
  END IF;

  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0620', MESSAGE = v_msg;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS bp_draw_schedule_no_overlap ON public.draw_schedule;
CREATE CONSTRAINT TRIGGER bp_draw_schedule_no_overlap
  AFTER INSERT OR UPDATE OF da_assigned, start_week, end_week ON public.draw_schedule
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_draw_schedule_no_overlap();

-- ---------------------------------------------------------------------------
-- 4. bp_resolve_da_overlap — the live body (2026-10-02) with three changes,
--    each marked fix-620: refuse first, skip started blocks, jump past a
--    running started block like an NP block.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resolve_da_overlap(p_anchor_project_id uuid, p_target_da text, p_target_start_week text, p_target_end_week text, p_anchor_status text, p_anchor_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_anchor_project_id uuid, out_anchor_updated_at timestamp with time zone, out_pushed_project_ids uuid[], out_conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor_dd_start    date;
  v_anchor_dd_end      date;
  v_anchor_target      date;
  v_anchor_updated_at  timestamptz;
  v_rows               integer;
  v_pushed             uuid[] := ARRAY[]::uuid[];
  v_block              RECORD;
  v_frontier           text;
  v_block_start_date   date;
  v_block_end_date     date;
  v_duration_weeks     integer;
  v_duration_days      integer;
  v_candidate_start    date;
  v_candidate_end      date;
  v_np_push            date;
  v_iter               int;
  v_new_start_date     date;
  v_new_end_date       date;
  v_new_start_week     text;
  v_new_end_week       text;
  v_new_target         date;
  v_pushed_anchor_id   int;
  -- fix-620
  v_monday             date := public.bp_draw_current_monday();
  v_tenant_id          uuid;
  v_old_lane           text;
  v_old_start          text;
  v_old_end            text;
  v_refusal            text;
BEGIN
  PERFORM set_config('app.ds_source', 'bp_resolve_da_overlap', true);
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220

  -- ★★ fix-620 §B: a drop over a STARTED block cannot be cleared by pushing
  --    (started blocks never move), so it is refused before anything is
  --    written — the same sentence the commit-time trigger would give.
  SELECT ds.tenant_id, ds.da_assigned, ds.start_week, ds.end_week
    INTO v_tenant_id, v_old_lane, v_old_start, v_old_end
    FROM public.draw_schedule ds
   WHERE ds.project_id = p_anchor_project_id;
  v_refusal := public.bp_draw_overlap_refusal(
    v_tenant_id, p_anchor_project_id, p_target_da, p_target_start_week, p_target_end_week,
    v_old_lane, v_old_start, v_old_end);
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0620', MESSAGE = v_refusal;
  END IF;

  v_anchor_dd_start := bp_week_key_to_date(p_target_start_week);
  v_anchor_dd_end   := bp_week_key_to_date(p_target_end_week);
  IF v_anchor_dd_end IS NOT NULL THEN
    v_anchor_dd_end := v_anchor_dd_end + 4;
  END IF;
  v_anchor_target := bp_week_key_to_date(p_target_end_week);
  IF v_anchor_target IS NOT NULL THEN v_anchor_target := v_anchor_target + 14; END IF;

  UPDATE public.draw_schedule AS ds
  SET da_assigned = p_target_da,
      start_week  = p_target_start_week,
      end_week    = p_target_end_week,
      status      = p_anchor_status,
      dd_start    = v_anchor_dd_start,
      dd_end      = v_anchor_dd_end
  WHERE ds.project_id = p_anchor_project_id
    AND ds.updated_at = p_anchor_expected_updated_at
  RETURNING ds.updated_at INTO v_anchor_updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT p_anchor_project_id, NULL::timestamptz, ARRAY[]::uuid[], true;
    RETURN;
  END IF;

  UPDATE public.permits
  SET dd_start = v_anchor_dd_start, dd_end = v_anchor_dd_end
  WHERE project_id = p_anchor_project_id;

  IF v_anchor_target IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.permits WHERE project_id = p_anchor_project_id AND type = 'Building Permit') THEN
      UPDATE public.permits SET target_submit = v_anchor_target
      WHERE project_id = p_anchor_project_id AND type = 'Building Permit';
    ELSE
      SELECT id INTO v_pushed_anchor_id FROM public.permits
      WHERE project_id = p_anchor_project_id ORDER BY id ASC LIMIT 1;
      IF v_pushed_anchor_id IS NOT NULL THEN
        UPDATE public.permits SET target_submit = v_anchor_target WHERE id = v_pushed_anchor_id;
      END IF;
    END IF;
  END IF;

  v_frontier := p_target_end_week;

  FOR v_block IN
    SELECT ds.project_id, ds.start_week, ds.end_week
    FROM public.draw_schedule AS ds
    WHERE ds.da_assigned = p_target_da
      AND ds.project_id != p_anchor_project_id
      AND ds.start_week IS NOT NULL
      AND ds.end_week IS NOT NULL
      AND ds.end_week >= p_target_start_week
    ORDER BY ds.start_week ASC
  LOOP
    -- ★★★ fix-620 §A: a STARTED block never moves. It is not pushed and does
    --     not advance the frontier; while it is still running, the jump loop
    --     below treats it as an obstacle.
    IF bp_week_key_to_date(v_block.start_week) < v_monday THEN
      CONTINUE;
    END IF;

    IF v_block.start_week <= v_frontier
       AND v_block.end_week >= p_target_start_week THEN
      v_block_start_date := v_block.start_week::date;
      v_block_end_date   := v_block.end_week::date;
      v_duration_weeks := (v_block_end_date - v_block_start_date) / 7;
      v_duration_days  := v_duration_weeks * 7;

      v_candidate_start := v_frontier::date + 7;
      v_iter := 0;
      LOOP
        v_iter := v_iter + 1;
        EXIT WHEN v_iter > 50;
        v_candidate_end := v_candidate_start + v_duration_days;
        -- fix-24a's NP jump, plus (fix-620) a started project block still
        -- running on this lane — whichever starts first.
        SELECT o.jump
          INTO v_np_push
          FROM (
            SELECT bp_week_key_to_date(tb.end_week) + 7 AS jump,
                   bp_week_key_to_date(tb.start_week)   AS st
              FROM public.da_time_blocks tb
             WHERE tb.da_name = p_target_da
               AND bp_week_key_to_date(tb.start_week) <= v_candidate_end
               AND bp_week_key_to_date(tb.end_week)   >= v_candidate_start
            UNION ALL
            SELECT bp_week_key_to_date(ds3.end_week) + 7,
                   bp_week_key_to_date(ds3.start_week)
              FROM public.draw_schedule ds3
             WHERE ds3.da_assigned = p_target_da
               AND ds3.tenant_id IS NOT DISTINCT FROM v_tenant_id
               AND ds3.project_id <> p_anchor_project_id
               AND ds3.project_id <> v_block.project_id
               AND ds3.start_week IS NOT NULL
               AND ds3.end_week IS NOT NULL
               AND bp_week_key_to_date(ds3.start_week) <  v_monday
               AND bp_week_key_to_date(ds3.start_week) <= v_candidate_end
               AND bp_week_key_to_date(ds3.end_week)   >= v_candidate_start
          ) o
          ORDER BY o.st ASC
          LIMIT 1;
        EXIT WHEN v_np_push IS NULL;
        v_candidate_start := v_np_push;
      END LOOP;

      v_new_start_date := v_candidate_start;
      v_new_end_date   := v_new_start_date + v_duration_days;
      v_new_start_week := to_char(v_new_start_date, 'YYYY-MM-DD');
      v_new_end_week   := to_char(v_new_end_date, 'YYYY-MM-DD');
      v_new_target     := v_new_end_date + 14;

      UPDATE public.draw_schedule AS ds2
      SET start_week = v_new_start_week,
          end_week   = v_new_end_week,
          dd_start   = v_new_start_date,
          dd_end     = v_new_end_date + 4
      WHERE ds2.project_id = v_block.project_id;

      UPDATE public.permits
      SET dd_start = v_new_start_date, dd_end = v_new_end_date + 4
      WHERE project_id = v_block.project_id;

      IF EXISTS (SELECT 1 FROM public.permits WHERE project_id = v_block.project_id AND type = 'Building Permit') THEN
        UPDATE public.permits SET target_submit = v_new_target
        WHERE project_id = v_block.project_id AND type = 'Building Permit';
      ELSE
        SELECT id INTO v_pushed_anchor_id FROM public.permits
        WHERE project_id = v_block.project_id ORDER BY id ASC LIMIT 1;
        IF v_pushed_anchor_id IS NOT NULL THEN
          UPDATE public.permits SET target_submit = v_new_target WHERE id = v_pushed_anchor_id;
        END IF;
      END IF;

      v_pushed   := array_append(v_pushed, v_block.project_id);
      v_frontier := v_new_end_week;
    END IF;
  END LOOP;

  RETURN QUERY SELECT p_anchor_project_id, v_anchor_updated_at, v_pushed, false;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants — Supabase's default privileges hand new functions to anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_draw_current_monday() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_draw_current_monday() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_draw_overlap_refusal(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_draw_overlap_refusal(uuid, uuid, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_trg_draw_schedule_no_overlap() FROM PUBLIC, anon, authenticated;
-- bp_resolve_da_overlap keeps its ACL (CREATE OR REPLACE); restated.
REVOKE ALL ON FUNCTION public.bp_resolve_da_overlap(uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_resolve_da_overlap(uuid, text, text, text, text, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Read back.
-- ---------------------------------------------------------------------------
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.draw_schedule'::regclass
                    AND tgname = 'bp_draw_schedule_no_overlap'
                    AND tgdeferrable AND tginitdeferred) THEN
    RAISE EXCEPTION 'fix-620: the deferred overlap trigger is missing';
  END IF;
  IF (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.bp_resolve_da_overlap(uuid,text,text,text,text,timestamptz)'::regprocedure)
     NOT LIKE '%fix-620 §A%' THEN
    RAISE EXCEPTION 'fix-620: bp_resolve_da_overlap was not replaced';
  END IF;
  IF has_function_privilege('anon', 'public.bp_resolve_da_overlap(uuid,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bp_draw_overlap_refusal(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bp_draw_current_monday()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-620: anon can execute a fix-620 function';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.bp_resolve_da_overlap(uuid,text,text,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fix-620: authenticated lost EXECUTE on bp_resolve_da_overlap';
  END IF;
END
$check$;

COMMIT;
