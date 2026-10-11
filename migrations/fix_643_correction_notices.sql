-- ===========================================================================
-- fix-643 (P-338) — when corrections come out, the Bridge tags the team
-- ===========================================================================
--
-- ⚖️ Bobby, 2026-10-11: "when the bridge creates a correction cycle post, can
-- it tag the DM, DA, ENT, Dave, Lucas, Gena, Brit, Bobby each time, so they
-- know corrections are out?"
--
-- His case, 26 110231 BS: the city issued CR3 corrections 9/10, the Bridge
-- opened the `CR 3` thread 9/11, and the team's first notice was Miles's post
-- on 9/14. The Bridge knew three days earlier and told nobody.
--
-- ★★★ ON THE SAME TRIGGER POINT AS THE THREAD. `bp_trg_cycle_cr_thread` already
--     fires when a Building Permit's cycle N >= 1 gets `corr_issued`. After
--     `bp_ensure_cr_thread`, it now calls `bp_post_cr_notice`, which replies in
--     the `CR N` thread (author NULL — "The Bridge") with
--       "Corrections are out — <num> (<type>), round N. The city issued them <Mon D>."
--       "@<DM> @<DA> @<ENT> @Corrections"
--     and `mentions` = those people's resolved ids ∪ the Corrections tag's
--     members, with duplicates removed. Two building permits on one project
--     reaching the same round: one thread, one reply per permit.
--
-- ★★★ THE FIXED HALF IS THE `Corrections` TAG, NOT NAMES IN CODE. Admins edit
--     its members in Settings; this reads them at the moment of posting. If the
--     tag is renamed or deleted, the notice still posts, tags the permit's
--     people, and RAISEs a WARNING naming what it could not tag.
--
-- ★★★ EXACTLY ONCE PER PERMIT PER ROUND: `cr_notices` (PK permit_id,
--     cycle_index). A re-scrape, a date correction or a human edit of
--     `corr_issued` finds the ledger row and posts nothing.
--
-- ★★★ FRESHNESS: only when `corr_issued` is within the last 14 days (Pacific)
--     and not in the future. Measured on prod 2026-10-11 from audit_log (capture
--     began 09-29): of 170 Building Permit `corr_issued` writes, every fresh one
--     (13) landed within 3 days of the date, NONE between 4 and 14 days, and the
--     other 140 were backfills 15+ days old (136 of them 90+). 14 days keeps the
--     brief's number with a wide margin over the observed lag and still refuses
--     every backfill seen.
--
-- ★★★ EMAILS FOR BRIDGE NOTICES ONLY. `bp_trg_notify_mentions` returned early
--     for every NULL-author row. It still does — unless the row is a ledgered
--     notice (`bp_cr_notice_payload` is not NULL). Imported history and seeds
--     stay silent. A notice's queue rows are ordinary `notify:mention` rows (so
--     the mention opt-out applies at queue time AND again at claim time, and the
--     dedupe key gives one email per address) carrying a payload
--     {notice:'corrections', …}, from which notify-send renders
--     "Corrections are out · <address> · CR N", signed "The Bridge".
--
-- ★★ THE AUTHOR TRIGGER WOULD HAVE SIGNED IT. `bp_trg_project_message_author`
--    fills a NULL author_id with auth.uid() — so when a person (not the
--    scraper) saves the corrections date, the Bridge's notice would carry THEIR
--    name and be emailed "from" them. It now leaves a ledgered notice NULL. The
--    ledger row is written first, with the message id the reply will use, which
--    is why `cr_notices.message_id` is a DEFERRED foreign key.
--
-- ★★ A NOTICE PROBLEM NEVER BLOCKS THE SCRAPER'S WRITE: the call is wrapped in
--    BEGIN … EXCEPTION … RAISE WARNING, the way fix-634 wraps its queueing.
--
-- ★ The project-creation `CR 1` seed (`bp_seed_project_posts`) is untouched: no
--   tags, no email. The first real CR 1 corrections post their own reply.
--
-- Live definitions read 2026-10-11 and used verbatim as the base for the three
-- replaced functions (`migrations/` is partial; prod is the source of truth).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cr_notices (
  permit_id   integer     NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  cycle_index integer     NOT NULL CHECK (cycle_index >= 1),
  tenant_id   uuid        NOT NULL,
  project_id  uuid        NOT NULL,
  message_id  uuid        UNIQUE
              REFERENCES public.project_messages(id) ON DELETE SET NULL
              DEFERRABLE INITIALLY DEFERRED,
  corr_issued date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (permit_id, cycle_index)
);

COMMENT ON TABLE public.cr_notices IS
  'fix-643 (P-338): one row per permit per correction round the Bridge has '
  'announced. Its existence is what stops a re-scrape or a date edit posting '
  'again, and its message_id is what marks a NULL-author message as a notice '
  'that may email.';

ALTER TABLE public.cr_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cr_notices_tenant_read ON public.cr_notices;
CREATE POLICY cr_notices_tenant_read ON public.cr_notices
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

REVOKE ALL ON public.cr_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cr_notices TO authenticated;
GRANT ALL ON public.cr_notices TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Is this message a Bridge notice? (the marker both triggers read)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_cr_notice_payload(p_message_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
           'notice', 'corrections',
           'round', n.cycle_index,
           'permit_num', p.num,
           'permit_type', p.type,
           'corr_issued', n.corr_issued)
    FROM public.cr_notices n
    JOIN public.permits p ON p.id = n.permit_id
   WHERE p_message_id IS NOT NULL
     AND n.message_id = p_message_id;
$function$;

-- ★ A yes/no for the author trigger, which runs as the person posting: it
--   reveals only whether a message id is a notice, never what it says.
CREATE OR REPLACE FUNCTION public.bp_is_cr_notice(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_message_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cr_notices n WHERE n.message_id = p_message_id);
$function$;

-- ---------------------------------------------------------------------------
-- 3. The notice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_post_cr_notice(
  p_permit_id   integer,
  p_cycle_index integer,
  p_corr_issued date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today   date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_tenant  uuid;
  v_project uuid;
  v_num     text;
  v_type    text;
  v_dm      text;
  v_da      text;
  v_ent     text;
  v_thread  uuid;
  v_msg     uuid := gen_random_uuid();
  v_got     uuid;
  v_role    record;
  v_uid     uuid;
  v_token   text;
  v_tag_id  uuid;
  v_tag     text;
  v_ids     uuid[] := '{}';
  v_tokens  text[] := '{}';
  v_missing text[] := '{}';
  v_body    text;
BEGIN
  IF p_permit_id IS NULL OR p_cycle_index IS NULL OR p_cycle_index < 1
     OR p_corr_issued IS NULL THEN
    RETURN NULL;
  END IF;

  -- ★★★ Freshness: news, not history (see the header for the measurement).
  IF p_corr_issued < v_today - 14 OR p_corr_issued > v_today THEN
    RETURN NULL;
  END IF;

  SELECT p.tenant_id, p.project_id, p.num, p.type, p.dm, p.da, p.ent_lead
    INTO v_tenant, v_project, v_num, v_type, v_dm, v_da, v_ent
    FROM public.permits p
   WHERE p.id = p_permit_id;

  IF v_project IS NULL OR v_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_type IS DISTINCT FROM 'Building Permit' THEN
    RETURN NULL;
  END IF;

  -- The same lookup bp_ensure_cr_thread uses to decide the thread exists.
  SELECT m.id INTO v_thread
    FROM public.project_messages m
   WHERE m.project_id = v_project
     AND m.parent_message_id IS NULL
     AND m.title = 'CR ' || p_cycle_index
   ORDER BY m.created_at, m.id
   LIMIT 1;
  IF v_thread IS NULL THEN
    RETURN NULL;
  END IF;

  -- ★★★ Exactly once per permit per round. Written BEFORE the reply, carrying
  --     the reply's id, so both triggers on project_messages can see it.
  INSERT INTO public.cr_notices
    (permit_id, cycle_index, tenant_id, project_id, message_id, corr_issued)
  VALUES
    (p_permit_id, p_cycle_index, v_tenant, v_project, v_msg, p_corr_issued)
  ON CONFLICT (permit_id, cycle_index) DO NOTHING
  RETURNING message_id INTO v_got;
  IF v_got IS NULL THEN
    RETURN NULL;
  END IF;

  -- The permit's people, resolved the way fix-634 resolves assignees: exactly
  -- one active login for the roster name, otherwise nobody (and a warning).
  FOR v_role IN
    SELECT * FROM (VALUES (1, 'DM', v_dm), (2, 'DA', v_da), (3, 'ENT', v_ent))
      AS s(ord, role, name)
    ORDER BY ord
  LOOP
    CONTINUE WHEN NULLIF(btrim(COALESCE(v_role.name, '')), '') IS NULL;
    v_uid := NULL;
    SELECT x.user_id INTO v_uid
      FROM public.bp_notify_person_for_name(v_tenant, v_role.name) x;
    IF v_uid IS NULL THEN
      v_missing := v_missing || (v_role.role || ' ' || btrim(v_role.name));
      CONTINUE;
    END IF;
    CONTINUE WHEN v_uid = ANY (v_ids);

    -- ★ The chip's text: the same name bp_mentionable_people shows for this
    --   login (bp_profile_display_name), computed for the permit's tenant
    --   because a trigger has no auth session.
    SELECT COALESCE(
             NULLIF(btrim(pr.name), ''),
             NULLIF(btrim(pr.full_name), ''),
             (SELECT NULLIF(btrim(tm.name), '')
                FROM public.team_members tm
               WHERE tm.tenant_id = v_tenant
                 AND tm.email IS NOT NULL
                 AND lower(btrim(tm.email)) = lower(btrim(pr.email))
                 AND NULLIF(btrim(tm.name), '') IS NOT NULL
               ORDER BY (tm.active IS NOT FALSE AND tm.former IS NOT TRUE) DESC, tm.name
               LIMIT 1))
      INTO v_token
      FROM public.profiles pr
     WHERE pr.id = v_uid;

    v_ids := v_ids || v_uid;
    IF v_token IS NOT NULL AND NOT (('@' || v_token) = ANY (v_tokens)) THEN
      v_tokens := v_tokens || ('@' || v_token);
    END IF;
  END LOOP;

  -- The Corrections tag: its members as they stand right now.
  SELECT t.id, t.name INTO v_tag_id, v_tag
    FROM public.mention_tags t
   WHERE t.tenant_id = v_tenant
     AND lower(btrim(t.name)) = 'corrections'
   ORDER BY t.created_at, t.id
   LIMIT 1;
  IF v_tag_id IS NULL THEN
    v_missing := v_missing || 'the Corrections tag'::text;
  ELSE
    v_ids := ARRAY(
      SELECT DISTINCT u FROM (
        SELECT unnest(v_ids) AS u
        UNION
        SELECT mm.user_id
          FROM public.mention_tag_members mm
          JOIN public.profiles pr ON pr.id = mm.user_id
         WHERE mm.tag_id = v_tag_id
           AND COALESCE(pr.active, true)
      ) s
    );
    v_tokens := v_tokens || ('@' || btrim(v_tag));
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE WARNING 'fix-643: corrections notice for permit % round % could not tag: %',
      COALESCE(v_num, p_permit_id::text), p_cycle_index, array_to_string(v_missing, ', ');
  END IF;

  v_body := 'Corrections are out — '
         || COALESCE(NULLIF(btrim(v_num), ''), 'this permit')
         || ' (' || v_type || '), round ' || p_cycle_index
         || '. The city issued them ' || to_char(p_corr_issued, 'FMMon FMDD') || '.';
  IF cardinality(v_tokens) > 0 THEN
    v_body := v_body || chr(10) || array_to_string(v_tokens, ' ');
  END IF;

  INSERT INTO public.project_messages
    (id, tenant_id, project_id, author_id, title, body, parent_message_id, mentions, created_at)
  VALUES
    (v_msg, v_tenant, v_project, NULL::uuid, NULL, v_body, v_thread, v_ids, now());

  RETURN v_msg;
END;
$function$;

COMMENT ON FUNCTION public.bp_post_cr_notice(integer, integer, date) IS
  'fix-643 (P-338): the Bridge''s "Corrections are out" reply in the CR N thread, '
  'tagging the permit''s DM/DA/ENT and the Corrections tag. Building Permits, '
  'round >= 1, corr_issued within 14 days, once per permit per round (cr_notices).';

-- ---------------------------------------------------------------------------
-- 4. The thread trigger calls it (live body + the wrapped call)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_cycle_cr_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project uuid;
  v_type    text;
BEGIN
  -- Cycle 0 is the design / initial submittal - never a correction round.
  IF NEW.cycle_index IS NULL OR NEW.cycle_index < 1 THEN
    RETURN NULL;
  END IF;

  SELECT p.project_id, p.type INTO v_project, v_type
  FROM public.permits p WHERE p.id = NEW.permit_id;

  IF v_project IS NULL THEN
    RETURN NULL;
  END IF;

  -- Bobby, verbatim: "yes, but only for a building permit CR 2 etc."
  IF v_type IS DISTINCT FROM 'Building Permit' THEN
    RETURN NULL;
  END IF;

  PERFORM public.bp_ensure_cr_thread(v_project, NEW.cycle_index);

  -- ★★ fix-643: tell the team. A notice problem must never block this write.
  BEGIN
    PERFORM public.bp_post_cr_notice(NEW.permit_id, NEW.cycle_index, NEW.corr_issued);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix-643: could not post the corrections notice for permit % round %: %',
      NEW.permit_id, NEW.cycle_index, SQLERRM;
  END;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The author trigger leaves a notice authorless
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_project_message_author()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- ★★ fix-643: a Bridge notice stays "The Bridge" even when a person's save
  --    set off the trigger that wrote it.
  IF NEW.author_id IS NULL AND NOT public.bp_is_cr_notice(NEW.id) THEN
    SELECT p.id INTO NEW.author_id
    FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- 6. Mention emails: Bridge notices may email; every other authorless row
--    stays silent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bp_trg_notify_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new    uuid[];
  r        record;
  v_notice jsonb;
  v_email  text;
  v_queued boolean := false;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  -- ★★★ fix-643: an authorless message emails only when it is a ledgered
  --     Bridge notice. Imported history and seeds stay silent, as before.
  IF NEW.author_id IS NULL THEN
    v_notice := public.bp_cr_notice_payload(NEW.id);
    IF v_notice IS NULL THEN RETURN NULL; END IF;
  END IF;
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
      IF v_notice IS NULL THEN
        PERFORM public.bp_notify_enqueue('notify:mention', r.id, r.email,
          NEW.author_id, NEW.project_id, NEW.id, NULL, NULL);
      ELSE
        -- ★ fix-643: the same row bp_notify_enqueue writes (mention opt-out,
        --   one per address via the dedupe key) plus the notice payload.
        v_email := lower(btrim(r.email));
        IF public.bp_notify_enabled(r.id, 'mention') THEN
          INSERT INTO public.notification_email_queue
            (kind, recipient_user_id, to_email, actor_user_id, project_id,
             message_id, task_id, task_source, dedupe_key, payload)
          VALUES
            ('notify:mention', r.id, v_email, NULL, NEW.project_id,
             NEW.id, NULL, NULL,
             'notify:mention:' || v_email || ':' || NEW.id::text, v_notice)
          ON CONFLICT (dedupe_key) DO NOTHING;
          IF FOUND THEN v_queued := true; END IF;
        END IF;
      END IF;
    END LOOP;
    IF v_queued THEN
      PERFORM public.bp_notify_nudge();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix-634: could not queue mention emails for message %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bp_post_cr_notice(integer, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_post_cr_notice(integer, integer, date) TO service_role;
REVOKE ALL ON FUNCTION public.bp_cr_notice_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_cr_notice_payload(uuid) TO service_role;
-- ★★ authenticated MUST keep this one: the author trigger runs as the person
--    posting, so without it every chat post would fail.
REVOKE ALL ON FUNCTION public.bp_is_cr_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_is_cr_notice(uuid) TO authenticated, service_role;

COMMIT;

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row. It adds one empty table and replaces
--    functions; no notice is back-posted for past rounds.
-- 2. It does not touch bp_seed_project_posts or bp_ensure_cr_thread: the
--    project-creation CR 1 seed tags nobody and emails nobody.
-- 3. It does not hard-code anyone: the fixed half is the Corrections tag.
-- 4. It does not change how any human-authored message emails.
