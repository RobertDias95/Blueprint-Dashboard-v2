-- fix-190b (2026-06-23): top (regional/ent) tier above the DM groups in the
-- per-quarter Draw Schedule layout.
--
-- The new draw schedule has a THIRD grouping level above the DM groups: e.g.
-- MILES spans Lindsay's columns, BRIANA spans Brittani's, and a mixed
-- "Miles, WA | Briana, AZ" spans Jade + Derry. This adds a per-column free-text
-- `top_label`; contiguous columns sharing the same non-empty top_label form one
-- top-tier span (ACROSS DM groups). NULL/empty = no top header for that column
-- (default; back-compat — a quarter with no top_labels renders byte-for-byte as
-- it does today, with no top band).
--
-- Layout-only + frozen-history like the rest of fix-182: rename RPCs do NOT
-- cascade here; dm_da_groups / wizard / cascade are untouched. No CHECK changes.
-- Every column-writing RPC must carry top_label through verbatim — the four
-- below are recreated from their LIVE defs (prod is source of truth; the
-- committed .sql is a partial record) with top_label threaded in. bp_reorder
-- (position only) and bp_delete need no change.
--
-- Migration applied to prod via MCP; this file is the repo backstop.

ALTER TABLE public.draw_schedule_quarter_layout
  ADD COLUMN IF NOT EXISTS top_label text;

-- ---------------------------------------------------------------------------
-- Upsert: thread top_label through both INSERT and UPDATE paths.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Append: carry top_label.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Mid-insert: carry top_label.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Clone: copy top_label alongside the other column fields. Based on the LIVE
-- def (fix-183 added the active-quarter filter + row_number reposition).
-- ---------------------------------------------------------------------------
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
