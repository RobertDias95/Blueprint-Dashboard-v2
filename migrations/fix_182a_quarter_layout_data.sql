-- fix-182a (2026-06-18): Quarter-versioned Draw Schedule layout — DATA + BACKEND.
--
-- Phase A of fix-182. The Draw Schedule grid groups DAs under managers from a
-- SINGLE global snapshot (public.dm_da_groups) with no time dimension, so
-- viewing a past quarter renders with TODAY's manager grouping/order. This adds
-- a per-quarter, fully-ordered saved column layout that can reproduce a quarter
-- exactly (ordered DA columns, manager-group headers, OPEN placeholder lanes,
-- standalone columns). NOTHING reads this table yet — the grid is byte-for-byte
-- unchanged after this ships. Phase B (settings editor) and Phase C (render +
-- quarter tabs) are separate, later briefs.
--
-- Migration applied to prod via MCP; this file is the repo backstop. Every
-- function pins search_path and is SECURITY DEFINER + tenant-gated per the
-- fix-157 model. (migrations/ is a partial record; prod is source of truth.)
--
-- ===========================================================================
-- LOCKED DESIGN DECISIONS (drive Phase B/C — do not silently revisit):
--
--  * FROZEN HISTORY. bp_rename_dm / bp_rename_da do NOT cascade into this table.
--    Those RPCs target team_members + dm_da_groups + permits/permit_tasks only
--    (see fix-72 / rename hooks); they never touch draw_schedule_quarter_layout.
--    A past quarter intentionally keeps the names/structure it had then — e.g.
--    a manager-of-DAs who later left, or "Ana" who grouped people without ever
--    being a `dm`-role member, stays exactly as recorded. group_label is free
--    text precisely so it can be a non-`dm` person.
--
--  * dm_da_groups stays the single "current/default" structure for the wizard
--    (findDmForDa) and the draw-schedule move-cascade. Phase A does NOT change
--    dm_da_groups in any way.
--
--  * Column semantics:
--      col_kind='open' -> placeholder lane, da_name IS NULL (nobody assigned).
--      col_kind='da'   -> da_name IS NOT NULL (the person in the column).
--      group_label NULL  -> standalone top-level column (no manager header).
--      group_label set   -> manager header spanning the contiguous run of
--                           columns sharing that label (any free-text name).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Table.
--    UNIQUE(tenant_id, quarter, position) is DEFERRABLE so bp_reorder can
--    permute positions in one UPDATE without a transient duplicate-key error.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draw_schedule_quarter_layout (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  quarter        text NOT NULL,                       -- 'YYYY-Qn'
  position       int  NOT NULL,                        -- left-to-right, 0..n
  col_kind       text NOT NULL CHECK (col_kind IN ('da','open')),
  da_name        text,
  group_label    text,
  label_override text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dsql_tenant_quarter_position_key
    UNIQUE (tenant_id, quarter, position) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT dsql_kind_da_consistency CHECK (
    (col_kind = 'open' AND da_name IS NULL) OR
    (col_kind = 'da'   AND da_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS draw_schedule_quarter_layout_tenant_idx
  ON public.draw_schedule_quarter_layout(tenant_id);
CREATE INDEX IF NOT EXISTS draw_schedule_quarter_layout_quarter_idx
  ON public.draw_schedule_quarter_layout(tenant_id, quarter, position);

-- Standard tenant-stamp + updated_at triggers (match dm_da_groups et al).
DROP TRIGGER IF EXISTS draw_schedule_quarter_layout_default_tenant
  ON public.draw_schedule_quarter_layout;
CREATE TRIGGER draw_schedule_quarter_layout_default_tenant
  BEFORE INSERT ON public.draw_schedule_quarter_layout
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

DROP TRIGGER IF EXISTS draw_schedule_quarter_layout_set_updated_at
  ON public.draw_schedule_quarter_layout;
CREATE TRIGGER draw_schedule_quarter_layout_set_updated_at
  BEFORE UPDATE ON public.draw_schedule_quarter_layout
  FOR EACH ROW EXECUTE FUNCTION public.bp_set_updated_at();

-- RLS: read within tenant scope; direct writes admin-only (parity with
-- dm_da_groups). All app writes go through the SECURITY DEFINER RPCs below.
ALTER TABLE public.draw_schedule_quarter_layout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsql_tenant_select ON public.draw_schedule_quarter_layout;
CREATE POLICY dsql_tenant_select ON public.draw_schedule_quarter_layout
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS dsql_tenant_admin_write ON public.draw_schedule_quarter_layout;
CREATE POLICY dsql_tenant_admin_write ON public.draw_schedule_quarter_layout
  FOR ALL USING (public.is_tenant_admin(tenant_id))
          WITH CHECK (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- 2a. Upsert one column (OCC). p_id NULL = insert (tenant stamped to caller);
--     non-NULL = OCC update. Mirrors bp_upsert_dm_da_group_row's return shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_upsert_quarter_layout_row(
  p_id uuid, p_data jsonb, p_expected_updated_at timestamptz)
 RETURNS TABLE(out_id uuid, updated_at timestamptz, conflict boolean)
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
      (tenant_id, quarter, position, col_kind, da_name, group_label, label_override)
    VALUES (
      v_tenant,
      p_data->>'quarter',
      (p_data->>'position')::int,
      p_data->>'col_kind',
      NULLIF(p_data->>'da_name', ''),
      NULLIF(p_data->>'group_label', ''),
      NULLIF(p_data->>'label_override', '')
    )
    RETURNING draw_schedule_quarter_layout.id,
              draw_schedule_quarter_layout.updated_at
      INTO out_id, updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  -- Update path: a row that exists but is outside caller scope is 42501,
  -- not an OCC conflict.
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
    label_override = NULLIF(p_data->>'label_override', '')
  WHERE g.id = p_id
    AND g.tenant_id = ANY (public.auth_tenant_ids())
    AND g.updated_at = p_expected_updated_at
  RETURNING g.id, g.updated_at INTO out_id, updated_at;

  IF FOUND THEN
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  -- Not updated: OCC conflict (or the row was deleted out from under us).
  out_id := p_id; updated_at := v_actual; conflict := true;
  RETURN NEXT;
END; $function$;

-- ---------------------------------------------------------------------------
-- 2b. Delete one column (OCC). Mirrors bp_delete_dm_da_group_row's shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_delete_quarter_layout_row(
  p_id uuid, p_expected_updated_at timestamptz)
 RETURNS TABLE(deleted boolean, conflict boolean, current_updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row_tenant uuid;
  v_actual     timestamptz;
BEGIN
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
    deleted := true; conflict := false; current_updated_at := NULL;   -- already gone
  ELSE
    deleted := false; conflict := true; current_updated_at := v_actual;
  END IF;
  RETURN NEXT;
END; $function$;

-- ---------------------------------------------------------------------------
-- 2c. Reorder a quarter's columns to position 0..n in p_ids order.
--     p_ids MUST be the complete set of that quarter's columns (a full
--     permutation) — guards against partial reorders leaving gaps/dupes.
--     The DEFERRABLE unique constraint lets the single UPDATE permute safely.
--     Returns the number of rows renumbered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_reorder_quarter_layout(
  p_quarter text, p_ids uuid[])
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

-- ---------------------------------------------------------------------------
-- 2d. Clone every column of p_from into p_to (new ids, same
--     position/col_kind/da_name/group_label/label_override). Transactional:
--     the DELETE+INSERT under p_force is atomic with the RPC call. Refuses a
--     non-empty target unless p_force. Operates within the caller's tenant.
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
  SELECT tenant_id, p_to, position, col_kind, da_name, group_label, label_override
  FROM public.draw_schedule_quarter_layout
  WHERE quarter = p_from AND tenant_id = v_tenant
  ORDER BY position;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END; $function$;

-- Grants: authenticated (app) + service_role; never PUBLIC/anon (fix-157 model).
REVOKE ALL ON FUNCTION public.bp_upsert_quarter_layout_row(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_delete_quarter_layout_row(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_reorder_quarter_layout(text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_clone_quarter_layout(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_quarter_layout_row(uuid, jsonb, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_delete_quarter_layout_row(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_reorder_quarter_layout(text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_clone_quarter_layout(text, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. One-time seed of 2026-Q1 from the surviving v1 quarterTeams blob in
--    legacy_app_config.data. Manager order = data->'dmOrder' (array); DA order
--    = the per-manager array order. Idempotent: skips if 2026-Q1 already has
--    rows for the tenant. Seeds the Blueprint Capital tenant only (the blob is
--    that tenant's v1 config; legacy_app_config is the global single-row store).
-- ---------------------------------------------------------------------------
DO $seed$
DECLARE
  v_tenant  uuid := '00000000-0000-0000-0000-000000000001';
  v_quarter text := '2026-Q1';
  v_qt      jsonb;
  v_dmorder jsonb;
  v_pos     int := 0;
  v_dm      record;
  v_da      record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.draw_schedule_quarter_layout
    WHERE tenant_id = v_tenant AND quarter = v_quarter
  ) THEN
    RAISE NOTICE 'fix-182a seed: % already populated — skipping', v_quarter;
    RETURN;
  END IF;

  SELECT data->'quarterTeams'->v_quarter, data->'dmOrder'
    INTO v_qt, v_dmorder
  FROM public.legacy_app_config ORDER BY id LIMIT 1;

  IF v_qt IS NULL OR jsonb_typeof(v_qt) <> 'object' THEN
    RAISE NOTICE 'fix-182a seed: no quarterTeams[%] object — skipping', v_quarter;
    RETURN;
  END IF;

  FOR v_dm IN
    SELECT qt.key AS dm_name,
           qt.value AS das,
           COALESCE(
             (SELECT d.ord
              FROM jsonb_array_elements_text(COALESCE(v_dmorder, '[]'::jsonb))
                   WITH ORDINALITY AS d(name, ord)
              WHERE d.name = qt.key),
             999
           ) AS dm_rank
    FROM jsonb_each(v_qt) AS qt
    ORDER BY dm_rank, qt.key
  LOOP
    FOR v_da IN
      SELECT a.da_name, a.ord
      FROM jsonb_array_elements_text(v_dm.das) WITH ORDINALITY AS a(da_name, ord)
      ORDER BY a.ord
    LOOP
      INSERT INTO public.draw_schedule_quarter_layout
        (tenant_id, quarter, position, col_kind, da_name, group_label)
      VALUES (v_tenant, v_quarter, v_pos, 'da', v_da.da_name, v_dm.dm_name);
      v_pos := v_pos + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'fix-182a seed: inserted % columns for %', v_pos, v_quarter;
END $seed$;
