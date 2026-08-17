import { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useBoardReads } from '../../hooks/useBoardReads';
import {
  useMentionablePeople,
  useProjectMessages,
} from '../../hooks/useProjectMessages';
import {
  chatStamp,
  initialsOf,
  keyForMention,
  lastMessages,
  mentionsMe,
  splitBody,
} from '../../lib/projectChat';
import ProjectChatModal from './ProjectChatModal';
import ChatAttachments from './ChatAttachments';
import type { MentionablePerson, Permit, ProjectMessage } from '../../lib/database.types';

// fix-329 (register #71) — the chat card at the TOP of Project Overview's left
// rail, built to Project_Chat_Mockup_v2.
//
// ★ IT IS A DOORWAY, NOT THE CONVERSATION. Last three messages, two-line clamp,
// mentions of the viewer tinted, an unread count, and "Open chat →". The full
// thread and the composer live in the modal — the same shape BoardBell's
// dropdown uses, and for the same reason: a rail 216px wide cannot hold a
// conversation without becoming one.
//
// ★★ THE UNREAD COUNT COMES FROM THE BELL'S SOURCE. It is
// `mention:{message_id}` keys (fix-307's scheme) minus board_item_reads — the
// same two inputs the badge uses — so reading a mention in either place stops it
// counting in both. Two counts that can disagree is the defect fix-298 Phase 2
// spent a ticket collapsing; this deliberately does not rebuild it.

const MINI_COUNT = 3;

export default function ProjectChatCard({
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
  const readsQ = useBoardReads();

  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);
  const people = useMemo(() => peopleQ.data ?? [], [peopleQ.data]);

  /** Mentions of me on THIS project that I have not acknowledged. */
  const unread = useMemo(() => {
    const read = new Set(readsQ.data ?? []);
    return messages.filter(
      (m) => mentionsMe(m, userId) && !read.has(keyForMention(m.id)),
    ).length;
  }, [messages, readsQ.data, userId]);

  const mini = useMemo(() => lastMessages(messages, MINI_COUNT), [messages]);

  return (
    <>
      <section
        className="rounded-lg border bg-surface overflow-hidden flex-shrink-0"
        style={{ borderColor: 'var(--color-de-border)' }}
        data-testid="project-chat-card"
      >
        <header
          className="px-3 py-2 border-b flex items-center justify-between"
          style={{
            background: 'var(--color-de-bg)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-de">
            Project chat
          </span>
          {unread > 0 && (
            <span
              className="text-[9.5px] font-bold text-de"
              data-testid="project-chat-unread"
            >
              {unread} new
            </span>
          )}
        </header>

        <div className="p-2.5 flex flex-col gap-2" data-testid="project-chat-mini">
          {messagesQ.isLoading ? (
            <div className="text-[11px] text-dim italic">Loading…</div>
          ) : mini.length === 0 ? (
            // ★ An empty thread says what to do, rather than rendering an empty
            // box that looks broken.
            <div className="text-[11px] text-dim italic" data-testid="project-chat-empty">
              No messages yet — start the conversation.
            </div>
          ) : (
            mini.map((m) => (
              <MiniMessage key={m.id} message={m} people={people} userId={userId} />
            ))
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full border-t text-[11.5px] font-bold text-de py-1.5 hover:bg-de-bg transition"
          style={{ borderTopColor: 'var(--color-border)' }}
          data-testid="project-chat-open"
        >
          Open chat →
        </button>
      </section>

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

function MiniMessage({
  message,
  people,
  userId,
}: {
  message: ProjectMessage;
  people: MentionablePerson[];
  userId: string | null;
}) {
  const toMe = mentionsMe(message, userId);
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
      data-testid={`project-chat-mini-${message.id}`}
      data-to-me={toMe ? 'true' : 'false'}
    >
      <Avatar name={message.author_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold text-text truncate">
            {message.author_name ?? 'Unknown'}
          </span>
          <span className="text-[9px] text-dim flex-shrink-0">
            {chatStamp(message.created_at)}
          </span>
        </div>
        {/* Two-line clamp, per the mockup — the card is a glance, not a read. */}
        <div
          className="text-[11.5px] text-text"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          <MessageBody body={message.body} people={people} />
        </div>
        {/* ★ fix-330: an attachment shows here too, or a snip-only message would
            render as a blank row in the rail. Compact — this column is 240px
            wide, so it is one named line per file and the thumbnail waits for
            the modal. */}
        <ChatAttachments attachments={message.attachments ?? []} compact />
      </div>
    </div>
  );
}

/** ★ Shared by the card and the modal: mentions tint, everything else does not.
 *  The tint reads the SAME roster the parser did, so a highlighted run and a
 *  stored mention id can never disagree. */
export function MessageBody({
  body,
  people,
}: {
  body: string;
  people: MentionablePerson[];
}) {
  const segments = useMemo(() => splitBody(body, people), [body, people]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mention ? (
          <span
            key={i}
            className="font-semibold text-de"
            style={{
              background: 'var(--color-de-bg)',
              borderRadius: 3,
              padding: '0 2px',
            }}
            data-testid="project-chat-mention"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function Avatar({ name }: { name: string | null | undefined }) {
  return (
    <span
      className="rounded-full bg-s2 text-muted font-bold flex items-center justify-center flex-shrink-0"
      style={{ width: 22, height: 22, fontSize: 8.5 }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
