-- fix-190c (2026-06-23): atomic "replace the whole quarter layout" RPC.
--
-- The per-quarter Draw Schedule layout editor used to commit EVERY field edit /
-- add / delete / drag instantly via the per-row RPCs, so a user sitting on the
-- wrong quarter could silently rewrite that quarter's saved layout (Q2 2026 got
-- overwritten with Q3's arrangement). fix-190c buffers all edits in a local
-- draft and persists ONLY on an explicit Save, which calls this one RPC.
--
-- bp_replace_quarter_layout deletes the (tenant, quarter) rows and re-inserts
-- p_rows in array order as positions 0..n-1, in ONE transaction. It carries
-- col_kind / da_name / group_label / label_override / top_label and relies on
-- the existing CHECK constraints (col_kind IN ('da','open','dm'); da_name
-- required for 'da'/'dm', NULL for 'open') to reject an invalid draft.
--
-- OCC: p_expected_fingerprint is the max(updated_at) the editor loaded (an ISO
-- timestamp string), or NULL to skip the check. It's compared as a timestamptz
-- (cast, not string) so PostgREST's vs Postgres's text formats can't cause a
-- false mismatch. If the quarter changed since load, RAISE 40001 so the editor
-- can warn + reload instead of clobbering a concurrent change. A per-(tenant,
-- quarter) advisory lock serializes concurrent savers.
--
-- Frozen-history rule unchanged: rename RPCs do NOT cascade here. Layout-only.
-- Migration applied to prod via MCP; this file is the repo backstop.

CREATE OR REPLACE FUNCTION public.bp_replace_quarter_layout(
  p_quarter text, p_rows jsonb, p_expected_fingerprint text DEFAULT NULL)
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

  -- Serialize concurrent writers to this (tenant, quarter) so the OCC check +
  -- delete/insert is atomic against another saver.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_tenant::text || ':' || p_quarter)::bigint);

  -- OCC: bail if the quarter changed since the editor loaded it. Compared as a
  -- timestamptz (format-agnostic). NULL = no baseline (skip).
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

REVOKE ALL ON FUNCTION public.bp_replace_quarter_layout(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_replace_quarter_layout(text, jsonb, text) TO authenticated, service_role;
