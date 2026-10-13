-- ===========================================================================
-- fix-658 — THE PERMIT SCRAPE HASN'T RUN FOR 36 WEEKDAY HOURS: TELL BOBBY   P-343
-- ===========================================================================
--
-- ⚖️ Bobby 10-12: GitHub's late schedule stays as it is ("Leave it as is"), but
--    "if it goes over 36 hours without running, then an alert should maybe go
--    out."
--
-- ---------------------------------------------------------------------------
-- ★★★ THE RULE
-- ---------------------------------------------------------------------------
-- SILENT = more than 36 hours since the latest `scraper_run.started_at` (a real
-- run, not a dry run), COUNTING ONLY MONDAY–FRIDAY HOURS IN PACIFIC TIME. The
-- scrape is weekday-only, so a normal weekend must never alert.
--   Fri 14:18 PT → Mon 12:10 PT  =  9.7 + 12.2  ≈ 21.9 weekday hours → quiet.
--   Thu 14:00 PT → Mon 02:00 PT  =  10 + 24 + 2 = 36 → not yet; 03:00 → alert.
-- Holidays are NOT skipped (no holiday calendar): a Monday holiday with no
-- scrape counts its hours.
-- Hours are real elapsed time inside each Pacific weekday, so DST days are
-- 23 or 25 hours long, as they are on the wall.
--
-- `scraper_run` (fix-561) is where a scrape is recorded: one row per run,
-- opened at start. fix-433's banner reads `audit_log` (newest `scrape%` row)
-- instead and only says "missed" to someone who opens the Bridge after noon;
-- nothing is sent. fix-597 is the scraper's check on the INDEXER, not on itself.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHAT HAPPENS WHEN IT IS SILENT — once per OUTAGE, not once per hour
-- ---------------------------------------------------------------------------
-- An outage is identified by the last run it follows. pg_cron runs
-- `bp_scrape_silence_check()` hourly; when silent it
--   1. files ONE `error_reports` row (source `scrape_silence`, level `error`)
--      whose fingerprint names the outage — `scrape_silence:<tenant>:<last run>`.
--      ★ The row IS the ledger: if any row with that fingerprint exists, in ANY
--        status (dismissed too), nothing is filed or sent again.
--   2. in the same statement path, queues ONE `notify:scrape_silent` email per
--      person on the Settings list "Scraper-down alert goes to"
--      (app_config `scrapeSilenceAlertRecipients`), dedupe key per outage.
--      A work alert: not governed by the mention/assignment switches; the way
--      off it is to leave the list.
-- When a run lands, the next check resolves the open row (status `resolved`,
-- context.resolved_note "scrape resumed <time>"). No "back up" email.
--
-- ★★ WHY A NEW SOURCE, NOT `scraper`. Error Triage does not LIST `scraper`
--    rows (fix-438 C1, Bobby's ruling: `bp_list_error_groups` and the badge
--    pass p_include_scraper = false). A `scraper` row would be filed and
--    never seen. fix-650 set the precedent: a system-level alert gets its own
--    source and label. "The scrape did not run" is a Bridge-side system fact
--    (fix-433 §C2's reasoning), so it belongs in the listed set.
--
-- ★★★ NO EXISTING ROW IS CHANGED. Functions, two widened CHECKs on the queue,
--     one widened CHECK on error_reports, a re-created bp_notify_claim (one new
--     WHEN), one cron job, and ONE seed row: app_config
--     `scrapeSilenceAlertRecipients` = ["Bobby"] (inserted only if absent).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The arithmetic
-- ---------------------------------------------------------------------------
-- ★★ Hours between two instants that fall on a Pacific Monday–Friday. Each
--    weekday contributes its overlap with [p_from, p_to]. NULL in → NULL out;
--    p_to before p_from → 0.
CREATE OR REPLACE FUNCTION public.bp_weekday_hours_between(p_from timestamptz, p_to timestamptz)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN NULL
    WHEN p_to <= p_from THEN 0::numeric
    ELSE (
      SELECT COALESCE(sum(GREATEST(0::numeric, extract(epoch FROM
               LEAST(p_to, ((g.d + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'))
             - GREATEST(p_from, (g.d::timestamp AT TIME ZONE 'America/Los_Angeles'))))), 0)
             / 3600.0
        FROM (SELECT gs::date AS d
                FROM generate_series((p_from AT TIME ZONE 'America/Los_Angeles')::date,
                                     (p_to   AT TIME ZONE 'America/Los_Angeles')::date,
                                     interval '1 day') gs) g
       WHERE extract(isodow FROM g.d) < 6
    )
  END;
$function$;

COMMENT ON FUNCTION public.bp_weekday_hours_between(timestamptz, timestamptz) IS
  'fix-658: elapsed hours between two instants that fall on a Pacific Monday–Friday. '
  'Weekends do not count; holidays do.';

-- ★ "Fri Oct 9 2:18 PM PT" — the last run as people read it.
CREATE OR REPLACE FUNCTION public.bp_scrape_silence_when(p_at timestamptz)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT to_char(p_at AT TIME ZONE 'America/Los_Angeles', 'Dy Mon FMDD FMHH12:MI AM') || ' PT';
$function$;

-- ---------------------------------------------------------------------------
-- 2. Recipients — names from Settings, resolved to one login or nobody
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_scrape_silence_recipients(p_tenant uuid)
RETURNS TABLE(name text, user_id uuid, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_name text;
  r record;
  v_found boolean;
BEGIN
  FOR v_name IN
    SELECT DISTINCT btrim(x)
      FROM public.app_config c,
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(c.value) = 'array' THEN c.value ELSE '[]'::jsonb END) x
     WHERE c.tenant_id = p_tenant
       AND c.key = 'scrapeSilenceAlertRecipients'
       AND btrim(x) <> ''
  LOOP
    v_found := false;
    FOR r IN SELECT * FROM public.bp_notify_person_for_name(p_tenant, v_name) LOOP
      v_found := true;
      name := v_name; user_id := r.user_id; email := r.email;
      RETURN NEXT;
    END LOOP;
    IF NOT v_found THEN
      name := v_name; user_id := NULL; email := NULL;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The queue learns a sixth kind; error_reports a sixth source
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_kind_known;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_kind_known
  CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake', 'notify:weekly',
                  'notify:resubmit', 'notify:scrape_silent'));

ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_has_subject;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_has_subject
  CHECK ((kind = 'notify:mention' AND message_id IS NOT NULL)
      OR (kind = 'notify:assignment' AND task_id IS NOT NULL AND task_source IS NOT NULL)
      OR (kind = 'notify:intake' AND payload IS NOT NULL)
      OR (kind = 'notify:weekly' AND payload IS NOT NULL)
      OR (kind = 'notify:resubmit' AND payload IS NOT NULL)
      OR (kind = 'notify:scrape_silent' AND payload IS NOT NULL));

ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_source_check;
ALTER TABLE public.error_reports ADD CONSTRAINT error_reports_source_check
  CHECK (source IN ('frontend_toast', 'frontend_exception', 'backend_rpc', 'scraper',
                    'notification_delivery', 'scrape_silence'));

-- ---------------------------------------------------------------------------
-- 4. THE CHECK (pg_cron, hourly)
-- ---------------------------------------------------------------------------
-- `p_now` is for the rolled-back proof and tests only; the cron passes nothing.
-- Returns one object per tenant: what it saw and what it did.
CREATE OR REPLACE FUNCTION public.bp_scrape_silence_check(p_now timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- ★★ THE THRESHOLD. Change it here and in src/lib/scrapeSilence.ts (a twin test pins both).
  c_threshold constant numeric := 36;
  v_now      timestamptz := COALESCE(p_now, now());
  v_tenant   uuid;
  v_last     timestamptz;
  v_hours    numeric;
  v_fp       text;
  v_err_id   bigint;
  v_resolved integer;
  v_queued   integer;
  v_payload  jsonb;
  v_q        uuid;
  r          record;
  v_out      jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bp_scrape_silence_check'));

  FOR v_tenant IN SELECT DISTINCT s.tenant_id FROM public.scraper_run s LOOP
    SELECT max(s.started_at) INTO v_last
      FROM public.scraper_run s
     WHERE s.tenant_id = v_tenant AND NOT s.dry_run AND s.started_at <= v_now;
    IF v_last IS NULL THEN CONTINUE; END IF;

    -- ★ A run landed after an open outage row → the outage is over.
    UPDATE public.error_reports e
       SET status = 'resolved',
           resolved_at = v_now,
           context = e.context || jsonb_build_object(
             'resolved_note', 'scrape resumed ' || public.bp_scrape_silence_when(v_last))
     WHERE e.tenant_id = v_tenant
       AND e.source = 'scrape_silence'
       AND e.status IN ('new', 'queued', 'in_progress')
       AND (e.context->>'last_run_at')::timestamptz < v_last;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;

    v_hours := public.bp_weekday_hours_between(v_last, v_now);
    v_err_id := NULL;
    v_queued := 0;

    IF v_hours > c_threshold THEN
      v_fp := 'scrape_silence:' || v_tenant::text || ':'
              || to_char(v_last AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS');

      -- ★★★ ONE ROW PER OUTAGE. The row is the ledger, whatever its status.
      INSERT INTO public.error_reports
        (tenant_id, source, level, message, fingerprint, context, status)
      SELECT v_tenant, 'scrape_silence', 'error',
             format('The permit scrape hasn''t run for %s weekday hours — last run %s.',
                    floor(v_hours)::int, public.bp_scrape_silence_when(v_last)),
             v_fp,
             jsonb_build_object(
               'last_run_at', v_last,
               'weekday_hours', floor(v_hours)::int,
               'threshold_hours', c_threshold,
               'checked_at', v_now),
             'new'
       WHERE NOT EXISTS (SELECT 1 FROM public.error_reports e
                          WHERE e.tenant_id = v_tenant AND e.fingerprint = v_fp)
      RETURNING id INTO v_err_id;

      -- ★★ The email rides on the row: filed now → emailed now, never otherwise.
      IF v_err_id IS NOT NULL THEN
        v_payload := jsonb_build_object(
          'last_run_at', v_last,
          'last_run_label', public.bp_scrape_silence_when(v_last),
          'last_run_day', to_char(v_last AT TIME ZONE 'America/Los_Angeles', 'Dy Mon FMDD'),
          'weekday_hours', floor(v_hours)::int,
          'threshold_hours', c_threshold);
        FOR r IN
          SELECT DISTINCT x.user_id, lower(btrim(x.email)) AS email
            FROM public.bp_scrape_silence_recipients(v_tenant) x
           WHERE x.user_id IS NOT NULL AND x.email IS NOT NULL
        LOOP
          v_q := NULL;
          INSERT INTO public.notification_email_queue
            (kind, recipient_user_id, to_email, payload, dedupe_key)
          VALUES
            ('notify:scrape_silent', r.user_id, r.email, v_payload,
             'notify:scrape_silent:' || r.email || ':' || v_fp)
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id INTO v_q;
          IF v_q IS NOT NULL THEN v_queued := v_queued + 1; END IF;
        END LOOP;
        IF v_queued > 0 THEN PERFORM public.bp_notify_nudge(); END IF;
      END IF;
    END IF;

    v_out := v_out || jsonb_build_object(
      'tenant_id', v_tenant,
      'last_run_at', v_last,
      'weekday_hours', round(v_hours, 1),
      'silent', v_hours > c_threshold,
      'filed_error_id', v_err_id,
      'emails_queued', v_queued,
      'resolved', v_resolved);
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.bp_scrape_silence_check(timestamptz) IS
  'fix-658 (P-343): hourly. Silent = more than 36 Pacific weekday hours since the '
  'latest non-dry-run scraper_run.started_at. Files one error_reports row '
  '(source scrape_silence) and queues one notify:scrape_silent email per person on '
  'scrapeSilenceAlertRecipients, once per outage; resolves the row when a run lands.';

-- ---------------------------------------------------------------------------
-- 5. The claim: a scrape-silent email is never "opted out"
-- ---------------------------------------------------------------------------
-- ★ Based on the LIVE definition (fix-646's, read back 2026-10-12). Same
--   signature, so CREATE OR REPLACE; the only change is one WHEN.
CREATE OR REPLACE FUNCTION public.bp_notify_claim(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, kind text, to_email text, recipient_user_id uuid,
  project_id uuid, message_id uuid, task_id uuid, task_source text,
  opted_out boolean, actor_name text, project_address text,
  post_title text, message_body text, message_deleted boolean,
  task_text text, task_done boolean, task_due date,
  payload jsonb
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.notification_email_queue q
       SET status = 'sending', claimed_at = now()
     WHERE q.id IN (
       SELECT q2.id FROM public.notification_email_queue q2
        WHERE q2.status = 'pending'
        ORDER BY q2.created_at, q2.id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
        FOR UPDATE SKIP LOCKED)
    RETURNING q.*
  )
  SELECT c.id, c.kind, c.to_email, c.recipient_user_id,
         c.project_id, c.message_id, c.task_id, c.task_source,
         -- ★ fix-637: a work alert, not subject to the mention/assignment toggles.
         -- ★ fix-642: the Weekly Update has its own switch.
         -- ★ fix-646: and so do the Resubmit-by warnings.
         -- ★ fix-658: the scrape-silent alert is a work alert, like intake.
         CASE WHEN c.kind IN ('notify:intake', 'notify:scrape_silent') THEN false
              WHEN c.kind = 'notify:weekly' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'weekly')
              WHEN c.kind = 'notify:resubmit' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'resubmit')
              ELSE NOT public.bp_notify_enabled(c.recipient_user_id,
                     CASE c.kind WHEN 'notify:mention' THEN 'mention' ELSE 'assignment' END)
         END,
         COALESCE(
           (SELECT COALESCE(NULLIF(btrim(tm.first_name), ''), tm.name)
              FROM public.team_members tm
             WHERE lower(btrim(tm.email)) = lower(btrim(ap.email)) AND tm.active
             ORDER BY tm.name, tm.id LIMIT 1),
           NULLIF(btrim(ap.full_name), ''),
           split_part(ap.email, '@', 1),
           'Someone'),
         pr.address,
         COALESCE(NULLIF(btrim(m.title), ''), NULLIF(btrim(pm.title), '')),
         m.body,
         (m.id IS NULL OR m.deleted_at IS NOT NULL) AND c.kind = 'notify:mention',
         COALESCE(pt.text, tt.text),
         COALESCE(pt.done, tt.done, false),
         COALESCE(pt.due_date, tt.due_date),
         c.payload
    FROM claimed c
    LEFT JOIN public.profiles ap ON ap.id = c.actor_user_id
    LEFT JOIN public.projects pr ON pr.id = c.project_id
    LEFT JOIN public.project_messages m ON m.id = c.message_id
    LEFT JOIN public.project_messages pm ON pm.id = m.parent_message_id
    LEFT JOIN public.permit_tasks pt ON c.task_source = 'permit_tasks' AND pt.id = c.task_id
    LEFT JOIN public.team_tasks tt ON c.task_source = 'team_tasks' AND tt.id = c.task_id
   ORDER BY c.created_at, c.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants — the arithmetic is readable; everything that files or queues is
--    cron / service only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_weekday_hours_between(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_weekday_hours_between(timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_scrape_silence_when(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_scrape_silence_when(timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_scrape_silence_recipients(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_scrape_silence_check(timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. THE ONE DATA WRITE — the recipients seed, with its tenant, only if absent
-- ---------------------------------------------------------------------------
INSERT INTO public.app_config (tenant_id, key, value)
SELECT tm.tenant_id, 'scrapeSilenceAlertRecipients', '["Bobby"]'::jsonb
  FROM public.team_members tm
 WHERE lower(btrim(tm.name)) = 'bobby' AND tm.active
 GROUP BY tm.tenant_id
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 8. The schedule (outside the transaction: cron.schedule upserts by name)
-- ---------------------------------------------------------------------------
-- Hourly at :25, every day. The weekday-hours rule is what keeps weekends
-- quiet, so the job itself needs no day filter.
SELECT cron.schedule(
  'bp-scrape-silence-check',
  '25 * * * *',
  $$SELECT public.bp_scrape_silence_check()$$
);

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row (one seed row is inserted if absent).
-- 2. No "back up" email — the triage row resolving itself is the all-clear.
-- 3. No holiday calendar — weekends only.
-- 4. No business-hours gate: the check fires in the hour the 36th weekday
--    hour passes, which can be overnight.
-- 5. It does not touch the scraper repo or fix-433's banner.
