-- ===========================================================================
-- fix-646 — A SMART "RESUBMIT BY" DATE, AND A WARNING WHEN IT PASSES
--           P-066 + P-011
-- ===========================================================================
--
-- ⚖️ Bobby 10-11: "turning around cycle 1 corrections, we give 10 business
--    days, after that, every other cycle we try to turn around within 5
--    business days, but volume of corrections also plays a part … amount of
--    corrections + cycle". He approved this table:
--
--      round   items on the letter            business days
--      CR1     ≤10 / 11–25 / 26–50 / 51+      10 / 15 / 20 / 25
--      CR2+    ≤10 / 11–25 / 26+              5 / 8 / 10
--      any     letter not indexed yet (0)     the base (10 / 5)
--
--    Counted from the day AFTER corr_issued, weekends skipped, no holiday
--    calendar. Items = correction_items for the permit and cycle with
--    is_correction IS NOT FALSE (correction_items.cycle = cycle_index,
--    measured: 136 of 138 letters line up within 3 days of corr_issued).
--    ★ The date can move LATER when the letter is indexed (0 → N items). That
--      is expected; every reader shows the current value.
--
-- ---------------------------------------------------------------------------
-- ★★★ ONE RULE, THREE READERS
-- ---------------------------------------------------------------------------
-- `bp_resubmit_rounds_for(tenants, today)` is THE list of open rounds with
-- their date. It feeds:
--   · the screens, through `bp_resubmit_rounds()` (the caller's tenants)
--   · the 7 AM warning, through `bp_resubmit_warning_enqueue()`
--   · the Weekly Update's new bucket "f · Past resubmit-by"
-- `src/lib/resubmitBy.ts` is a TS MIRROR for tests (no live DB in CI), pinned
-- to this file by ResubmitByFix646.test.ts.
--
-- AN OPEN ROUND = cycle_index ≥ 1, corr_issued set, resubmitted null, no later
--   cycle, the permit not issued (actual_issue null AND approval_date null —
--   fix-221: approved counts as issued — and not withdrawn/cancelled), its
--   project not archived.
-- PAST = at least one business day has gone by after the resubmit-by date
--   (`days_past` ≥ 1). Due Friday, Saturday is not "past"; Monday is 1 day past.
-- PARKED = the project has an open project_holds row (a hold OR a cancel — the
--   same `project_parked` rule the correction-reconciliation views use) or the
--   permit has an open permit_holds row. ★ A parked round still shows its date;
--   it only never WARNS — and it is not ledgered, so when the hold lifts it is
--   warned in the next digest.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE WARNING: fix-634's queue, a new kind, fix-637's clock
-- ---------------------------------------------------------------------------
--   pg_cron weekdays at 14:00 and 15:00 UTC (= 7 AM Pacific in PDT and PST)
--     → bp_resubmit_warning_enqueue(): a Pacific weekday from 7 AM only
--     → the NEWLY past rounds = past, not parked, and not in the ledger
--       `resubmit_warnings` (or ledgered for an EARLIER date — the letter got
--       indexed, the date moved later, and that later date has now passed too)
--     → recipients per round: the permit's ENT lead and DM (permit value, else
--       the project's), each resolved through fix-634's one-login-or-nobody
--       `bp_notify_person_for_name`, ∪ app_config `resubmitWarningRecipients`
--       (seeded Dave, Brittani, Bobby). Not the DA — Bobby's choice.
--     → ONE `notify:resubmit` queue row per person per day listing their
--       rounds; a person with the "resubmit" switch off is not queued (and
--       bp_notify_claim re-checks it at send)
--     → the rounds go into the ledger, so a re-run — the second cron hour, or
--       tomorrow — sends nothing about them again.
--   ★ LAUNCH. The ledger starts empty, so the FIRST run sends one digest of
--     everything already past (`launch: true` in the payload says so in the
--     email). After that, only rounds that pass their date.
--   ★ ONE DIGEST PER DAY. If the ledger already has a row warned today for the
--     tenant, the run stops: anything that turned past since then waits for
--     tomorrow's digest instead of producing a second email.
--
-- ---------------------------------------------------------------------------
-- ★★★ NO EXISTING ROW IS CHANGED. Adds functions, one ledger table, one queue
--     kind + one preference category (widened CHECKs), one cron job, two
--     replaced functions (bp_weekly_snapshot_for gains bucket f;
--     bp_notify_claim reads the new switch), and ONE seed row: app_config
--     `resubmitWarningRecipients` = ["Dave","Brittani","Bobby"] (only if absent).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Arithmetic
-- ---------------------------------------------------------------------------

-- ★★ The n-th weekday AFTER p_from (n ≥ 1). Friday + 1 → Monday. A Saturday
--    corr_issued + 1 → Monday too. Weekends only — no holiday calendar.
CREATE OR REPLACE FUNCTION public.bp_add_business_days(p_from date, p_n integer)
RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_from IS NULL OR p_n IS NULL THEN NULL
    WHEN p_n <= 0 THEN p_from
    ELSE (SELECT d::date
            FROM generate_series(p_from + 1, p_from + p_n * 2 + 7, interval '1 day') d
           WHERE extract(isodow FROM d) < 6
           ORDER BY d
          OFFSET p_n - 1 LIMIT 1)
  END;
$function$;

-- ★★★ THE TABLE. Twin: `resubmitBusinessDays` in src/lib/resubmitBy.ts.
CREATE OR REPLACE FUNCTION public.bp_resubmit_business_days(p_cycle_index integer, p_items integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_cycle_index IS NULL OR p_cycle_index < 1 THEN NULL
    WHEN p_cycle_index = 1 THEN
      CASE WHEN COALESCE(p_items, 0) <= 10 THEN 10
           WHEN p_items <= 25 THEN 15
           WHEN p_items <= 50 THEN 20
           ELSE 25 END
    ELSE
      CASE WHEN COALESCE(p_items, 0) <= 10 THEN 5
           WHEN p_items <= 25 THEN 8
           ELSE 10 END
  END;
$function$;

-- The items on a round's letter (0 = not indexed yet).
CREATE OR REPLACE FUNCTION public.bp_correction_item_count(p_permit_id integer, p_cycle_index integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::int
    FROM public.correction_items ci
   WHERE ci.permit_id = p_permit_id
     AND ci.cycle = p_cycle_index
     AND ci.is_correction IS NOT FALSE;
$function$;

-- ---------------------------------------------------------------------------
-- 2. One round's date — for ANY round with corr_issued (history included).
--    Tenant-scoped: a signed-in caller gets NULL for another tenant's permit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resubmit_by(p_permit_id integer, p_cycle_index integer)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.bp_add_business_days(
           c.corr_issued,
           public.bp_resubmit_business_days(
             c.cycle_index, public.bp_correction_item_count(c.permit_id, c.cycle_index)))
    FROM public.permit_cycles c
    JOIN public.permits p ON p.id = c.permit_id
   WHERE c.permit_id = p_permit_id
     AND c.cycle_index = p_cycle_index
     AND c.cycle_index >= 1
     AND c.corr_issued IS NOT NULL
     AND (auth.uid() IS NULL OR p.tenant_id = ANY (public.auth_tenant_ids()));
$function$;

COMMENT ON FUNCTION public.bp_resubmit_by(integer, integer) IS
  'fix-646 (P-066): the smart Resubmit-by date for one correction round — '
  'corr_issued + N business days, N from the round and the letter''s item count '
  '(CR1 10/15/20/25 at ≤10/11–25/26–50/51+; CR2+ 5/8/10 at ≤10/11–25/26+; '
  'not indexed = the base). Weekends skipped, no holidays.';

-- ---------------------------------------------------------------------------
-- 3. THE RULE — every open round, with its date and basis.
--    Service-role only (it takes arbitrary tenants); the screens use
--    bp_resubmit_rounds() below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resubmit_rounds_for(p_tenants uuid[], p_today date DEFAULT NULL)
RETURNS TABLE(
  tenant_id uuid,
  permit_id integer,
  project_id uuid,
  address text,
  num text,
  type text,
  status text,
  cycle_index integer,
  corr_issued date,
  items integer,
  business_days integer,
  resubmit_by date,
  days_past integer,
  is_past boolean,
  parked boolean,
  ent_lead text,
  dm text,
  da text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH k AS (SELECT COALESCE(p_today, public.bp_pacific_today()) AS today),
  latest AS (
    SELECT DISTINCT ON (c.permit_id) c.permit_id, c.cycle_index, c.corr_issued, c.resubmitted
      FROM public.permit_cycles c
     WHERE c.cycle_index >= 1
     ORDER BY c.permit_id, c.cycle_index DESC
  ),
  opn AS (
    SELECT p.tenant_id, p.id AS permit_id, p.project_id,
           COALESCE(NULLIF(btrim(pj.address), ''), '(no address)') AS address,
           NULLIF(btrim(p.num), '') AS num,
           NULLIF(btrim(p.type), '') AS type,
           p.status,
           x.cycle_index, x.corr_issued,
           public.bp_correction_item_count(p.id, x.cycle_index) AS items,
           (EXISTS (SELECT 1 FROM public.project_holds h
                     WHERE h.project_id = p.project_id AND h.hold_end IS NULL)
            OR EXISTS (SELECT 1 FROM public.permit_holds h
                        WHERE h.permit_id = p.id AND h.hold_end IS NULL)) AS parked,
           COALESCE(NULLIF(btrim(p.ent_lead), ''), NULLIF(btrim(pj.entitlement_lead), '')) AS ent_lead,
           COALESCE(NULLIF(btrim(p.dm), ''), NULLIF(btrim(pj.design_manager), '')) AS dm,
           NULLIF(btrim(p.da), '') AS da
      FROM public.permits p
      JOIN public.projects pj ON pj.id = p.project_id
      JOIN latest x ON x.permit_id = p.id
     WHERE p.tenant_id = ANY (COALESCE(p_tenants, '{}'::uuid[]))
       AND COALESCE(pj.archived, false) = false
       AND p.actual_issue IS NULL
       AND p.approval_date IS NULL
       AND COALESCE(p.status, '') NOT ILIKE '%withdraw%'
       AND COALESCE(p.status, '') NOT ILIKE '%cancel%'
       AND x.corr_issued IS NOT NULL
       AND x.resubmitted IS NULL
  ),
  dated AS (
    SELECT o.*,
           public.bp_resubmit_business_days(o.cycle_index, o.items) AS business_days,
           public.bp_add_business_days(o.corr_issued,
             public.bp_resubmit_business_days(o.cycle_index, o.items)) AS resubmit_by
      FROM opn o
  )
  SELECT d.tenant_id, d.permit_id, d.project_id, d.address, d.num, d.type, d.status,
         d.cycle_index, d.corr_issued, d.items, d.business_days, d.resubmit_by,
         GREATEST(0, public.bp_business_days_between(d.resubmit_by, k.today)) AS days_past,
         public.bp_business_days_between(d.resubmit_by, k.today) >= 1 AS is_past,
         d.parked, d.ent_lead, d.dm, d.da
    FROM dated d CROSS JOIN k
   ORDER BY d.resubmit_by, d.address, d.permit_id;
$function$;

COMMENT ON FUNCTION public.bp_resubmit_rounds_for(uuid[], date) IS
  'fix-646: THE list of open correction rounds with their Resubmit-by date, '
  'business days past, and whether the round is parked (project/permit hold or '
  'cancel). Read by the screens (bp_resubmit_rounds), the 7 AM warning and the '
  'Weekly Update bucket f. Service-role only.';

-- ★ The screens' RPC: the caller's own tenants.
DROP FUNCTION IF EXISTS public.bp_resubmit_rounds();
CREATE FUNCTION public.bp_resubmit_rounds()
RETURNS TABLE(
  tenant_id uuid, permit_id integer, project_id uuid, address text, num text,
  type text, status text, cycle_index integer, corr_issued date, items integer,
  business_days integer, resubmit_by date, days_past integer, is_past boolean,
  parked boolean, ent_lead text, dm text, da text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM public.bp_resubmit_rounds_for(public.auth_tenant_ids(), NULL);
$function$;

-- ---------------------------------------------------------------------------
-- 4. The ledger — which rounds have been warned about, and for which date.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resubmit_warnings (
  permit_id   integer NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  cycle_index integer NOT NULL,
  tenant_id   uuid    NOT NULL,
  resubmit_by date    NOT NULL,
  warned_on   date    NOT NULL,
  warned_at   timestamptz NOT NULL DEFAULT now(),
  recipients  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (permit_id, cycle_index)
);

COMMENT ON TABLE public.resubmit_warnings IS
  'fix-646: one row per correction round the Resubmit-by warning has announced, '
  'with the date it announced. A round is warned again only if its date later '
  'moves (letter indexed) and that new date passes too. Service-role only.';

ALTER TABLE public.resubmit_warnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resubmit_warnings FROM public, anon, authenticated;
GRANT ALL ON TABLE public.resubmit_warnings TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Recipients for one round: ENT + DM (resolved) ∪ the Settings list.
--    Deduped by email. Unresolvable names are simply nobody (never a guess).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resubmit_warning_recipients(
  p_tenant uuid, p_ent text, p_dm text
)
RETURNS TABLE(user_id uuid, email text, why text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH names AS (
    SELECT 1 AS ord, 'ENT'::text AS why, btrim(p_ent) AS name
     WHERE NULLIF(btrim(COALESCE(p_ent, '')), '') IS NOT NULL
    UNION ALL
    SELECT 2, 'DM', btrim(p_dm)
     WHERE NULLIF(btrim(COALESCE(p_dm, '')), '') IS NOT NULL
    UNION ALL
    SELECT 3, 'list', btrim(x)
      FROM public.app_config c,
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(c.value) = 'array' THEN c.value ELSE '[]'::jsonb END) x
     WHERE c.tenant_id = p_tenant
       AND c.key = 'resubmitWarningRecipients'
       AND btrim(x) <> ''
  ),
  resolved AS (
    SELECT n.ord, n.why, r.user_id, lower(btrim(r.email)) AS email
      FROM names n
      CROSS JOIN LATERAL public.bp_notify_person_for_name(p_tenant, n.name) r
     WHERE r.email IS NOT NULL AND btrim(r.email) <> ''
  )
  SELECT DISTINCT ON (email) user_id, email, why
    FROM resolved
   ORDER BY email, ord;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Queue kind + preference category
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_kind_known;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_kind_known
  CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake', 'notify:weekly',
                  'notify:resubmit'));

ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_has_subject;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_has_subject
  CHECK ((kind = 'notify:mention' AND message_id IS NOT NULL)
      OR (kind = 'notify:assignment' AND task_id IS NOT NULL AND task_source IS NOT NULL)
      OR (kind = 'notify:intake' AND payload IS NOT NULL)
      OR (kind = 'notify:weekly' AND payload IS NOT NULL)
      OR (kind = 'notify:resubmit' AND payload IS NOT NULL));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_category_known;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_category_known
  CHECK (category IN ('mention', 'assignment', 'weekly', 'resubmit'));

-- ---------------------------------------------------------------------------
-- 7. The daily enqueue (pg_cron calls this). Returns how many emails it queued.
--    `p_force` skips the weekday / 7 AM gate (manual runs); the ledger and the
--    per-day dedupe still apply.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_resubmit_warning_enqueue(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local  timestamp := now() AT TIME ZONE 'America/Los_Angeles';
  v_today  date := v_local::date;
  v_tenant uuid;
  v_launch boolean;
  v_rounds integer;
  v_new    jsonb;
  r        record;
  v_id     uuid;
  v_queued integer := 0;
BEGIN
  IF NOT p_force THEN
    -- ★ fix-637's clock: weekdays, from 7 AM in Seattle. The job fires at
    --   14:00 and 15:00 UTC so one of them is 7 AM whatever DST says.
    IF extract(isodow FROM v_local) >= 6 THEN RETURN 0; END IF;
    IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;
  END IF;

  FOR v_tenant IN
    SELECT DISTINCT p.tenant_id FROM public.permits p WHERE p.tenant_id IS NOT NULL
  LOOP
    -- ★ One digest per day: today's run already happened for this tenant.
    IF EXISTS (SELECT 1 FROM public.resubmit_warnings w
                WHERE w.tenant_id = v_tenant AND w.warned_on = v_today) THEN
      CONTINUE;
    END IF;

    v_launch := NOT EXISTS (SELECT 1 FROM public.resubmit_warnings w
                             WHERE w.tenant_id = v_tenant);

    -- The NEWLY past rounds: past, not parked, not ledgered (or ledgered for an
    -- earlier date that has since moved later).
    SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
      INTO v_new
      FROM (
        SELECT o.permit_id, o.project_id, o.address, o.num, o.type, o.cycle_index,
               o.corr_issued, o.items, o.business_days, o.resubmit_by, o.days_past,
               o.ent_lead, o.dm
          FROM public.bp_resubmit_rounds_for(ARRAY[v_tenant], v_today) o
          LEFT JOIN public.resubmit_warnings w
            ON w.permit_id = o.permit_id AND w.cycle_index = o.cycle_index
         WHERE o.is_past
           AND NOT o.parked
           AND (w.permit_id IS NULL OR w.resubmit_by < o.resubmit_by)
      ) o;

    v_rounds := jsonb_array_length(v_new);
    IF v_rounds = 0 THEN CONTINUE; END IF;

    -- One email per person, listing that person's rounds.
    FOR r IN
      WITH pairs AS (
        SELECT n.*, rc.user_id, rc.email
          FROM jsonb_to_recordset(v_new) AS n(
                 permit_id integer, project_id uuid, address text, num text, type text,
                 cycle_index integer, corr_issued date, items integer, business_days integer,
                 resubmit_by date, days_past integer, ent_lead text, dm text)
          CROSS JOIN LATERAL public.bp_resubmit_warning_recipients(v_tenant, n.ent_lead, n.dm) rc
      )
      SELECT pr.email, min(pr.user_id::text)::uuid AS user_id,
             jsonb_agg(jsonb_build_object(
               'permit_id', pr.permit_id,
               'project_id', pr.project_id,
               'address', pr.address,
               'num', pr.num,
               'type', pr.type,
               'cycle_index', pr.cycle_index,
               'corr_issued', pr.corr_issued,
               'items', pr.items,
               'business_days', pr.business_days,
               'resubmit_by', pr.resubmit_by,
               'days_past', pr.days_past,
               'ent_lead', pr.ent_lead)
               ORDER BY pr.days_past DESC, pr.address, pr.permit_id) AS items
        FROM pairs pr
       GROUP BY pr.email
    LOOP
      IF NOT public.bp_notify_enabled(r.user_id, 'resubmit') THEN CONTINUE; END IF;
      v_id := NULL;
      INSERT INTO public.notification_email_queue
        (kind, recipient_user_id, to_email, payload, dedupe_key)
      VALUES
        ('notify:resubmit', r.user_id, r.email,
         jsonb_build_object('date', v_today, 'launch', v_launch, 'items', r.items),
         'notify:resubmit:' || r.email || ':' || v_today::text)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN v_queued := v_queued + 1; END IF;
    END LOOP;

    -- ★ Ledger every announced round, so no one hears about it again.
    INSERT INTO public.resubmit_warnings
      (permit_id, cycle_index, tenant_id, resubmit_by, warned_on, recipients)
    SELECT n.permit_id, n.cycle_index, v_tenant, n.resubmit_by, v_today,
           (SELECT count(*)::int FROM public.bp_resubmit_warning_recipients(v_tenant, n.ent_lead, n.dm))
      FROM jsonb_to_recordset(v_new) AS n(
             permit_id integer, cycle_index integer, resubmit_by date, ent_lead text, dm text)
    ON CONFLICT (permit_id, cycle_index) DO UPDATE
      SET resubmit_by = EXCLUDED.resubmit_by,
          warned_on   = EXCLUDED.warned_on,
          warned_at   = now(),
          recipients  = EXCLUDED.recipients;
  END LOOP;

  IF v_queued > 0 THEN
    PERFORM public.bp_notify_nudge();
  END IF;
  RETURN v_queued;
END;
$function$;

COMMENT ON FUNCTION public.bp_resubmit_warning_enqueue(boolean) IS
  'fix-646 (P-011): queues the Past resubmit-by digest — one notify:resubmit row '
  'per person per day listing the rounds that passed their date since the last '
  'run (ledger resubmit_warnings), to the ENT + DM + resubmitWarningRecipients, '
  'skipping parked rounds and anyone with the "resubmit" switch off. Weekdays '
  'from 7 AM Pacific unless forced. The first run lists everything already past.';

-- ---------------------------------------------------------------------------
-- 8. bp_notify_claim — the live definition (fix-642, md5 2e6901…), with ONE
--    change: notify:resubmit reads the 'resubmit' switch.
-- ---------------------------------------------------------------------------
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
         CASE WHEN c.kind = 'notify:intake' THEN false
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
-- 9. The Weekly Update gains bucket f, "Past resubmit-by" — the live body
--    (fix-642, md5 b602fb…) with ONE added UNION branch. Bucket d stays.
--    on_date = the resubmit-by date, age_days = business days past.
--    ★ Parked rounds are left out, exactly as the warning leaves them out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_weekly_snapshot_for(p_tenants uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenants uuid[] := COALESCE(p_tenants, '{}'::uuid[]);
  v_today   date;
  v_result  jsonb;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;

  WITH live AS (
    SELECT p.*
      FROM public.permits p
     WHERE p.tenant_id = ANY (v_tenants)
       AND p.actual_issue IS NULL
       AND COALESCE(p.status, '') NOT ILIKE '%withdraw%'
       AND COALESCE(p.status, '') NOT ILIKE '%cancel%'
  ),
  c0 AS (
    SELECT permit_id, submitted, intake_accepted
      FROM public.permit_cycles WHERE cycle_index = 0
  ),
  latest AS (
    SELECT DISTINCT ON (permit_id) permit_id, cycle_index, corr_issued, resubmitted
      FROM public.permit_cycles WHERE cycle_index >= 1
     ORDER BY permit_id, cycle_index DESC
  ),
  rows AS (
    SELECT 'a' AS bucket, l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit AS on_date, (l.target_submit - v_today) AS age_days
      FROM live l JOIN public.active_projects pr ON pr.id = l.project_id
     WHERE l.target_submit BETWEEN v_today AND v_today + 14
       AND NOT public.bp_intake_is_accepted(l.intake_date, v_today)
    UNION ALL
    SELECT 'b', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.target_submit, (v_today - l.target_submit)
      FROM live l JOIN public.active_projects pr ON pr.id = l.project_id
      LEFT JOIN c0 ON c0.permit_id = l.id
     WHERE l.target_submit < v_today AND c0.submitted IS NULL
    UNION ALL
    SELECT 'c', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, c0.submitted, (v_today - c0.submitted)
      FROM live l JOIN public.active_projects pr ON pr.id = l.project_id
      JOIN c0 ON c0.permit_id = l.id
     WHERE c0.submitted IS NOT NULL AND c0.intake_accepted IS NULL
    UNION ALL
    SELECT 'd', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, x.corr_issued, (v_today - x.corr_issued)
      FROM live l JOIN public.active_projects pr ON pr.id = l.project_id
      JOIN latest x ON x.permit_id = l.id
     WHERE x.corr_issued IS NOT NULL AND x.resubmitted IS NULL
       AND x.corr_issued < v_today - 7
    UNION ALL
    SELECT 'e', l.id, l.project_id, pr.address, l.num, l.type, l.ent_lead, l.da,
           l.status, l.approval_date, (v_today - l.approval_date)
      FROM live l JOIN public.active_projects pr ON pr.id = l.project_id
     WHERE l.approval_date IS NOT NULL
    UNION ALL
    -- ★ fix-646: Past resubmit-by — THE rule (bp_resubmit_rounds_for), past and not parked.
    SELECT 'f', o.permit_id, o.project_id, o.address, o.num, o.type, o.ent_lead, o.da,
           o.status, o.resubmit_by, o.days_past
      FROM public.bp_resubmit_rounds_for(v_tenants, v_today) o
     WHERE o.is_past AND NOT o.parked
  )
  SELECT jsonb_build_object(
           'today', v_today,
           'rows', COALESCE(jsonb_agg(
             jsonb_build_object(
               'bucket', r.bucket, 'permit_id', r.id, 'project_id', r.project_id,
               'address', r.address, 'num', r.num, 'type', r.type,
               'ent_lead', r.ent_lead, 'da', r.da, 'status', r.status,
               'on_date', r.on_date, 'age_days', r.age_days
             ) ORDER BY r.bucket, r.age_days DESC, r.address
           ), '[]'::jsonb)
         )
    INTO v_result FROM rows r;

  RETURN COALESCE(v_result, jsonb_build_object('today', v_today, 'rows', '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Grants. The date and the screens' list are readable by signed-in users
--     (tenant-scoped inside); everything that takes tenants, queues or claims
--     is service/cron only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_add_business_days(date, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_add_business_days(date, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_resubmit_business_days(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_resubmit_business_days(integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_correction_item_count(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_correction_item_count(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.bp_resubmit_by(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_resubmit_by(integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_resubmit_rounds() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_resubmit_rounds() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bp_resubmit_rounds_for(uuid[], date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_resubmit_rounds_for(uuid[], date) TO service_role;
REVOKE ALL ON FUNCTION public.bp_resubmit_warning_recipients(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_resubmit_warning_recipients(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.bp_resubmit_warning_enqueue(boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;
REVOKE ALL ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. THE ONE DATA WRITE — the recipients seed, only if absent.
--     Roster spellings (team_members.name), which bp_notify_person_for_name matches.
-- ---------------------------------------------------------------------------
INSERT INTO public.app_config (tenant_id, key, value)
SELECT tm.tenant_id, 'resubmitWarningRecipients', '["Dave","Brittani","Bobby"]'::jsonb
  FROM public.team_members tm
 WHERE lower(btrim(tm.name)) = 'bobby' AND tm.active
 GROUP BY tm.tenant_id
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 12. The schedule (outside the transaction: cron.schedule upserts by name).
--     fix-637's DST-safe pair: 14:00 UTC = 7 AM PDT, 15:00 UTC = 7 AM PST.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'bp-resubmit-warning',
  '0 14,15 * * 1-5',
  $$SELECT public.bp_resubmit_warning_enqueue()$$
);

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row (one seed row is inserted if absent).
-- 2. It has no holiday calendar — weekends only, as ruled.
-- 3. It does not touch the scraper's 14-day `scraper:mbp_resubmittal`
--    condition (scraper repo, MBP_STUCK_CORRECTIONS_DAYS = 14). Retiring it is
--    a scraper follow-up.
-- 4. It does not warn the DA (Bobby's choice).
