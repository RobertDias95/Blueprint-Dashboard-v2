-- fix-214 (2026-06-29): unify the "in corrections" definition across every
-- surface (hybrid rule). The Dashboard bucket (effectiveStage) keyed on the
-- reviewer rollup and the weekly report (bp_get_weekly_da_report) keyed only on
-- corr_issued, so they disagreed: a permit with corr_issued set but a lingering
-- in_review reviewer (224 2nd Ave N) showed on the report but read "Under Review"
-- on the dashboard; reviewer-corrections-only permits (no corr_issued) showed on
-- the dashboard but were missed by the report.
--
-- Canonical hybrid (Bobby) — the SQL twin of the TS isPermitInCorrections() in
-- src/lib/permitStage.ts. KEEP THE TWO IN LOCKSTEP.
--   1. A manual stage_override is authoritative: 'co' => corrections; any other
--      valid stage ('de'/'pm'/'ap'/'is') => not.
--   2. Resolved / terminal (actual_issue, approval_date, terminal-positive
--      status) => not in corrections.
--   3. Otherwise, on the permit's CURRENT (latest) cycle:
--        a. corr_issued IS NOT NULL and not resubmitted => CORRECTIONS. corr_issued
--           is the cycle-completion authority: the city closed the cycle by
--           issuing corrections, so ANY reviewer still in_review on that cycle is
--           treated as waived/resolved (it does NOT keep the permit "Under
--           Review"). Survives re-scrapes (the scraper rewrites reviewer rows but
--           never the corr_issued date).
--        b. else the reviewer rollup == corrections (every reviewer responded,
--           none outstanding, >=1 corrections_required) => CORRECTIONS. Gated on
--           a rollup-driven status (Pending/Applied), exactly like the dashboard's
--           existing reviewer override — ported verbatim.
--
-- Idempotent: CREATE OR REPLACE only.

-- ---------------------------------------------------------------------------
-- 1. The canonical SQL "in corrections?" test. One documented place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_permit_in_corrections(
  p_permit_id integer,
  p_tenants uuid[]
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status         text;
  v_stage_override text;
  v_actual_issue   date;
  v_approval_date  date;
  v_latest_idx     integer;
  v_corr_issued    date;
  v_resubmitted    date;
  v_actionable     integer;
  v_outstanding    integer;
  v_corrections    integer;
BEGIN
  SELECT p.status, p.stage_override, p.actual_issue, p.approval_date
    INTO v_status, v_stage_override, v_actual_issue, v_approval_date
  FROM public.permits p
  WHERE p.id = p_permit_id
    AND p.tenant_id = ANY (p_tenants);

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- 1. Manual stage override is the authoritative escape hatch.
  IF COALESCE(v_stage_override, '') = 'co' THEN
    RETURN true;
  END IF;
  IF COALESCE(v_stage_override, '') IN ('de', 'pm', 'ap', 'is') THEN
    RETURN false;
  END IF;

  -- 2. Resolved / terminal => not in corrections.
  IF v_actual_issue IS NOT NULL OR v_approval_date IS NOT NULL THEN
    RETURN false;
  END IF;
  IF COALESCE(v_status, '') IN (
    'Conceptually Approved', 'Approved', 'Issued', 'Completed', 'Closed', 'Ready for Issuance'
  ) THEN
    RETURN false;
  END IF;

  -- 3. Current (latest) cycle index — from the cycles, else the reviewer rows
  --    (mirrors the TS currentCycleIndex fallback).
  SELECT max(pc.cycle_index) INTO v_latest_idx
  FROM public.permit_cycles pc
  WHERE pc.permit_id = p_permit_id
    AND pc.tenant_id = ANY (p_tenants);

  IF v_latest_idx IS NULL THEN
    SELECT max(r.cycle_index) INTO v_latest_idx
    FROM public.permit_cycle_reviewers r
    WHERE r.permit_id = p_permit_id
      AND r.tenant_id = ANY (p_tenants);
  END IF;

  IF v_latest_idx IS NULL THEN
    RETURN false;
  END IF;

  -- 3a. corr_issued half (authoritative): latest cycle has corr_issued, not resubmitted.
  SELECT pc.corr_issued, pc.resubmitted
    INTO v_corr_issued, v_resubmitted
  FROM public.permit_cycles pc
  WHERE pc.permit_id = p_permit_id
    AND pc.tenant_id = ANY (p_tenants)
    AND pc.cycle_index = v_latest_idx
  LIMIT 1;

  IF v_corr_issued IS NOT NULL AND v_resubmitted IS NULL THEN
    RETURN true;
  END IF;

  -- 3b. reviewer half (gated on rollup-driven Pending/Applied): latest-cycle rollup
  --     == corrections. Port of reviewerVerdictForCycle: exclude not_required;
  --     outstanding = in_review / in_process / assigned / pending.
  IF COALESCE(v_status, '') IN ('Pending', 'Applied') THEN
    SELECT
      count(*) FILTER (WHERE r.current_status <> 'not_required'),
      count(*) FILTER (WHERE r.current_status IN ('in_review', 'in_process', 'assigned', 'pending')),
      count(*) FILTER (WHERE r.current_status = 'corrections_required')
      INTO v_actionable, v_outstanding, v_corrections
    FROM public.permit_cycle_reviewers r
    WHERE r.permit_id = p_permit_id
      AND r.tenant_id = ANY (p_tenants)
      AND r.cycle_index = v_latest_idx;

    IF COALESCE(v_actionable, 0) > 0
       AND COALESCE(v_outstanding, 0) = 0
       AND COALESCE(v_corrections, 0) > 0 THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_permit_in_corrections(integer, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_permit_in_corrections(integer, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Route the weekly report's `corr` CTE through the unified test. The only
--    change vs the prior definition is the `corr` CTE WHERE clause: it now calls
--    bp_permit_in_corrections() instead of the inline corr_issued-only predicate,
--    so reviewer-rollup == corrections permits (no corr_issued) are included and
--    the manual stage_override is honored. Everything else is unchanged.
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
  da_keys AS (
    SELECT da_key FROM corr
    UNION
    SELECT da_key FROM upc
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
      ) AS upcoming_intakes
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
          'upcoming_intakes', g.upcoming_intakes
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
