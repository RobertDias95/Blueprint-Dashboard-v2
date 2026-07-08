-- fix-221: count "approved but not issued" permits as issued/complete, and add
-- an "Approved – Awaiting Issuance" saved report.
--
-- "approved-not-issued" (the single shared definition, mirrored by
-- src/lib/effectiveIssued.ts isApprovedNotIssued):
--   approval_date IS NOT NULL AND actual_issue IS NULL
--   AND status NOT IN ('Issued','Withdrawn','Completed','Closed')
--   AND parent_permit_id IS NULL   (sub-permits excluded, fix-194)
--
-- Two server changes here:
--   1. bp_get_weekly_da_report gains a third per-DA bucket,
--      `approved_awaiting_issuance`, so these permits (which the corrections +
--      upcoming-intakes gates both drop) stay visible in the weekly report.
--   2. The reporting hub seeds a new builtin card, approved_awaiting_issuance,
--      whose route (/reports/approved-awaiting) renders the client report.
--
-- Base authored against the LIVE pg_get_functiondef of each function
-- (migrations/ is a partial record; prod eibnmwthkcuumyclyxoe is source of
-- truth). The throughput/issued-count change (approved-not-issued counts as
-- issued via approval_date) is pure client TS (src/lib/effectiveIssued.ts +
-- reportMetrics.ts) — no SQL needed for it.

-- ---------------------------------------------------------------------------
-- 1. Weekly DA report — add the "Approved – Awaiting Issuance" bucket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_get_weekly_da_report(p_week_start date, p_window_days integer DEFAULT 14, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants    uuid[] := public.auth_tenant_ids();
  v_window_end date   := p_week_start + COALESCE(p_window_days, 14);
  v_f_ent      text   := NULLIF(p_filters->>'ent_lead', '');
  v_f_type     text   := NULLIF(p_filters->>'type', '');
  v_f_status   text   := NULLIF(p_filters->>'status', '');
  v_f_juris    text   := NULLIF(p_filters->>'juris', '');
  v_f_da       text   := NULLIF(p_filters->>'da', '');
  v_result     jsonb;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (pc.permit_id)
      pc.permit_id, pc.cycle_index, pc.corr_issued, pc.resubmitted
    FROM public.permit_cycles pc
    WHERE pc.tenant_id = ANY (v_tenants)
    ORDER BY pc.permit_id, pc.cycle_index DESC
  ),
  base AS (
    SELECT
      p.id                AS permit_id,
      p.project_id        AS project_id,
      pr.address          AS address,
      pr.juris            AS juris,
      p.type              AS type,
      p.num               AS num,
      p.portal_url        AS portal_url,
      p.ent_lead          AS ent_lead,
      p.da                AS da,
      COALESCE(p.da, 'Unassigned') AS da_key,
      p.target_submit     AS target_submit,
      p.actual_issue      AS actual_issue,
      p.approval_date     AS approval_date,
      p.parent_permit_id  AS parent_permit_id,
      p.stage_override    AS stage_override,
      p.status            AS permit_status,
      l.cycle_index       AS cycle_index,
      l.corr_issued       AS corr_issued,
      l.resubmitted       AS resubmitted,
      EXISTS (
        SELECT 1 FROM public.permit_cycles pc
        WHERE pc.permit_id = p.id
          AND pc.tenant_id = ANY (v_tenants)
          AND pc.intake_accepted IS NOT NULL
      )                   AS ever_intake_accepted,
      COALESCE(rn.body, '') AS note_body
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
    LEFT JOIN latest l ON l.permit_id = p.id
    LEFT JOIN public.report_notes rn ON rn.permit_id = p.id
    WHERE p.tenant_id = ANY (v_tenants)
      AND (v_f_ent    IS NULL OR p.ent_lead = v_f_ent)
      AND (v_f_type   IS NULL OR p.type = v_f_type)
      AND (v_f_status IS NULL OR p.status = v_f_status)
      AND (v_f_juris  IS NULL OR pr.juris = v_f_juris)
      AND (v_f_da     IS NULL OR COALESCE(p.da, 'Unassigned') = v_f_da)
      AND NOT EXISTS (
        SELECT 1 FROM public.project_holds ph
        WHERE ph.project_id = p.project_id
          AND ph.tenant_id = ANY (v_tenants)
          AND ph.hold_end IS NULL
      )
  ),
  corr AS (
    -- fix-214: unified hybrid "in corrections" (corr_issued OR reviewer-rollup ==
    -- corrections, corr_issued authoritative). Mirrors src/lib/permitStage.ts
    -- isPermitInCorrections — keep in lockstep.
    SELECT * FROM base
    WHERE public.bp_permit_in_corrections(permit_id, v_tenants)
  ),
  upc AS (
    SELECT * FROM base
    WHERE target_submit IS NOT NULL
      AND target_submit BETWEEN p_week_start AND v_window_end
      AND ever_intake_accepted IS FALSE
      AND actual_issue IS NULL
      AND approval_date IS NULL
      AND COALESCE(stage_override, '') NOT IN ('ap','is')
      AND COALESCE(permit_status, '') NOT IN (
        'Conceptually Approved','Approved','Issued','Completed','Closed','Ready for Issuance'
      )
  ),
  apr AS (
    -- fix-221: approved but not yet issued (Seattle "Issuance Prep"). Mirrors
    -- src/lib/effectiveIssued.ts isApprovedNotIssued — keep in lockstep.
    SELECT * FROM base
    WHERE approval_date IS NOT NULL
      AND actual_issue IS NULL
      AND parent_permit_id IS NULL
      AND COALESCE(permit_status, '') NOT IN ('Issued','Withdrawn','Completed','Closed')
  ),
  da_keys AS (
    SELECT da_key FROM corr
    UNION
    SELECT da_key FROM upc
    UNION
    SELECT da_key FROM apr
  ),
  groups AS (
    SELECT
      k.da_key,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'permit_id',  c.permit_id,
            'project_id', c.project_id,
            'address',    c.address,
            'juris',      c.juris,
            'type',       c.type,
            'num',        c.num,
            'portal_url', c.portal_url,
            'corr_issued', c.corr_issued,
            'cycle_index', c.cycle_index,
            'ent_lead',   c.ent_lead,
            'da',         c.da,
            'note_body',  c.note_body
          )
          ORDER BY c.corr_issued, c.address
        ), '[]'::jsonb)
        FROM corr c WHERE c.da_key = k.da_key
      ) AS corrections,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'permit_id',  u.permit_id,
            'project_id', u.project_id,
            'address',    u.address,
            'juris',      u.juris,
            'type',       u.type,
            'num',        u.num,
            'portal_url', u.portal_url,
            'target_submit', u.target_submit,
            'cycle_index', u.cycle_index,
            'ent_lead',   u.ent_lead,
            'da',         u.da,
            'note_body',  u.note_body
          )
          ORDER BY u.target_submit, u.address
        ), '[]'::jsonb)
        FROM upc u WHERE u.da_key = k.da_key
      ) AS upcoming_intakes,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'permit_id',  a.permit_id,
            'project_id', a.project_id,
            'address',    a.address,
            'juris',      a.juris,
            'type',       a.type,
            'num',        a.num,
            'portal_url', a.portal_url,
            'approval_date', a.approval_date,
            'cycle_index', a.cycle_index,
            'ent_lead',   a.ent_lead,
            'da',         a.da,
            'note_body',  a.note_body
          )
          -- oldest approval first = longest-waiting first
          ORDER BY a.approval_date, a.address
        ), '[]'::jsonb)
        FROM apr a WHERE a.da_key = k.da_key
      ) AS approved_awaiting_issuance
    FROM da_keys k
  )
  SELECT jsonb_build_object(
    'das',
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'da',   g.da_key,
          'name', g.da_key,
          'corrections', g.corrections,
          'upcoming_intakes', g.upcoming_intakes,
          'approved_awaiting_issuance', g.approved_awaiting_issuance
        )
        ORDER BY (g.da_key = 'Unassigned'), g.da_key
      ),
      '[]'::jsonb
    ),
    'generated_at', now(),
    'week_start',   p_week_start,
    'window_days',  COALESCE(p_window_days, 14)
  )
  INTO v_result
  FROM groups g;
  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'das', '[]'::jsonb,
      'generated_at', now(),
      'week_start', p_week_start,
      'window_days', COALESCE(p_window_days, 14)
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Reporting hub — seed the new builtin card (idempotent, both builtins).
--    Rewritten from the live def: the prior early-return on the weekly marker
--    meant already-seeded tenants never picked up a newly-added builtin. Now
--    every builtin is inserted with ON CONFLICT DO NOTHING, so ensure-on-read
--    self-heals for both existing and future tenants. The tenant-scope guard
--    (fix-157/163) is preserved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_ensure_report_hub_seed(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cat      uuid;
  v_pipeline uuid;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_ensure_report_hub_seed: tenant % not in caller scope', p_tenant
      USING ERRCODE = '42501';
  END IF;

  -- Weekly Updates category + Weekly DA Update builtin.
  SELECT id INTO v_cat
  FROM public.report_categories
  WHERE tenant_id = p_tenant AND name = 'Weekly Updates' AND parent_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
    VALUES (p_tenant, NULL, 'Weekly Updates', 0)
    RETURNING id INTO v_cat;
  END IF;

  INSERT INTO public.saved_reports
    (tenant_id, category_id, name, description, kind, builtin_key, position)
  VALUES (
    p_tenant, v_cat, 'Weekly DA Update',
    'Per-DA one-pager: permits in corrections (with the date corrections came out), carry-forward notes, and upcoming intakes for the week. Printable / send-ready.',
    'builtin', 'weekly_da_update', 0
  )
  ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
  DO NOTHING;

  -- fix-221: Pipeline category + Approved – Awaiting Issuance builtin.
  SELECT id INTO v_pipeline
  FROM public.report_categories
  WHERE tenant_id = p_tenant AND name = 'Pipeline' AND parent_id IS NULL
  ORDER BY position, created_at
  LIMIT 1;
  IF v_pipeline IS NULL THEN
    INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
    VALUES (p_tenant, NULL, 'Pipeline', 1)
    RETURNING id INTO v_pipeline;
  END IF;

  INSERT INTO public.saved_reports
    (tenant_id, category_id, name, description, kind, builtin_key, position)
  VALUES (
    p_tenant, v_pipeline, 'Approved – Awaiting Issuance',
    'Permits the city has approved (approval date set) but not yet issued — sitting in Issuance Prep. Sorted by days-since-approval; each row opens the permit in Project View.',
    'builtin', 'approved_awaiting_issuance', 0
  )
  ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
  DO NOTHING;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Back-seed the new builtin for every existing tenant.
--    Direct inserts (NOT a bp_ensure_report_hub_seed call) because that
--    function's tenant-scope guard raises when run as the migration role
--    (no service_role / no auth_tenant_ids). Idempotent via ON CONFLICT.
-- ---------------------------------------------------------------------------
DO $seed$
DECLARE
  v_t        uuid;
  v_pipeline uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    SELECT id INTO v_pipeline
    FROM public.report_categories
    WHERE tenant_id = v_t AND name = 'Pipeline' AND parent_id IS NULL
    ORDER BY position, created_at
    LIMIT 1;
    IF v_pipeline IS NULL THEN
      INSERT INTO public.report_categories (tenant_id, parent_id, name, position)
      VALUES (v_t, NULL, 'Pipeline', 1)
      RETURNING id INTO v_pipeline;
    END IF;

    INSERT INTO public.saved_reports
      (tenant_id, category_id, name, description, kind, builtin_key, position)
    VALUES (
      v_t, v_pipeline, 'Approved – Awaiting Issuance',
      'Permits the city has approved (approval date set) but not yet issued — sitting in Issuance Prep. Sorted by days-since-approval; each row opens the permit in Project View.',
      'builtin', 'approved_awaiting_issuance', 0
    )
    ON CONFLICT (tenant_id, builtin_key) WHERE builtin_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$seed$;
