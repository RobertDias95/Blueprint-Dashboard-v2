import { useMemo, useState } from 'react';
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
import ProjectChatModal from './ProjectChatModal';
import ChatAttachments from './ChatAttachments';
import { Avatar, MessageBody } from './ChatMessageBody';
import type { MentionablePerson, Permit } from '../../lib/database.types';

// fix-331 §3 — the conversation lives INSIDE the Team card now.
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

export default function ProjectChatSection({
  projectId,
  permits,
}: {
  projectId: string;
  /** For anchoring a chat-born task — passed straight through to the modal. */
  permits: Permit[];
}) {
  const [open, setOpen] = useState(false);
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
    <>
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

        {/* ★ A LINK, NOT A BUTTON BAR. Inside a section the treatment has to be
            quieter than the rail card's full-width footer button was, or it
            reads as the widget it is no longer allowed to be. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start text-[10.5px] font-bold text-de hover:underline bg-transparent border-none p-0 cursor-pointer"
          data-testid="project-chat-open"
        >
          {posts.length > PREVIEW_COUNT
            ? `Open chat (${posts.length} posts) →`
            : 'Open chat →'}
        </button>
      </div>

      {open && (
        <ProjectChatModal
          projectId={projectId}
          permits={permits}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * ★ The unread pill, rendered by the CALLER beside the section heading.
 *
 * It is exported separately because <OverviewSection> owns the heading row, and
 * a count drawn inside the body would sit under the word "Chat" rather than
 * beside it — the layout every other badge in this app uses. Same query, same
 * subtraction, same source as the bell; see the header note.
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
      className="text-[8.5px] font-extrabold text-de"
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
      <Avatar name={latest.author_name} />
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
