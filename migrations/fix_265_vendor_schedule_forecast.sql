-- fix-265 (2026-08-03): Vendor Schedule Forecast — the send ledger + the two
-- columns the report needs.
--
-- APPLIED to prod (eibnmwthkcuumyclyxoe) on 2026-08-03 via MCP apply_migration
-- as `fix_265_vendor_schedule_forecast`, which records the provenance row AND
-- the full statement text. This file is the repo-of-record backstop and matches
-- what was applied byte for byte.
--
-- WHY THIS EXISTS
-- Blueprint sends a weekly schedule forecast to its structural engineer (SSS).
-- Done by hand today off old feasibility docs: roughly half the sends are late
-- or an apology for being late, and they only ever carried NEW projects.
-- Meanwhile draw_schedule_audit records 57 start-week and 91 end-week moves
-- since 2026-06-25 that the vendor was never told about. The point of the
-- feature is RELIABILITY and CHANGE VISIBILITY, not saved typing — which is why
-- the centrepiece here is a ledger of what the vendor already knows.
--
-- Conventions mirrored from fix-262 / fix-167 exactly:
--   * RPCs SECURITY DEFINER, fix-163 tenant gate (service_role bypasses),
--     search_path pinned, audited into audit_log.
--   * Vocabulary/config in app_config, editable in Settings.
--   * anon/PUBLIC revoked; authenticated + service_role granted.
--
-- ============================================================================
-- DECISIONS WORTH READING BEFORE YOU EDIT THIS FILE
-- ============================================================================
-- 1. vendor_report_state is LAST-STATE, not history. One row per
--    (tenant, vendor, project) holding what the vendor was last told. We only
--    ever ask "what do they already know?", so a history table would be dead
--    weight. audit_log carries the who/when trail for each send.
--
-- 2. vendor_key is text, not an enum, and is part of the PK. 'structural' is
--    the only value today; civil / survey / architect land later with NO
--    migration — just a new recipient list in app_config.
--
-- 3. The ledger drives the NEW and CHANGED sections ONLY. It must never hide a
--    row from the UPCOMING PIPELINE section — Bobby: "we want to keep the list a
--    running list, that way nothing is missed." That rule lives in the client
--    (lib/vendorReport.ts) and is regression-locked by tests; it is called out
--    here because a future "optimisation" to filter the pipeline by the ledger
--    would be a silent product regression.
--
-- 4. Marking sent is an EXPLICIT, SEPARATE action from composing the email.
--    bp_mark_vendor_report_sent is the only writer. Composing a draft must never
--    call it — Bobby previews drafts he does not send, and a compose that
--    silently marked things sent would make projects vanish from next week's
--    email. This is the single most important behavioural rule in the feature.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. projects.reuse_notes
-- ---------------------------------------------------------------------------
-- The qualifier Gena writes by hand today: "Units are Similar to 13515 27th?
-- XL?", "7315 Jones Ave NW (W/O GAR)". reused_from_project_id (fix-216) already
-- carries the LINK; this carries the nuance that makes the link useful to the
-- engineer. Deliberately NOT redesign_notes, which is scoped to redesigns and
-- would conflate two different relationships.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS reuse_notes text;

COMMENT ON COLUMN public.projects.reuse_notes IS
  'fix-265: free-text qualifier on the reuse relationship ("Units are Similar '
  'to 13515 27th? XL?"). Complements reused_from_project_id, which carries the '
  'link itself. Surfaced in the vendor schedule forecast so the engineer knows '
  'HOW the reuse differs. NOT redesign_notes (that is redesign-scoped).';

-- ---------------------------------------------------------------------------
-- B. draw_schedule.exclude_from_vendor_reports
-- ---------------------------------------------------------------------------
-- Bobby: "maybe we have the ability to take things off that don't count... we
-- can use that as a learning module." Default IN, opt out per block — we
-- deliberately do NOT try to enumerate the excluded categories up front, and
-- watch what gets excluded instead.
ALTER TABLE public.draw_schedule
  ADD COLUMN IF NOT EXISTS exclude_from_vendor_reports boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.draw_schedule.exclude_from_vendor_reports IS
  'fix-265: opt a draw block OUT of every vendor-facing report. Default false '
  '(everything is IN). Per-block manual switch, not a category rule — the set '
  'of blocks that get excluded is meant to TEACH us what the category rule '
  'should eventually be.';

-- Partial index: the report reads the ~always-tiny excluded set, never scans it.
CREATE INDEX IF NOT EXISTS draw_schedule_vendor_excluded_idx
  ON public.draw_schedule (project_id)
  WHERE exclude_from_vendor_reports;

-- NOTE: this column is intentionally NOT added to bp_audit_draw_schedule's
-- change list. That trigger early-returns unless da_assigned / start_week /
-- end_week / status / manually_placed changed, and an exclusion toggle is a
-- reporting preference, not a schedule move. (Worth knowing while you are in
-- here: dd_start / dd_end changes are NOT audited either — see the fix-265 PR
-- body. The forecast's change detection reads this ledger, not the audit table,
-- so that gap does not affect it.)

-- ---------------------------------------------------------------------------
-- C. vendor_report_state — the send ledger
-- ---------------------------------------------------------------------------
-- Last-communicated state per (vendor, project). "Last send" = max(sent_at).
CREATE TABLE IF NOT EXISTS public.vendor_report_state (
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- 'structural' today. Keyed so civil/survey/architect need no migration.
  vendor_key      text        NOT NULL,
  project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- The three fields the vendor was told. NULL = "was blank when we told them",
  -- which is distinct from "we never told them" (= no row at all). The report
  -- relies on that distinction: a value going from blank to set IS a change.
  sent_start_week text,
  sent_dd_end     date,
  sent_status     text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  sent_by         uuid,
  PRIMARY KEY (tenant_id, vendor_key, project_id)
);

COMMENT ON TABLE public.vendor_report_state IS
  'fix-265: what each external vendor was LAST told about each project. Drives '
  'the NEW and CHANGED sections of the vendor schedule forecast. Last-state, '
  'not history (audit_log carries the trail). Written ONLY by '
  'bp_mark_vendor_report_sent — never by composing a draft.';

COMMENT ON COLUMN public.vendor_report_state.vendor_key IS
  'fix-265: which vendor this ledger row is about. ''structural'' is the only '
  'live value; part of the PK so additional vendors need no schema change.';

-- The report's hot read: every ledger row for one vendor in one tenant.
CREATE INDEX IF NOT EXISTS vendor_report_state_vendor_idx
  ON public.vendor_report_state (tenant_id, vendor_key);

-- "When did we last send?" — max(sent_at) per vendor.
CREATE INDEX IF NOT EXISTS vendor_report_state_sent_at_idx
  ON public.vendor_report_state (tenant_id, vendor_key, sent_at DESC);

ALTER TABLE public.vendor_report_state ENABLE ROW LEVEL SECURITY;

-- fix-157 model: tenant-scoped SELECT for authenticated; writes go exclusively
-- through the SECURITY DEFINER RPC below, so there is deliberately no
-- INSERT/UPDATE/DELETE policy for authenticated.
DROP POLICY IF EXISTS vendor_report_state_select ON public.vendor_report_state;
CREATE POLICY vendor_report_state_select ON public.vendor_report_state
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS vendor_report_state_service ON public.vendor_report_state;
CREATE POLICY vendor_report_state_service ON public.vendor_report_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL     ON TABLE public.vendor_report_state FROM PUBLIC, anon;
GRANT  SELECT  ON TABLE public.vendor_report_state TO authenticated;
GRANT  ALL     ON TABLE public.vendor_report_state TO service_role;

-- fix-227 pattern: default tenant_id to the caller so a direct insert can never
-- land tenant-less. (The RPC always passes it explicitly; this is the backstop.)
DROP TRIGGER IF EXISTS vendor_report_state_default_tenant ON public.vendor_report_state;
CREATE TRIGGER vendor_report_state_default_tenant
  BEFORE INSERT ON public.vendor_report_state
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

-- ---------------------------------------------------------------------------
-- D. bp_mark_vendor_report_sent — the ONLY ledger writer
-- ---------------------------------------------------------------------------
-- Takes the exact set of rows that were included in the send, as jsonb:
--   [{"project_id":"...","start_week":"2026-08-10","dd_end":"2026-09-18",
--     "status":"Scheduled"}, ...]
-- Upserts one ledger row per entry, stamping sent_at/sent_by. Idempotent by
-- construction: running it twice with the same payload leaves the same state,
-- which is what makes "a second immediate run yields an empty new/changed set"
-- true.
CREATE OR REPLACE FUNCTION public.bp_mark_vendor_report_sent(
  p_tenant_id  uuid,
  p_vendor_key text,
  p_rows       jsonb
)
 RETURNS SETOF public.vendor_report_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key   text := NULLIF(btrim(COALESCE(p_vendor_key, '')), '');
  v_count integer;
BEGIN
  -- fix-163 tenant gate; service_role bypasses.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (p_tenant_id = ANY (public.auth_tenant_ids()))
  THEN
    RAISE EXCEPTION 'bp_mark_vendor_report_sent: tenant % not in caller scope', p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'bp_mark_vendor_report_sent: vendor_key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'bp_mark_vendor_report_sent: p_rows must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;

  -- Nothing to record is a no-op, not an error: the user may hit "Mark as sent"
  -- on a week where every section is empty.
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.vendor_report_state AS vrs (
    tenant_id, vendor_key, project_id,
    sent_start_week, sent_dd_end, sent_status, sent_at, sent_by
  )
  SELECT
    p_tenant_id,
    v_key,
    (e->>'project_id')::uuid,
    NULLIF(btrim(COALESCE(e->>'start_week', '')), ''),
    NULLIF(btrim(COALESCE(e->>'dd_end', '')), '')::date,
    NULLIF(btrim(COALESCE(e->>'status', '')), ''),
    now(),
    auth.uid()
  FROM jsonb_array_elements(p_rows) AS e
  -- Only rows for projects in THIS tenant; a crafted payload cannot write a
  -- ledger row for someone else's project.
  WHERE EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = (e->>'project_id')::uuid
      AND p.tenant_id = p_tenant_id
  )
  ON CONFLICT (tenant_id, vendor_key, project_id) DO UPDATE
    SET sent_start_week = EXCLUDED.sent_start_week,
        sent_dd_end     = EXCLUDED.sent_dd_end,
        sent_status     = EXCLUDED.sent_status,
        sent_at         = EXCLUDED.sent_at,
        sent_by         = EXCLUDED.sent_by;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_log (tenant_id, user_id, action, table_name, row_id, changes)
  VALUES (
    p_tenant_id, auth.uid(), 'vendor_report_sent', 'vendor_report_state', v_key,
    jsonb_build_object(
      'vendor_key', v_key,
      'row_count', v_count,
      'project_ids', (
        SELECT jsonb_agg(e->>'project_id') FROM jsonb_array_elements(p_rows) AS e
      )
    )
  );

  RETURN QUERY
    SELECT * FROM public.vendor_report_state
    WHERE tenant_id = p_tenant_id AND vendor_key = v_key;
END;
$function$;

-- ---------------------------------------------------------------------------
-- E. Recipient lists — app_config, per vendor_key
-- ---------------------------------------------------------------------------
-- These people change; hardcoding them would mean a deploy to fix a typo'd
-- address. Same app_config mechanism as every other editable vocabulary.
-- Shape: { "<vendor_key>": { "label": text, "to": [{name,email}], "cc": [...] } }
INSERT INTO public.app_config (tenant_id, key, value)
SELECT (SELECT id FROM public.tenants ORDER BY id LIMIT 1), 'vendorReportRecipients',
  '{
     "structural": {
       "label": "SSS Engineering",
       "to": [{"name": "Tawny Glenn", "email": "t.glenn@ssseng.com"}],
       "cc": [
         {"name": "Brittani Ard",  "email": ""},
         {"name": "Shire Mahdi",   "email": ""},
         {"name": "David Rice",    "email": ""},
         {"name": "Gena Gunther",  "email": ""}
       ]
     }
   }'::jsonb
ON CONFLICT (key) DO NOTHING;

-- The cc addresses are deliberately seeded EMPTY rather than guessed. The
-- report renders a missing address as a visible warning and the Settings editor
-- is where they get filled in — a wrong-but-plausible address would fail
-- silently, which is the worst outcome for a vendor-facing email.

-- ---------------------------------------------------------------------------
-- F. Grants (fix-157 model: anon/PUBLIC revoked, app-callable via authenticated)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.bp_mark_vendor_report_sent(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bp_mark_vendor_report_sent(uuid, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G. Grant tightening (applied as fix_265_vendor_report_state_tighten_grants)
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE COPYING SECTION C's REVOKE INTO A NEW MIGRATION.
--
-- `REVOKE ALL ... FROM PUBLIC, anon` (the fix-262 idiom, section C above) is NOT
-- sufficient on this project. There is an ALTER DEFAULT PRIVILEGES rule granting
-- ALL on new public tables to `authenticated`; it fires at CREATE TABLE, and the
-- REVOKE never named that role. Post-apply verification caught it:
-- has_table_privilege('authenticated', 'vendor_report_state', 'INSERT') was true.
--
-- No exposure resulted (RLS was on and `authenticated` has only a SELECT policy,
-- so the write was already refused), but the grants did not match the stated
-- model. Applied as a separate migration immediately after, kept here so this
-- file remains the repo-of-record for the table's real state.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.vendor_report_state FROM authenticated;
GRANT SELECT ON TABLE public.vendor_report_state TO authenticated;

COMMIT;
