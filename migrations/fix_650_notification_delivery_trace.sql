-- ===========================================================================
-- fix-650 (P-203) — make notification delivery traceable
-- ===========================================================================
--
-- Brittani, 2026-09-09: *"it shows in my notification tab but not in the bell
-- or on the app."* Bobby, 2026-10-12: *"can you make it tracable so we know if
-- this issue occurs for anybody else?"*
--
-- Until now the database could say when something was READ but never whether
-- it ever APPEARED. Notifications are derived in the browser (fix-336's
-- `useBoardNotifications`), so the only witness to "it reached the bell" is
-- the browser. This file gives it somewhere to say so, and gives the server a
-- way to notice when it didn't.
--
-- A · `notification_deliveries` — a receipt, written by the client the FIRST
--     time an item enters the bell's unseen list (surface 'bell') and when a
--     desktop banner / ding fires for it (surface 'desktop'). Insert-only, one
--     row per (person, item, surface), through `bp_record_notification_deliveries`.
--
-- B · `user_presence` — one row per person: `last_active_at`, written at most
--     every 5 minutes while the Bridge is open AND VISIBLE, plus `active_since`
--     (the start of the current run of visible use).
--
--     ★ WHY NOT fix-589's heartbeat (`client_build_seen.last_seen_at`)? It is
--       the existing signal and §0.2 looked at it first. It cannot carry this:
--       it fires on a timer that keeps running in a hidden tab (so it means
--       "a window is open", not "somebody is looking"), and it is one row per
--       BUILD, so a deploy resets it. A gap must only ever be charged to a
--       person who was really there, and a hidden tab is not there.
--
-- C · `bp_notification_delivery_check()` — hourly, weekdays 7 AM–6 PM Pacific.
--     For each server-derivable notification (mentions and task assignments —
--     see `bp_notification_candidates`) more than an hour old, where the
--     recipient was visibly in the Bridge after it was created + 5 min, and
--     there is NO bell receipt and NO read → one `error_reports` row, source
--     `notification_delivery`, fingerprint per person + item, so it lands in
--     Error triage once and never again.
--
-- D · `bp_notification_delivery_report(p_days)` — the admin report: per person
--     notified · reached the bell · median time to bell · read · median time to
--     read · gaps (with the items).
--
-- ★★ NO EXISTING ROW CHANGES. Two new tables, one widened CHECK (a whole-list
--    rewrite that adds `notification_delivery`), new functions, one cron job.
--
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A · the receipts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid        NOT NULL,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ★ The bell's own key (`mention:<uuid>`, `task:<uuid>`, `flip:…`), exactly
  --   as board_item_reads stores it, so a receipt and a read join on it.
  item_key        text        NOT NULL CHECK (length(item_key) BETWEEN 1 AND 300),
  -- ★ NewItem.source — every kind the bell derives, not only the two the
  --   server can check. A receipt is evidence whatever the kind.
  kind            text        NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  surface         text        NOT NULL CHECK (surface IN ('bell', 'desktop')),
  first_at        timestamptz NOT NULL DEFAULT now(),
  -- ★ What the live socket said at that moment (stores/realtimeStore). A miss
  --   that only happens while degraded is a different bug from one that
  --   happens while live.
  realtime_status text        CHECK (realtime_status IS NULL OR length(realtime_status) <= 20),
  -- ★ lib/buildInfo.BUILD_SHA, so a miss can be pinned to a bundle.
  build           text        CHECK (build IS NULL OR length(build) <= 40),
  UNIQUE (user_id, item_key, surface)
);

DROP TRIGGER IF EXISTS notification_deliveries_default_tenant ON public.notification_deliveries;
CREATE TRIGGER notification_deliveries_default_tenant
  BEFORE INSERT ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

CREATE INDEX IF NOT EXISTS notification_deliveries_tenant_idx
  ON public.notification_deliveries (tenant_id, first_at DESC);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

-- ★ READ: your own receipts always; everybody's only as a tenant admin.
DROP POLICY IF EXISTS notification_deliveries_select ON public.notification_deliveries;
CREATE POLICY notification_deliveries_select ON public.notification_deliveries
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_tenant_admin(tenant_id)
  );

-- ★ INSERT: your own, in your own tenant. No UPDATE and no DELETE policy — a
--   receipt that can be edited or withdrawn is not evidence.
DROP POLICY IF EXISTS notification_deliveries_insert ON public.notification_deliveries;
CREATE POLICY notification_deliveries_insert ON public.notification_deliveries
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = ANY (public.auth_tenant_ids())
  );

-- ---------------------------------------------------------------------------
-- 2. B · presence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  -- ★★ The start of the current run of visible use. A write more than
  --    PRESENCE_SESSION_GAP (15 min, three missed 5-minute beats) after the last
  --    one starts a new run. The check needs it so that somebody who opened the
  --    app SECONDS ago — whose bell has not finished loading — is not charged
  --    with a miss: see bp_notification_delivery_gaps_for.
  active_since   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_presence_default_tenant ON public.user_presence;
CREATE TRIGGER user_presence_default_tenant
  BEFORE INSERT ON public.user_presence
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_presence_select ON public.user_presence;
CREATE POLICY user_presence_select ON public.user_presence
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_tenant_admin(tenant_id)
  );
-- ★ No write policies: the one writer is bp_touch_presence, pinned to auth.uid().

-- ---------------------------------------------------------------------------
-- 3. Error triage learns the new source (whole-list rewrite of the CHECK).
-- ---------------------------------------------------------------------------
ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_source_check;
ALTER TABLE public.error_reports ADD CONSTRAINT error_reports_source_check
  CHECK (source = ANY (ARRAY[
    'frontend_toast'::text, 'frontend_exception'::text, 'backend_rpc'::text,
    'scraper'::text, 'notification_delivery'::text
  ]));

-- ---------------------------------------------------------------------------
-- 4. The client writers
-- ---------------------------------------------------------------------------

-- ★ Batched: p_items is [{key, kind, surface}, …]. Duplicates are ignored, so
--   a client that re-sends after a lost response costs nothing. Returns how
--   many rows were new. Capped at 200 items per call.
CREATE OR REPLACE FUNCTION public.bp_record_notification_deliveries(
  p_items           jsonb,
  p_realtime_status text DEFAULT NULL,
  p_build           text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_n      integer;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  v_tenant := (public.auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN RETURN 0; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN 0; END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'bp_record_notification_deliveries: at most 200 items per call'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_deliveries
    (tenant_id, user_id, item_key, kind, surface, realtime_status, build)
  SELECT DISTINCT ON (x.key, x.surface)
         v_tenant, v_uid, x.key, x.kind, x.surface,
         left(p_realtime_status, 20), left(p_build, 40)
    FROM jsonb_to_recordset(p_items) AS x(key text, kind text, surface text)
   WHERE x.key IS NOT NULL AND length(x.key) BETWEEN 1 AND 300
     AND x.kind IS NOT NULL AND length(x.kind) BETWEEN 1 AND 40
     AND x.surface IN ('bell', 'desktop')
  ON CONFLICT (user_id, item_key, surface) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bp_touch_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  v_tenant := (public.auth_tenant_ids())[1];
  IF v_tenant IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_presence AS u (user_id, tenant_id, last_active_at, active_since)
  VALUES (v_uid, v_tenant, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    -- ★ PRESENCE_SESSION_GAP = 15 minutes.
    active_since   = CASE WHEN u.last_active_at < now() - interval '15 minutes'
                          THEN now() ELSE u.active_since END,
    last_active_at = now(),
    tenant_id      = EXCLUDED.tenant_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. §0.1 — what the server can derive, for a named person
-- ---------------------------------------------------------------------------
--
-- ★★ TWO KINDS, AND ONLY TWO, mirror the bell's own rules (lib/boardReads
--    buildNewItems, sources 2 and 5):
--
--   mention  `mention:<message id>`: project_messages.mentions holds AUTH IDS,
--            not deleted, after the fix-307 epoch. Exactly the bell's query.
--   task     `task:<task id>`: a permit task (active project) or team task,
--            created after the epoch, whose assigned_to or a co-assignee is a
--            roster name that resolves to ONE login (fix-634's
--            bp_notify_person_for_name; a role or an ambiguous name → nobody).
--
--   The other eight kinds are not checked, and say why in the README of this
--   ticket: flips go through the client's parseFlips suppression; reactions
--   carry a moving watermark key; conditions key on first_seen; handoff /
--   permit / auto_closed route by name through rules that live client-side;
--   post requests are SHARED and have no read rows at all. Their receipts are
--   still recorded.
CREATE OR REPLACE FUNCTION public.bp_notification_candidates(
  p_tenants uuid[],
  p_since   timestamptz
)
RETURNS TABLE (
  tenant_id  uuid,
  user_id    uuid,
  item_key   text,
  kind       text,
  created_at timestamptz,
  project_id uuid,
  permit_id  integer,
  address    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH since AS (
    -- ★ fix-307's BOARD_NOTIFICATIONS_EPOCH: nothing older is ever news.
    SELECT greatest(p_since, '2026-08-14T00:00:00Z'::timestamptz) AS t
  ),
  raw AS (
    SELECT m.tenant_id, u.uid AS user_id, 'mention:' || m.id::text AS item_key,
           'mention'::text AS kind, m.created_at, m.project_id,
           NULL::integer AS permit_id, pr.address
      FROM public.project_messages m
      CROSS JOIN since
      CROSS JOIN LATERAL unnest(m.mentions) AS u(uid)
      LEFT JOIN public.projects pr ON pr.id = m.project_id
     WHERE m.tenant_id = ANY (p_tenants)
       AND m.deleted_at IS NULL
       AND m.created_at > since.t

    UNION ALL

    SELECT t.tenant_id, who.user_id, 'task:' || t.id::text, 'task',
           t.created_at, p.project_id, t.permit_id, pr.address
      FROM public.permit_tasks t
      JOIN public.permits p ON p.id = t.permit_id
      JOIN public.active_projects pr ON pr.id = p.project_id
      CROSS JOIN since
      CROSS JOIN LATERAL (
        SELECT t.assigned_to AS nm
        UNION
        SELECT a.assignee FROM public.permit_task_assignees a WHERE a.task_id = t.id
      ) names
      CROSS JOIN LATERAL public.bp_notify_person_for_name(t.tenant_id, names.nm) who
     WHERE t.tenant_id = ANY (p_tenants)
       AND t.created_at > since.t

    UNION ALL

    SELECT tt.tenant_id, who.user_id, 'task:' || tt.id::text, 'task',
           tt.created_at, NULL::uuid, NULL::integer, NULL::text
      FROM public.team_tasks tt
      CROSS JOIN since
      CROSS JOIN LATERAL public.bp_notify_person_for_name(tt.tenant_id, tt.assigned_to) who
     WHERE tt.tenant_id = ANY (p_tenants)
       AND tt.created_at > since.t
  )
  SELECT DISTINCT ON (r.user_id, r.item_key)
         r.tenant_id, r.user_id, r.item_key, r.kind, r.created_at,
         r.project_id, r.permit_id, r.address
    FROM raw r
    JOIN public.profiles pf ON pf.id = r.user_id AND COALESCE(pf.active, true)
   ORDER BY r.user_id, r.item_key;
$function$;

-- ---------------------------------------------------------------------------
-- 6. C · the gap rule (one definition; the check and the admin read share it)
-- ---------------------------------------------------------------------------
--
-- A gap is a candidate that is:
--   • more than 1 hour old,
--   • unread (no board_item_reads row for that key),
--   • with no 'bell' receipt,
--   • for a person who was VISIBLY in the Bridge at some moment between
--     created_at + 5 min and now − 2 min.
--
-- ★★ THE LAST CONDITION, IN DETAIL. user_presence holds one run of visible use,
--    [active_since, last_active_at]. That run meets the window
--    [created + 5 min, now − 2 min] exactly when last_active_at ≥ created + 5 min
--    AND active_since ≤ now − 2 min. The −2 min is what stops a false alarm for
--    somebody who opened the app seconds before the check ran and whose bell
--    is still loading. An earlier run that is no longer recorded can only make
--    the check LATE (it catches the gap on a later hour), never wrong.
CREATE OR REPLACE FUNCTION public.bp_notification_delivery_gaps_for(
  p_tenants uuid[],
  p_since   timestamptz,
  p_now     timestamptz DEFAULT now()
)
RETURNS TABLE (
  tenant_id      uuid,
  user_id        uuid,
  person         text,
  email          text,
  item_key       text,
  kind           text,
  created_at     timestamptz,
  project_id     uuid,
  permit_id      integer,
  address        text,
  last_active_at timestamptz,
  active_since   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.tenant_id, c.user_id,
         COALESCE(nm.name, pf.email, c.user_id::text) AS person,
         pf.email,
         c.item_key, c.kind, c.created_at, c.project_id, c.permit_id, c.address,
         up.last_active_at, up.active_since
    FROM public.bp_notification_candidates(p_tenants, p_since) c
    JOIN public.user_presence up ON up.user_id = c.user_id
    JOIN public.profiles pf ON pf.id = c.user_id
    LEFT JOIN LATERAL (
      -- ★ fix-330: profiles.name is NULL for every login; the roster has it.
      SELECT tm.name
        FROM public.team_members tm
       WHERE tm.tenant_id = c.tenant_id
         AND lower(btrim(tm.email)) = lower(btrim(pf.email))
       ORDER BY tm.active DESC, COALESCE(tm.former, false), tm.name
       LIMIT 1
    ) nm ON true
   WHERE c.created_at <= p_now - interval '1 hour'
     AND up.last_active_at >= c.created_at + interval '5 minutes'
     AND up.active_since   <= p_now - interval '2 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM public.board_item_reads r
        WHERE r.user_id = c.user_id AND r.item_key = c.item_key
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.notification_deliveries d
        WHERE d.user_id = c.user_id AND d.item_key = c.item_key
          AND d.surface = 'bell'
     );
$function$;

-- ★ The brief's name, for an admin: the same rule over the caller's tenant.
CREATE OR REPLACE FUNCTION public.bp_notification_delivery_gaps(
  p_since timestamptz DEFAULT now() - interval '7 days'
)
RETURNS TABLE (
  tenant_id      uuid,
  user_id        uuid,
  person         text,
  email          text,
  item_key       text,
  kind           text,
  created_at     timestamptz,
  project_id     uuid,
  permit_id      integer,
  address        text,
  last_active_at timestamptz,
  active_since   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
BEGIN
  IF v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'bp_notification_delivery_gaps: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.bp_notification_delivery_gaps_for(ARRAY[v_tenant], p_since, now());
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. C · the hourly check → Error triage
-- ---------------------------------------------------------------------------
--
-- ★ One error_reports row per NEW gap. The fingerprint is
--   `notification_delivery:<user id>:<item key>`; a fingerprint that already
--   exists (whatever its status — resolved and dismissed included) is never
--   written again, so a gap is reported exactly once.
-- ★ Looks back 4 days, so a Friday-evening item is still checked on Monday.
-- ★ `p_force` skips the weekday / 7 AM–6 PM Pacific gate (manual runs).
CREATE OR REPLACE FUNCTION public.bp_notification_delivery_check(p_force boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_local   timestamp := now() AT TIME ZONE 'America/Los_Angeles';
  v_tenants uuid[];
  v_n       integer;
BEGIN
  IF NOT p_force THEN
    IF extract(isodow FROM v_local) >= 6 THEN RETURN 0; END IF;
    IF extract(hour FROM v_local) < 7 OR extract(hour FROM v_local) > 18 THEN
      RETURN 0;
    END IF;
  END IF;

  -- ★ Two overlapping runs (a slow hour, a manual run) must not double-file.
  PERFORM pg_advisory_xact_lock(hashtext('bp_notification_delivery_check'));

  SELECT array_agg(t.id) INTO v_tenants FROM public.tenants t;
  IF v_tenants IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.error_reports
    (tenant_id, user_id, user_email, source, level, message, fingerprint, context, status)
  SELECT g.tenant_id,
         g.user_id,
         g.email,
         'notification_delivery',
         'warning',
         format(
           '%s''s bell never showed a %s%s (%s). They were in the Bridge afterwards and it is still unread.',
           g.person,
           CASE g.kind WHEN 'mention' THEN 'mention' ELSE 'task assignment' END,
           CASE WHEN g.address IS NOT NULL THEN ' on ' || g.address ELSE '' END,
           to_char(g.created_at AT TIME ZONE 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM')
         ),
         'notification_delivery:' || g.user_id::text || ':' || g.item_key,
         jsonb_build_object(
           'recipient_user_id', g.user_id,
           'recipient',         g.person,
           'item_key',          g.item_key,
           'kind',              g.kind,
           'item_created_at',   g.created_at,
           'project_id',        g.project_id,
           'permit_id',         g.permit_id,
           'address',           g.address,
           'last_active_at',    g.last_active_at,
           'active_since',      g.active_since
         ),
         'new'
    FROM public.bp_notification_delivery_gaps_for(v_tenants, now() - interval '4 days', now()) g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.error_reports e
      WHERE e.tenant_id = g.tenant_id
        AND e.fingerprint = 'notification_delivery:' || g.user_id::text || ':' || g.item_key
   );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. D · the admin report
-- ---------------------------------------------------------------------------
--
-- ★★ THE WINDOW STARTS AT THE FIRST RECEIPT EVER WRITTEN, not 30 days back,
--    until 30 days have passed. Before that moment no bell could write a
--    receipt, so an older item would read as "never reached the bell" when the
--    truth is "nothing was listening". `delivery_epoch` is returned so the page
--    can say so.
-- ★ Times are minutes from the item's creation. They include time the person
--   simply wasn't in the app — time to bell measures delivery AND absence.
CREATE OR REPLACE FUNCTION public.bp_notification_delivery_report(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_epoch  timestamptz;
  v_from   timestamptz;
  v_rows   jsonb;
BEGIN
  IF v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'bp_notification_delivery_report: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT min(d.first_at) INTO v_epoch
    FROM public.notification_deliveries d WHERE d.tenant_id = v_tenant;
  v_from := greatest(now() - make_interval(days => greatest(COALESCE(p_days, 30), 1)),
                     COALESCE(v_epoch, now()));

  WITH c AS (
    SELECT * FROM public.bp_notification_candidates(ARRAY[v_tenant], v_from)
  ),
  per_item AS (
    SELECT c.user_id, c.item_key, c.created_at,
           b.first_at AS bell_at,
           r.read_at
      FROM c
      LEFT JOIN public.notification_deliveries b
        ON b.user_id = c.user_id AND b.item_key = c.item_key AND b.surface = 'bell'
      LEFT JOIN LATERAL (
        SELECT min(x.read_at) AS read_at FROM public.board_item_reads x
         WHERE x.user_id = c.user_id AND x.item_key = c.item_key
      ) r ON true
  ),
  per_user AS (
    SELECT p.user_id,
           count(*)::int                                  AS notified,
           count(p.bell_at)::int                          AS reached_bell,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY
             greatest(extract(epoch FROM p.bell_at - p.created_at), 0) / 60.0)
             FILTER (WHERE p.bell_at IS NOT NULL)          AS median_bell_min,
           count(p.read_at)::int                          AS read,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY
             greatest(extract(epoch FROM p.read_at - p.created_at), 0) / 60.0)
             FILTER (WHERE p.read_at IS NOT NULL)          AS median_read_min
      FROM per_item p
     GROUP BY p.user_id
  ),
  gaps AS (
    SELECT e.user_id,
           count(*)::int AS gap_count,
           jsonb_agg(jsonb_build_object(
             'id',         e.id,
             'flagged_at', e.created_at,
             'status',     e.status,
             'item_key',   e.context->>'item_key',
             'kind',       e.context->>'kind',
             'created_at', e.context->>'item_created_at',
             'address',    e.context->>'address',
             'project_id', e.context->>'project_id',
             'permit_id',  e.context->>'permit_id',
             'message',    e.message
           ) ORDER BY e.created_at DESC) AS items
      FROM public.error_reports e
     WHERE e.tenant_id = v_tenant
       AND e.source = 'notification_delivery'
       AND e.created_at >= v_from
     GROUP BY e.user_id
  ),
  people AS (
    SELECT user_id FROM per_user
    UNION
    SELECT user_id FROM gaps WHERE user_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id',         pp.user_id,
           'person',          COALESCE(nm.name, pf.email, pp.user_id::text),
           'notified',        COALESCE(u.notified, 0),
           'reached_bell',    COALESCE(u.reached_bell, 0),
           'median_bell_min', u.median_bell_min,
           'read',            COALESCE(u.read, 0),
           'median_read_min', u.median_read_min,
           'gaps',            COALESCE(g.gap_count, 0),
           'gap_items',       COALESCE(g.items, '[]'::jsonb),
           'last_active_at',  up.last_active_at
         ) ORDER BY COALESCE(g.gap_count, 0) DESC,
                    COALESCE(nm.name, pf.email, pp.user_id::text)), '[]'::jsonb)
    INTO v_rows
    FROM people pp
    LEFT JOIN per_user u ON u.user_id = pp.user_id
    LEFT JOIN gaps g ON g.user_id = pp.user_id
    LEFT JOIN public.profiles pf ON pf.id = pp.user_id
    LEFT JOIN public.user_presence up ON up.user_id = pp.user_id
    LEFT JOIN LATERAL (
      SELECT tm.name FROM public.team_members tm
       WHERE tm.tenant_id = v_tenant
         AND lower(btrim(tm.email)) = lower(btrim(pf.email))
       ORDER BY tm.active DESC, COALESCE(tm.former, false), tm.name
       LIMIT 1
    ) nm ON true;

  RETURN jsonb_build_object(
    'from',           v_from,
    'days',           greatest(COALESCE(p_days, 30), 1),
    'delivery_epoch', v_epoch,
    'rows',           v_rows
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Grants — fix-157 / fix-273 posture. ★ The Supabase default-privileges
--    trap: a new table hands `authenticated` every write grant unless revoked.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.notification_deliveries TO authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;

REVOKE ALL ON TABLE public.user_presence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_presence TO authenticated;
GRANT ALL ON TABLE public.user_presence TO service_role;

REVOKE ALL ON FUNCTION public.bp_record_notification_deliveries(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_record_notification_deliveries(jsonb, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_touch_presence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_touch_presence() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bp_notification_candidates(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notification_candidates(uuid[], timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.bp_notification_delivery_gaps_for(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notification_delivery_gaps_for(uuid[], timestamptz, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.bp_notification_delivery_check(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_notification_delivery_check(boolean) TO service_role;

REVOKE ALL ON FUNCTION public.bp_notification_delivery_gaps(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_notification_delivery_gaps(timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bp_notification_delivery_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_notification_delivery_report(integer) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 10. The schedule. Hourly at :05; the function's own gate keeps it to
--     weekdays 7 AM–6 PM Pacific whatever DST says.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'bp-notification-delivery-check',
  '5 * * * *',
  $$SELECT public.bp_notification_delivery_check()$$
);

-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ===========================================================================
-- 1. It changes no existing row.
-- 2. It sends no email. A gap reaches an admin through Error triage only.
-- 3. It checks two kinds (mention, task); the other eight are receipted but
--    not checked — see section 5.
-- 4. It keeps no history of presence: one row per person, latest run only.
