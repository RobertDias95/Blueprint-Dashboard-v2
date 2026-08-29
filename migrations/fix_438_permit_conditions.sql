-- ===========================================================================
-- ★★★ fix-438 — A STANDING CONDITION IS ONE SELF-CLEARING ROW
-- ===========================================================================
--
-- Ruling, Bobby 2026-08-29 (D-2026-08-29-a-standing-condition-is-one-self-
-- clearing-row): a condition — "this permit has sat N days in corrections with
-- no upload", "the city's date disagrees with the stored one" — is ONE ROW PER
-- PERMIT PER CONDITION, updated each run rather than repeated. It CLEARS
-- ITSELF when the condition ends. It surfaces as a notification to that
-- permit's ENT lead, who can ACKNOWLEDGE it. There is no Resolve on a
-- condition. Error Triage keeps Bridge errors only.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS MEASURED, 2026-08-29, BEFORE ANYTHING WAS WRITTEN
-- ---------------------------------------------------------------------------
--
--   error_reports, all time:   229 scraper rows (173 open, 56 resolved)
--                               90 backend_rpc rows (6 open)
--
--   So 96% of the open triage panel is not what the panel is for. And the
--   split inside those 173 IS the design:
--
--     89 rows  fingerprint 0c7f30f6…  moduleName_parse_failed, seattle/landuse
--              — and 89 DISTINCT permit_ids. Once each. A transient degraded
--                page that retried: audit_log holds 1,422
--                scrape_workflow_fetch_recovered rows in the same window.
--     59 rows  the same thing on seattle/bp — 59 distinct permits, once each.
--     25 rows  mbp_resubmittal "stuck in corrections, no upload" — THREE
--              distinct permits, written again on every run. Edmonds permit
--              198 alone accounts for most of them, 2026-08-20 → 2026-08-29.
--
-- ★★★ THE DIVIDING LINE IS THE KIND, NOT WHETHER A PERMIT IS NAMED. The 89
-- transient rows name a permit each and are still machine housekeeping that
-- fixed itself. The 25 resubmittal rows are three standing facts about three
-- permits, repeated 25 times. Housekeeping never reaches a person; a condition
-- becomes ONE row that maintains itself.
--
-- ★★ AND THE PANEL LIES ABOUT IT TODAY. bp_list_error_groups takes its sample
-- from the NEWEST row, so that group reads "89 occurrences, permit 3044101-LU"
-- when it is 89 permits once each. Bobby would go and investigate one permit
-- that was never the problem. Section C fixes the display, not the data.
--
-- ---------------------------------------------------------------------------
-- ★★★ NOTHING IN HERE IS APPLIED BY THE PR. This file is written by fix-438
-- and applied through the Supabase MCP `apply_migration` after the merge —
-- never the SQL editor (standing rule: migrations/ is partial and prod is
-- ahead, so every CREATE OR REPLACE below was written against the LIVE
-- pg_get_functiondef, quoted where it matters).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A1. The table
-- ---------------------------------------------------------------------------
--
-- ★★★ THE UNIQUE KEY IS THE WHOLE MODEL. (tenant_id, permit_id, kind,
-- cond_key) is what makes "one row per permit per condition" a property of the
-- database rather than a promise the writer has to keep. `cond_key` is the
-- disambiguator INSIDE a kind — a cycle index for a resubmittal, a field name
-- for a disagreement — and defaults to '' rather than NULL because NULL is not
-- equal to itself in a unique index and the whole guarantee would evaporate
-- for every row that did not need one.
--
-- ★★ `kind` IS NAMESPACED BY ITS SOURCE: 'scraper:mbp_resubmittal',
-- 'scraper:cycle_disagreement'. That is not decoration. bp_sync_permit_
-- conditions clears by SET DIFFERENCE, so a source that could see another
-- source's rows would clear them; the prefix makes ownership structural and
-- checkable in one LIKE, with no registry table to keep in step.
CREATE TABLE IF NOT EXISTS public.permit_conditions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  permit_id     integer NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  cond_key      text NOT NULL DEFAULT '',
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  seen_count    integer NOT NULL DEFAULT 1,
  -- ★ NULL means OPEN. One nullable timestamp rather than a status column:
  --   there are exactly two states and a CHECK-constrained enum would invite a
  --   third that nothing clears.
  cleared_at    timestamptz,
  cleared_reason text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_detail_hash text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permit_conditions_kind_namespaced CHECK (position(':' in kind) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS permit_conditions_unique_condition
  ON public.permit_conditions (tenant_id, permit_id, kind, cond_key);

-- The Bridge's read: every OPEN row, newest first.
CREATE INDEX IF NOT EXISTS permit_conditions_open
  ON public.permit_conditions (tenant_id, last_seen_at DESC)
  WHERE cleared_at IS NULL;

-- The sync's set-difference scan: one permit, one source's kinds.
CREATE INDEX IF NOT EXISTS permit_conditions_permit_kind
  ON public.permit_conditions (permit_id, kind)
  WHERE cleared_at IS NULL;

COMMENT ON TABLE public.permit_conditions IS
  'fix-438: standing conditions on a permit. One row per (permit, kind, cond_key), '
  'updated each run and self-clearing via bp_sync_permit_conditions''s set difference. '
  'Never an event log — see audit_log for those.';

-- ---------------------------------------------------------------------------
-- A1b. RLS + grants — the permit_task_audit model (fix-272), copied on purpose
-- ---------------------------------------------------------------------------
--
-- ★ Name `authenticated` EXPLICITLY in the REVOKE. A bare
--   `REVOKE ALL FROM PUBLIC, anon` leaves the ALTER DEFAULT PRIVILEGES grant in
--   place — the fix-265 lesson, and exactly what left draw_schedule_audit
--   truncatable.
ALTER TABLE public.permit_conditions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permit_conditions_tenant_select ON public.permit_conditions;
CREATE POLICY permit_conditions_tenant_select ON public.permit_conditions
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS permit_conditions_service ON public.permit_conditions;
CREATE POLICY permit_conditions_service ON public.permit_conditions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.permit_conditions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.permit_conditions FROM authenticated;
GRANT SELECT ON TABLE public.permit_conditions TO authenticated;
GRANT ALL    ON TABLE public.permit_conditions TO service_role;

-- ---------------------------------------------------------------------------
-- A1c. Realtime — because a subscription to an UNPUBLISHED table is SILENT
-- ---------------------------------------------------------------------------
--
-- ★★★ fix-336 found this the hard way and fix-393 finished it: `audit_log` was
-- subscribed-to for four tickets and emitted nothing, because Postgres does not
-- publish a table you have not added to the publication, and the client gets no
-- error for listening to silence. So adding a REALTIME_TABLES key in
-- queryKeys.ts is HALF the job, and this is the other half. Measured
-- 2026-08-29: `supabase_realtime` publishes 41 public tables, and every key in
-- REALTIME_TABLES is among them — an invariant a test now pins.
--
-- ★ Idempotent: adding a table already in the publication is an error, so ask
--   first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'permit_conditions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.permit_conditions;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ★★★ B2 — THE HASH DECISION, AND IT IS NOT md5(detail::text)
-- ---------------------------------------------------------------------------
--
-- The brief asks whether day-counts would bump the hash daily. MEASURED: they
-- would. The live mbp_resubmittal detail carries
-- `"days_in_corrections": 30` and permit 198 went 14 → 30 over nine days, plus
-- a `scraper_run_at` that changes every single run. Hashing `detail` whole
-- would re-surface an ACKNOWLEDGED condition every morning — which is P-069,
-- the exact failure this ruling closes, rebuilt inside its own fix.
--
-- So the hash is taken over a STABLE PROJECTION: `detail` minus a named set of
-- time-varying keys.
--
-- ★★ A DENY-LIST, NOT AN ALLOW-LIST, AND THE REASON IS THE FAILURE MODE. The
-- kinds are not all written yet — fix-439 brings cycle_disagreement — and an
-- allow-list would strip every field of an unknown kind, hash a constant, and
-- SILENTLY never re-surface. A deny-list fails the other way: an unnamed
-- volatile field re-surfaces too often, which somebody sees and reports.
-- Choose the failure that is visible.
--
-- ★ ONE DEFINITION, used by the acknowledge RPC and by the read RPC, so the
--   stamped hash and the compared hash cannot drift. The Bridge never computes
--   it — it is handed both strings and compares them.
CREATE OR REPLACE FUNCTION public.bp_condition_detail_hash(p_detail jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT md5(
    COALESCE(
      (COALESCE(p_detail, '{}'::jsonb) - ARRAY[
        -- Elapsed-time counters: these move on their own, every day.
        'days_in_corrections', 'days', 'age_days', 'days_open', 'days_since',
        -- When the machine last looked, which is never news.
        'scraper_run_at', 'as_of', 'observed_at', 'checked_at', 'run_at',
        'last_seen_at'
      ])::text,
      '{}'
    )
  );
$function$;

COMMENT ON FUNCTION public.bp_condition_detail_hash(jsonb) IS
  'fix-438 B2: hash of the MATERIAL part of a condition detail. Time-varying keys '
  'are stripped so an acknowledged condition does not re-surface every morning '
  'when its day counter ticks.';

-- ---------------------------------------------------------------------------
-- A2. bp_sync_permit_conditions — the self-clearing rule, and nothing else
-- ---------------------------------------------------------------------------
--
-- ★★★ THE SET DIFFERENCE IS THE ENTIRE POINT. `p_conditions` is the FULL set
-- of conditions currently true for this permit FROM THIS SOURCE. Anything open
-- for that permit, owned by that source, and absent from the payload is no
-- longer true — so it clears. Nothing else in the system clears a condition;
-- there is no Resolve, and a person cannot mark one finished, because a
-- condition is not a task.
--
-- ★★ AN EMPTY ARRAY IS THEREFORE MEANINGFUL AND MUST BE SENT. "no conditions
-- from this source on this permit" is what clears the last one. A caller that
-- skips the call when it has nothing to report leaves a stale row open for
-- ever — fix-439's brief must say so.
--
-- ★★ A CLEARED ROW THAT COMES BACK IS RE-OPENED WITH A FRESH first_seen_at,
-- not resurrected. The board key is cond:<id>:<first_seen_at>, so a fresh
-- first_seen makes it a genuinely NEW unread item for the ENT lead — which is
-- right: it went away and came back, and that is news. The acknowledgement is
-- dropped for the same reason.
CREATE OR REPLACE FUNCTION public.bp_sync_permit_conditions(
  p_permit_id integer,
  p_source    text,
  p_conditions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant   uuid;
  v_prefix   text;
  v_kinds    text[];
  v_opened   int := 0;
  v_updated  int := 0;
  v_cleared  int := 0;
  v_item     jsonb;
  v_kind     text;
  v_cond_key text;
  v_detail   jsonb;
  v_was_open boolean;
BEGIN
  IF p_permit_id IS NULL THEN
    RAISE EXCEPTION 'bp_sync_permit_conditions: p_permit_id is required';
  END IF;
  IF COALESCE(btrim(p_source), '') = '' THEN
    RAISE EXCEPTION 'bp_sync_permit_conditions: p_source is required';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.permits WHERE id = p_permit_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_sync_permit_conditions: permit % not found', p_permit_id;
  END IF;

  v_prefix := btrim(p_source) || ':';

  -- ★★★ THE OWNERSHIP CHECK, BEFORE ANYTHING IS WRITTEN. Every kind in the
  --     payload must belong to the declared source. Without this, a caller
  --     that sent one mislabelled kind would have its set difference clear a
  --     DIFFERENT source's standing conditions — silently, and the row would
  --     look as though the condition had genuinely ended.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_conditions, '[]'::jsonb))
  LOOP
    v_kind := COALESCE(v_item->>'kind', '');
    IF left(v_kind, length(v_prefix)) <> v_prefix THEN
      RAISE EXCEPTION
        'bp_sync_permit_conditions: kind % is not owned by source %',
        v_kind, p_source;
    END IF;
  END LOOP;

  -- 1. Upsert everything currently true.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_conditions, '[]'::jsonb))
  LOOP
    v_kind     := v_item->>'kind';
    v_cond_key := COALESCE(v_item->>'cond_key', '');
    v_detail   := COALESCE(v_item->'detail', '{}'::jsonb);

    SELECT (cleared_at IS NULL) INTO v_was_open
      FROM public.permit_conditions
     WHERE tenant_id = v_tenant AND permit_id = p_permit_id
       AND kind = v_kind AND cond_key = v_cond_key;

    INSERT INTO public.permit_conditions AS pc
      (tenant_id, permit_id, kind, cond_key, detail)
    VALUES (v_tenant, p_permit_id, v_kind, v_cond_key, v_detail)
    ON CONFLICT (tenant_id, permit_id, kind, cond_key) DO UPDATE
      SET detail        = EXCLUDED.detail,
          last_seen_at  = now(),
          updated_at    = now(),
          -- ★ A re-open restarts the count and the clock; a continuing
          --   condition just ticks.
          seen_count    = CASE WHEN pc.cleared_at IS NULL
                               THEN pc.seen_count + 1 ELSE 1 END,
          first_seen_at = CASE WHEN pc.cleared_at IS NULL
                               THEN pc.first_seen_at ELSE now() END,
          cleared_at    = NULL,
          cleared_reason = NULL,
          -- ★★ A RE-OPENED CONDITION IS UNACKNOWLEDGED. It went away and came
          --    back; the person's "I know" was about the previous episode.
          acknowledged_at   = CASE WHEN pc.cleared_at IS NULL
                                   THEN pc.acknowledged_at ELSE NULL END,
          acknowledged_by   = CASE WHEN pc.cleared_at IS NULL
                                   THEN pc.acknowledged_by ELSE NULL END,
          acknowledged_detail_hash = CASE WHEN pc.cleared_at IS NULL
                                   THEN pc.acknowledged_detail_hash ELSE NULL END;

    IF v_was_open IS TRUE THEN
      v_updated := v_updated + 1;
    ELSE
      -- Both a brand-new row and a cleared row coming back are "opened".
      v_opened := v_opened + 1;
    END IF;
  END LOOP;

  -- 2. Clear what this source no longer reports.
  --
  -- ** THE SEPARATOR IS NOT COSMETIC. Concatenating kind and cond_key with
  --    nothing between them makes ('scraper:x', '1') and ('scraper:x1', '')
  --    the same string, and one condition would silently clear the other.
  --    chr(31) is the ASCII unit separator and cannot occur in either.
  SELECT COALESCE(
           array_agg(
             COALESCE(e->>'kind','') || chr(31) || COALESCE(e->>'cond_key','')
           ),
           ARRAY[]::text[])
    INTO v_kinds
    FROM jsonb_array_elements(COALESCE(p_conditions, '[]'::jsonb)) e;

  WITH cleared AS (
    UPDATE public.permit_conditions
       SET cleared_at     = now(),
           cleared_reason = 'condition_ended',
           updated_at     = now()
     WHERE tenant_id = v_tenant
       AND permit_id = p_permit_id
       AND cleared_at IS NULL
       -- ★ ONLY THIS SOURCE'S KINDS. The prefix is the ownership boundary.
       AND left(kind, length(v_prefix)) = v_prefix
       AND (kind || chr(31) || cond_key) <> ALL (v_kinds)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_cleared FROM cleared;

  RETURN jsonb_build_object(
    'opened',  v_opened,
    'updated', v_updated,
    'cleared', v_cleared
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_sync_permit_conditions(integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_sync_permit_conditions(integer, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.bp_sync_permit_conditions(integer, text, jsonb) IS
  'fix-438 A2: replace one source''s standing conditions for one permit. The payload '
  'is the FULL current set; anything open, owned by this source and absent from it is '
  'cleared. An EMPTY array is meaningful and must be sent.';

-- ---------------------------------------------------------------------------
-- A3. bp_acknowledge_permit_condition — the ENT lead says "I know"
-- ---------------------------------------------------------------------------
--
-- ★★ THE CALLER MUST BE THE PERMIT'S ENT LEAD OR AN ADMIN, and the ENT lead is
-- a roster NAME, not an id (permits.ent_lead holds 'Bobby', 'Briana', 'Miles').
-- So the check goes auth.uid() → team_members.email → team_members.name →
-- permits.ent_lead, matched case- and whitespace-insensitively, which is the
-- same route resolveRosterIdentity takes in the Bridge.
--
-- ★★★ Eric ≠ Erick. The comparison is on the WHOLE trimmed name, never a
-- prefix or a LIKE — the roster holds `Eric` (viewer) and `Erick` (da) one
-- letter apart, and a sloppy match would hand one person's conditions to the
-- other.
CREATE OR REPLACE FUNCTION public.bp_acknowledge_permit_condition(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row      public.permit_conditions%ROWTYPE;
  v_ent_lead text;
  v_tenant   uuid;
  v_allowed  boolean := false;
  v_hash     text;
BEGIN
  SELECT * INTO v_row FROM public.permit_conditions WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'bp_acknowledge_permit_condition: condition % not found', p_id;
  END IF;
  IF NOT (v_row.tenant_id = ANY (public.auth_tenant_ids())) THEN
    RAISE EXCEPTION 'bp_acknowledge_permit_condition: not your tenant';
  END IF;

  SELECT p.ent_lead, p.tenant_id INTO v_ent_lead, v_tenant
    FROM public.permits p WHERE p.id = v_row.permit_id;

  v_allowed := public.is_tenant_admin(v_tenant);

  IF NOT v_allowed AND COALESCE(btrim(v_ent_lead), '') <> '' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.team_members tm
        JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(tm.email))
       WHERE u.id = auth.uid()
         AND tm.tenant_id = v_tenant
         AND lower(btrim(tm.name)) = lower(btrim(v_ent_lead))
    ) INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'bp_acknowledge_permit_condition: only the permit''s entitlement lead or an admin may acknowledge';
  END IF;

  v_hash := public.bp_condition_detail_hash(v_row.detail);

  UPDATE public.permit_conditions
     SET acknowledged_at = now(),
         acknowledged_by = auth.uid(),
         acknowledged_detail_hash = v_hash,
         updated_at = now()
   WHERE id = p_id;

  -- ★ Audited, like every other consequential write. audit_log is the event
  --   log; permit_conditions is the state. Acknowledging IS an event.
  INSERT INTO public.audit_log (user_id, action, table_name, row_id, changes, tenant_id)
  VALUES (
    auth.uid(),
    'condition_acknowledged',
    'permit_conditions',
    p_id::text,
    jsonb_build_object(
      'permit_id', v_row.permit_id,
      'kind', v_row.kind,
      'cond_key', v_row.cond_key,
      'detail_hash', v_hash
    ),
    v_row.tenant_id
  );

  RETURN jsonb_build_object('id', p_id, 'acknowledged_detail_hash', v_hash);
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_acknowledge_permit_condition(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_acknowledge_permit_condition(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- A4. bp_list_permit_conditions — what the Bridge reads
-- ---------------------------------------------------------------------------
--
-- ★ STABLE + SECURITY INVOKER: the caller's own RLS decides what they see, so
--   this cannot become a tenant-scoping hole the way a DEFINER read would.
--   Standing rule 9.
--
-- ★★ It returns BOTH hashes so the client compares two strings it was handed
--    and never re-derives one. A second implementation of the hash in
--    TypeScript is exactly how the stamped value and the compared value start
--    to disagree.
CREATE OR REPLACE FUNCTION public.bp_list_permit_conditions(p_open_only boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(obj ORDER BY last_seen_at DESC, id), '[]'::jsonb)
  FROM (
    SELECT
      c.last_seen_at,
      c.id,
      jsonb_build_object(
        'id',            c.id,
        'permit_id',     c.permit_id,
        'project_id',    p.project_id,
        'permit_num',    p.num,
        'permit_type',   p.type,
        'address',       pr.address,
        'ent_lead',      p.ent_lead,
        'kind',          c.kind,
        'cond_key',      c.cond_key,
        'detail',        c.detail,
        'first_seen_at', c.first_seen_at,
        'last_seen_at',  c.last_seen_at,
        'seen_count',    c.seen_count,
        'cleared_at',    c.cleared_at,
        'cleared_reason', c.cleared_reason,
        'acknowledged_at', c.acknowledged_at,
        'acknowledged_detail_hash', c.acknowledged_detail_hash,
        'detail_hash',   public.bp_condition_detail_hash(c.detail)
      ) AS obj
    FROM public.permit_conditions c
    JOIN public.permits  p  ON p.id = c.permit_id
    JOIN public.projects pr ON pr.id = p.project_id
    WHERE (NOT p_open_only OR c.cleared_at IS NULL)
  ) rows;
$function$;

REVOKE ALL ON FUNCTION public.bp_list_permit_conditions(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_permit_conditions(boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- C. Error Triage keeps Bridge errors
-- ---------------------------------------------------------------------------
--
-- ★★★ DROP FIRST. `CREATE OR REPLACE` with a NEW argument list makes an
-- OVERLOAD, not a replacement — bp_list_error_groups(text[]) and
-- bp_list_error_groups(text[], boolean) would both exist, and PostgREST would
-- refuse the call as ambiguous. bp_new_error_count() is worse: a zero-arg
-- version beside a one-defaulted-arg version makes `bp_new_error_count()`
-- itself "not unique". Both old signatures go.
DROP FUNCTION IF EXISTS public.bp_list_error_groups(text[]);
DROP FUNCTION IF EXISTS public.bp_new_error_count();

-- ★★★ C1: SCRAPER ROWS ARE EXCLUDED BY DEFAULT, NOT DELETED. 229 historical
-- scraper rows (173 of them still status='new') stay exactly where they are
-- and stop being listed. No UPDATE — marking them resolved would be a claim
-- nobody made, and if Bobby wants that it is a separate approval.
--
-- ★ The flag exists so the rows are reachable rather than erased: pass
--   p_include_scraper => true and the panel is what it was.
CREATE OR REPLACE FUNCTION public.bp_list_error_groups(
  p_status text[] DEFAULT ARRAY['new'::text, 'queued'::text, 'in_progress'::text],
  p_include_scraper boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(g ORDER BY last_seen DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      fingerprint,
      -- ★★★ C2 — THE SAMPLE COMES FROM THE FIRST ROW NOW.
      --
      -- It used to come from the newest, which is how the seattle/landuse
      -- group read "89 occurrences, permit 3044101-LU" while actually being 89
      -- DIFFERENT permits once each. The newest row is the least
      -- representative one there is: it is simply whichever permit the scraper
      -- happened to reach last. The first occurrence is where an investigation
      -- starts, and `last_seen` beside it still says how current the group is.
      --
      -- ★ `, id ASC` is not decoration. created_at is set from now(), which is
      --   CONSTANT within a transaction — 89 of these rows share one run and
      --   several share a timestamp to the microsecond. Without the id
      --   tie-break the "first" row is whichever the planner felt like.
      (array_agg(source   ORDER BY created_at ASC, id ASC))[1] AS source,
      (array_agg(level    ORDER BY created_at ASC, id ASC))[1] AS level,
      (array_agg(message  ORDER BY created_at ASC, id ASC))[1] AS sample_message,
      (array_agg(context  ORDER BY created_at ASC, id ASC))[1] AS sample_context,
      -- ★ Triage STATE stays newest-first: status drives the filter below and
      --   backlog_ref is whatever was last written. Those describe the group's
      --   handling, not its sample.
      (array_agg(status   ORDER BY created_at DESC, id DESC))[1] AS status,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      COUNT(*)::int AS count,
      COUNT(DISTINCT user_id)::int AS user_count,
      -- ★★★ C2 — HOW MANY PERMITS, which is the number that was missing.
      --   "89 occurrences" and "89 permits" are the same size and opposite
      --   meanings: one is a permit in trouble, the other is a bad afternoon
      --   across the book. NULL when the context carries no permit at all,
      --   which is how a Bridge error stays silent about permits.
      COUNT(DISTINCT context->>'permit_id')::int AS permit_count,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_count,
      MAX(resolved_at) AS last_resolved_at,
      (
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) > 0
        AND (array_agg(status ORDER BY created_at DESC, id DESC))[1]
              IN ('new', 'queued', 'in_progress')
      ) AS recurred,
      (array_agg(backlog_ref ORDER BY created_at DESC, id DESC)
        FILTER (WHERE backlog_ref IS NOT NULL))[1] AS backlog_ref
    FROM public.error_reports
    WHERE tenant_id = ANY(auth_tenant_ids())
      AND (p_include_scraper OR source <> 'scraper')
    GROUP BY fingerprint
    HAVING (array_agg(status ORDER BY created_at DESC, id DESC))[1] = ANY(p_status)
  ) g;
  RETURN v_result;
END;
$function$;

-- ★ C3: the nav badge counts Bridge errors only, by the same flag and the same
--   default. Two functions, one rule — a badge that counted a different set
--   from the page it opens is the disagreement fix-432 spent a ticket removing.
CREATE OR REPLACE FUNCTION public.bp_new_error_count(
  p_include_scraper boolean DEFAULT false
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COUNT(*)::int FROM (
    SELECT fingerprint
    FROM public.error_reports
    WHERE tenant_id = ANY(auth_tenant_ids())
      AND (p_include_scraper OR source <> 'scraper')
    GROUP BY fingerprint
    HAVING (array_agg(status ORDER BY created_at DESC, id DESC))[1] = 'new'
  ) x;
$function$;

REVOKE ALL ON FUNCTION public.bp_list_error_groups(text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_error_groups(text[], boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.bp_new_error_count(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_new_error_count(boolean) TO authenticated;

COMMIT;

-- ===========================================================================
-- VERIFICATION (run after apply; read-only)
-- ===========================================================================
--
--   -- the 229 scraper rows are still there and no longer listed
--   select source, status, count(*) from error_reports group by 1,2 order by 1,2;
--   select jsonb_array_length(bp_list_error_groups());                 -- Bridge only
--   select jsonb_array_length(bp_list_error_groups(
--     ARRAY['new','queued','in_progress'], true));                     -- everything
--
--   -- the sync's three outcomes, rolled back
--   BEGIN;
--     select bp_sync_permit_conditions(198, 'scraper',
--       '[{"kind":"scraper:mbp_resubmittal","cond_key":"2","detail":{"days_in_corrections":30}}]'::jsonb);
--     select bp_sync_permit_conditions(198, 'scraper', '[]'::jsonb);   -- clears it
--   ROLLBACK;
-- ===========================================================================
