-- fix-182d (2026-06-18): collision-proof column inserts for the quarter-layout
-- editor.
--
-- Live prod error (error_reports): "duplicate key value violates unique
-- constraint dsql_tenant_quarter_position_key" — 3x in 36s for one user editing
-- the Q3 2025 layout. Root cause: the editor's add-column / insert-OPEN-lane
-- path computed the new row's `position` from CLIENT state (rows.length), so two
-- rapid adds both picked the same next position before the first mutation's
-- cache invalidation landed, and the INSERT wrote that client position verbatim
-- (no constraint deferral) -> immediate 23505. Data was never corrupted (the
-- constraint rejected the bad writes).
--
-- Two SECURITY DEFINER RPCs make inserts authoritative server-side. Both take a
-- per-(tenant,quarter) transaction advisory lock so concurrent inserts serialize
-- (an MVCC snapshot alone would let two appends read the same max(position)).
-- Tenant-gated (42501) like the rest of the family; authenticated + service_role.
--
-- Migration applied to prod via MCP; this file is the repo backstop.

-- ---------------------------------------------------------------------------
-- 1. Append: position is ALWAYS server-computed = max(position)+1 within
--    (tenant, quarter). Kills the rapid-double-add race. p_col carries the
--    column fields (col_kind, da_name, group_label, label_override); any
--    position in p_col is ignored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_append_quarter_layout_column(
  p_quarter text, p_col jsonb)
 RETURNS TABLE(out_id uuid, updated_at timestamptz, out_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_pos    int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_append_quarter_layout_column: no tenant in caller scope'
      USING ERRCODE = '42501';
  END IF;
  IF p_quarter IS NULL THEN
    RAISE EXCEPTION 'bp_append_quarter_layout_column: quarter required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent appends to the same quarter so max(position) is stable.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_tenant::text || ':' || p_quarter)::bigint);

  SELECT COALESCE(max(position), -1) + 1 INTO v_pos
  FROM public.draw_schedule_quarter_layout
  WHERE tenant_id = v_tenant AND quarter = p_quarter;

  INSERT INTO public.draw_schedule_quarter_layout
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override)
  VALUES (
    v_tenant, p_quarter, v_pos,
    p_col->>'col_kind',
    NULLIF(p_col->>'da_name', ''),
    NULLIF(p_col->>'group_label', ''),
    NULLIF(p_col->>'label_override', '')
  )
  RETURNING draw_schedule_quarter_layout.id,
            draw_schedule_quarter_layout.updated_at,
            draw_schedule_quarter_layout.position
    INTO out_id, updated_at, out_position;

  RETURN NEXT;
END; $function$;

-- ---------------------------------------------------------------------------
-- 2. Mid-insert at an explicit position: shift rows with position >= P up by
--    one, then insert at P — atomically, with the DEFERRABLE unique constraint
--    deferred so the shift can't transiently collide (mirrors
--    bp_reorder_quarter_layout). Clamps P into [0, count] so a stale client P
--    can never error (it lands at the end at worst).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_insert_quarter_layout_column(
  p_quarter text, p_at_position integer, p_col jsonb)
 RETURNS TABLE(out_id uuid, updated_at timestamptz, out_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_count  int;
  v_pos    int;
BEGIN
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
    (tenant_id, quarter, position, col_kind, da_name, group_label, label_override)
  VALUES (
    v_tenant, p_quarter, v_pos,
    p_col->>'col_kind',
    NULLIF(p_col->>'da_name', ''),
    NULLIF(p_col->>'group_label', ''),
    NULLIF(p_col->>'label_override', '')
  )
  RETURNING draw_schedule_quarter_layout.id,
            draw_schedule_quarter_layout.updated_at,
            draw_schedule_quarter_layout.position
    INTO out_id, updated_at, out_position;

  RETURN NEXT;
END; $function$;

REVOKE ALL ON FUNCTION public.bp_append_quarter_layout_column(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_insert_quarter_layout_column(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_append_quarter_layout_column(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_insert_quarter_layout_column(text, integer, jsonb) TO authenticated, service_role;
