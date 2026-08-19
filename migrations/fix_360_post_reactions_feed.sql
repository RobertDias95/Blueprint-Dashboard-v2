-- ===========================================================================
-- fix-360 §2 — a reaction tells its author, once, and it keeps counting
-- ===========================================================================
--
-- Bobby, in full, because the SHAPE matters more than the feature:
--
--   "Sometimes we like to see when someone reacts… maybe it's not 15 different
--    notifications. Maybe it's one notification in our notification center
--    because it's one post, but it's multiple reactions to that post. So
--    instead of us getting 15 notifications, it's one notification, but it pops
--    up the bell 12 times and mark it as read then three times, but in the
--    actual notification center it just shows that this post got 15 reactions,
--    or eight thumbs up and six smiley faces, versus breaking it down one by
--    one. So that way you can easily just click that one notification and mark
--    it all as read instantly versus having to check off 15 separate
--    notifications."
--
-- ★★ THE ONLY THING THIS MIGRATION ADDS IS A READ. There is no new table and
-- no new column, and that is a finding rather than a shortcut — see the note on
-- the watermark key in src/lib/postReactions.ts. fix-307 made board_item_reads
-- APPEND-ONLY on purpose ("there is no such thing as un-reading"), and an
-- item that must re-open when its content changes is expressible in exactly
-- that model, by putting the newest reaction's instant in the key.
--
-- ★ fix-347 established what a reaction IS — a read receipt, not decoration
-- (register #148). This does not restate that; it delivers the receipt to the
-- person it was for.

-- ---------------------------------------------------------------------------
-- Reactions on MY posts, minus my own
-- ---------------------------------------------------------------------------
--
-- ★ ONE ROW PER REACTION, deliberately, even though the client renders one row
-- per POST. The aggregation ("8 👍 · 6 😊") is the part a person reads and
-- therefore the part worth having under test, and a SQL GROUP BY would put it
-- where no test in this repo can reach it. The volume this guards is small by
-- construction: it is only ever reactions to one person's own posts.
--
-- ★ `deleted_at IS NULL` — fix-334 made deletion SOFT, so a deleted post keeps
-- its rows. Being told about applause for a post you deleted is noise about
-- something that is no longer there.
--
-- ★★ AND NEVER YOUR OWN REACTION. `mr.user_id <> auth.uid()` is the whole of
-- rule six, and it lives here rather than in the client because the client
-- should not have to be trusted with "do not tell me about me". Reacting to
-- your own post is a legitimate thing to do (fix-347 treats a reaction as an
-- acknowledgement, and acknowledging your own post is how you say "still
-- mine") — it just is not news.
CREATE OR REPLACE FUNCTION public.bp_my_post_reactions(p_limit integer DEFAULT 500)
  RETURNS TABLE (
    message_id uuid,
    project_id uuid,
    post_title text,
    post_excerpt text,
    emoji text,
    reacted_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT
    m.id          AS message_id,
    m.project_id  AS project_id,
    m.title       AS post_title,
    -- ★ Enough to know WHICH post, and no more. The centre's row is about the
    -- reactions; the post is identification, not content.
    left(m.body, 120) AS post_excerpt,
    mr.emoji      AS emoji,
    mr.created_at AS reacted_at
  FROM public.message_reactions mr
  JOIN public.project_messages m ON m.id = mr.message_id
  WHERE m.author_id = auth.uid()
    AND m.deleted_at IS NULL
    AND mr.user_id <> auth.uid()
    AND mr.tenant_id = ANY (public.auth_tenant_ids())
  ORDER BY mr.created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.bp_my_post_reactions(integer) IS
  'fix-360 §2: reactions to the caller''s own posts, excluding the caller''s '
  'own. One row per reaction; the client groups them into one board item per '
  'post. Never notifies anyone about their own reaction.';

REVOKE ALL ON FUNCTION public.bp_my_post_reactions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_my_post_reactions(integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ★ Nothing else changes.
-- ---------------------------------------------------------------------------
-- §1 (grouping a permit's simultaneous changes) is entirely client-side: the
-- run identity it groups on, `changes->>'scraper_run_at'`, is already stamped
-- on every scrape_change_applied row by the scraper. No column was added and
-- no row was edited — see src/lib/boardFlips.ts for what that stamp turned out
-- to actually mean, which is not quite what the brief assumed.
