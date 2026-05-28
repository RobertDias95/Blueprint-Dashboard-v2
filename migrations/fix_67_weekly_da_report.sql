-- fix-67 (2026-05-28): Weekly DA Update report — Phase 1 of the Reports hub.
--
-- Adds:
--   1. public.report_notes — one persistent free-text note per permit. The
--      note IS the carry-forward: it's shown whenever the permit appears in
--      the weekly report, edited in place. tenant-scoped + RLS.
--   2. bp_get_weekly_da_report(week_start, window_days, filters) -> jsonb —
--      the structured report payload, grouped by DA (Unassigned last).
--   3. bp_upsert_report_note(permit_id, body) -> timestamptz — write/update
--      a note, returns the new updated_at for cache invalidation.
--
-- Tenant pattern matches the rest of the repo: auth_tenant_ids() resolves
-- the caller's tenant uuids from tenant_memberships (user_id = auth.uid());
-- RLS policies use `tenant_id = ANY(auth_tenant_ids())`. The RPCs are
-- SECURITY DEFINER (so they bypass RLS) and therefore filter tenant
-- EXPLICITLY — reads via `= ANY(auth_tenant_ids())`, the note write derives
-- its tenant from the parent permit after confirming that permit is in the
-- caller's tenant set (cross-tenant write is impossible).
--
-- ADDITIVE + SAFE: new table + new functions only. Nothing existing is
-- altered. The scraper never touches report_notes.

-- ---------------------------------------------------------------------------
-- 1. report_notes table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_notes (
  permit_id   integer PRIMARY KEY REFERENCES public.permits(id) ON DELETE CASCADE,
  tenant_id   uuid    NOT NULL,
  body        text    NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_notes_tenant_idx
  ON public.report_notes(tenant_id);

-- Default tenant_id to the caller's tenant on any direct insert (parity with
-- the other tenant-scoped tables; the upsert RPC sets it explicitly too).
DROP TRIGGER IF EXISTS report_notes_default_tenant ON public.report_notes;
CREATE TRIGGER report_notes_default_tenant
  BEFORE INSERT ON public.report_notes
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

-- RLS — mirror permit_cycle_reviewers' 4-policy shape exactly.
ALTER TABLE public.report_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_notes_tenant_select ON public.report_notes;
CREATE POLICY report_notes_tenant_select ON public.report_notes
  FOR SELECT USING (tenant_id = ANY (auth_tenant_ids()));

DROP POLICY IF EXISTS report_notes_tenant_insert ON public.report_notes;
CREATE POLICY report_notes_tenant_insert ON public.report_notes
  FOR INSERT WITH CHECK (tenant_id = ANY (auth_tenant_ids()));

DROP POLICY IF EXISTS report_notes_tenant_update ON public.report_notes;
CREATE POLICY report_notes_tenant_update ON public.report_notes
  FOR UPDATE USING (tenant_id = ANY (auth_tenant_ids()))
  WITH CHECK (tenant_id = ANY (auth_tenant_ids()));

DROP POLICY IF EXISTS report_notes_tenant_delete ON public.report_notes;
CREATE POLICY report_notes_tenant_delete ON public.report_notes
  FOR DELETE USING (tenant_id = ANY (auth_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 2. bp_get_weekly_da_report
-- ---------------------------------------------------------------------------
-- Builds the report payload grouped by DA:
--   { das: [ { da, name, corrections: [...], upcoming_intakes: [...] } ],
--     generated_at, week_start, window_days }
--
-- corrections = permits whose LATEST cycle (max cycle_index) has a non-null
--   corr_issued (the date corrections came out).
-- upcoming_intakes = permits with target_submit in [week_start, week_start +
--   window_days] AND the latest cycle's intake_accepted IS NULL (not yet
--   intaken).
-- Filters (all optional): ent_lead, type, status, juris, da. The `da` filter
--   matches the COALESCE(da,'Unassigned') group key so "Unassigned" is
--   selectable. DA groups sort alphabetically with Unassigned last; rows
--   sort by their date then address.
CREATE OR REPLACE FUNCTION public.bp_get_weekly_da_report(
  p_week_start  date,
  p_window_days integer DEFAULT 14,
  p_filters     jsonb   DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
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
    -- Latest cycle per permit (max cycle_index) within the caller's tenant.
    SELECT DISTINCT ON (pc.permit_id)
      pc.permit_id, pc.cycle_index, pc.corr_issued, pc.intake_accepted
    FROM public.permit_cycles pc
    WHERE pc.tenant_id = ANY (v_tenants)
    ORDER BY pc.permit_id, pc.cycle_index DESC
  ),
  base AS (
    SELECT
      p.id            AS permit_id,
      p.project_id    AS project_id,
      pr.address      AS address,
      pr.juris        AS juris,
      p.type          AS type,
      p.num           AS num,
      p.portal_url    AS portal_url,
      p.ent_lead      AS ent_lead,
      p.da            AS da,
      COALESCE(p.da, 'Unassigned') AS da_key,
      p.target_submit AS target_submit,
      l.cycle_index   AS cycle_index,
      l.corr_issued   AS corr_issued,
      l.intake_accepted AS intake_accepted,
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
    SELECT * FROM base WHERE corr_issued IS NOT NULL
  ),
  upc AS (
    SELECT * FROM base
    WHERE target_submit IS NOT NULL
      AND target_submit BETWEEN p_week_start AND v_window_end
      AND intake_accepted IS NULL
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

-- ---------------------------------------------------------------------------
-- 3. bp_upsert_report_note
-- ---------------------------------------------------------------------------
-- One note per permit. Derives the note's tenant_id from the parent permit
-- AFTER confirming that permit is in the caller's tenant set — a cross-tenant
-- write raises (the permit lookup returns nothing). Returns the new
-- updated_at so the client can reconcile its cache.
CREATE OR REPLACE FUNCTION public.bp_upsert_report_note(
  p_permit_id integer,
  p_body      text
)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants       uuid[] := public.auth_tenant_ids();
  v_permit_tenant uuid;
  v_ua            timestamptz;
BEGIN
  SELECT p.tenant_id INTO v_permit_tenant
  FROM public.permits p
  WHERE p.id = p_permit_id
    AND p.tenant_id = ANY (v_tenants);

  IF v_permit_tenant IS NULL THEN
    RAISE EXCEPTION 'permit % not found in caller tenant', p_permit_id;
  END IF;

  INSERT INTO public.report_notes (permit_id, tenant_id, body, updated_at)
  VALUES (p_permit_id, v_permit_tenant, COALESCE(p_body, ''), now())
  ON CONFLICT (permit_id) DO UPDATE
    SET body = EXCLUDED.body,
        updated_at = now()
  RETURNING updated_at INTO v_ua;

  RETURN v_ua;
END;
$function$;

-- Callable by logged-in users (matches the other bp_* RPCs).
GRANT EXECUTE ON FUNCTION public.bp_get_weekly_da_report(date, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_upsert_report_note(integer, text) TO authenticated;
