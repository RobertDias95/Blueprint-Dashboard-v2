-- ===========================================================================
-- fix-642 (P-017 #44) — the Weekly Update also arrives by email
-- ===========================================================================
--
-- ⚖️ Same people as the pop-up (agenda members), the same Wednesday morning
--    (~7 AM Pacific), one email per person per edition, opt-out switch
--    "Weekly Update" (absence = on, like fix-634).
--
-- WHAT THIS ADDS (no existing rows are changed):
--   1. bp_weekly_snapshot_for(tenants[]) — the five buckets for given tenants.
--      bp_weekly_snapshot() (the pop-up's RPC) now delegates to it, so the
--      pop-up and the email read ONE definition. Same body, same output.
--   2. bp_weekly_update_recipients(tenant) — agenda members, resolved to a login
--      through fix-634's one-person-or-nobody helper.
--   3. bp_weekly_update_payload(tenant, edition) — what the email renders,
--      frozen at queue time: the snapshot rows + the open agenda items.
--   4. queue kind 'notify:weekly' + preference category 'weekly'.
--   5. bp_weekly_update_enqueue() + the Wednesday pg_cron job (fix-637's
--      DST-safe pattern: fire at 14:00 and 15:00 UTC, the function only acts
--      from 7 AM Pacific, and the dedupe key makes the second firing a no-op).
--   6. bp_notify_claim: opted_out for notify:weekly reads the 'weekly' switch.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The snapshot, for named tenants. ★ The body is bp_weekly_snapshot()'s as
--    live on 2026-10-11, with only the tenant source changed.
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

COMMENT ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) IS
  'fix-642: THE five Weekly Update buckets for the given tenants. Read by the '
  'pop-up (through bp_weekly_snapshot, with the caller''s tenants) and by the '
  'Wednesday email (bp_weekly_update_payload). Service-role only.';

-- ★ The pop-up's RPC, unchanged in signature and output: it now asks the one
--   definition above for the caller's own tenants.
CREATE OR REPLACE FUNCTION public.bp_weekly_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.bp_weekly_snapshot_for(public.auth_tenant_ids());
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Recipients: the agenda members (the pop-up's audience), by name, each
--    resolved to ONE login or nobody (fix-634's helper). A name that resolves
--    to nobody is returned with NULLs so it can be reported, never guessed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_weekly_update_recipients(p_tenant uuid)
RETURNS TABLE(name text, user_id uuid, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_name  text;
  r       record;
  v_found boolean;
BEGIN
  FOR v_name IN
    SELECT DISTINCT btrim(tm.name)
      FROM public.team_members tm
     WHERE tm.tenant_id = p_tenant
       AND tm.agenda_member IS TRUE
       AND tm.active
       AND NOT COALESCE(tm.former, false)
       AND btrim(COALESCE(tm.name, '')) <> ''
     ORDER BY 1
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
-- 3. The payload: what the email says, frozen when it is queued.
--    · snapshot = bp_weekly_snapshot_for (all rows; notify-send sorts each
--      bucket the way the pop-up does and takes the top 5).
--    · agenda   = the OPEN agenda items (fix-462: team_tasks.agenda, live =
--      not Resolved/Cancelled), in the pop-up's order: priority, then oldest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_weekly_update_payload(p_tenant uuid, p_edition date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'edition', p_edition,
    'snapshot', public.bp_weekly_snapshot_for(ARRAY[p_tenant]),
    'agenda', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id,
               'text', t.text,
               'assigned_to', NULLIF(btrim(t.assigned_to), ''),
               'priority', COALESCE(t.priority, false),
               'created_at', t.created_at,
               'days_on_agenda', GREATEST(0,
                 public.bp_pacific_today() - (t.created_at AT TIME ZONE 'America/Los_Angeles')::date))
             ORDER BY COALESCE(t.priority, false) DESC, t.created_at, t.id)
        FROM public.team_tasks t
       WHERE t.tenant_id = p_tenant
         AND t.agenda IS TRUE
         AND COALESCE(t.completion_status, 'Open') NOT IN ('Resolved', 'Cancelled')
    ), '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 4. One queue kind and one preference category.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_kind_known;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_kind_known
  CHECK (kind IN ('notify:mention', 'notify:assignment', 'notify:intake', 'notify:weekly'));

ALTER TABLE public.notification_email_queue
  DROP CONSTRAINT IF EXISTS notification_email_queue_has_subject;
ALTER TABLE public.notification_email_queue
  ADD CONSTRAINT notification_email_queue_has_subject
  CHECK ((kind = 'notify:mention' AND message_id IS NOT NULL)
      OR (kind = 'notify:assignment' AND task_id IS NOT NULL AND task_source IS NOT NULL)
      OR (kind = 'notify:intake' AND payload IS NOT NULL)
      OR (kind = 'notify:weekly' AND payload IS NOT NULL));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_category_known;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_category_known
  CHECK (category IN ('mention', 'assignment', 'weekly'));

-- ---------------------------------------------------------------------------
-- 5. Queue one email per recipient per edition.
--    ★ Edition = the Wednesday that most recently began in Pacific — the same
--      name the pop-up computes (src/lib/weeklyEdition.ts currentEdition).
--    ★ Unforced, it acts only on Wednesday from 7 AM Pacific.
--    ★ An opted-out person is not queued (and notify-send re-checks at send).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_weekly_update_enqueue(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local   timestamp := now() AT TIME ZONE 'America/Los_Angeles';
  v_today   date := v_local::date;
  v_edition date;
  v_tenant  uuid;
  v_payload jsonb;
  r         record;
  v_id      uuid;
  v_queued  integer := 0;
BEGIN
  IF NOT p_force THEN
    IF extract(isodow FROM v_local) <> 3 THEN RETURN 0; END IF;
    IF extract(hour FROM v_local) < 7 THEN RETURN 0; END IF;
  END IF;

  -- Days back to the most recent Wednesday (0 on Wednesday).
  v_edition := v_today - ((extract(isodow FROM v_today)::int + 4) % 7);

  FOR v_tenant IN
    SELECT DISTINCT tm.tenant_id FROM public.team_members tm
     WHERE tm.agenda_member IS TRUE AND tm.active
  LOOP
    v_payload := NULL;
    FOR r IN
      SELECT * FROM public.bp_weekly_update_recipients(v_tenant)
       WHERE user_id IS NOT NULL AND email IS NOT NULL
         AND public.bp_notify_enabled(user_id, 'weekly')
    LOOP
      IF v_payload IS NULL THEN
        v_payload := public.bp_weekly_update_payload(v_tenant, v_edition);
      END IF;
      v_id := NULL;
      INSERT INTO public.notification_email_queue
        (kind, recipient_user_id, to_email, payload, dedupe_key)
      VALUES
        ('notify:weekly', r.user_id, lower(btrim(r.email)), v_payload,
         'notify:weekly:' || lower(btrim(r.email)) || ':' || v_edition::text)
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

COMMENT ON FUNCTION public.bp_weekly_update_enqueue(boolean) IS
  'fix-642 (P-017): queues the Weekly Update email — one notify:weekly row per '
  'agenda member per edition (dedupe notify:weekly:<email>:<edition>), skipping '
  'anyone with the "weekly" switch off. Wednesday from 7 AM Pacific unless forced.';

-- ---------------------------------------------------------------------------
-- 6. bp_notify_claim — live definition (fix-637), with ONE change: the
--    opted_out column reads the 'weekly' switch for notify:weekly.
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
         CASE WHEN c.kind = 'notify:intake' THEN false
              WHEN c.kind = 'notify:weekly' THEN NOT public.bp_notify_enabled(c.recipient_user_id, 'weekly')
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
-- Grants. The pop-up RPC keeps its grant; everything new is service-role only
-- (bp_weekly_snapshot_for takes arbitrary tenants, so it must not be callable
-- by a signed-in user).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_weekly_snapshot_for(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.bp_weekly_snapshot() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bp_weekly_snapshot() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_weekly_update_recipients(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_weekly_update_recipients(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bp_weekly_update_payload(uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_weekly_update_payload(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.bp_weekly_update_enqueue(boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;

COMMIT;

-- ★ fix-637's DST-safe pattern: 14:00 UTC is 7 AM PDT, 15:00 UTC is 7 AM PST.
--   The function's own 7 AM Pacific gate drops the early firing in winter and
--   the dedupe key makes the second firing in summer a no-op.
SELECT cron.schedule(
  'bp-weekly-update-email',
  '0 14,15 * * 3',
  $$SELECT public.bp_weekly_update_enqueue()$$
);
