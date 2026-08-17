-- fix-334: chat, dialled in. Posts with replies, admin-gated posting, edit and
-- delete with the original kept.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-17 via MCP apply_migration.
--   The grants and BOTH policies were verified afterwards with a real
--   cross-user attempt under `SET ROLE authenticated`, not by reading them
--   back — see the bottom of this file for what was asserted.
--
-- ---------------------------------------------------------------------------
-- ★★ ONE TABLE, NOT TWO. Why a post is a message.
-- ---------------------------------------------------------------------------
-- A post could have been its own table with project_messages.post_id pointing
-- at it. It is not, and the reason is that a post is a message in every way
-- that matters: it has an author, a body, @mentions, attachments, an edit
-- history, and a task can be created from it. A second table would have needed
-- its own tenant trigger, its own RLS, its own grants, its own realtime entry
-- and its own half of the read RPC — six duplications to express "this one has
-- a title".
--
-- So: `parent_message_id IS NULL` is a POST, and it carries a title.
--     `parent_message_id IS NOT NULL` is a REPLY, and it does not.
--
-- ★ TWO LEVELS, NOT A TREE. Teams does not nest further and neither does this.
-- Enforced by a trigger, not by convention: a reply's parent must itself be a
-- post. See bp_trg_project_message_shape.
--
-- ---------------------------------------------------------------------------
-- ★★ WHERE THE SEVEN EXISTING MESSAGES WENT — the one deliberate write
-- ---------------------------------------------------------------------------
-- Measured before touching anything: 7 messages across 5 projects, 0 tasks
-- created from any of them, 0 attachments.
--
-- They predate posts, so they have no parent and no title, and the shape CHECK
-- below would reject them. §1 of the brief is explicit that they must "land
-- somewhere sensible" and that a message which becomes unreachable is a data
-- loss even though no row was deleted.
--
-- ★ Each project that has any gets ONE new post titled "General", and its
-- existing messages are adopted into it. Nothing about the messages themselves
-- changes: body, author, created_at, mentions and attachments are untouched.
-- The only column written is `parent_message_id`, which did not exist a moment
-- ago and had no value to preserve.
--
-- ★ THE GENERAL POST INHERITS THE FIRST MESSAGE'S AUTHOR AND A TIMESTAMP ONE
-- SECOND BEFORE IT, so the thread it adopts still sorts underneath it and the
-- post does not appear to have been written by nobody.
--
-- This is the standing rule's one exception and it is the one the brief itself
-- asks for. It is a structural adoption, not a backfill of content.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_messages
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS parent_message_id uuid
    REFERENCES public.project_messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  -- ★ THE EDIT HISTORY, and it is written by the DATABASE. See §4 below: a
  -- history the client appends is a claim about client code, and "we keep a
  -- record of everything" has to be stronger than that.
  ADD COLUMN IF NOT EXISTS revisions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.project_messages.parent_message_id IS
  'fix-334: NULL = this row is a POST (and carries a title). Non-NULL = a REPLY '
  'under that post. Two levels only — enforced by bp_trg_project_message_shape.';
COMMENT ON COLUMN public.project_messages.revisions IS
  'fix-334: append-only [{body, at, by}] of superseded text, written by '
  'bp_trg_project_message_revision on UPDATE. The client cannot skip it.';

CREATE INDEX IF NOT EXISTS project_messages_parent_idx
  ON public.project_messages (parent_message_id, created_at)
  WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_messages_posts_idx
  ON public.project_messages (project_id, created_at DESC)
  WHERE parent_message_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. ★ Adopt the pre-existing messages, BEFORE the shape CHECK exists
-- ---------------------------------------------------------------------------
DO $adopt$
DECLARE
  r RECORD;
  v_post uuid;
BEGIN
  FOR r IN
    SELECT m.project_id,
           m.tenant_id,
           min(m.created_at) AS first_at,
           (array_agg(m.author_id ORDER BY m.created_at))[1] AS first_author
    FROM public.project_messages m
    WHERE m.parent_message_id IS NULL
      AND m.title IS NULL
    GROUP BY m.project_id, m.tenant_id
  LOOP
    INSERT INTO public.project_messages
      (tenant_id, project_id, author_id, title, body, created_at, updated_at)
    VALUES (
      r.tenant_id, r.project_id, r.first_author,
      'General',
      -- ★ A body, because the CHECK further down requires one and because an
      -- empty post reads as broken. It says what it is.
      'Messages posted before this project had posts.',
      r.first_at - interval '1 second',
      r.first_at - interval '1 second'
    )
    RETURNING id INTO v_post;

    UPDATE public.project_messages
       SET parent_message_id = v_post
     WHERE project_id = r.project_id
       AND parent_message_id IS NULL
       AND title IS NULL
       AND id <> v_post;
  END LOOP;
END $adopt$;

-- ---------------------------------------------------------------------------
-- 3. The shape: a post has a title, a reply has a parent. Never both, never
--    neither.
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_messages
  DROP CONSTRAINT IF EXISTS project_messages_shape;
ALTER TABLE public.project_messages
  ADD CONSTRAINT project_messages_shape CHECK (
    (parent_message_id IS NULL
       AND title IS NOT NULL AND length(btrim(title)) > 0)
    OR
    (parent_message_id IS NOT NULL AND title IS NULL)
  );

-- ★ A reply's parent must be a POST, and in the SAME PROJECT. Without this a
-- reply could hang off another reply (three levels) or point across projects,
-- and both are invisible in the UI until somebody's conversation goes missing.
CREATE OR REPLACE FUNCTION public.bp_trg_project_message_shape()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_parent_parent uuid;
  v_parent_project uuid;
  v_found boolean;
BEGIN
  IF NEW.parent_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT true, p.parent_message_id, p.project_id
    INTO v_found, v_parent_parent, v_parent_project
  FROM public.project_messages p
  WHERE p.id = NEW.parent_message_id;

  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'parent message % does not exist', NEW.parent_message_id;
  END IF;
  IF v_parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'replies nest one level only — % is itself a reply',
      NEW.parent_message_id;
  END IF;
  IF v_parent_project <> NEW.project_id THEN
    RAISE EXCEPTION 'a reply must live in the same project as its post';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_messages_shape_trg ON public.project_messages;
CREATE TRIGGER project_messages_shape_trg
  BEFORE INSERT OR UPDATE OF parent_message_id ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_project_message_shape();

-- ---------------------------------------------------------------------------
-- ★★ 4. Edit and delete — and why this reverses fix-329's append-only rule
-- ---------------------------------------------------------------------------
-- fix-329 refused UPDATE outright, and said why: "a message someone can
-- silently rewrite makes 'created from this message' a claim about text that no
-- longer exists."
--
-- ★ Bobby's own answer dissolves that: "we still want to show the original
-- text, but then it maybe just kind of gets minimized. That way we can keep a
-- record of everything." KEEPING THE ORIGINAL REACHABLE REMOVES THE WORD
-- "SILENTLY". The objection was never to editing; it was to editing without a
-- trace, and a trace is exactly what is being added.
--
-- ★★ AND THE TRACE IS THE DATABASE'S JOB. This trigger appends the superseded
-- body on every UPDATE that changes it, and on the update that deletes the
-- message. A client cannot forget it, cannot skip it, and cannot fake it —
-- which is what makes "a record of everything" true rather than aspirational.
--
-- ★ NOTHING IS EVER HARD DELETED. There is no DELETE grant and no DELETE
-- policy. A hard delete would also strand permit_tasks.source_message_id, which
-- fix-329 deliberately made ON DELETE SET NULL so a task survives its message —
-- soft delete means it never has to.
CREATE OR REPLACE FUNCTION public.bp_trg_project_message_revision()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  -- The body changed, or the message was just deleted. Either way the text that
  -- was on screen a moment ago is now superseded, and it is kept.
  IF (NEW.body IS DISTINCT FROM OLD.body)
     OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    NEW.revisions := COALESCE(OLD.revisions, '[]'::jsonb) || jsonb_build_object(
      'body', OLD.body,
      'at', COALESCE(OLD.edited_at, OLD.created_at),
      'by', OLD.author_id,
      'reason', CASE
        WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted'
        ELSE 'edited'
      END
    );
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;
  NEW.updated_at := now();

  -- ★ Undelete is not a feature anybody asked for, and allowing it would let a
  -- deleted message quietly reappear. Deletion is one-way.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_messages_revision_trg ON public.project_messages;
CREATE TRIGGER project_messages_revision_trg
  BEFORE UPDATE ON public.project_messages
  FOR EACH ROW EXECUTE FUNCTION public.bp_trg_project_message_revision();

-- ---------------------------------------------------------------------------
-- ★★ 5. RLS — posts are admin-only, replies are not, edits are the author's
-- ---------------------------------------------------------------------------
-- ★ THE WRITE IS GATED, NOT THE BUTTON. fix-234's lesson, and fix-331 §6 had to
-- go back and fix exactly this shape: a hidden control over an open policy is
-- not a permission, it is a suggestion.
DROP POLICY IF EXISTS project_messages_tenant_insert ON public.project_messages;
CREATE POLICY project_messages_tenant_insert ON public.project_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = ANY (public.auth_tenant_ids())
    AND (author_id IS NULL OR author_id = auth.uid())
    -- ★★ A POST (no parent) requires admin. A REPLY does not, and must not:
    -- 23 of this tenant's 29 people are editors, and a chat only they can read
    -- is not a chat. Bobby: "generally, entitlements or design managers would
    -- make these posts" — the STRUCTURE is controlled, the conversation is not.
    AND (
      parent_message_id IS NOT NULL
      OR public.is_tenant_admin(tenant_id)
    )
  );

-- ★ EDITING IS THE AUTHOR'S OWN. Admins create posts — that is structure.
-- Rewriting somebody else's words is a different thing and nobody asked for it,
-- so there is no admin exemption here on purpose.
DROP POLICY IF EXISTS project_messages_author_update ON public.project_messages;
CREATE POLICY project_messages_author_update ON public.project_messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = ANY (public.auth_tenant_ids())
    AND author_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = ANY (public.auth_tenant_ids())
    AND author_id = auth.uid()
  );

-- ★ No DELETE policy, and no DELETE grant. Deletion is the `deleted_at` column.

-- ---------------------------------------------------------------------------
-- 6. Grants — column-level, so the policy is not the only thing holding
-- ---------------------------------------------------------------------------
-- ★★ UPDATE IS GRANTED ON THREE COLUMNS, NOT ON THE TABLE. RLS says WHICH ROWS
-- a person may touch; a column grant says WHICH FIELDS. Without it, an author
-- editing their own message could also rewrite project_id, author_id,
-- parent_message_id or created_at, and the row-level policy would happily allow
-- it because the row is still theirs. Postgres enforces the column list itself,
-- so this holds even against a hand-rolled request.
--
-- `revisions`, `edited_at` and `updated_at` are deliberately NOT grantable: they
-- are the trigger's, and a client that could write them could forge the history.
REVOKE ALL ON TABLE public.project_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.project_messages TO authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.project_messages FROM authenticated;
GRANT UPDATE (body, mentions, deleted_at)
  ON TABLE public.project_messages TO authenticated;
GRANT UPDATE ON TABLE public.project_messages TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The read RPC — posts, replies, and everything the thread renders
-- ---------------------------------------------------------------------------
-- Return type changes, so this drops and recreates.
--
-- ★ ONE FLAT LIST, not a nested shape. The client groups replies under their
-- post, which it has to be able to do anyway for the realtime refresh; a nested
-- JSON payload would have meant two shapes for one thread.
--
-- ★ reply_count and last_activity_at are computed HERE and only for posts —
-- §1 wants a post to show them, and doing it in SQL keeps the Team-card section
-- from loading every reply in the project to count them.
DROP FUNCTION IF EXISTS public.bp_list_project_messages(uuid);
CREATE FUNCTION public.bp_list_project_messages(p_project_id uuid)
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    parent_message_id uuid,
    title text,
    author_id uuid,
    author_name text,
    body text,
    mentions uuid[],
    attachments jsonb,
    created_at timestamptz,
    edited_at timestamptz,
    deleted_at timestamptz,
    revisions jsonb,
    task_id uuid,
    task_text text,
    task_permit_id integer,
    reply_count integer,
    last_activity_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT m.id, m.project_id, m.parent_message_id, m.title, m.author_id,
         public.bp_profile_display_name(m.author_id) AS author_name,
         m.body, m.mentions, m.attachments, m.created_at,
         m.edited_at, m.deleted_at, m.revisions,
         t.id AS task_id, t.text AS task_text, t.permit_id AS task_permit_id,
         CASE WHEN m.parent_message_id IS NULL THEN (
           SELECT count(*)::int FROM public.project_messages r
           WHERE r.parent_message_id = m.id AND r.deleted_at IS NULL
         ) END AS reply_count,
         CASE WHEN m.parent_message_id IS NULL THEN (
           SELECT max(x.created_at) FROM (
             SELECT m.created_at
             UNION ALL
             SELECT r.created_at FROM public.project_messages r
             WHERE r.parent_message_id = m.id AND r.deleted_at IS NULL
           ) x
         ) END AS last_activity_at
  FROM public.project_messages m
  LEFT JOIN LATERAL (
    SELECT pt.id, pt.text, pt.permit_id
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
-- ★ VERIFY AFTER APPLYING — with a real cross-user attempt, not by reading:
--
--   authenticated  SELECT ✓  INSERT ✓  DELETE ✗  TRUNCATE ✗
--                  UPDATE only on (body, mentions, deleted_at)
--   a NON-ADMIN inserting a post (parent_message_id NULL)  → REFUSED
--   a NON-ADMIN inserting a reply                          → ALLOWED
--   user B updating user A's message                       → 0 rows
--   the author updating their own                          → 1 row, and
--                                                            revisions grew
-- ---------------------------------------------------------------------------
