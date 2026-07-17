-- fix-notes-4 (2026-07-17): unify report_notes into public.notes — one notes
-- source everywhere.
--
-- PROBLEM: the Weekly DA Update report (fix-67) kept its per-permit note in a
-- SEPARATE table (public.report_notes, one row per permit, 31 rows), so a note
-- typed on a permit (public.notes, fix-notes-1) never appeared in that report
-- and vice-versa.
--
-- FIX:
--   1. Back up report_notes, then migrate every row into public.notes as an
--      ACTIVE permit note (created_at/updated_at preserved, created_by NULL,
--      tenant from report_notes.tenant_id, project from the permit). Skips any
--      row whose identical active note already exists (0 on prod at apply
--      time; 1 permit had a different pre-existing active note — the
--      newest-active display rule governs which one the report box binds to).
--   2. Repoint bp_get_weekly_da_report's note read from report_notes to the
--      NEWEST ACTIVE (completed=false) public.notes note per permit, and add
--      note_id to each row payload so the client can edit THAT note through
--      the fix-notes-1 hooks. (Full function body below is based on the LIVE
--      prod definition — includes fix-164 intake gate, fix-170 hold gate,
--      fix-214 corrections hybrid, fix-221 approved-awaiting bucket.)
--
-- NOT dropped (follow-up once verified): the report_notes table (backed up +
-- frozen — nothing writes it anymore) and the now-orphaned
-- bp_upsert_report_note RPC (kept so a not-yet-refreshed client tab doesn't
-- 500 mid-deploy; its writes no longer surface anywhere).

-- ---------------------------------------------------------------------------
-- 1. Backup + data migration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._report_notes_backup_20260717 AS
  SELECT * FROM public.report_notes;

INSERT INTO public.notes
  (tenant_id, project_id, permit_id, body, completed, created_by, created_at, updated_at)
SELECT
  rn.tenant_id,
  p.project_id,
  rn.permit_id,
  TRIM(rn.body),
  false,
  NULL,
  rn.created_at,
  rn.updated_at
FROM public.report_notes rn
JOIN public.permits p ON p.id = rn.permit_id
WHERE COALESCE(TRIM(rn.body), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.permit_id = rn.permit_id
      AND n.completed = false
      AND n.body = TRIM(rn.body)
  );

-- ---------------------------------------------------------------------------
-- 2. bp_get_weekly_da_report — note_body/note_id now come from public.notes
--    (newest ACTIVE per permit). Only the active_notes CTE, the base join,
--    and the three jsonb row builders changed vs the live definition.
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
  -- fix-notes-4: the report's per-permit note = the NEWEST ACTIVE
  -- (completed=false) unified note for that permit (public.notes single
  -- source, replacing the old report_notes join).
  active_notes AS (
    SELECT DISTINCT ON (n.permit_id)
      n.permit_id, n.id AS note_id, n.body
    FROM public.notes n
    WHERE n.tenant_id = ANY (v_tenants)
      AND n.permit_id IS NOT NULL
      AND n.completed = false
    ORDER BY n.permit_id, n.created_at DESC, n.id DESC
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
      COALESCE(an.body, '') AS note_body,
      an.note_id          AS note_id
    FROM public.permits p
    JOIN public.projects pr ON pr.id = p.project_id
    LEFT JOIN latest l ON l.permit_id = p.id
    LEFT JOIN active_notes an ON an.permit_id = p.id
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
            'note_body',  c.note_body,
            'note_id',    c.note_id
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
            'note_body',  u.note_body,
            'note_id',    u.note_id
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
            'note_body',  a.note_body,
            'note_id',    a.note_id
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
