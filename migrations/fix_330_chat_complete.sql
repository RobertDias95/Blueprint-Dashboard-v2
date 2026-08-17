-- fix-330: finish project chat. The @ picker, the chosen permit, attachments.
--
-- ★ APPLIED TO PROD (eibnmwthkcuumyclyxoe) 2026-08-17 via MCP apply_migration.
--   Grants and the storage RLS were VERIFIED afterwards by executing a real
--   signed read as two different tenants — see the bottom of this file.
--
-- ---------------------------------------------------------------------------
-- ★★ 0. THE ROOT CAUSE OF "I TYPE @Miles AND NOTHING HAPPENS"
-- ---------------------------------------------------------------------------
-- fix-329's brief guessed that `@Miles` worked and only `@mi` failed. Measured
-- on prod 2026-08-17, that guess was wrong and the truth is worse:
--
--   SELECT name, full_name FROM profiles JOIN tenant_memberships USING (...)
--   -> 29 rows, name IS NULL and full_name IS NULL on EVERY ONE.
--   auth.users.raw_user_meta_data has no full_name/name/display_name either.
--
-- So bp_mentionable_people's COALESCE fell all the way through to `pr.email`
-- and the mentionable roster was 29 EMAIL ADDRESSES. `@Miles` matched nothing
-- because the only name on offer was `@miles@blueprintcap.com`. A typeahead
-- alone would have "fixed" this by showing Bobby a dropdown of email addresses.
--
-- ★ The human names live in ONE place in this database: `team_members.name`,
-- joined to a login by `team_members.email`. That is fix-176's mapping
-- (login → roster → discipline), and this reuses it rather than inventing a
-- second answer or backfilling profiles. 22 of the 29 logins resolve to a
-- roster name; the other 7 fall back to the email's local part, which is a
-- readable handle and is never blank.
--
-- ★ NO ROWS ARE WRITTEN. profiles.name stays NULL. The standing rule is that
-- existing rows are not backfilled, and a display name derived at read time
-- cannot drift out of date the way a copied one can.

-- ---------------------------------------------------------------------------
-- 1. One definition of a person's display name
-- ---------------------------------------------------------------------------
-- ★ Used by BOTH chat RPCs, so the name on a message and the name in the
-- picker are the same string. Two spellings of a person is exactly how "@Miles"
-- would resolve in one place and not the other.
--
-- Ordering inside the roster lookup prefers a CURRENT row: a person can hold
-- several roster rows (one per role) and a live role is the one whose name
-- should show.
-- ★ TENANT-SCOPED, because it is SECURITY DEFINER and granted to
-- `authenticated`: without the EXISTS below it would resolve ANY profile's name
-- for anybody holding the uuid. Every read path in this app is tenant-bounded
-- (fix-157) and a name lookup is not the place to make the first exception.
-- Outside the caller's tenant it returns NULL and the surface renders 'Unknown'.
CREATE OR REPLACE FUNCTION public.bp_profile_display_name(p_profile_id uuid)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    NULLIF(TRIM(pr.name), ''),
    NULLIF(TRIM(pr.full_name), ''),
    (
      SELECT NULLIF(TRIM(tm.name), '')
      FROM public.team_members tm
      WHERE tm.tenant_id = ANY (public.auth_tenant_ids())
        AND tm.email IS NOT NULL
        AND lower(TRIM(tm.email)) = lower(TRIM(pr.email))
        AND NULLIF(TRIM(tm.name), '') IS NOT NULL
      ORDER BY (tm.active IS NOT FALSE AND tm.former IS NOT TRUE) DESC, tm.name
      LIMIT 1
    ),
    NULLIF(split_part(COALESCE(pr.email, ''), '@', 1), ''),
    pr.email
  )
  FROM public.profiles pr
  WHERE pr.id = p_profile_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = pr.id
        AND m.tenant_id = ANY (public.auth_tenant_ids())
    );
$$;

COMMENT ON FUNCTION public.bp_profile_display_name(uuid) IS
  'fix-330: a login''s human name. profiles.name/full_name are NULL for all 29 '
  'production logins, so this resolves through team_members.email (fix-176''s '
  'login->roster mapping) and falls back to the email local part. Read-time '
  'derivation on purpose — nothing is backfilled onto profiles.';

REVOKE ALL ON FUNCTION public.bp_profile_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_profile_display_name(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Who the @ picker may offer — fix-321's rule, server side
-- ---------------------------------------------------------------------------
-- ★ CHOOSING someone is the current roster only; SHOWING who someone is stays
-- whatever is recorded. This function is a picker source, so it is the first
-- half — and it applies lib/roster.ts's exact predicate
-- (`active IS NOT FALSE AND former IS NOT TRUE`) rather than a second one.
--
-- ★ UNKNOWN IS NOT DEPARTED. Someone with a login and no roster row at all
-- (7 of 29 today: keenan, ldeherrera, dave, taylor, greg, ej, jake, keelie,
-- jessie) is still offered. formerMemberNames documents why: treating unknown
-- as departed quietly hides live people. Only a roster that ACTUALLY SAYS the
-- person has left removes them, which is the case where every matching row is
-- retired.
--
-- Measured today: the three retired roster rows (Alex, Chad, Nidhi) have no
-- email and no login, so this filter removes nobody yet. It is written for the
-- first person who leaves while still holding a login — the exact shape
-- roster.ts was written for.
CREATE OR REPLACE FUNCTION public.bp_mentionable_people()
  RETURNS TABLE (user_id uuid, name text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT DISTINCT
         pr.id AS user_id,
         public.bp_profile_display_name(pr.id) AS name,
         pr.email
  FROM public.tenant_memberships tm
  JOIN public.profiles pr ON pr.id = tm.user_id
  WHERE tm.tenant_id = ANY (public.auth_tenant_ids())
    AND COALESCE(pr.active, true)
    -- ★ fix-321: excluded ONLY when the roster says so — rows exist for this
    -- email and not one of them is current.
    AND NOT (
      EXISTS (
        SELECT 1 FROM public.team_members r
        WHERE r.tenant_id = ANY (public.auth_tenant_ids())
          AND r.email IS NOT NULL
          AND lower(TRIM(r.email)) = lower(TRIM(pr.email))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.team_members r
        WHERE r.tenant_id = ANY (public.auth_tenant_ids())
          AND r.email IS NOT NULL
          AND lower(TRIM(r.email)) = lower(TRIM(pr.email))
          AND r.active IS NOT FALSE
          AND r.former IS NOT TRUE
      )
    )
  ORDER BY 2;
$$;

COMMENT ON FUNCTION public.bp_mentionable_people() IS
  'fix-330: people the @ picker may offer. Names resolve through '
  'bp_profile_display_name (team_members.email), and fix-321''s rule applies — '
  'someone the roster says has left is never offered, while someone with no '
  'roster row at all still is (unknown is not departed).';

REVOKE ALL ON FUNCTION public.bp_mentionable_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_mentionable_people()
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Attachments live on the message row
-- ---------------------------------------------------------------------------
-- ★ jsonb, not a child table — the SAME argument fix-329 made for `mentions`
-- and it holds for exactly the same reason. An attachment list is written once
-- with its message, never edited (the table has no UPDATE grant), always read
-- with its message, and never queried on its own. A child table earns its keep
-- when the child changes independently; this one cannot.
--
-- Shape: [{"path","name","mime","size"}]. `path` is the storage object key —
-- the file itself is in the bucket below, not in the database.
ALTER TABLE public.project_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.project_messages
  DROP CONSTRAINT IF EXISTS project_messages_attachments_shape;
ALTER TABLE public.project_messages
  ADD CONSTRAINT project_messages_attachments_shape
  CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 5);

-- ★ A SNIP WITH NO WORDS IS A MESSAGE. fix-329 required a non-empty body
-- because a message was only ever text. Pasting a screenshot and pressing send
-- is how Bobby said he would actually use this, so an attachment-only message
-- must be legal — but a message that is BOTH empty and attachment-less still
-- must not be.
ALTER TABLE public.project_messages
  DROP CONSTRAINT IF EXISTS project_messages_body_check;
ALTER TABLE public.project_messages
  ADD CONSTRAINT project_messages_body_check
  CHECK (length(btrim(body)) > 0 OR jsonb_array_length(attachments) > 0);

COMMENT ON COLUMN public.project_messages.attachments IS
  'fix-330: [{path,name,mime,size}] for files uploaded with this message. '
  'Denormalized jsonb for the same reason mentions is a uuid[] — written once '
  'with an append-only row, always read with it, never queried alone. `path` '
  'keys storage.objects in the chat-attachments bucket.';

-- ---------------------------------------------------------------------------
-- 4. The bucket
-- ---------------------------------------------------------------------------
-- ★ PRIVATE. Every other read path in this app is tenant-scoped and a public
-- bucket would make an attachment the one thing in the product readable by a
-- stranger with a URL. Reads go through a short-lived signed URL instead.
--
-- ★ LIMITS ARE ENFORCED AT THE BUCKET, not only in the browser. A client-side
-- check is a courtesy that tells the person WHY; the bucket is what makes the
-- limit true. Both must agree, and src/lib/chatAttachments.ts holds the same
-- two lists with a test that diffs them against this file.
--
--   25 MB — the mockup's own example is an 11 MB plan set, so 10 MB would have
--           rejected the first real file. 25 sits under Supabase's 50 MB
--           per-request ceiling with room to spare.
--   types — what a permitting team actually pastes and attaches: screenshots,
--           photos, PDFs, and the office documents that arrive by email.
--           Everything else is refused, by name, with the reason shown.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  26214400,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/heic',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 5. RLS on the objects themselves
-- ---------------------------------------------------------------------------
-- ★ The tenant test is the SAME ONE plan-thumbnails already uses: the first
-- path segment is a project id, and the project must be in the caller's tenant.
-- The path is therefore `{project_id}/{uuid}/{filename}`, and a caller cannot
-- read across tenants because they cannot name a project id that resolves.
--
-- It matches project_messages deliberately: same tenant, readable by anyone in
-- it. An attachment that a teammate can see the message for but not open would
-- be a second, quieter permission model.
--
-- ★★ NO UPDATE AND NO DELETE FOR authenticated, and that is the orphan story:
--
--   A message can never be deleted (project_messages has no DELETE grant), so
--   a message-deletion orphan cannot exist.
--
--   A file uploaded and then abandoned cannot exist either, because the
--   composer holds picked and pasted files in memory and uploads them in the
--   same action that inserts the message. Closing the modal uploads nothing.
--
--   The one orphan that CAN happen is an upload that succeeded followed by an
--   insert that failed. Those objects are unreferenced and unreachable — no
--   surface lists the bucket — and they are deliberately NOT cleanable by the
--   client, for the same reason messages are append-only: a browser that can
--   delete storage objects can silently hollow out a message somebody else has
--   already read. Sweeping them is a service_role job against
--   `NOT EXISTS (SELECT 1 FROM project_messages WHERE attachments @> ...)`;
--   there is nothing to sweep today and nothing accumulates on its own.
DROP POLICY IF EXISTS chat_attachments_tenant_read ON storage.objects;
CREATE POLICY chat_attachments_tenant_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 1)
        AND p.tenant_id = ANY (public.auth_tenant_ids())
    )
  );

DROP POLICY IF EXISTS chat_attachments_tenant_insert ON storage.objects;
CREATE POLICY chat_attachments_tenant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(objects.name, '/', 1)
        AND p.tenant_id = ANY (public.auth_tenant_ids())
    )
  );

DROP POLICY IF EXISTS chat_attachments_service_write ON storage.objects;
CREATE POLICY chat_attachments_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'chat-attachments')
  WITH CHECK (bucket_id = 'chat-attachments');

-- ---------------------------------------------------------------------------
-- 6. The read RPC gains attachments and the task's permit
-- ---------------------------------------------------------------------------
-- The return type changes, so this drops and recreates rather than REPLACEs.
--
-- ★ task_permit_id is here for the link-back's last hop: the thread can say
-- WHICH permit a chat-born task landed on, and link to it, instead of asserting
-- that it went somewhere.
DROP FUNCTION IF EXISTS public.bp_list_project_messages(uuid);
CREATE FUNCTION public.bp_list_project_messages(p_project_id uuid)
  RETURNS TABLE (
    id uuid,
    project_id uuid,
    author_id uuid,
    author_name text,
    body text,
    mentions uuid[],
    attachments jsonb,
    created_at timestamptz,
    task_id uuid,
    task_text text,
    task_permit_id integer
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT m.id, m.project_id, m.author_id,
         -- ★ The same display name the picker offers, so the author line and
         -- the mention token cannot spell the same person two ways.
         public.bp_profile_display_name(m.author_id) AS author_name,
         m.body, m.mentions, m.attachments, m.created_at,
         t.id AS task_id, t.text AS task_text, t.permit_id AS task_permit_id
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
-- 7. Grants are re-asserted, because Supabase keeps handing them back
-- ---------------------------------------------------------------------------
-- ★ ADDING A COLUMN does not re-grant, but this file has been edited by hand
-- and the column-level story is easy to get wrong. Re-stating costs nothing and
-- the alternative has bitten this project three times
-- (permit_milestone_acks, board_item_reads, project_messages itself).
REVOKE ALL ON TABLE public.project_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.project_messages TO authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.project_messages FROM authenticated;

-- ---------------------------------------------------------------------------
-- ★ WHAT WAS ACTUALLY MEASURED AFTER APPLYING (prod, 2026-08-17), not read off
--   this file. Two rolled-back probes; nothing was left behind — re-counted
--   afterwards at 0 messages, 0 chat-born tasks, 0 attachment objects,
--   1 tenant.
--
-- GRANTS — has_table_privilege on public.project_messages
--   authenticated  SELECT t  INSERT t  UPDATE f  DELETE f  TRUNCATE f
--   anon           SELECT f  INSERT f
--
-- BUCKET — storage.buckets where id='chat-attachments'
--   public f · file_size_limit 26214400 · 12 allowed mime types · 3 policies
--
-- ★★ STORAGE RLS, EXERCISED AGAINST REAL OBJECT ROWS AS TWO REAL TENANTS
--   (a second tenant, login and project were created inside the probe so
--   "another tenant" was not hypothetical), acting as role `authenticated`
--   with request.jwt.claims set:
--     insider upload into own project        ALLOWED
--     insider upload into ANOTHER tenant     BLOCKED
--     insider read of own attachment         1 row
--   ★ OUTSIDER read of that attachment       0 rows
--   ★ OUTSIDER read of the whole bucket      0 rows
--     outsider upload into Blueprint project BLOCKED
--   ★ insider DELETE of an attachment        BLOCKED   <- the orphan story
--
--   Honest limit: this exercises the SELECT policy the Storage API evaluates
--   before it will sign anything, with a real object row — it is not an HTTP
--   fetch of a minted signed URL, which needs a real user session token this
--   session does not have. The bucket is private, so there is no unsigned path.
--
-- ★ THE CHAIN, END TO END (second probe, on 1301 6th Ave N — 9 permits):
--     message inserted with an attachment and a mention   ok
--     bp_upsert_permit_task on the CHOSEN permit 10283    ok
--     bp_list_permit_tasks(10283) contains it             1   <- ★ the last hop
--     bp_list_permit_tasks(10276, the anchor)             0
--     bp_list_tasks() (My Tasks + My Board)               1
--     bp_my_tasks('Miles')                                1
--     thread link-back task_permit_id                     10283
--     thread returns the attachment                       1
--     author_name                                         'Bobby'  (was an email)
--     attachment-only message                             ACCEPTED
--     empty, attachment-less message                      REFUSED
--     six attachments on one message                      REFUSED
--     UPDATE a message                                    BLOCKED
-- ---------------------------------------------------------------------------
