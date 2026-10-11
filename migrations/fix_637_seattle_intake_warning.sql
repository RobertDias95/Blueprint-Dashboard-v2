-- ===========================================================================
-- fix-637 — SEATTLE INTAKES 7 BUSINESS DAYS OUT: A DAILY POP-UP AND EMAIL   P-180
-- ===========================================================================
--
-- ⚖️ Bobby:
--    09-09  "a notification for the Seattle intakes whenever they are within 72
--           business hours… That way Miles and Brianna know to reschedule them."
--    10-11  "do 7 business days in advance total." · "a pop up on the screen,
--           like the weekly agenda and an email notication daily until resolved."
--    Weekends are skipped. No holiday calendar (not asked for).
--
-- ---------------------------------------------------------------------------
-- ★★★ ONE RULE, TWO DELIVERIES
-- ---------------------------------------------------------------------------
-- `bp_intake_warning_due(p_today, p_tenant)` is THE definition of a due slot.
--   · the daily POP-UP calls it as an RPC (invoker rights, so RLS scopes it)
--   · the daily EMAIL calls it from `bp_intake_warning_enqueue`, run by pg_cron
-- so the email and the pop-up cannot list different slots. The TS module
-- `src/lib/intakeWarning.ts` is a MIRROR for tests (no live DB in CI) and is
-- pinned to this file by `SeattleIntakeWarningFix637.test.ts`.
--
-- A slot is DUE when it is
--   1. a SEATTLE intake slot — an `intake_records` row (the Intake Tracker's slot
--      inventory). Measured 2026-10-11: every row with a permit is a Seattle
--      permit, and placeholders ("OPEN") carry no permit and no project at all,
--      so "no permit" counts as Seattle and a linked permit must be in a
--      Seattle project. ★ PLACEHOLDERS COUNT — a placeholder 7 business days out
--      is exactly the slot that has to be swapped or released.
--   2. NOT RESOLVED. Released or swapped = the row is gone or re-pointed, so it
--      simply is not read. A moved date = it falls out of the window. ACCEPTED
--      is fix-513's rule, `intakeIsAccepted` — Bobby 09-09: DATE ONLY, accepted
--      means the permit's `intake_date` has arrived. `bp_intake_is_accepted` is
--      its SQL twin (one comparison, pinned by a twin test). A slot with no
--      permit has nothing to accept.
--   3. 0–7 BUSINESS DAYS from today (Pacific; weekends skipped) — or PAST its
--      date and still unresolved ("Past date"), FROM THE GO-LIVE DATE ON.
--
-- ★★★ WHY THE PAST-DATE GATE. Measured on prod 2026-10-11: 19 slots are past
--     their date and were never released — 14 "OPEN" placeholders back to
--     2026-01-04, two unattached Othello rows from 2025-12 / 2026-03, and three
--     placeholder rows whose permit moved on. None can be rescheduled any more.
--     Without a gate the FIRST email would be 19 dead rows; P-180's own note
--     ("gate it so it does not fire retroactively on a backlog nobody can act
--     on") is the rule. Anything whose date passes FROM 2026-10-12 ON stays due
--     until somebody resolves it, exactly as ruled. The backlog is listed in
--     the fix-637 PR for whoever wants to clear it in the tracker.
--
-- ★★ CONSEQUENCE OF THE ACCEPTED RULE, stated so nobody is surprised: a slot
--    LINKED TO A PERMIT reads "accepted" from its intake day on (date-only), so
--    it leaves the list on the day itself. "Past date" therefore shows on
--    placeholder / unattached slots — the ones the date-only rule cannot clear.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE EMAIL: fix-634's queue, a new kind, no new secret
-- ---------------------------------------------------------------------------
--   pg_cron, weekdays at 14:00 and 15:00 UTC (= 7 AM Pacific in PDT and in PST)
--     → bp_intake_warning_enqueue() — proceeds only on a Pacific weekday at or
--       after 7 AM, and only when something is due
--     → one `notification_email_queue` row per recipient per day, kind
--       `notify:intake`, the due list frozen into `payload`, dedupe key
--       `notify:intake:<email>:<date>` (so the second hour is a no-op)
--     → fix-634's empty pg_net nudge → notify-send renders and sends, one
--       `email_outbox` row per send.
--
-- ★★ NOT SUBJECT TO THE EMAIL TOGGLES. `notification_preferences` covers
--    "mention" and "assignment" — things that happen TO you. This is a work
--    alert sent to the people Settings names for it, and the way to stop it is
--    to take yourself off that list. So the enqueue does not consult the
--    preferences and `bp_notify_claim` reports `opted_out = false` for it.
--
-- RECIPIENTS — app_config `seattleIntakeWarningRecipients`, a JSON array of
--   roster names, edited in Settings. Each name resolves through fix-634's
--   `bp_notify_person_for_name` (one active roster email with a login, or
--   nobody — never a guess).
--
-- ---------------------------------------------------------------------------
-- ★★★ NO EXISTING ROW IS CHANGED. Installs pg_cron, adds functions, one nullable
--     column + two widened CHECKs on the queue, one cron job, and ONE seed row:
--     app_config `seattleIntakeWarningRecipients` = ["Miles","Briana"] for the
--     tenant (inserted only if absent).
-- ===========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- 1. Clock + arithmetic
-- ---------------------------------------------------------------------------

-- ★ The calendar day in Seattle, whatever the server's zone.
CREATE OR REPLACE FUNCTION public.bp_pacific_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date;
$function$;

-- ★★ Business days from p_from to p_to: the weekdays in (p_from, p_to].
--    Same day → 0. Friday → Monday → 1. Negative when p_to is earlier (the
--    weekdays in (p_to, p_from], negated). Weekends only — no holiday calendar.
CREATE OR REPLACE FUNCTION public.bp_business_days_between(p_from date, p_to date)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN NULL
    WHEN p_to >= p_from THEN
      (SELECT count(*)::int FROM generate_series(p_from + 1, p_to, interval '1 day') d
        WHERE extract(isodow FROM d) < 6)
    ELSE
      -(SELECT count(*)::int FROM generate_series(p_to + 1, p_from, interval '1 day') d
         WHERE extract(isodow FROM d) < 6)
  END;
$function$;

-- ★★★ THE SQL TWIN OF `intakeIsAccepted` (src/lib/targetApproval.ts, fix-513).
--     Bobby 09-09: DATE ONLY. If that rule ever changes, change BOTH — the twin
--     test fails until they agree.
CREATE OR REPLACE FUNCTION public.bp_intake_is_accepted(p_intake_date date, p_today date)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_intake_date IS NOT NULL AND p_intake_date <= p_today;
$function$;

-- ---------------------------------------------------------------------------
-- 2. THE RULE
-- ---------------------------------------------------------------------------
-- ★ INVOKER rights: the pop-up's RPC sees only its own tenant through the
--   existing SELECT policies on intake_records / permits / projects. The cron
--   path runs it as the owner and passes p_tenant explicitly.
CREATE OR REPLACE FUNCTION public.bp_intake_warning_due(
  p_today  date DEFAULT NULL,
  p_tenant uuid DEFAULT NULL
)
RETURNS TABLE(
  slot_id integer,
  tenant_id uuid,
  project_id uuid,
  permit_id integer,
  address text,
  permit_num text,
  permit_type text,
  is_placeholder boolean,
  intake_date date,
  business_days_left integer,
  past_date boolean
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH k AS (
    SELECT COALESCE(p_today, public.bp_pacific_today()) AS today,
           -- ★★★ The go-live gate for PAST dates — see the header.
           DATE '2026-10-12' AS past_since,
           7 AS window_days
  )
  SELECT ir.id,
         ir.tenant_id,
         COALESCE(p.project_id, ir.project_id),
         ir.permit_id,
         COALESCE(NULLIF(btrim(pj.address), ''), NULLIF(btrim(ir.address), ''), '(no address)'),
         COALESCE(NULLIF(btrim(p.num), ''), NULLIF(btrim(ir.permit_num), '')),
         COALESCE(NULLIF(btrim(p.type), ''), NULLIF(btrim(ir.permit_type), '')),
         COALESCE(ir.is_placeholder, false),
         ir.intake_date,
         public.bp_business_days_between(k.today, ir.intake_date),
         ir.intake_date < k.today
    FROM public.intake_records ir
    CROSS JOIN k
    LEFT JOIN public.permits  p  ON p.id  = ir.permit_id
    LEFT JOIN public.projects pj ON pj.id = p.project_id
   WHERE ir.intake_date IS NOT NULL
     AND (p_tenant IS NULL OR ir.tenant_id = p_tenant)
     -- 1. a Seattle slot
     AND (ir.permit_id IS NULL OR pj.juris = 'Seattle')
     -- 2. not accepted (fix-513's date-only rule, on the PERMIT's intake date)
     AND (ir.permit_id IS NULL OR NOT public.bp_intake_is_accepted(p.intake_date, k.today))
     -- 3. inside the window, or past and still unresolved (from go-live on)
     AND (
       (ir.intake_date >= k.today
         AND public.bp_business_days_between(k.today, ir.intake_date) <= k.window_days)
       OR (ir.intake_date < k.today AND ir.intake_date >= k.past_since)
     )
   ORDER BY ir.intake_date, 5, ir.id;
$function$;

COMMENT ON FUNCTION public.bp_intake_warning_due(date, uuid) IS
  'fix-637 (P-180): THE rule for the Seattle intake warning — read by the daily '
  'pop-up (RPC) and the daily email (bp_intake_warning_enqueue). Seattle slot, '
  'not accepted (fix-513 date-only), 0–7 business days out (Pacific, weekends '
  'skipped) or past its date since 2026-10-12.';

-- ---------------------------------------------------------------------------
-- 3. Recipients — names from Settings, resolved to one login or nobody
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_intake_warning_recipients(p_tenant uuid)
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
       AND c.key = 'seattleIntakeWarningRecipients'
       AND btrim(x) <> ''
  LOOP
    v_found := false;
    FOR r IN SELECT * FROM public.bp_notify_person_for_name(p_tenant, v_name) LOOP
      v_found := true;
      name := v_name; user_id := r.user_id; email := r.email;
      RETURN NEXT;
    END LOOP;
    -- ★ Unresolvable names come back with NULLs, so a report can list them.
    IF NOT v_found THEN
      name := v_name; user_id := NULL; email := NULL;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The queue learns a third kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_email_queue
  ADD COLUMN IF NOT EXISTS payload jsonb;

COMMENT ON COLUMN public.notification_email_queue.payload IS
  'fix-637: for kind notify:intake, the due list as it stood when queued '
  '({date, items:[…]}) — so the email says what was due at 7 AM, not at send.';

ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_kind_known;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_kind_known
  CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake'));

ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_has_subject;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_has_subject
  CHECK ((kind = 'notify:mention' AND message_id IS NOT NULL)
      OR (kind = 'notify:assignment' AND task_id IS NOT NULL AND task_source IS NOT NULL)
      OR (kind = 'notify:intake' AND payload IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 5. The daily enqueue (pg_cron calls this)
-- ---------------------------------------------------------------------------
-- Returns how many emails it queued. `p_force` skips the weekday/7 AM gate —
-- for a manual run only; the per-day dedupe still applies.
CREATE OR REPLACE FUNCTION public.bp_intake_warning_enqueue(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local   timestamp := now() AT TIME ZONE 'America/Los_Angeles';
  v_today   date := v_local::date;
  v_tenant  uuid;
  v_payload jsonb;
  v_items   jsonb;
  r         record;
  v_id      uuid;
  v_queued  integer := 0;
BEGIN
  IF NOT p_force THEN
    -- ★ Business days only, and not before 7 AM in Seattle. The job runs at
    --   both 14:00 and 15:00 UTC so one of them is 7 AM whatever DST says;
    --   the dedupe key makes the other a no-op.
    IF extract(isodow FROM v_local) >= 6 THEN RETURN 0; END IF;
    IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;
  END IF;

  FOR v_tenant IN
    SELECT DISTINCT c.tenant_id FROM public.app_config c
     WHERE c.key = 'seattleIntakeWarningRecipients'
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'slot_id', d.slot_id,
             'project_id', d.project_id,
             'address', d.address,
             'permit_num', d.permit_num,
             'permit_type', d.permit_type,
             'is_placeholder', d.is_placeholder,
             'intake_date', d.intake_date,
             'business_days_left', d.business_days_left,
             'past_date', d.past_date)
             ORDER BY d.intake_date, d.address, d.slot_id), '[]'::jsonb)
      INTO v_items
      FROM public.bp_intake_warning_due(v_today, v_tenant) d;

    -- ★ Nothing due → nobody is emailed. "Daily until resolved", not daily.
    IF jsonb_array_length(v_items) = 0 THEN CONTINUE; END IF;

    v_payload := jsonb_build_object('date', v_today, 'items', v_items);

    FOR r IN
      SELECT * FROM public.bp_intake_warning_recipients(v_tenant)
       WHERE user_id IS NOT NULL AND email IS NOT NULL
    LOOP
      v_id := NULL;
      INSERT INTO public.notification_email_queue
        (kind, recipient_user_id, to_email, payload, dedupe_key)
      VALUES
        ('notify:intake', r.user_id, lower(btrim(r.email)), v_payload,
         'notify:intake:' || lower(btrim(r.email)) || ':' || v_today::text)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN v_queued := v_queued + 1; END IF;
    END LOOP;
  END LOOP;

  IF v_queued > 0 THEN
    PERFORM public.bp_notify_nudge();
  END IF;
  RETURN v_queued;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The claim returns the payload, and intake is never "opted out"
-- ---------------------------------------------------------------------------
-- ★ Based on the LIVE definition (identical to fix-634's file, checked
--   2026-10-11). The return type changes, so it must be dropped first — a
--   CREATE OR REPLACE cannot add an OUT column.
DROP FUNCTION IF EXISTS public.bp_notify_claim(integer);
CREATE FUNCTION public.bp_notify_claim(p_limit integer DEFAULT 50)
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
         CASE WHEN c.kind = 'notify:intake' THEN false
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

COMMENT ON FUNCTION public.bp_notify_claim(integer) IS
  'fix-634 (P-323) + fix-637: service-role only. Claims pending '
  'notification_email_queue rows (status → sending) and returns what notify-send '
  'renders from, including the notify:intake payload.';

-- ---------------------------------------------------------------------------
-- 7. Grants — the rule is readable by signed-in users (RLS scopes it);
--    everything that queues or claims is service/cron only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_pacific_today() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_pacific_today() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_business_days_between(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_business_days_between(date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_intake_is_accepted(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_intake_is_accepted(date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_intake_warning_due(date, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_intake_warning_due(date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bp_intake_warning_recipients(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_intake_warning_enqueue(boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. THE ONE DATA WRITE — the recipients seed, with its tenant, only if absent
-- ---------------------------------------------------------------------------
-- ★ "Briana" is the roster spelling (team_members.name), which is what
--   bp_notify_person_for_name matches.
INSERT INTO public.app_config (tenant_id, key, value)
SELECT tm.tenant_id, 'seattleIntakeWarningRecipients', '["Miles","Briana"]'::jsonb
  FROM public.team_members tm
 WHERE lower(btrim(tm.name)) = 'miles' AND tm.active
 GROUP BY tm.tenant_id
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 9. The schedule (outside the transaction: cron.schedule upserts by name)
-- ---------------------------------------------------------------------------
-- 14:00 and 15:00 UTC, Monday–Friday = 7 AM Pacific in PDT (UTC-7) and in PST
-- (UTC-8). The function's own gate and the per-day dedupe make the other hour
-- a no-op.
SELECT cron.schedule(
  'bp-seattle-intake-warning',
  '0 14,15 * * 1-5',
  $$SELECT public.bp_intake_warning_enqueue()$$
);

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row (one seed row is inserted if absent).
-- 2. It stores no key. The nudge is fix-634's unauthenticated empty POST.
-- 3. It has no holiday calendar — weekends only, as ruled.
-- 4. It does not list the 19 pre-go-live past slots (see the header).
