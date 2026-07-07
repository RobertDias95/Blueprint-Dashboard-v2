-- fix-220: lock draw-schedule editing to admins only (server-enforced).
--
-- Role model: tenant_memberships.role / profiles.role in {'admin','editor'}.
-- Admins today: robertd, briana, dave, miles, brittani (both tables agree).
-- Requirement: every draw-schedule WRITE (draw_schedule, da_time_blocks,
-- draw_schedule_quarter_layout) must be admin-only. Editors keep full READ.
-- The scraper writes on the service key (auth.role() = 'service_role') and
-- MUST remain exempt — service_role also has BYPASSRLS in Supabase, so the
-- RLS admin-write policies below never apply to it.
--
-- Two enforcement layers (defense in depth, matches the task's preferred design):
--   1. RLS on draw_schedule + da_time_blocks: SELECT to all tenant members,
--      INSERT/UPDATE/DELETE only to tenant admins (mirrors the pre-existing
--      draw_schedule_quarter_layout + dm_da_groups admin-write policies).
--      This blocks direct table writes AND every SECURITY INVOKER write RPC
--      (bp_move_draw_schedule_da, bp_update_draw_schedule_with_dd_sync,
--      bp_upsert_draw_schedule_row, bp_set_bp_dd_dates, bp_shift_da_blocks_up,
--      bp_place_new_project_on_da, bp_rename_da, bp_resize_da_time_block,
--      bp_upsert/delete/replace_da_time_block(s), bp_delete/replace_draw_schedule)
--      for non-admin callers, because those run as the invoker.
--   2. An explicit admin guard inside every SECURITY DEFINER write RPC — those
--      run as owner and BYPASS RLS, so RLS alone can't stop them. Covered here:
--      bp_resolve_da_overlap, bp_update_redesign_dd_phase, and the 8 quarter-
--      layout RPCs. Each raises 42501 unless caller is service_role or admin.
--
-- Explicitly NOT gated: bp_create_project_with_permits stays editor-callable
-- (project creation is not draw-schedule editing) — it is SECURITY DEFINER and
-- writes the project's initial lane directly, so it keeps working for editors.
--
-- Base migration authored against the LIVE pg_get_functiondef of each RPC
-- (migrations/ is a partial record; prod eibnmwthkcuumyclyxoe is source of
-- truth). The only change to each function body is the guard PERFORM at the top.

-- ---------------------------------------------------------------------------
-- 1. Admin guard helpers
-- ---------------------------------------------------------------------------

-- Boolean: may the current caller edit the draw schedule?
--   service_role (scraper)         -> yes (bypass)
--   tenant/global admin            -> yes
--   everyone else (editor/viewer)  -> no
-- is_admin() checks profiles.role='admin'; the tenant_memberships fallback
-- mirrors the is_tenant_admin() notion used by the RLS policies, so both
-- enforcement layers agree.
CREATE OR REPLACE FUNCTION public.bp_can_edit_draw_schedule()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT auth.role() = 'service_role'
      OR public.is_admin()
      OR EXISTS (
           SELECT 1 FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND role = 'admin'
         );
$function$;

-- Raise unless the caller may edit the draw schedule. Called at the top of
-- every SECURITY DEFINER draw-schedule write RPC (those bypass RLS).
CREATE OR REPLACE FUNCTION public.bp_assert_draw_schedule_admin()
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.bp_can_edit_draw_schedule() THEN
    RAISE EXCEPTION 'draw schedule editing is restricted to admins'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_can_edit_draw_schedule() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_assert_draw_schedule_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_can_edit_draw_schedule() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_assert_draw_schedule_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS: admin-only writes on draw_schedule + da_time_blocks
--    (SELECT policies are left untouched — reads stay open to tenant members,
--     and the realtime pre-auth path that calls auth_tenant_ids() is preserved.)
-- ---------------------------------------------------------------------------

ALTER TABLE public.draw_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draw_schedule_tenant_insert ON public.draw_schedule;
DROP POLICY IF EXISTS draw_schedule_tenant_update ON public.draw_schedule;
DROP POLICY IF EXISTS draw_schedule_tenant_delete ON public.draw_schedule;
DROP POLICY IF EXISTS draw_schedule_tenant_admin_write ON public.draw_schedule;
CREATE POLICY draw_schedule_tenant_admin_write ON public.draw_schedule
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

ALTER TABLE public.da_time_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS da_time_blocks_tenant_insert ON public.da_time_blocks;
DROP POLICY IF EXISTS da_time_blocks_tenant_update ON public.da_time_blocks;
DROP POLICY IF EXISTS da_time_blocks_tenant_delete ON public.da_time_blocks;
DROP POLICY IF EXISTS da_time_blocks_tenant_admin_write ON public.da_time_blocks;
CREATE POLICY da_time_blocks_tenant_admin_write ON public.da_time_blocks
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER write RPCs — add the admin guard (they bypass RLS).
--    Bodies are the live definitions with a single PERFORM added at the top.
-- ---------------------------------------------------------------------------

-- 3a. bp_resolve_da_overlap — "Push Down" cascade (draw_schedule + permits)
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
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  v_anchor_dd_start := bp_week_key_to_date(p_target_start_week);
  v_anchor_dd_end   := bp_week_key_to_date(p_target_end_week);
  IF v_anchor_dd_end IS NOT NULL THEN
    v_anchor_dd_end := v_anchor_dd_end + 4;
  END IF;
  -- fix-25h: anchor target_submit = end_week_monday + 14 (matches bp_move_draw_schedule_da).
  -- Used by DD-edit + Push-Down flow so target_submit doesn't stay stale.
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

  -- fix-25h: cascade target_submit to anchor's BP (or anchor-fallback permit
  -- when no BP), matching bp_move_draw_schedule_da's pattern.
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
        SELECT (bp_week_key_to_date(end_week) + 7)
          INTO v_np_push
          FROM public.da_time_blocks
          WHERE da_name = p_target_da
            AND bp_week_key_to_date(start_week) <= v_candidate_end
            AND bp_week_key_to_date(end_week)   >= v_candidate_start
          ORDER BY bp_week_key_to_date(start_week) ASC
          LIMIT 1;
        EXIT WHEN v_np_push IS NULL;
        v_candidate_start := v_np_push;
      END LOOP;

      v_new_start_date := v_candidate_start;
      v_new_end_date   := v_new_start_date + v_duration_days;
      v_new_start_week := to_char(v_new_start_date, 'YYYY-MM-DD');
      v_new_end_week   := to_char(v_new_end_date, 'YYYY-MM-DD');
      -- fix-25h: each pushed block also gets target_submit refreshed
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

-- 3b. bp_update_redesign_dd_phase — redesign DD lane editor (draw_schedule)
CREATE OR REPLACE FUNCTION public.bp_update_redesign_dd_phase(p_project_id uuid, p_da text, p_dd_start date, p_dd_end date, p_status text, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(project_id uuid, updated_at timestamp with time zone, conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenants uuid[] := public.auth_tenant_ids();
  v_tenant  uuid;
  v_snapped_start date;
  v_snapped_end   date;
  v_existing      timestamptz;
  v_new_upd       timestamptz;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'p_project_id is required'; END IF;
  IF p_da IS NULL OR TRIM(p_da) = '' THEN RAISE EXCEPTION 'p_da is required'; END IF;
  IF p_dd_start IS NULL OR p_dd_end IS NULL THEN
    RAISE EXCEPTION 'dd_start and dd_end are required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.projects
   WHERE id = p_project_id AND tenant_id = ANY (v_tenants);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'project % not found in caller tenant', p_project_id;
  END IF;

  v_snapped_start := snap_to_monday_forward(p_dd_start);
  v_snapped_end   := p_dd_end;

  SELECT updated_at INTO v_existing
  FROM public.draw_schedule
  WHERE project_id = p_project_id;

  IF v_existing IS NULL THEN
    INSERT INTO public.draw_schedule (
      tenant_id, project_id, da_assigned,
      start_week, end_week, dd_start, dd_end,
      status, manual_status, manually_placed, updated_at
    ) VALUES (
      v_tenant, p_project_id, TRIM(p_da),
      to_char(v_snapped_start, 'YYYY-MM-DD'),
      to_char(date_trunc('week', v_snapped_end)::date, 'YYYY-MM-DD'),
      v_snapped_start, v_snapped_end,
      COALESCE(NULLIF(TRIM(p_status), ''), 'Scheduled'), false, true, now()
    ) RETURNING updated_at INTO v_new_upd;
    project_id := p_project_id;
    updated_at := v_new_upd;
    conflict   := false;
    RETURN NEXT; RETURN;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_existing IS DISTINCT FROM p_expected_updated_at THEN
    project_id := p_project_id;
    updated_at := v_existing;
    conflict   := true;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.draw_schedule SET
    da_assigned = TRIM(p_da),
    start_week  = to_char(v_snapped_start, 'YYYY-MM-DD'),
    end_week    = to_char(date_trunc('week', v_snapped_end)::date, 'YYYY-MM-DD'),
    dd_start    = v_snapped_start,
    dd_end      = v_snapped_end,
    status      = COALESCE(NULLIF(TRIM(p_status), ''), status),
    manually_placed = true,
    updated_at  = now()
  WHERE project_id = p_project_id
  RETURNING updated_at INTO v_new_upd;

  project_id := p_project_id;
  updated_at := v_new_upd;
  conflict   := false;
  RETURN NEXT;
END;
$function$;

-- 3c. Quarter-layout RPCs (draw_schedule_quarter_layout) — 8 functions.

CREATE OR REPLACE FUNCTION public.bp_upsert_quarter_layout_row(p_id uuid, p_data jsonb, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_id uuid, updated_at timestamp with time zone, conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant     uuid := (public.auth_tenant_ids())[1];
  v_row_tenant uuid;
  v_actual     timestamptz;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_upsert_quarter_layout_row: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.draw_schedule_quarter_layout
      (tenant_id, quarter, position, col_kind, da_name, group_label, label_override, top_label)
    VALUES (
      v_tenant,
      p_data->>'quarter',
      (p_data->>'position')::int,
      p_data->>'col_kind',
      NULLIF(p_data->>'da_name', ''),
      NULLIF(p_data->>'group_label', ''),
      NULLIF(p_data->>'label_override', ''),
      NULLIF(p_data->>'top_label', '')
    )
    RETURNING draw_schedule_quarter_layout.id,
              draw_schedule_quarter_layout.updated_at
      INTO out_id, updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  SELECT g.tenant_id, g.updated_at INTO v_row_tenant, v_actual
  FROM public.draw_schedule_quarter_layout g WHERE g.id = p_id;
  IF v_row_tenant IS NOT NULL
     AND NOT (v_row_tenant = ANY (public.auth_tenant_ids())) THEN
    RAISE EXCEPTION 'bp_upsert_quarter_layout_row: row % not in caller scope', p_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.draw_schedule_quarter_layout g SET
    quarter        = p_data->>'quarter',
    position       = (p_data->>'position')::int,
    col_kind       = p_data->>'col_kind',
    da_name        = NULLIF(p_data->>'da_name', ''),
    group_label    = NULLIF(p_data->>'group_label', ''),
    label_override = NULLIF(p_data->>'label_override', ''),
    top_label      = NULLIF(p_data->>'top_label', '')
  WHERE g.id = p_id
    AND g.tenant_id = ANY (public.auth_tenant_ids())
    AND g.updated_at = p_expected_updated_at
  RETURNING g.id, g.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_delete_quarter_layout_row(p_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(deleted boolean, conflict boolean, current_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row_tenant uuid;
  v_actual     timestamptz;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF (public.auth_tenant_ids())[1] IS NULL THEN
    RAISE EXCEPTION 'bp_delete_quarter_layout_row: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;

  SELECT g.tenant_id INTO v_row_tenant
  FROM public.draw_schedule_quarter_layout g WHERE g.id = p_id;
  IF v_row_tenant IS NOT NULL
     AND NOT (v_row_tenant = ANY (public.auth_tenant_ids())) THEN
    RAISE EXCEPTION 'bp_delete_quarter_layout_row: row % not in caller scope', p_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.draw_schedule_quarter_layout
  WHERE id = p_id
    AND tenant_id = ANY (public.auth_tenant_ids())
    AND updated_at = p_expected_updated_at;
  IF FOUND THEN
    deleted := true; conflict := false; current_updated_at := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT g.updated_at INTO v_actual
  FROM public.draw_schedule_quarter_layout g WHERE g.id = p_id;
  IF v_actual IS NULL THEN
    deleted := true; conflict := false; current_updated_at := NULL;
  ELSE
    deleted := false; conflict := true; current_updated_at := v_actual;
  END IF;
  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_reorder_quarter_layout(p_quarter text, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_total  int;
  v_match  int;
  v_count  int;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_reorder_quarter_layout: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'bp_reorder_quarter_layout: quarter and non-empty ids required'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.draw_schedule_quarter_layout
  WHERE quarter = p_quarter AND tenant_id = ANY (public.auth_tenant_ids());

  SELECT count(*) INTO v_match
  FROM public.draw_schedule_quarter_layout
  WHERE quarter = p_quarter
    AND tenant_id = ANY (public.auth_tenant_ids())
    AND id = ANY (p_ids);

  IF v_total <> v_match OR v_match <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION
      'bp_reorder_quarter_layout: id set must be the full % column set (have %, given %, matched %)',
      p_quarter, v_total, array_length(p_ids, 1), v_match
      USING ERRCODE = '22023';
  END IF;

  SET CONSTRAINTS dsql_tenant_quarter_position_key DEFERRED;

  UPDATE public.draw_schedule_quarter_layout g
  SET position = v.ord - 1
  FROM unnest(p_ids) WITH ORDINALITY AS v(id, ord)
  WHERE g.id = v.id
    AND g.quarter = p_quarter
    AND g.tenant_id = ANY (public.auth_tenant_ids());
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_clone_quarter_layout(p_from text, p_to text, p_force boolean DEFAULT false)
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
         src.col_kind, src.da_name, src.group_label, src.label_override, src.top_label
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

CREATE OR REPLACE FUNCTION public.bp_append_quarter_layout_column(p_quarter text, p_col jsonb)
 RETURNS TABLE(out_id uuid, updated_at timestamp with time zone, out_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_pos    int;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_append_quarter_layout_column: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL THEN
    RAISE EXCEPTION 'bp_append_quarter_layout_column: quarter required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_tenant::text || ':' || p_quarter)::bigint);

  SELECT COALESCE(max(position), -1) + 1 INTO v_pos
  FROM public.draw_schedule_quarter_layout
  WHERE tenant_id = v_tenant AND quarter = p_quarter;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override, top_label)
  VALUES (
    v_tenant, p_quarter, v_pos,
    p_col->>'col_kind',
    NULLIF(p_col->>'da_name', ''),
    NULLIF(p_col->>'group_label', ''),
    NULLIF(p_col->>'label_override', ''),
    NULLIF(p_col->>'top_label', '')
  )
  RETURNING draw_schedule_quarter_layout.id,
            draw_schedule_quarter_layout.updated_at,
            draw_schedule_quarter_layout.position
    INTO out_id, updated_at, out_position;

  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_insert_quarter_layout_column(p_quarter text, p_at_position integer, p_col jsonb)
 RETURNS TABLE(out_id uuid, updated_at timestamp with time zone, out_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_count  int;
  v_pos    int;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_insert_quarter_layout_column: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL OR p_at_position IS NULL THEN
    RAISE EXCEPTION 'bp_insert_quarter_layout_column: quarter and at_position required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_tenant::text || ':' || p_quarter)::bigint);

  SELECT count(*) INTO v_count
  FROM public.draw_schedule_quarter_layout
  WHERE tenant_id = v_tenant AND quarter = p_quarter;

  v_pos := least(greatest(p_at_position, 0), v_count);

  SET CONSTRAINTS dsql_tenant_quarter_position_key DEFERRED;

  UPDATE public.draw_schedule_quarter_layout
  SET position = position + 1
  WHERE tenant_id = v_tenant AND quarter = p_quarter AND position >= v_pos;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override, top_label)
  VALUES (
    v_tenant, p_quarter, v_pos,
    p_col->>'col_kind',
    NULLIF(p_col->>'da_name', ''),
    NULLIF(p_col->>'group_label', ''),
    NULLIF(p_col->>'label_override', ''),
    NULLIF(p_col->>'top_label', '')
  )
  RETURNING draw_schedule_quarter_layout.id,
            draw_schedule_quarter_layout.updated_at,
            draw_schedule_quarter_layout.position
    INTO out_id, updated_at, out_position;

  RETURN NEXT;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_replace_quarter_layout(p_quarter text, p_rows jsonb, p_expected_fingerprint text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant  uuid := (public.auth_tenant_ids())[1];
  v_current timestamptz;
  v_count   int;
BEGIN
  PERFORM public.bp_assert_draw_schedule_admin();  -- fix-220
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_replace_quarter_layout: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL THEN
    RAISE EXCEPTION 'bp_replace_quarter_layout: quarter required'
      USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'bp_replace_quarter_layout: p_rows must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_tenant::text || ':' || p_quarter)::bigint);

  IF p_expected_fingerprint IS NOT NULL THEN
    SELECT max(updated_at) INTO v_current
    FROM public.draw_schedule_quarter_layout
    WHERE tenant_id = v_tenant AND quarter = p_quarter;
    IF coalesce(v_current, 'epoch'::timestamptz)
       IS DISTINCT FROM coalesce(p_expected_fingerprint::timestamptz, 'epoch'::timestamptz) THEN
      RAISE EXCEPTION 'bp_replace_quarter_layout: % changed since load (conflict)', p_quarter
        USING ERRCODE = '40001';
    END IF;
  END IF;

  DELETE FROM public.draw_schedule_quarter_layout
  WHERE tenant_id = v_tenant AND quarter = p_quarter;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override, top_label)
  SELECT v_tenant,
         p_quarter,
         (r.ord - 1)::int,
         r.elem->>'col_kind',
         NULLIF(r.elem->>'da_name', ''),
         NULLIF(r.elem->>'group_label', ''),
         NULLIF(r.elem->>'label_override', ''),
         NULLIF(r.elem->>'top_label', '')
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION public.bp_seed_quarter_layout_from_current(p_quarter text, p_force boolean DEFAULT false)
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
    RAISE EXCEPTION 'bp_seed_quarter_layout_from_current: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL THEN
    RAISE EXCEPTION 'bp_seed_quarter_layout_from_current: quarter required'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.draw_schedule_quarter_layout
  WHERE quarter = p_quarter AND tenant_id = v_tenant;

  IF v_existing > 0 THEN
    IF NOT p_force THEN
      RAISE EXCEPTION
        'bp_seed_quarter_layout_from_current: target % already has % rows (pass p_force to overwrite)',
        p_quarter, v_existing
        USING ERRCODE = '23505';
    END IF;
    DELETE FROM public.draw_schedule_quarter_layout
    WHERE quarter = p_quarter AND tenant_id = v_tenant;
  END IF;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label)
  SELECT v_tenant,
         p_quarter,
         (row_number() OVER (
            ORDER BY g.dm_order, g.da_order, g.dm_name, g.da_name)) - 1,
         'da',
         g.da_name,
         g.dm_name
  FROM public.dm_da_groups g
  LEFT JOIN public.team_members tm
    ON tm.tenant_id = v_tenant AND tm.role = 'da' AND tm.name = g.da_name
  WHERE g.tenant_id = v_tenant
    AND public.bp_member_active_in_quarter(
          tm.active_start_quarter, tm.active_end_quarter, p_quarter);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;
