-- fix-164 (2026-06-15): weekly DA report — already-submitted permits leak into
-- "Upcoming Intakes".
--
-- Bug (live prod): bp_get_weekly_da_report listed permits in BOTH the corrections
-- and upcoming-intakes buckets (e.g. 10431 SE 19th St, Bellevue — BPs 248/251/
-- 252/253 + grading 250; also 302/184). A permit in corrections is, by
-- definition, already submitted and intake-accepted, so it must never appear in
-- upcoming intakes.
--
-- Root cause: the `upc` CTE gated on `intake_accepted IS NULL`, but
-- `intake_accepted` was pulled from the `latest` CTE = the permit's LATEST cycle
-- (DISTINCT ON (permit_id) … ORDER BY cycle_index DESC). intake_accepted is
-- recorded on CYCLE 0; the latest cycle of any submitted permit is a review cycle
-- (1+) where intake_accepted is always NULL. So "not yet intake-accepted"
-- structurally evaluated true for every already-submitted permit whose
-- target_submit fell in the window → leak. (corr_issued / resubmitted correctly
-- belong to the latest cycle — only the intake check was wrong.)
--
-- Fix (minimal — intake check only): add a permit-level `ever_intake_accepted`
-- flag to `base` (EXISTS over ANY of the permit's cycles), and gate `upc` on
-- `ever_intake_accepted IS FALSE` instead of the latest-cycle `intake_accepted IS
-- NULL`. The now-unused `latest.intake_accepted` column is dropped. Everything
-- else — the `corr` bucket, terminal-positive gating, window, grouping — is
-- untouched. Re-emitted from the live prod def (pg_get_functiondef — canon;
-- migrations/ is a partial record). Applied to prod via MCP.

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
      -- fix-128: terminal-positive gating inputs (mirror effectiveStage).
      p.actual_issue      AS actual_issue,
      p.approval_date     AS approval_date,
      p.stage_override    AS stage_override,
      p.status            AS permit_status,
      l.cycle_index       AS cycle_index,
      l.corr_issued       AS corr_issued,
      l.resubmitted       AS resubmitted,
      -- fix-164: intake-acceptance is recorded on cycle 0, not the latest cycle.
      -- Flag whether the permit was intake-accepted on ANY cycle so `upc` can
      -- exclude already-submitted permits (the latest-cycle intake_accepted is
      -- always NULL for a permit in review, which leaked it into upcoming intakes).
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
  ),
  corr AS (
    SELECT * FROM base
    WHERE corr_issued IS NOT NULL
      AND resubmitted IS NULL
      AND actual_issue IS NULL
      AND approval_date IS NULL
      AND COALESCE(stage_override, '') NOT IN ('ap','is')
      AND COALESCE(permit_status, '') NOT IN (
        'Conceptually Approved','Approved','Issued','Completed','Closed','Ready for Issuance'
      )
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
