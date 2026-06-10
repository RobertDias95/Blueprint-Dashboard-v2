-- fix-154 (2026-06-10): per-type × per-jurisdiction target_submit offset overrides.
--
-- Context: the 14 in-code target_submit "formulas" (fix-25-feat-J / -AA) are a
-- per-type ANCHOR (dd_end / go_date / bp_c0_intake / bp_c1_resub /
-- bp_actual_issue / mirror_bp — see anchorFor() + the WHEN branches in
-- bp_recompute_target_submits) plus a per-type OFFSET in days. The offset is the
-- Tier-5 hardcoded fallback inside bp_learn_target_submit_days() (used when the
-- (type, juris) learner has no samples). Bobby wants the OFFSET to vary by
-- jurisdiction (Seattle BP ≠ Kirkland BP); the anchor logic is type-shaped and
-- stays in code.
--
-- This adds target_submit_formulas (tenant_id, type, jurisdiction, offset_days).
-- jurisdiction NULL = the "Base" row (matches the task_templates "Base" mental
-- model). Resolution: per-juris row if present, else the Base row, else NULL.
--
-- Wiring: bp_learn_target_submit_days() gains a new tier that consults this
-- table (via bp_target_submit_offset) BETWEEN the data learner and the hardcoded
-- literal. The 14 Base rows are seeded with the exact existing hardcoded values,
-- so behavior is IDENTICAL until an admin adds a per-juris override — no
-- backfill of existing permits.target_submit, only new recomputes pick it up.
--
-- The two mirror_bp types (Grading / Clearing, LSM) copy BP.target_submit
-- directly and never reach bp_learn_target_submit_days, so their offset is
-- inert; they are seeded at 0 purely so all 14 types appear in the Settings UI.
--
-- Applied to PROD via Supabase MCP apply_migration as
-- "fix_154_target_submit_formulas". This file is the repo record.

-- 1. Table + RLS.
CREATE TABLE IF NOT EXISTS public.target_submit_formulas (
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type         text        NOT NULL,
  jurisdiction text,                       -- NULL = Base (applies when no override)
  offset_days  integer     NOT NULL,       -- e.g. 90 for "anchor + 90"; may be negative
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);

-- NULL-safe uniqueness: one row per (tenant, type, juris-or-Base). A plain PK
-- can't express COALESCE, so an expression unique index enforces it instead.
CREATE UNIQUE INDEX IF NOT EXISTS target_submit_formulas_scope_uniq
  ON public.target_submit_formulas (tenant_id, type, COALESCE(jurisdiction, ''));

ALTER TABLE public.target_submit_formulas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS target_submit_formulas_tenant_policy ON public.target_submit_formulas;
CREATE POLICY target_submit_formulas_tenant_policy
  ON public.target_submit_formulas
  FOR ALL USING (tenant_id = ANY (public.auth_tenant_ids()));

-- 2. Seed the 14 (type, Base) rows from the existing in-code offsets
--    (bp_learn_target_submit_days Tier-5 CASE). G&C / LSM = 0 (mirror types).
INSERT INTO public.target_submit_formulas (tenant_id, type, jurisdiction, offset_days)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Building Permit',    NULL, 21),
  ('00000000-0000-0000-0000-000000000001', 'Condo',              NULL, 129),
  ('00000000-0000-0000-0000-000000000001', 'Demolition',         NULL, 37),
  ('00000000-0000-0000-0000-000000000001', 'ECA Waiver',         NULL, 10),
  ('00000000-0000-0000-0000-000000000001', 'Grading / Clearing', NULL, 0),
  ('00000000-0000-0000-0000-000000000001', 'IPR',                NULL, 7),
  ('00000000-0000-0000-0000-000000000001', 'LBA',                NULL, 37),
  ('00000000-0000-0000-0000-000000000001', 'LSM',                NULL, 0),
  ('00000000-0000-0000-0000-000000000001', 'PAR/Pre-Sub',        NULL, 10),
  ('00000000-0000-0000-0000-000000000001', 'SDOT Tree',          NULL, 10),
  ('00000000-0000-0000-0000-000000000001', 'Short Plat',         NULL, 37),
  ('00000000-0000-0000-0000-000000000001', 'SIP',                NULL, 37),
  ('00000000-0000-0000-0000-000000000001', 'TRAO',               NULL, 10),
  ('00000000-0000-0000-0000-000000000001', 'ULS',                NULL, 7)
ON CONFLICT (tenant_id, type, COALESCE(jurisdiction, '')) DO NOTHING;

DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.target_submit_formulas WHERE jurisdiction IS NULL;
  RAISE NOTICE 'fix-154 seed: % (type, Base) rows present (should be 14)', v_count;
END $$;

-- 3. Resolver: per-juris row if present, else Base, else NULL. Tenant-scoped via
--    auth_tenant_ids() (same pattern as bp_learn_days' permit_type_defaults tier).
CREATE OR REPLACE FUNCTION public.bp_target_submit_offset(p_type text, p_jurisdiction text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_offset integer;
BEGIN
  SELECT offset_days INTO v_offset
  FROM public.target_submit_formulas
  WHERE type = p_type
    AND tenant_id = ANY (auth_tenant_ids())
    AND (jurisdiction = v_juris OR jurisdiction IS NULL)
  ORDER BY (jurisdiction IS NULL), tenant_id  -- per-juris (false) sorts before Base (true)
  LIMIT 1;
  RETURN v_offset;
END;
$function$;

-- 4. List for the Settings editor — Base first per type.
CREATE OR REPLACE FUNCTION public.bp_list_target_submit_formulas()
 RETURNS TABLE(type text, jurisdiction text, offset_days integer, updated_at timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT type, jurisdiction, offset_days, updated_at
  FROM public.target_submit_formulas
  WHERE tenant_id = ANY (auth_tenant_ids())
  ORDER BY type, jurisdiction NULLS FIRST;
$function$;

-- 5. OCC upsert. p_jurisdiction NULL/'' → the Base row. Offset may be negative.
CREATE OR REPLACE FUNCTION public.bp_upsert_target_submit_formula(p_type text, p_jurisdiction text, p_offset_days integer, p_expected_updated_at timestamp with time zone)
 RETURNS TABLE(out_updated_at timestamp with time zone, conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_user   uuid;
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_actual timestamptz;
BEGIN
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'p_type is required';
  END IF;
  IF p_offset_days IS NULL OR p_offset_days < -365 OR p_offset_days > 730 THEN
    RAISE EXCEPTION 'p_offset_days must be in [-365, 730], got %', p_offset_days;
  END IF;

  v_user   := auth.uid();
  v_tenant := (auth_tenant_ids())[1];  -- single-tenant prod; matches bp_upsert_permit_type_default
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant in auth context';
  END IF;

  SELECT updated_at INTO v_actual
  FROM public.target_submit_formulas
  WHERE tenant_id = v_tenant AND type = p_type
    AND jurisdiction IS NOT DISTINCT FROM v_juris;

  IF v_actual IS NULL THEN
    INSERT INTO public.target_submit_formulas
      (tenant_id, type, jurisdiction, offset_days, updated_at, updated_by)
    VALUES (v_tenant, p_type, v_juris, p_offset_days, now(), v_user)
    RETURNING updated_at INTO out_updated_at;
    conflict := false;
    RETURN NEXT; RETURN;
  END IF;

  -- OCC: enforce the expected timestamp when the caller supplied one.
  IF p_expected_updated_at IS NOT NULL AND v_actual IS DISTINCT FROM p_expected_updated_at THEN
    out_updated_at := v_actual; conflict := true;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.target_submit_formulas
    SET offset_days = p_offset_days, updated_at = now(), updated_by = v_user
  WHERE tenant_id = v_tenant AND type = p_type
    AND jurisdiction IS NOT DISTINCT FROM v_juris
  RETURNING updated_at INTO out_updated_at;
  conflict := false;
  RETURN NEXT;
END;
$function$;

-- 6. Delete an override. Refuses the Base row (jurisdiction NULL) — Base is
--    seeded for all types and edited, never removed. Returns rows deleted.
CREATE OR REPLACE FUNCTION public.bp_delete_target_submit_formula(p_type text, p_jurisdiction text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_juris  text := NULLIF(p_jurisdiction, '');
  v_count  integer;
BEGIN
  IF v_juris IS NULL THEN
    RETURN 0;  -- refuse to delete a Base row
  END IF;
  v_tenant := (auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant in auth context';
  END IF;
  DELETE FROM public.target_submit_formulas
  WHERE tenant_id = v_tenant AND type = p_type AND jurisdiction = v_juris;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 7. Wire the table into the derivation: bp_learn_target_submit_days gains a new
--    Tier-5 (per-juris table) BETWEEN the data learner (Tiers 1-4) and the
--    hardcoded literal (now Tier 6). Only this block is new vs the prior body.
CREATE OR REPLACE FUNCTION public.bp_learn_target_submit_days(p_type text, p_juris text, p_anchor text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_avg integer;
  v_default integer;
  v_windows integer[] := ARRAY[90, 180, 365, NULL]::integer[];
  v_w integer;
BEGIN
  IF p_anchor NOT IN (
    'dd_end','go_date','bp_c0_intake','bp_c1_resub','bp_actual_issue'
  ) THEN RETURN NULL; END IF;

  -- fix-37: (type, juris) recency cascade only.
  FOREACH v_w IN ARRAY v_windows LOOP

    IF p_anchor = 'dd_end' THEN
      SELECT AVG(c0.submitted - p.dd_end)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND p.dd_end IS NOT NULL
        AND ABS(c0.submitted - p.dd_end) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'go_date' THEN
      SELECT AVG(c0.submitted - pr.go_date)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND pr.go_date IS NOT NULL
        AND ABS(c0.submitted - pr.go_date) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_c0_intake' THEN
      SELECT AVG(c0.submitted - bp_c0.intake_accepted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      JOIN permit_cycles bp_c0
        ON bp_c0.permit_id = bp.id AND bp_c0.cycle_index = 0
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp_c0.intake_accepted IS NOT NULL
        AND ABS(c0.submitted - bp_c0.intake_accepted) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_c1_resub' THEN
      SELECT AVG(c0.submitted - bp_c1.resubmitted)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      JOIN permit_cycles bp_c1
        ON bp_c1.permit_id = bp.id AND bp_c1.cycle_index = 1
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp_c1.resubmitted IS NOT NULL
        AND ABS(c0.submitted - bp_c1.resubmitted) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));

    ELSIF p_anchor = 'bp_actual_issue' THEN
      SELECT AVG(c0.submitted - bp.actual_issue)::integer INTO v_avg
      FROM permits p
      JOIN projects pr ON pr.id = p.project_id
      JOIN permit_cycles c0
        ON c0.permit_id = p.id AND c0.cycle_index = 0
      JOIN LATERAL (
        SELECT bp.id, bp.actual_issue
        FROM permits bp
        WHERE bp.project_id = p.project_id
          AND bp.type = 'Building Permit'
          AND bp.actual_issue IS NOT NULL
        ORDER BY bp.id ASC LIMIT 1
      ) bp ON true
      WHERE p.type = p_type
        AND pr.juris = p_juris
        AND c0.submitted IS NOT NULL
        AND bp.actual_issue IS NOT NULL
        AND ABS(c0.submitted - bp.actual_issue) <= 730
        AND (v_w IS NULL OR c0.submitted >= (CURRENT_DATE - v_w));
    END IF;

    IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;
  END LOOP;

  -- Tier 5 (fix-154): per-(type, juris) tenant offset override table.
  -- Per-juris row wins, else the (type, Base) row; NULL when no row at all.
  v_avg := bp_target_submit_offset(p_type, p_juris);
  IF v_avg IS NOT NULL THEN RETURN v_avg; END IF;

  -- Tier 6: hardcoded fallback mirroring fix-25-feat-J offsets (now only hit
  -- for tenants/types without a seeded Base row).
  v_default := CASE p_type
    WHEN 'Building Permit' THEN 21
    WHEN 'Demolition'      THEN 37
    WHEN 'ECA Waiver'      THEN 10
    WHEN 'IPR'             THEN 7
    WHEN 'ULS'             THEN 7
    WHEN 'LBA'             THEN 37
    WHEN 'Short Plat'      THEN 37
    WHEN 'SIP'             THEN 37
    WHEN 'PAR/Pre-Sub'     THEN 10
    WHEN 'SDOT Tree'       THEN 10
    WHEN 'TRAO'            THEN 10
    WHEN 'Condo'           THEN 129
    ELSE NULL
  END;
  RETURN v_default;
END;
$function$;
