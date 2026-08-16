-- fix-329 (register #71): project chat, phase 1 — text only.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-16 via MCP apply_migration.
--   Grants verified afterwards with has_table_privilege — see the bottom of
--   this file for what was asserted and why the assertion is not optional.
--
-- ONE CONVERSATION PER PROJECT. Bobby's decision, not an inference: 3921 has
-- five permits and one thread. `project_id` is therefore the only scope column
-- — there is deliberately no permit_id, because a per-permit thread is a
-- different product and adding the column "just in case" would invite one.
--
-- VISIBILITY IS THE TENANT, exactly like every other screen in this app. No
-- per-project ACL: adding one would be the first place in the schema where two
-- people in Blueprint see different rows of the same project, and nobody asked
-- for that.
--
-- ---------------------------------------------------------------------------
-- ★ APPEND-ONLY, AND WHY IT IS A DECISION RATHER THAN AN OMISSION
-- ---------------------------------------------------------------------------
-- Phase 1 grants SELECT + INSERT and nothing else. A message cannot be edited
-- or deleted by anyone using the app.
--
-- The reason is the task link below: a task can be created FROM a message, and
-- a message somebody can silently rewrite afterwards turns "created from this
-- message" into a claim about text that no longer exists. Chat is a record of
-- what was said. Phase 2 can add editing with an edit trail if Bobby wants it;
-- what it must not do is quietly mutate history, so the column that would
-- carry it (`updated_at`) exists and NOTHING writes it today.
--
-- ---------------------------------------------------------------------------
-- ★ MENTIONS ARE STORED PARSED, as uuid[] — the brief asked for the choice and
--   the reason.
-- ---------------------------------------------------------------------------
-- The bell asks "did this mention me" for every message on every derivation.
-- Three options were on the table:
--
--   1. re-parse `body` on read — the bell would have to parse every message in
--      the tenant on every board render, and the parse rule would then live in
--      two languages the moment SQL needed it too;
--   2. a child table (message_mentions) — correct and normalized, but it is a
--      join for a value that is written exactly once and never edited, since
--      messages are append-only. A child table earns its keep when the child
--      changes independently; this one cannot;
--   3. a uuid[] column with a GIN index — one row, one write, and
--      `mentions @> ARRAY[auth.uid()]` is an index lookup.
--
-- Chose 3. It is denormalized ON PURPOSE and the denormalization is safe
-- precisely BECAUSE the row is immutable: there is no update path that could
-- leave `mentions` disagreeing with `body`.
--
-- The array holds profiles.id (auth user ids), not names. A name changes; an
-- id does not, and the bell's key scheme (fix-307) is built entirely on
-- immutable database identities for the same reason.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Stamped by the trigger below, not by a DEFAULT auth.uid(): a bare default
  -- would FK-fail for any authenticated user without a profiles row, which is
  -- the trap fix-notes-1 hit and documented.
  author_id  uuid REFERENCES public.profiles(id),
  body       text NOT NULL CHECK (length(btrim(body)) > 0),
  mentions   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Reserved for a phase-2 edit trail. NOTHING writes this today; there is no
  -- UPDATE grant, so it cannot drift.
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.project_messages IS
  'fix-329: one project-scoped chat thread per project. APPEND-ONLY in phase 1 '
  '(SELECT + INSERT grants only) because tasks link back to messages and a '
  'silently rewritten message would make that link a lie. mentions is a parsed '
  'uuid[] of profiles.id, safe to denormalize because the row is immutable.';

CREATE INDEX IF NOT EXISTS project_messages_project_created_idx
  ON public.project_messages (project_id, created_at DESC);

-- ★ The index the bell's question needs: "which messages mention me".
CREATE INDEX IF NOT EXISTS project_messages_mentions_gin
  ON public.project_messages USING GIN (mentions);

-- ---------------------------------------------------------------------------
-- 2. Triggers — the tenant + author pattern this schema already uses
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS project_messages_default_tenant ON public.project_messages;
CREATE TRIGGER project_messages_default_tenant
  BEFORE INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.default_tenant_id_to_caller();

CREATE OR REPLACE FUNCTION public.bp_trg_project_message_author()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.author_id IS NULL THEN
    SELECT p.id INTO NEW.author_id
    FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_messages_author ON public.project_messages;
CREATE TRIGGER project_messages_author
  BEFORE INSERT ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_project_message_author();

-- ---------------------------------------------------------------------------
-- 3. RLS + grants (fix-157 model, fix-307 shape)
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_messages_tenant_select ON public.project_messages;
CREATE POLICY project_messages_tenant_select ON public.project_messages
  FOR SELECT USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★ Insert is tenant-scoped AND author-pinned: a caller may only post as
-- themselves. The trigger stamps author_id, and this refuses anything else.
DROP POLICY IF EXISTS project_messages_tenant_insert ON public.project_messages;
CREATE POLICY project_messages_tenant_insert ON public.project_messages
  FOR INSERT WITH CHECK (
    tenant_id = ANY (public.auth_tenant_ids())
    AND (author_id IS NULL OR author_id = auth.uid())
  );

-- ★ No UPDATE or DELETE policy at all. Append-only is enforced twice — by the
-- absent policy and by the absent grant below — because either alone can be
-- undone by a well-meaning change to the other.

REVOKE ALL ON TABLE public.project_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.project_messages TO authenticated, service_role;
-- ★ Named explicitly. Supabase DEFAULT PRIVILEGES hand every new table full DML
-- to `authenticated`, and a REVOKE that does not name the role leaves it —
-- which is exactly what happened to permit_milestone_acks (fix-298 P2) and
-- board_item_reads (fix-307), both caught only by checking afterwards.
REVOKE UPDATE, DELETE, TRUNCATE ON public.project_messages FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. The task link — a task remembers the message it came from
-- ---------------------------------------------------------------------------
-- ★ NULLABLE and ON DELETE SET NULL. A task created from a message is a TASK:
-- it lives in My Tasks and on the board under fix-308's ownership rules, and it
-- must survive its message. SET NULL rather than CASCADE is the whole point —
-- losing the provenance is acceptable, losing the work is not.
ALTER TABLE public.permit_tasks
  ADD COLUMN IF NOT EXISTS source_message_id uuid
  REFERENCES public.project_messages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.permit_tasks.source_message_id IS
  'fix-329: the chat message this task was created from, if any. NULL for every '
  'task not born in chat. ON DELETE SET NULL — a deleted message must never '
  'delete a task.';

CREATE INDEX IF NOT EXISTS permit_tasks_source_message_idx
  ON public.permit_tasks (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Read RPC — author names live on profiles, which is read-own-only
-- ---------------------------------------------------------------------------
-- The fix-70 / fix-notes-1 pattern: SECURITY DEFINER with an EXPLICIT tenant
-- filter, because a definer function does not get RLS applied for free and the
-- filter is the only thing standing between tenants.
--
-- It also returns whether a task was created from each message, so the thread
-- can show "✓ Task created" without a second round trip.
CREATE OR REPLACE FUNCTION public.bp_list_project_messages(p_project_id uuid)
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    author_id uuid,
    author_name text,
    body text,
    mentions uuid[],
    created_at timestamptz,
    task_id uuid,
    task_text text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT m.id, m.project_id, m.author_id,
         COALESCE(NULLIF(TRIM(pr.name), ''), NULLIF(TRIM(pr.full_name), ''), pr.email)
           AS author_name,
         m.body, m.mentions, m.created_at,
         t.id AS task_id, t.text AS task_text
  FROM public.project_messages m
  LEFT JOIN public.profiles pr ON pr.id = m.author_id
  LEFT JOIN LATERAL (
    SELECT pt.id, pt.text
    FROM public.permit_tasks pt
    WHERE pt.source_message_id = m.id
    ORDER BY pt.created_at
    LIMIT 1
  ) t ON true
  WHERE m.project_id = p_project_id
    AND m.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY m.created_at ASC, m.id ASC;
$$;

REVOKE ALL ON FUNCTION public.bp_list_project_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_project_messages(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Who can be mentioned
-- ---------------------------------------------------------------------------
-- ★ The @-picker needs (user_id, name) pairs, and profiles is read-own-only —
-- so without this a client could render its own name and nobody else's. Same
-- definer + explicit-tenant-filter shape as above.
--
-- Sourced from tenant_memberships, so the list is "people who can actually open
-- this tenant", never a roster of names that may not have logins. A mention
-- that cannot resolve to a user id cannot notify anyone, and offering one would
-- be the paperclip-that-does-nothing failure in another costume.
CREATE OR REPLACE FUNCTION public.bp_mentionable_people()
  RETURNS TABLE (user_id uuid, name text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT DISTINCT pr.id AS user_id,
         COALESCE(NULLIF(TRIM(pr.name), ''), NULLIF(TRIM(pr.full_name), ''), pr.email)
           AS name,
         pr.email
  FROM public.tenant_memberships tm
  JOIN public.profiles pr ON pr.id = tm.user_id
  WHERE tm.tenant_id = ANY (public.auth_tenant_ids())
    AND COALESCE(pr.active, true)
  ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.bp_mentionable_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_mentionable_people()
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------------
-- ★ ONE CHANNEL. The client adds project_messages to REALTIME_TABLES, which is
-- the single `bp-v2-realtime` subscription — useScraperActivity's comment
-- records what a second channel cost last time.
DO $pub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'project_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_messages;
  END IF;
END $pub$;

-- ---------------------------------------------------------------------------
-- ★ VERIFY AFTER APPLYING — not by reading this file:
--
--   SELECT has_table_privilege('authenticated','public.project_messages','SELECT'), -- t
--          has_table_privilege('authenticated','public.project_messages','INSERT'), -- t
--          has_table_privilege('authenticated','public.project_messages','UPDATE'), -- f
--          has_table_privilege('authenticated','public.project_messages','DELETE'), -- f
--          has_table_privilege('anon','public.project_messages','SELECT');           -- f
-- ---------------------------------------------------------------------------
