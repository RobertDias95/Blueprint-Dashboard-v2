-- fix-182b (2026-06-18): seed a quarter's Draw Schedule layout from the CURRENT
-- dm_da_groups. Phase B helper — the "start a brand-new quarter from today's
-- team" path. bp_clone_quarter_layout (fix-182a) covers quarter -> quarter;
-- this builds a quarter from the live manager grouping.
--
-- Rows are produced in the same left-to-right order the grid uses today
-- (dm_order, da_order, then name as tiebreak — mirrors useDmDaGroups), as DA
-- columns (col_kind='da') with group_label = the manager name. Same guards as
-- bp_clone_quarter_layout: tenant-gated (42501), refuse a non-empty target
-- unless p_force, transactional DELETE+INSERT.
--
-- Migration applied to prod via MCP; this file is the repo backstop. The editor
-- (Settings) is the only caller; nothing reads draw_schedule_quarter_layout yet
-- (Phase C wires the render).

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
  WHERE g.tenant_id = v_tenant;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;

REVOKE ALL ON FUNCTION public.bp_seed_quarter_layout_from_current(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_seed_quarter_layout_from_current(text, boolean) TO authenticated, service_role;
