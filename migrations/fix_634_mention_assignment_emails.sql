-- ===========================================================================
-- fix-634 — EMAIL PEOPLE WHEN THEY ARE @-MENTIONED OR ASSIGNED A TASK   P-323
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-09-16 (decision `email-notifications-v1`):
--    1. Triggers are an @mention and a task assignment, and NOTHING else.
--    2. Immediate, not a digest (~34 mentions a month to the people who asked).
--    3. On by default, with a per-person opt-out per category.
--    4. From bridge@, through fix-628's sender, in fix-631's branded template.
--
-- ---------------------------------------------------------------------------
-- ★★★ THE SHAPE: THE DATABASE DECIDES WHO, THE FUNCTION ONLY SENDS
-- ---------------------------------------------------------------------------
--   write (chat insert / task assign)
--     → AFTER trigger resolves recipients and INSERTs into notification_email_queue
--     → once per transaction, pg_net POSTs an EMPTY body to the `notify-send`
--       Edge Function (a "nudge" — it carries no recipient, no id, nothing)
--     → the function claims every pending row (FOR UPDATE SKIP LOCKED), sends
--       each through Graph, writes ONE email_outbox row per send, and marks the
--       queue rows sent / failed / skipped with that outbox id.
--
-- ★★★ WHY THIS NEEDS NO NEW SECRET. The function is deployed --no-verify-jwt and
--     trusts NOTHING in the request: all it can be asked to do is "drain what the
--     database already queued". A stranger who POSTs to it can at most make it
--     send, a few seconds early, mail that was going to be sent anyway — and
--     the claim is atomic, so not twice. No key is stored in the database, and
--     the function holds only the two secrets it already had (the injected
--     service-role key, and fix-628's MS_GRAPH_CLIENT_SECRET).
--
-- ★★★ WHY pg_net IS SAFE INSIDE A TRIGGER. `net.http_post` only INSERTs into
--     `net.http_request_queue`; the background worker reads COMMITTED rows. So a
--     rolled-back chat post sends no nudge, and a committed one nudges only AFTER
--     its queue rows are visible to the function.
--
-- ★★ AND A LOST NUDGE IS NOT A LOST EMAIL. A row whose nudge never arrived sits
--    at status 'pending' (visible) and the NEXT nudge — from anybody's next
--    mention or assignment — drains it, because the function claims every
--    pending row, not just the ones its own request was about.
--
-- ---------------------------------------------------------------------------
-- ★★★ WHO GETS ONE
-- ---------------------------------------------------------------------------
-- MENTIONS — `project_messages.mentions` is uuid[] of auth users. Resolved by id
--   to `profiles.email`. ★ NEVER by `team_members.name`.
--     · the author never (by id AND by email — one person, two logins)
--     · an edit that ADDS a mention emails only the added person
--     · a soft-deleted message emails nobody
--     · a row whose created_at is more than an hour old is HISTORY (a backfill,
--       e.g. fix-381's CR threads) and emails nobody — fix-378's rule
--     · no author (a machine write) emails nobody
--
-- ASSIGNMENTS — `assigned_to` / `permit_task_assignees.assignee` are TEXT: a
--   roster first name ("Miles") or a ROLE ("Entitlements", "Design Manager").
--     · resolved only when the name matches ACTIVE roster rows that share
--       EXACTLY ONE email, and that email has an active login. Lucas's two
--       rows share one email → one person. Two people called "Cam" → nobody.
--       Jeremy has no email → nobody. A ROLE matches no roster row → nobody.
--       ★ We do not guess.
--     · only when a PERSON made the change (auth.uid() is set). The scraper,
--       the bot-task minters and every service-role writer mint tasks without a
--       user — fix-363's person-vs-machine rule — and must not mail anybody.
--     · co-assignee rows with source <> 'manual' (fix-346 / fix-368's automatic
--       DM co-assign) are the machine's choice, not an assignment.
--     · `bp_set_task_assignees` REPLACES the whole set (DELETE then INSERT), so
--       re-saving an unchanged list would look like N new assignments. The
--       DELETE trigger remembers what it removed for the rest of the
--       transaction and the INSERT trigger ignores a name that was just there.
--     · a task that is already done emails nobody; nor does assigning yourself.
--
-- ★★ DEDUPE. `dedupe_key` = kind + lower(email) + the message / task id, UNIQUE.
--    So one person gets at most ONE email per message and ONE per task, however
--    many paths name them (assigned_to AND a co-assignee row; mentioned on
--    insert and again on edit).
--
-- ★★ OPT-OUT. `notification_preferences` — absence means ON. Checked when the
--    row is queued and again when it is sent.
--
-- ---------------------------------------------------------------------------
-- ★★★ NO EXISTING PRODUCTION ROW IS CHANGED BY THIS FILE. It installs pg_net,
--     creates two tables, helper functions and four triggers. Nothing is
--     inserted, updated or deleted, and the triggers act only on FUTURE writes.
-- ===========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 1. notification_preferences — per person, per category; absence = ON
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   text NOT NULL,
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category),
  CONSTRAINT notification_preferences_category_known
    CHECK (category IN ('mention', 'assignment'))
);

COMMENT ON TABLE public.notification_preferences IS
  'fix-634 (P-323): email-notification opt-outs. ABSENCE MEANS ON — a person '
  'with no row gets every category. Each user reads and writes only their own.';

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_service ON public.notification_preferences;
CREATE POLICY notification_preferences_service ON public.notification_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ★★★ `FROM public, anon` — anon inherits PUBLIC (fix-157). And the explicit
--     grant list, because Supabase's default privileges would otherwise hand
--     `authenticated` TRUNCATE on a new table (fix-273).
REVOKE ALL ON TABLE public.notification_preferences FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO service_role;

-- ---------------------------------------------------------------------------
-- 2. notification_email_queue — what the triggers decided, until it is sent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_email_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  kind              text NOT NULL,
  recipient_user_id uuid NOT NULL,
  to_email          text NOT NULL,
  actor_user_id     uuid,
  project_id        uuid,
  message_id        uuid,
  task_id           uuid,
  task_source       text,
  dedupe_key        text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  claimed_at        timestamptz,
  processed_at      timestamptz,
  -- ★ The email_outbox row that recorded the attempt. Several queue rows can
  --   share one (an assignment burst is ONE email listing every task).
  outbox_id         uuid REFERENCES public.email_outbox(id),
  note              text,

  CONSTRAINT notification_email_queue_kind_known
    CHECK (kind IN ('notify:mention', 'notify:assignment')),
  CONSTRAINT notification_email_queue_status_known
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  CONSTRAINT notification_email_queue_task_source_known
    CHECK (task_source IS NULL OR task_source IN ('permit_tasks', 'team_tasks')),
  CONSTRAINT notification_email_queue_has_subject
    CHECK ((kind = 'notify:mention' AND message_id IS NOT NULL)
        OR (kind = 'notify:assignment' AND task_id IS NOT NULL AND task_source IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_email_queue_dedupe
  ON public.notification_email_queue (dedupe_key);
CREATE INDEX IF NOT EXISTS notification_email_queue_pending
  ON public.notification_email_queue (created_at) WHERE status = 'pending';

COMMENT ON TABLE public.notification_email_queue IS
  'fix-634 (P-323): one row per (recipient, message|task) the triggers decided '
  'should be emailed. Drained by the notify-send Edge Function, which writes one '
  'email_outbox row per send and links it here. status pending = not yet '
  'attempted (a nudge was lost; the next one drains it).';

ALTER TABLE public.notification_email_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_email_queue_service ON public.notification_email_queue;
CREATE POLICY notification_email_queue_service ON public.notification_email_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.notification_email_queue FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_email_queue TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- ★ Absence means ON.
CREATE OR REPLACE FUNCTION public.bp_notify_enabled(p_user uuid, p_category text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE user_id = p_user AND category = p_category AND enabled = false
  );
$function$;

-- ★★★ A ROSTER NAME → ONE PERSON, OR NOBODY. Never a guess.
CREATE OR REPLACE FUNCTION public.bp_notify_person_for_name(p_tenant uuid, p_name text)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_emails text[];
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN; END IF;

  SELECT array_agg(DISTINCT lower(btrim(tm.email)))
    INTO v_emails
    FROM public.team_members tm
   WHERE tm.tenant_id = p_tenant
     AND tm.active
     AND NOT COALESCE(tm.former, false)
     AND lower(btrim(tm.name)) = lower(btrim(p_name))
     AND tm.email IS NOT NULL AND btrim(tm.email) <> '';

  -- ★ Zero (a role, or Jeremy) or two-plus (an ambiguous name): nobody.
  IF v_emails IS NULL OR cardinality(v_emails) <> 1 THEN RETURN; END IF;

  RETURN QUERY
    SELECT p.id, p.email
      FROM public.profiles p
     WHERE lower(btrim(p.email)) = v_emails[1]
       AND COALESCE(p.active, true)
     ORDER BY p.created_at, p.id
     LIMIT 1;
END;
$function$;

-- ★★ One nudge per transaction, however many rows it queued. The URL is the
--    function's public address, not a secret; the request carries no key.
CREATE OR REPLACE FUNCTION public.bp_notify_nudge()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tx text := txid_current()::text;
BEGIN
  IF current_setting('bp.notify_nudged', true) IS NOT DISTINCT FROM v_tx THEN
    RETURN;
  END IF;
  PERFORM set_config('bp.notify_nudged', v_tx, true);
  PERFORM net.http_post(
    url     := 'https://eibnmwthkcuumyclyxoe.supabase.co/functions/v1/notify-send',
    body    := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$function$;

-- ★★★ THE ONE PLACE A ROW IS QUEUED. Every exclusion that is about the PERSON
--     (author, opt-out, no address) lives here so the four triggers cannot
--     disagree about it.
CREATE OR REPLACE FUNCTION public.bp_notify_enqueue(
  p_kind text, p_recipient uuid, p_email text, p_actor uuid,
  p_project uuid, p_message uuid, p_task uuid, p_task_source text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_actor_email text;
  v_category text := CASE p_kind WHEN 'notify:mention' THEN 'mention' ELSE 'assignment' END;
  v_id uuid;
BEGIN
  IF p_recipient IS NULL OR v_email = '' THEN RETURN; END IF;
  IF p_actor IS NOT NULL AND p_recipient = p_actor THEN RETURN; END IF;
  SELECT lower(btrim(email)) INTO v_actor_email FROM public.profiles WHERE id = p_actor;
  IF v_actor_email IS NOT NULL AND v_actor_email = v_email THEN RETURN; END IF;
  IF NOT public.bp_notify_enabled(p_recipient, v_category) THEN RETURN; END IF;

  INSERT INTO public.notification_email_queue
    (kind, recipient_user_id, to_email, actor_user_id, project_id,
     message_id, task_id, task_source, dedupe_key)
  VALUES
    (p_kind, p_recipient, v_email, p_actor, p_project,
     p_message, p_task, p_task_source,
     p_kind || ':' || v_email || ':' || COALESCE(p_message, p_task)::text)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    PERFORM public.bp_notify_nudge();
  END IF;
END;
$function$;

-- ★ Assign-by-name, shared by the three assignment triggers.
CREATE OR REPLACE FUNCTION public.bp_notify_assignment(
  p_tenant uuid, p_name text, p_project uuid, p_task uuid, p_task_source text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM public.bp_notify_person_for_name(p_tenant, p_name) LOOP
    PERFORM public.bp_notify_enqueue('notify:assignment', r.user_id, r.email,
      auth.uid(), p_project, NULL, p_task, p_task_source);
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Triggers. ★★★ Each wraps its work in an EXCEPTION block: a failure to
--    queue an email must never fail the chat post or the task save that caused
--    it. It is raised as a WARNING (Postgres logs) instead.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bp_trg_notify_mentions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new uuid[];
  r record;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.author_id IS NULL THEN RETURN NULL; END IF;
  -- ★★ History, not news: a backfilled message keeps its original created_at.
  IF NEW.created_at < now() - interval '1 hour' THEN RETURN NULL; END IF;

  v_new := ARRAY(
    SELECT DISTINCT m FROM unnest(COALESCE(NEW.mentions, '{}'::uuid[])) m
    EXCEPT
    SELECT m FROM unnest(CASE WHEN TG_OP = 'UPDATE'
                              THEN COALESCE(OLD.mentions, '{}'::uuid[])
                              ELSE '{}'::uuid[] END) m
  );
  IF cardinality(v_new) = 0 THEN RETURN NULL; END IF;

  BEGIN
    FOR r IN
      SELECT p.id, p.email
        FROM public.profiles p
       WHERE p.id = ANY (v_new)
         AND p.email IS NOT NULL AND btrim(p.email) <> ''
         AND COALESCE(p.active, true)
    LOOP
      PERFORM public.bp_notify_enqueue('notify:mention', r.id, r.email,
        NEW.author_id, NEW.project_id, NEW.id, NULL, NULL);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix-634: could not queue mention emails for message %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS project_messages_notify_mentions ON public.project_messages;
CREATE TRIGGER project_messages_notify_mentions
  AFTER INSERT OR UPDATE OF mentions ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_notify_mentions();

CREATE OR REPLACE FUNCTION public.bp_trg_notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
BEGIN
  -- ★★★ A person did this, or nobody is emailed (fix-363).
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.done, false) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF TG_TABLE_NAME = 'permit_tasks' THEN
      SELECT project_id INTO v_project FROM public.permits WHERE id = NEW.permit_id;
      PERFORM public.bp_notify_assignment(NEW.tenant_id, NEW.assigned_to, v_project,
        NEW.id, 'permit_tasks');
    ELSE
      PERFORM public.bp_notify_assignment(NEW.tenant_id, NEW.assigned_to,
        NEW.ref_project_id, NEW.id, 'team_tasks');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix-634: could not queue assignment email for task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS permit_tasks_notify_assigned ON public.permit_tasks;
CREATE TRIGGER permit_tasks_notify_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON public.permit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_notify_task_assigned();

DROP TRIGGER IF EXISTS team_tasks_notify_assigned ON public.team_tasks;
CREATE TRIGGER team_tasks_notify_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON public.team_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_notify_task_assigned();

-- ★★★ The co-assignee join table. `bp_set_task_assignees` DELETEs the whole set
--     and re-INSERTs it, so the DELETE side records what it removed (for this
--     transaction only) and the INSERT side skips a name that was already on.
CREATE OR REPLACE FUNCTION public.bp_trg_notify_coassignee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
  v_removed text;
  v_task record;
  v_project uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_key := '|' || OLD.task_id::text || ':' || lower(btrim(OLD.assignee)) || '|';
    PERFORM set_config('bp.notify_removed',
      COALESCE(current_setting('bp.notify_removed', true), '') || v_key, true);
    RETURN NULL;
  END IF;

  IF auth.uid() IS NULL OR NEW.source IS DISTINCT FROM 'manual' THEN RETURN NULL; END IF;
  v_key := '|' || NEW.task_id::text || ':' || lower(btrim(NEW.assignee)) || '|';
  v_removed := COALESCE(current_setting('bp.notify_removed', true), '');
  IF position(v_key IN v_removed) > 0 THEN RETURN NULL; END IF;

  BEGIN
    SELECT t.id, t.permit_id, t.done INTO v_task FROM public.permit_tasks t WHERE t.id = NEW.task_id;
    IF v_task.id IS NULL OR COALESCE(v_task.done, false) THEN RETURN NULL; END IF;
    SELECT project_id INTO v_project FROM public.permits WHERE id = v_task.permit_id;
    PERFORM public.bp_notify_assignment(NEW.tenant_id, NEW.assignee, v_project,
      NEW.task_id, 'permit_tasks');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix-634: could not queue co-assignee email for task %: %', NEW.task_id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS permit_task_assignees_notify ON public.permit_task_assignees;
CREATE TRIGGER permit_task_assignees_notify
  AFTER INSERT OR DELETE ON public.permit_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_notify_coassignee();

-- ---------------------------------------------------------------------------
-- 5. The claim — what the function reads, with everything it renders from
-- ---------------------------------------------------------------------------
-- ★★ FOR UPDATE SKIP LOCKED, so two overlapping nudges never claim (or send)
--    the same row. ★ The actor's name comes from the ROSTER by email —
--    profiles.name is NULL for every login (fix-330).
CREATE OR REPLACE FUNCTION public.bp_notify_claim(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, kind text, to_email text, recipient_user_id uuid,
  project_id uuid, message_id uuid, task_id uuid, task_source text,
  opted_out boolean, actor_name text, project_address text,
  post_title text, message_body text, message_deleted boolean,
  task_text text, task_done boolean, task_due date
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
         NOT public.bp_notify_enabled(c.recipient_user_id,
           CASE c.kind WHEN 'notify:mention' THEN 'mention' ELSE 'assignment' END),
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
         COALESCE(pt.due_date, tt.due_date)
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
  'fix-634 (P-323): service-role only. Claims pending notification_email_queue '
  'rows (status → sending) and returns what notify-send renders from.';

-- ★★★ Every helper is service-role / trigger-only. Nothing here is callable
--     with a user's JWT — `bp_notify_claim` would otherwise let any signed-in
--     user read other people's queued mentions.
REVOKE ALL ON FUNCTION public.bp_notify_enabled(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_person_for_name(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_nudge() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_enqueue(text, uuid, text, uuid, uuid, uuid, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_assignment(uuid, text, uuid, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_notify_claim(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_trg_notify_mentions() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_trg_notify_task_assigned() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.bp_trg_notify_coassignee() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notify_claim(integer) TO service_role;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row. Triggers act on future writes only.
-- 2. It stores no key. The nudge is an unauthenticated empty POST by design.
-- 3. It does not resolve a ROLE to a person. useTaskOwnership does that for the
--    board; doing it here would be a guess with someone's inbox on the end.
-- 4. It does not retry. A 'failed' row has its reason in email_outbox.error;
--    a 'pending' row is waiting for the next nudge; a 'sending' row older than
--    a few minutes means the function died mid-send (check its logs).
