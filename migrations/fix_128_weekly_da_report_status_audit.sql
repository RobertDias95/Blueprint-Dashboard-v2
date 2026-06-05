-- fix-128: align bp_get_weekly_da_report's "in corrections" predicate with
-- the canonical effectiveStage formula (src/lib/permitStage.ts:49-81).
--
-- Pre-fix:  corr := base WHERE corr_issued IS NOT NULL on the LATEST cycle.
-- Post-fix: the predicate adds the four terminal-positive short-circuits
--           effectiveStage enforces (actual_issue, approval_date,
--           stage_override IN ('ap','is'), TERMINAL_ISSUED/APPROVED status)
--           plus the "corrections truly outstanding" gate (latest cycle's
--           resubmitted IS NULL).
--
-- Bug report (Bobby, 2026-06-09): the Weekly DA Report listed 5603 45th Ave
-- SW Demolition (permit 10068) under "Corrections" while the permit detail
-- view rendered "Issued":
--
--   permit.status   = 'Issued'
--   approval_date   = 2026-05-14
--   actual_issue    = 2026-05-15
--   latest cycle (2): corr_issued = 2026-05-08, resubmitted = NULL
--
-- The permit was issued AFTER corrections came down (Demo permits often
-- skip a final resubmission — the city accepts as-is). The per-cycle
-- corr_issued is history; the permit moved past it at the parent level.
-- effectiveStage line 54 short-circuits to 'is' the moment actual_issue
-- is set; the RPC's "in corrections" predicate needs to honor the same
-- priority. Same gate added to the Upcoming Intakes CTE — an issued
-- permit shouldn't dangle in "upcoming" just because target_submit lands
-- in the window.
--
-- Prod audit (failure mode A: different status formula). The pre-fix RPC
-- returned 29 permits in corrections; 4 of those had terminal-positive
-- state:
--   - permit 10068, '5603 45th Ave SW',  Demolition, status='Issued'
--   - permit 10132, '6027 4th Ave NE',   Demolition, status='Issued'
--                                        (also has latest cycle resubmitted)
--   - permit 310,   '8844 10th Ave SW',  SDOT Tree, status='Conceptually Approved'
--   - permit 351,   '5951 32nd Ave SW',  SDOT Tree, status='Conceptually Approved'
-- All four now drop out of the corrections list. The other 25 remain.
--
-- Sandbox-verified via BEGIN/ROLLBACK before applying to prod; applied
-- via mcp__claude_ai_Supabase__apply_migration
-- (fix_128_weekly_da_report_status_audit). Post-apply probe re-ran the
-- RPC against the prod cohort and confirmed all 4 affected permits no
-- longer surface in corrections.

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
      pc.permit_id, pc.cycle_index, pc.corr_issued, pc.resubmitted, pc.intake_accepted
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
      l.intake_accepted   AS intake_accepted,
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
      AND intake_accepted IS NULL
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
