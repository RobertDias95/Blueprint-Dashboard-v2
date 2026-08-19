// ===========================================================================
// ★★★ fix-360 §2 — a reaction tells its author, once, and it keeps counting
// ===========================================================================
//
// Bobby, in full, because the SHAPE matters more than the feature:
//
//   "Sometimes we like to see when someone reacts… maybe it's not 15 different
//    notifications. Maybe it's one notification in our notification center
//    because it's one post, but it's multiple reactions to that post. So
//    instead of us getting 15 notifications, it's one notification, but it pops
//    up the bell 12 times and mark it as read then three times, but in the
//    actual notification center it just shows that this post got 15 reactions,
//    or eight thumbs up and six smiley faces, versus breaking it down one by
//    one. So that way you can easily just click that one notification and mark
//    it all as read instantly versus having to check off 15 separate
//    notifications."
//
// ★★★ THIS IS A NEW SHAPE, and getting it wrong is the whole risk. Every board
// item before it is *one thing happened → one row → one read*. This is ONE ROW
// THAT MUTATES: it exists from the first reaction and its content changes as
// more arrive.
//
// ★ fix-347 established what a reaction IS — a read receipt, not decoration
// (register #148). Nothing here restates that. This delivers the receipt to the
// person it was for.

/** One reaction on one of the viewer's own posts, as bp_my_post_reactions
 *  returns it. ★ The viewer's OWN reactions are already excluded server-side —
 *  see the migration, and rule six. */
export interface PostReactionRow {
  message_id: string;
  project_id: string;
  post_title: string | null;
  post_excerpt: string;
  emoji: string;
  reacted_at: string;
}

export interface EmojiTally {
  emoji: string;
  count: number;
}

/** Everything one board item needs to say "8 👍 · 6 😊 on this post". */
export interface ReactionDigest {
  messageId: string;
  projectId: string;
  postTitle: string | null;
  postExcerpt: string;
  /** Every reaction on the post, from everyone but its author. */
  total: number;
  /** ★ THE BODY, and the brief is specific about it: an aggregate BY EMOJI —
   *  not a list of names, not a list of events. Biggest group first so the
   *  order means something; ties broken by emoji so it is stable. */
  byEmoji: EmojiTally[];
  /** ★★ THE WATERMARK — the newest reaction folded into this digest. It is the
   *  read key's second half; see keyForReactions. */
  newestAt: string;
}

// ---------------------------------------------------------------------------
// ★★★ THE WATERMARK KEY — and why §2 needed no new table after all
// ---------------------------------------------------------------------------
//
// The brief expected "a new table or column" here, and there is neither. That
// is a finding rather than a shortcut, and it turns on one sentence fix-307
// wrote when it built the read model:
//
//     "Append-only: SELECT + INSERT only. Reading is a fact that happened at a
//      moment; there is no such thing as un-reading, and 'mark all read' is
//      expressed as more rows rather than a mutated one."
//
// ★★ An item that must RE-OPEN when its content changes looks at first like the
// thing that model cannot express — you would want to move `read_at` forward,
// which is an UPDATE the table deliberately does not grant. But the requirement
// is not "un-read the row". It is: *this digest, the one you actually saw, is
// read; a digest containing something you have not seen is not.* Those are two
// different facts, so in an append-only model they are two different rows —
// and the key is what tells them apart.
//
// ★★★ SO THE KEY CARRIES THE WATERMARK: `reaction:{message_id}:{newestAt}`.
//
//   * 15 reactions, never read       → ONE key, ONE row in the centre.
//   * Marking it read                → ONE insert. One click clears all 15,
//                                      which is the requirement Bobby stated
//                                      twice.
//   * A 16th reaction arrives        → the watermark moves, so the key moves,
//                                      so there is no read row for it: unread
//                                      again, carrying the NEW total.
//   * Nothing arrives                → the key is unchanged, so re-deriving the
//                                      feed forever produces no new unread
//                                      item. Idempotent.
//
// ★★ AND IT COSTS NOTHING ELSEWHERE. `Notifications.tsx` carries its own copy
// of the unread predicate (`!readKeys.has(i.key)`) because the centre renders
// both states per row rather than a filtered list. A read model taught a new
// rule — "read, unless something newer arrived" — would have had to be taught
// to that predicate too, and the day it was not, the bell and the centre would
// disagree about the same item. That is the exact failure fix-329 exists to
// prevent. A key that already encodes the state needs no second rule anywhere.
//
// ★ Is a key built from a value not the thing §1 forbids? §1 forbids it because
// a flip is IMMUTABLE — a key that moved under it would silently re-notify, and
// that is a defect. Here re-notifying is the specification. The same property
// is a bug in one section and the mechanism in the other, which is why the two
// sections key differently and why this note exists.
//
// ★ A removed reaction (fix-347 lets you toggle) walks the watermark BACK to an
// earlier instant, which is a key that was very likely already read — so the
// item quietly settles rather than announcing that somebody changed their mind.
// Re-adding it produces a new instant, and therefore new news. A count in the
// key would get that pair wrong in both directions.

/** ★ The stable half is the message id; the moving half is the watermark. */
export function keyForReactions(messageId: string, newestAt: string): string {
  return `reaction:${messageId}:${newestAt}`;
}

/** ★ Every reaction key for one post, whatever its watermark — for tests and
 *  for anything that needs to ask "is this row about that post". */
export function isReactionKeyFor(key: string, messageId: string): boolean {
  return key.startsWith(`reaction:${messageId}:`);
}

/**
 * ★★★ FIFTEEN REACTIONS ON ONE POST BECOME ONE DIGEST.
 *
 * Grouped by POST, never by reactor and never by emoji — "one notification in
 * our notification center because it's one post". A post with no reactions from
 * anybody but its author yields nothing at all, because there is no news in it.
 */
export function buildReactionDigests(
  rows: ReadonlyArray<PostReactionRow>,
): ReactionDigest[] {
  const byMessage = new Map<string, PostReactionRow[]>();
  for (const r of rows) {
    const bucket = byMessage.get(r.message_id);
    if (bucket) bucket.push(r);
    else byMessage.set(r.message_id, [r]);
  }

  const digests: ReactionDigest[] = [];
  for (const [messageId, group] of byMessage) {
    const counts = new Map<string, number>();
    let newestAt = '';
    for (const r of group) {
      counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
      if (r.reacted_at > newestAt) newestAt = r.reacted_at;
    }
    const byEmoji = [...counts.entries()]
      .map(([emoji, count]) => ({ emoji, count }))
      // Biggest group first; emoji as the tie-break so the same set of
      // reactions always renders the same way. A body that reshuffles between
      // renders reads as new news when nothing has happened.
      .sort((a, z) => z.count - a.count || a.emoji.localeCompare(z.emoji));

    digests.push({
      messageId,
      projectId: group[0].project_id,
      postTitle: group[0].post_title,
      postExcerpt: group[0].post_excerpt,
      total: group.length,
      byEmoji,
      newestAt,
    });
  }

  // Newest activity first, matching every other board source.
  return digests.sort((a, z) => z.newestAt.localeCompare(a.newestAt));
}

/** ★ "8 👍 · 6 😊" — the aggregate, in the order buildReactionDigests fixed. */
export function formatEmojiTally(byEmoji: ReadonlyArray<EmojiTally>): string {
  return byEmoji.map((t) => `${t.count} ${t.emoji}`).join(' · ');
}

/** ★ The headline. The COUNT is the news — "this post got 15 reactions" — and
 *  the emoji breakdown is the body under it, which is how Bobby described it. */
export function reactionTitle(total: number): string {
  return total === 1
    ? '1 reaction to your post'
    : `${total} reactions to your post`;
}

/** ★ The body: the tally, then just enough of the post to know WHICH post.
 *
 *  The brief says the body is an aggregate by emoji rather than a list of names
 *  or events, and it is — the excerpt is neither. It is identification, and
 *  without it a person with two posts in one project cannot tell which one the
 *  applause was for. */
export function reactionDetail(d: ReactionDigest): string {
  const tally = formatEmojiTally(d.byEmoji);
  const which = (d.postTitle ?? d.postExcerpt).trim();
  if (!which) return tally;
  const short = which.length > 60 ? `${which.slice(0, 57)}…` : which;
  return `${tally} — ${short}`;
}
