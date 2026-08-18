import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useBoardReads } from '../../hooks/useBoardReads';
import {
  useMentionablePeople,
  useProjectMessages,
} from '../../hooks/useProjectMessages';
import {
  groupIntoPosts,
  isDeleted,
  keyForMention,
  mentionsMe,
  type ChatPost,
} from '../../lib/projectChat';
import ChatAttachments from './ChatAttachments';
import { MessageBody } from './ChatMessageBody';
import type { MentionablePerson } from '../../lib/database.types';

// fix-331 §3 — the conversation lives INSIDE the Team card now.
//
// ★★ fix-346 §1 MOVED THE SECTION DOWN, and only that. The Team card reads
// Internal · External · Chat · [Chat button] — Bobby: "move that chat down
// below, above the chat button, so that it goes internal, external, and then
// here's the chat section, and then it shows your two most recent chats, and
// then the chat button." Nothing in THIS file changed for the move: the caller
// (TeamCell) owns the placement, which is the point of this being a section
// body rather than a card. What did change here is §1b — the author avatar came
// off each preview row; see MiniPost.
//
// Bobby: "Move the Project Chat UI into the Team on Project Overview, between
// Internal and External. That way your project chat lives in between the two
// teams and it flows. Someone goes onto Project Overview, they see something,
// they're like, okay who's on this project — they can just see right there, open
// the chat, boom."
//
// ★★ AND IT HAD TO READ AS PART OF THE CARD, which is the half that decided the
// implementation. Bobby, on the first version: "feels like it is part of the
// team card, not a separate UI feature/function like it shows now."
//
// So this component is a SECTION BODY, not a card. It renders no border, no
// background, no header of its own — the caller wraps it in the same
// <OverviewSection> that draws INTERNAL and EXTERNAL, and the separator, the
// padding and the heading all come from there. That is the difference between a
// third section of Team and a widget dropped into it, and it is asserted: the
// test checks that nothing inside this section draws a second bordered box.
//
// ★ THE RAIL CARD IS GONE. One home for the conversation — the left rail is back
// to Permits and Redesigns. Two entry points to one thread was the thing that
// made it feel bolted on.
//
// ★★ THE UNREAD COUNT IS UNCHANGED AND STILL THE BELL'S. `mention:{message_id}`
// keys (fix-307's scheme) minus board_item_reads — the same two inputs the badge
// uses — so reading a mention in either place stops it counting in both. fix-329
// established this and fix-298 Phase 2 spent a ticket collapsing the defect of
// two counts that could disagree. Moving the surface does not get to re-open it.

/** ★ One or two, per Bobby: "If anything we just want to display maybe one or
 *  two of the most previous messages, and then the rest you would have to open."
 *  Two, because one message with no predecessor reads as an announcement rather
 *  than a conversation — and because the section sits in the middle of a card
 *  whose other two sections are lists. */
const PREVIEW_COUNT = 2;

// ★★ fix-345 §3: THIS IS THE PREVIEW, AND ONLY THE PREVIEW.
//
// It used to own the modal and the "Open chat →" link as well. Bobby asked for
// a uniform bottom button on every Project Overview card — "make them all at
// the bottom and horizontally equally and vertically equal" — and the Team
// card's way in had to become that button, which lives in a different section
// of the same card.
//
// ★ So the open state moved UP to the card (TeamCell), which owns both the
// section this renders into and the pinned button section at its foot. One
// owner, one modal, two children. The alternative was leaving a second opener
// in here, and two ways into one thread from one card is the exact shape this
// ticket is removing.
//
// ★ `permits` went with the modal — this component never used them for
// anything else.
export default function ProjectChatSection({ projectId }: { projectId: string }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const messagesQ = useProjectMessages(projectId);
  const peopleQ = useMentionablePeople();

  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);
  const people = useMemo(() => peopleQ.data ?? [], [peopleQ.data]);

  // ★★ fix-334: the section previews POSTS, not raw messages. Bobby's rule from
  // fix-331 still holds — "one or two of the most previous messages, and then
  // the rest you would have to open" — but the unit of a conversation is a post
  // now, and two posts say more about what is happening on a project than the
  // last two replies torn out of whichever one happened to be busiest.
  const posts = useMemo(() => groupIntoPosts(messages), [messages]);
  const preview = useMemo(() => posts.slice(0, PREVIEW_COUNT), [posts]);

  return (
    <div className="flex flex-col gap-1.5" data-testid="project-chat-mini">
        {messagesQ.isLoading ? (
          <div className="text-[10.5px] text-dim italic">Loading…</div>
        ) : preview.length === 0 ? (
          // ★ An empty thread says what to do, rather than rendering an empty
          // block that looks broken.
          <div className="text-[10.5px] text-dim italic" data-testid="project-chat-empty">
            No posts yet — open the chat to start one.
          </div>
        ) : (
          preview.map((p) => (
            <MiniPost key={p.post.id} entry={p} people={people} userId={userId} />
          ))
        )}

      {/* ★★ fix-345 §3: THE INLINE "Open chat →" LINK IS GONE. The way in is
          the Chat button at the foot of this card now — see TeamCell.

          Bobby's rule, applied to his own ask: "Two ways into the same modal
          from one card is one too many." fix-346 §1 then moved the preview
          itself down to sit directly ABOVE that button — preview, then the way
          in — so the two are adjacent instead of separated by External. */}
    </div>
  );
}

// ★ fix-345 §3: `useProjectPostCount` — the number the Team card's Chat button
// prints — lives in hooks/useProjectMessages.ts, not here. This is a component
// file, and the react-refresh rule lets one export only components.

/**
 * ★ The unread count. Same query, same subtraction, same source as the bell —
 * see the header note. That has never changed and is the part that matters.
 *
 * ★★ fix-345 §3 MOVED IT ONTO THE BUTTON. It was the section heading's
 * `titleRight`, which was the right place while the heading sat above the only
 * chat affordance on the card. The way in is now the Chat button at the card's
 * foot, and the brief's rule is that the indicator stays on whichever control
 * survives — a count beside a heading is decoration, a count on the control you
 * are about to press is information. Rendering it in both places would be one
 * number in two spots, free to disagree the moment somebody edits one.
 *
 * ★ It sets no colour of its own any more: inside the action it inherits, so it
 * turns white with the rest of the label on hover instead of staying blue on a
 * blue fill.
 */
export function ProjectChatUnread({ projectId }: { projectId: string }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const messagesQ = useProjectMessages(projectId);
  const readsQ = useBoardReads();

  const unread = useMemo(() => {
    const read = new Set(readsQ.data ?? []);
    return (messagesQ.data ?? []).filter(
      (m) => mentionsMe(m, userId) && !read.has(keyForMention(m.id)),
    ).length;
  }, [messagesQ.data, readsQ.data, userId]);

  if (unread <= 0) return null;
  return (
    <span
      className="text-[8.5px] font-extrabold"
      data-testid="project-chat-unread"
    >
      {unread} new
    </span>
  );
}

/**
 * ★ One POST, at a glance. Title first — that is the whole reason posts exist:
 * "different posts for different concepts or different categories of chatting…
 * that way you can keep a chat more organized." A title plus a reply count says
 * what is going on; two lines of somebody's last sentence does not.
 *
 * ★ The MOST RECENT message in the post is what it previews underneath, so the
 * section still answers "what was just said" as well as "what is being
 * discussed".
 */
function MiniPost({
  entry,
  people,
  userId,
}: {
  entry: ChatPost;
  people: MentionablePerson[];
  userId: string | null;
}) {
  const latest =
    [...entry.replies].reverse().find((r) => !isDeleted(r)) ?? entry.post;
  const toMe =
    mentionsMe(entry.post, userId) ||
    entry.replies.some((r) => mentionsMe(r, userId) && !isDeleted(r));
  return (
    <div
      className="flex gap-2"
      style={
        toMe
          ? {
              background: 'var(--color-de-bg)',
              margin: '-2px -4px',
              padding: '2px 4px',
              borderRadius: 6,
            }
          : undefined
      }
      data-testid={`project-chat-mini-${entry.post.id}`}
      data-to-me={toMe ? 'true' : 'false'}
    >
      {/* ★★ fix-346 §1b: NO AVATAR. Bobby, on the circle beside each row: "I
          don't like the BO next to the post thread. I think just show recent
          threads and their replies, no need for the naming item."

          ★ THE PREVIEW LISTS THREADS, NOT MESSAGES — a title plus a reply
          count. An author circle answers a question nobody asked of a topic
          list, and on a post with replies it was actively misleading: it showed
          whoever wrote the LATEST message, which reads as ownership of the
          thread rather than authorship of one line in it.

          ★ SCOPE IS THE PREVIEW ONLY. Avatars stay on individual messages
          inside the modal, where "who said this" is the point — and
          `initialsOf()` is deliberately untouched (register #127, BO vs BD,
          lands with the roster names and still matters there). */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold text-text truncate">
            {entry.post.title}
          </span>
          <span className="text-[9px] text-dim flex-shrink-0">
            {entry.replyCount}{' '}
            {entry.replyCount === 1 ? 'reply' : 'replies'}
          </span>
        </div>
        {/* Two-line clamp — the section is a glance, not a read. */}
        <div
          className="text-[11px] text-text"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {isDeleted(latest) ? (
            <span className="text-dim italic">Message deleted</span>
          ) : (
            <MessageBody body={latest.body} people={people} />
          )}
        </div>
        {/* fix-330: an attachment shows here too, or a snip-only message would
            render as a blank row. Compact — one named line per file. */}
        <ChatAttachments attachments={latest.attachments ?? []} compact />
      </div>
    </div>
  );
}
