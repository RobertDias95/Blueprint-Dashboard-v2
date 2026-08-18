-- ===========================================================================
-- fix-347 — reactions that answer the NEGATIVE question, and two kinds of tag
-- ===========================================================================
--
-- ★★★ THE PRINCIPLE, which is the same one behind fix-307, fix-335 §9, fix-339
-- and fix-336. Bobby:
--
--   "Sometimes when we post we always say, react this to let us know that you
--    saw it. And then when we look at the reactions we can say, we saw fifteen
--    people thumbs up it, and we can hover over that thumbs up and see… if
--    anyone MISSED that post and didn't react."
--
-- A reaction here is a READ RECEIPT. The interesting query is not "how many"
-- but "who has not" — and "who has not" needs an AUDIENCE to subtract from,
-- which is what the tags in this same migration define.
--
-- ---------------------------------------------------------------------------
-- 1. message_reactions — one row per person per emoji per message
-- ---------------------------------------------------------------------------
--
-- ★ A REACTION NOTIFIES NOBODY. It writes nothing to project_messages.mentions
-- and creates no board item; fix-307's model derives items from tasks, flips,
-- acks, permits, mentions and post requests, and this table is deliberately not
-- among them. Acknowledging is not messaging.
--
-- ★ The emoji set is FIXED and small (a full picker is a different feature).
-- Bobby named thumbs up, heart, laugh and surprise; ✅ and 👀 join them because
-- this is a read-receipt feature and "seen it" / "looking at it" are the two
-- things people actually want to say with one click.
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES public.project_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ★ One row per person per emoji: clicking the same one again removes it,
  -- and the database says so rather than trusting the client to.
  UNIQUE (message_id, user_id, emoji)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.message_reactions'::regclass
      AND conname = 'message_reactions_emoji_check'
  ) THEN
    ALTER TABLE public.message_reactions
      ADD CONSTRAINT message_reactions_emoji_check
      CHECK (emoji IN ('👍', '❤️', '😂', '😮', '✅', '👀'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON public.message_reactions (message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_reactions_tenant_select ON public.message_reactions;
CREATE POLICY message_reactions_tenant_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★ You may only add or remove YOUR OWN reaction. "Who has not reacted" is only
-- worth reading if nobody can react on somebody else's behalf.
DROP POLICY IF EXISTS message_reactions_own_insert ON public.message_reactions;
CREATE POLICY message_reactions_own_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS message_reactions_own_delete ON public.message_reactions;
CREATE POLICY message_reactions_own_delete ON public.message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = ANY (public.auth_tenant_ids()));

REVOKE ALL ON public.message_reactions FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;

-- ---------------------------------------------------------------------------
-- 2. mention_tags / mention_tag_members — the CUSTOM tag
-- ---------------------------------------------------------------------------
--
-- Bobby: "The group tags should be customizable… we could have one group tag,
-- we could have 30 group tags, and it could be a different combination of
-- anyone in the tool."
--
-- ★ TENANT-WIDE, not per project: the same tag is available in every chat.
--
-- ★★ WHO MAY CREATE AND EDIT THEM: ADMINS. fix-334 restricted post CREATION to
-- admins and deliberately left replying open, and a tag sits on the creation
-- side of that line — it is a notification target, not a message. Anyone able
-- to define one could quietly build an "@everyone" that pages 29 people, and
-- editing one silently changes who a future post reaches. Everyone can USE
-- them; the roster of who is in one is admin-owned, exactly like the roster of
-- who is on a project (Settings → Team).
CREATE TABLE IF NOT EXISTS public.mention_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ★ Case-insensitive uniqueness per tenant: "@Leadership" and "@leadership"
-- must not be two different audiences.
CREATE UNIQUE INDEX IF NOT EXISTS mention_tags_tenant_name_key
  ON public.mention_tags (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.mention_tag_members (
  tenant_id uuid NOT NULL,
  tag_id    uuid NOT NULL REFERENCES public.mention_tags(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL,
  PRIMARY KEY (tag_id, user_id)
);

ALTER TABLE public.mention_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mention_tag_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mention_tags_tenant_select ON public.mention_tags;
CREATE POLICY mention_tags_tenant_select ON public.mention_tags
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

DROP POLICY IF EXISTS mention_tag_members_tenant_select ON public.mention_tag_members;
CREATE POLICY mention_tag_members_tenant_select ON public.mention_tag_members
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.auth_tenant_ids()));

-- ★ No write policies at all: every mutation goes through the admin-gated RPCs
-- below. A missing policy is a denial, so this is the gate rather than a
-- decoration on top of one.
REVOKE ALL ON public.mention_tags FROM PUBLIC, anon;
REVOKE ALL ON public.mention_tag_members FROM PUBLIC, anon;
GRANT SELECT ON public.mention_tags TO authenticated;
GRANT SELECT ON public.mention_tag_members TO authenticated;
GRANT ALL ON public.mention_tags TO service_role;
GRANT ALL ON public.mention_tag_members TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Reading and writing
-- ---------------------------------------------------------------------------

-- ★ Every reaction on one project's chat, with the reactor's display NAME —
-- because the feature is "hover the thumbs up and see who", and resolving 29
-- ids to names on the client would be a second answer to a question
-- bp_profile_display_name already answers (fix-343 verified it resolves for all
-- 29 logins).
CREATE OR REPLACE FUNCTION public.bp_list_message_reactions(p_project_id uuid)
RETURNS TABLE(message_id uuid, emoji text, user_id uuid, user_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.message_id, r.emoji, r.user_id,
         public.bp_profile_display_name(r.user_id) AS user_name
  FROM public.message_reactions r
  JOIN public.project_messages m ON m.id = r.message_id
  WHERE m.project_id = p_project_id
    AND m.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY r.created_at;
$function$;

REVOKE ALL ON FUNCTION public.bp_list_message_reactions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_message_reactions(uuid)
  TO authenticated, service_role;

-- ★ Toggle: the same click adds or removes, decided by what is already there
-- rather than by what the client believes. Returns the new state so the caller
-- never has to guess which way it went.
CREATE OR REPLACE FUNCTION public.bp_toggle_message_reaction(
  p_message_id uuid,
  p_emoji text
)
RETURNS TABLE(added boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_uid    uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bp_toggle_message_reaction: not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT m.tenant_id INTO v_tenant
  FROM public.project_messages m
  WHERE m.id = p_message_id AND m.tenant_id = ANY (public.auth_tenant_ids());
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_toggle_message_reaction: message % not in caller tenant', p_message_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.message_reactions
   WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    added := false;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.message_reactions (tenant_id, message_id, user_id, emoji)
  VALUES (v_tenant, p_message_id, v_uid, p_emoji)
  ON CONFLICT (message_id, user_id, emoji) DO NOTHING;

  added := true;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_toggle_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_toggle_message_reaction(uuid, text)
  TO authenticated, service_role;

-- ★ The tags, with their membership as an array — one row per tag, so the
-- picker does not have to stitch two queries together.
CREATE OR REPLACE FUNCTION public.bp_list_mention_tags()
RETURNS TABLE(id uuid, name text, member_ids uuid[], updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT t.id, t.name,
         COALESCE(
           (SELECT array_agg(m.user_id ORDER BY m.user_id)
              FROM public.mention_tag_members m WHERE m.tag_id = t.id),
           ARRAY[]::uuid[]
         ) AS member_ids,
         t.updated_at
  FROM public.mention_tags t
  WHERE t.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY lower(t.name);
$function$;

REVOKE ALL ON FUNCTION public.bp_list_mention_tags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_list_mention_tags()
  TO authenticated, service_role;

-- ★★ Create or edit, ADMIN ONLY (see the note on the table). The whole
-- membership is replaced in one call: a tag is a set, and applying a diff from
-- the client would let two admins editing at once each drop the other's change.
CREATE OR REPLACE FUNCTION public.bp_upsert_mention_tag(
  p_id uuid,
  p_name text,
  p_member_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := (public.auth_tenant_ids())[1];
  v_name   text := btrim(COALESCE(p_name, ''));
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: no tenant' USING ERRCODE = '42501';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'creating or editing a tag is restricted to admins'
      USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: a tag needs a name' USING ERRCODE = '22023';
  END IF;
  -- ★ The name is what people type after '@', so it cannot contain whitespace
  -- (the parser matches a token) or a leading '@' (that is the sigil, not the
  -- name). Rejected here rather than silently rewritten: a tag that is not
  -- called what you named it is worse than an error.
  IF v_name ~ '\s' OR left(v_name, 1) = '@' THEN
    RAISE EXCEPTION 'bp_upsert_mention_tag: a tag name is one word, without @ (got %)', v_name
      USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.mention_tags (tenant_id, name, created_by)
    VALUES (v_tenant, v_name, auth.uid())
    RETURNING mention_tags.id INTO v_id;
  ELSE
    UPDATE public.mention_tags
       SET name = v_name, updated_at = now()
     WHERE mention_tags.id = p_id
       AND mention_tags.tenant_id = ANY (public.auth_tenant_ids())
    RETURNING mention_tags.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bp_upsert_mention_tag: tag % not in caller tenant', p_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.mention_tag_members WHERE tag_id = v_id;
  INSERT INTO public.mention_tag_members (tenant_id, tag_id, user_id)
  SELECT v_tenant, v_id, u
  FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u
  -- ★ Only real logins in this tenant. A tag that "contains" somebody who
  -- cannot receive a notification is a promise it cannot keep.
  WHERE EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id = u AND tm.tenant_id = v_tenant
  )
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_upsert_mention_tag(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_upsert_mention_tag(uuid, text, uuid[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bp_delete_mention_tag(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT t.tenant_id INTO v_tenant FROM public.mention_tags t
   WHERE t.id = p_id AND t.tenant_id = ANY (public.auth_tenant_ids());
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'bp_delete_mention_tag: tag % not in caller tenant', p_id
      USING ERRCODE = '42501';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'deleting a tag is restricted to admins' USING ERRCODE = '42501';
  END IF;
  -- ★ Members cascade. Messages that used the tag are untouched by design:
  -- project_messages.mentions holds the RESOLVED ids, so "who did this reach?"
  -- survives the tag being edited or deleted entirely. That is §4's rule.
  DELETE FROM public.mention_tags WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bp_delete_mention_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_delete_mention_tag(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------------
--
-- ★★ REACTIONS STREAM. fix-336's rule is that publishing a table is a
-- per-table decision, and this one earns it: the whole feature is "who has seen
-- this", so a count that only moves on refresh is a lie in exactly the
-- dimension being measured — two people would sit on the same post disagreeing
-- about whether fifteen or sixteen had acknowledged it.
--
-- ★ The tag tables are NOT published: they change when an admin edits a roster,
-- which is a Settings action on a screen that refetches on save, and nothing
-- reads them continuously.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
