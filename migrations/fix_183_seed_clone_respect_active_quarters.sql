-- fix-183 (2026-06-18): the "build a quarter" RPCs must respect active-quarters
-- so a departed DA is never re-introduced into a layout.
--
-- active_quarters (team_members.active_start_quarter/active_end_quarter) is the
-- team-MEMBERSHIP source ("who's on the team, when"); the per-quarter layout
-- (fix-182) is ARRANGEMENT. Until now bp_seed_quarter_layout_from_current copied
-- dm_da_groups verbatim and bp_clone_quarter_layout copied the prior quarter
-- verbatim — so seeding e.g. Q2 2026 from the current structure would have
-- re-introduced Chad/Nidhi/Alex (all ended 2026-Q1). Both now filter 'da'
-- columns through bp_member_active_in_quarter(<member window>, target_quarter)
-- and renumber positions contiguously.
--
-- A 'da' column whose name has NO team_members row defaults to VISIBLE (NULL
-- window -> bp_member_active_in_quarter returns true), matching the Draw
-- Schedule fallback rule ("no team_member record -> default visible"). OPEN
-- lanes (col_kind='open', no da) ALWAYS carry over. Tenant gate + force
-- semantics are unchanged.
--
-- Migration applied to prod via MCP; this file is the repo backstop. Replaces
-- the bodies only (same signatures, grants intact).

-- ---------------------------------------------------------------------------
-- Seed a quarter from the CURRENT dm_da_groups, keeping only DAs active in the
-- target quarter. row_number() over the kept set -> contiguous 0..n.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_seed_quarter_layout_from_current(
  p_quarter text, p_force boolean DEFAULT false)
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

-- ---------------------------------------------------------------------------
-- Clone p_from -> p_to, dropping 'da' columns whose DA is inactive in p_to.
-- OPEN lanes always carry over; group_label/label_override preserved for kept
-- columns. row_number() over the source order -> contiguous 0..n.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_clone_quarter_layout(
  p_from text, p_to text, p_force boolean DEFAULT false)
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
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override)
  SELECT v_tenant,
         p_to,
         (row_number() OVER (ORDER BY src.position)) - 1,
         src.col_kind, src.da_name, src.group_label, src.label_override
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
