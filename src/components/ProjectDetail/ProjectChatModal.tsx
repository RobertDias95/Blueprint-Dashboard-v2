import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useBoardReads, useMarkBoardItemsRead } from '../../hooks/useBoardReads';
import {
  permitChoiceLabel,
  useMentionablePeople,
  usePostMessage,
  useProjectMessages,
} from '../../hooks/useProjectMessages';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  chatStamp,
  keyForMention,
  mentionableAfterRoster,
  mentionsMe,
  parseMentions,
  unresolvedMentions,
} from '../../lib/projectChat';
import {
  ATTACHMENT_LIMIT_HINT,
  humanSize,
  MAX_ATTACHMENTS_PER_MESSAGE,
  pastedFileName,
  rejectionReason,
  type PendingAttachment,
} from '../../lib/chatAttachments';
import { Avatar, MessageBody } from './ProjectChatCard';
import MentionTextarea from './MentionTextarea';
import ChatAttachments from './ChatAttachments';
import ChatTaskComposer from './ChatTaskComposer';
import type {
  MentionablePerson,
  Permit,
  ProjectMessage,
} from '../../lib/database.types';

// fix-330 — the full conversation, finished.
//
// ★ READING THE THREAD MARKS ITS MENTIONS READ (fix-329, unchanged). Opening
// this is the moment a mention stops being news, so it writes board_item_reads
// for exactly the `mention:{id}` keys on screen — fix-307's model, reused. It
// does NOT mark anything else read, and reading is not doing.
//
// ★★ THE PLACEHOLDER IS GONE. fix-329 shipped a disabled paperclip with a
// deferral label on it into production, and this ticket exists to erase it. The
// paperclip is live: a file picker, a paste handler for snips, limits that
// explain their refusals, and attachments rendered inline. A test greps the
// whole source tree for that label, so it cannot come back.
//
// ★ ONE COMPOSER, THREE INPUTS. Text, mentions and files all leave through the
// same Send and the same usePostMessage mutation — so an upload cannot succeed
// into a message that never posted, and a partly-sent message has nowhere to
// hide.

export default function ProjectChatModal({
  projectId,
  permits,
  onClose,
}: {
  projectId: string;
  permits: Permit[];
  onClose: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const messagesQ = useProjectMessages(projectId);
  const peopleQ = useMentionablePeople();
  const readsQ = useBoardReads();
  const markRead = useMarkBoardItemsRead();
  const post = usePostMessage();

  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);

  // ★ fix-321, applied on both sides of the wire. bp_mentionable_people already
  // drops departed staff; this drops them again on the way into the picker, so
  // the rule is assertable against the rendered list and not only against SQL.
  // See mentionableAfterRoster for why "unknown" is not "departed".
  const team = useTeamMembers();
  const people = useMemo(
    () => mentionableAfterRoster(peopleQ.data ?? [], team.all),
    [peopleQ.data, team.all],
  );

  // ★ Mark the mentions in this thread read — once, for the keys actually on
  // screen. The mutation is idempotent (INSERT ... ON CONFLICT DO NOTHING), so a
  // re-render cannot double-write, and the guard keeps it from firing on every
  // realtime refresh.
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    const read = new Set(readsQ.data ?? []);
    const keys = messages
      .filter((m) => mentionsMe(m, userId))
      .map((m) => keyForMention(m.id))
      .filter((k) => !read.has(k) && !markedRef.current.has(k));
    if (keys.length === 0) return;
    keys.forEach((k) => markedRef.current.add(k));
    markRead.mutate(keys);
    // markRead is a stable mutation object; including it would re-fire on every
    // render of the hook's internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, readsQ.data, userId]);

  // Esc closes, like every other overlay in the app. The mention picker stops
  // propagation while it is open, so Escape dismisses the list first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ★ Object URLs are revoked when the composer lets go of the file. Without
  // this every pasted snip leaks a blob for the life of the tab.
  useEffect(
    () => () => {
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    },
    [pending],
  );

  /** ★ One door for the picker and for paste, so a refusal reads the same
   *  whichever way the file arrived. */
  function addFiles(files: readonly File[]) {
    if (files.length === 0) return;
    setRejected(null);
    setPending((prev) => {
      const next = [...prev];
      for (const [i, file] of files.entries()) {
        const name = pastedFileName(file, next.length);
        const reason = rejectionReason(
          { name, type: file.type, size: file.size },
          next.length,
        );
        if (reason) {
          // Report the FIRST refusal and stop — a stack of red lines from one
          // drop is noise, and the person only needs to fix one thing to retry.
          setRejected(reason);
          break;
        }
        next.push({
          localId: `${Date.now()}-${i}-${name}`,
          file:
            file.name === name
              ? file
              : new File([file], name, { type: file.type }),
          previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : null,
        });
      }
      return next;
    });
  }

  /** ★ A SNIP IS Ctrl+V — Bobby said so, and it is how this will actually be
   *  used. Clipboard items that are files become attachments; pasted TEXT falls
   *  through to the textarea untouched. */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  function removePending(localId: string) {
    setPending((prev) => {
      const hit = prev.find((p) => p.localId === localId);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  const unresolved = useMemo(
    () => unresolvedMentions(draft, people),
    [draft, people],
  );

  const canSend = (draft.trim().length > 0 || pending.length > 0) && !post.isPending;

  function send() {
    if (!canSend) return;
    post.mutate(
      {
        projectId,
        body: draft.trim(),
        mentions: parseMentions(draft, people),
        files: pending.map((p) => p.file),
      },
      {
        onSuccess: () => {
          pending.forEach(
            (p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl),
          );
          setDraft('');
          setPending([]);
          setRejected(null);
        },
      },
    );
  }

  const authors = new Set(messages.map((m) => m.author_name ?? '')).size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(17,24,39,.42)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Project chat"
      data-testid="project-chat-modal"
    >
      <div
        className="bg-surface rounded-xl flex flex-col overflow-hidden"
        style={{ width: 'min(880px, 92vw)', height: 'min(660px, 88vh)' }}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border flex-none">
          <div>
            <div className="text-[14px] font-display font-bold text-text">
              Project chat
            </div>
            <div className="text-[11px] text-dim" data-testid="project-chat-subtitle">
              {messages.length} message{messages.length === 1 ? '' : 's'}
              {authors > 0 ? ` · ${authors} ${authors === 1 ? 'person' : 'people'}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-dim hover:text-text text-lg leading-none"
            aria-label="Close"
            data-testid="project-chat-close"
          >
            ✕
          </button>
        </header>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4"
          data-testid="project-chat-thread"
        >
          {messages.length === 0 ? (
            <div className="text-[12px] text-dim italic">
              No messages yet — say something to the project team.
            </div>
          ) : (
            messages.map((m) => (
              <FullMessage
                key={m.id}
                message={m}
                projectId={projectId}
                userId={userId}
                people={people}
                permits={permits}
              />
            ))
          )}
        </div>

        <div className="flex-none border-t border-border p-3">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            people={people}
            onSubmit={send}
            onPaste={onPaste}
            placeholder="Message the project team… type @ to mention someone, or paste a snip"
            testId="project-chat-input"
          />

          {/* ★★ AN UNRESOLVED @word IS NOT A MENTION, AND IT SAYS SO. `@mi` used
              to look exactly like a mention and silently notify nobody. It still
              posts — as plain text, which is honest — but nobody presses Send
              believing otherwise. */}
          {unresolved.length > 0 && (
            <div
              className="text-[10.5px] mt-1.5"
              style={{ color: 'var(--color-co)' }}
              data-testid="project-chat-unresolved"
            >
              {unresolved.join(', ')}{' '}
              {unresolved.length === 1 ? 'matches nobody' : 'match nobody'} — it
              will post as plain text, and notify no one. Pick a name from the
              list to mention someone.
            </div>
          )}

          {pending.length > 0 && (
            <div
              className="flex flex-wrap gap-2 mt-2"
              data-testid="project-chat-pending"
            >
              {pending.map((p) => (
                <span
                  key={p.localId}
                  className="flex items-center gap-1.5 rounded border px-1.5 py-1 text-[10.5px] text-text"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                  data-testid={`project-chat-pending-${p.file.name}`}
                >
                  {p.previewUrl ? (
                    <img
                      src={p.previewUrl}
                      alt=""
                      style={{ height: 24, width: 24, objectFit: 'cover', borderRadius: 3 }}
                    />
                  ) : (
                    <span aria-hidden>📄</span>
                  )}
                  <span className="truncate" style={{ maxWidth: 160 }}>
                    {p.file.name}
                  </span>
                  <span className="text-dim">{humanSize(p.file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removePending(p.localId)}
                    className="text-dim hover:text-text leading-none"
                    aria-label={`Remove ${p.file.name}`}
                    data-testid={`project-chat-pending-remove-${p.file.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* ★ A REJECTED FILE SAYS WHY, naming the file and the limit it broke.
              "Upload failed" is the message this codebase has spent tickets
              replacing. */}
          {rejected && (
            <div
              className="text-[10.5px] mt-1.5"
              style={{ color: 'var(--color-danger, #b91c1c)' }}
              role="alert"
              data-testid="project-chat-attach-rejected"
            >
              {rejected}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2">
            {/* ★★ THE PAPERCLIP IS LIVE. This is the control fix-329 shipped
                disabled, wearing a deferral label — the placeholder this ticket
                exists to erase. */}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                // Reset so re-picking the SAME file fires change again.
                e.target.value = '';
              }}
              data-testid="project-chat-file-input"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              title={ATTACHMENT_LIMIT_HINT}
              className="text-[10.5px] text-text border border-border rounded px-2 py-1 hover:bg-s2 transition disabled:opacity-50"
              data-testid="project-chat-attach"
            >
              📎 Attach
            </button>
            <span className="text-[10.5px] text-dim">
              Enter sends · Shift+Enter for a new line · paste a snip to attach it
            </span>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="ml-auto bg-de text-white rounded-lg px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
              data-testid="project-chat-send"
            >
              {post.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullMessage({
  message,
  projectId,
  userId,
  people,
  permits,
}: {
  message: ProjectMessage;
  projectId: string;
  userId: string | null;
  people: MentionablePerson[];
  permits: Permit[];
}) {
  const toMe = mentionsMe(message, userId);
  const made = !!message.task_id;
  const [composing, setComposing] = useState(false);
  const taskPermit = permits.find((p) => p.id === message.task_permit_id) ?? null;

  return (
    <div
      className="flex gap-2.5"
      style={
        toMe
          ? {
              background: 'var(--color-de-bg)',
              margin: '-7px -9px',
              padding: '7px 9px',
              borderRadius: 8,
            }
          : undefined
      }
      data-testid={`project-chat-message-${message.id}`}
      data-to-me={toMe ? 'true' : 'false'}
    >
      <Avatar name={message.author_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-bold text-text">
            {message.author_name ?? 'Unknown'}
          </span>
          <span className="text-[10px] text-dim">{chatStamp(message.created_at)}</span>
        </div>
        <div className="text-[13px] text-text mt-0.5" style={{ whiteSpace: 'pre-wrap' }}>
          <MessageBody body={message.body} people={people} />
        </div>

        <ChatAttachments attachments={message.attachments ?? []} />

        {made ? (
          // ★ The link-back, from the same RPC that lists the thread — and now
          // it names the PERMIT the task landed on and links to it, so the last
          // hop of the chain is visible rather than asserted.
          <div
            className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11.5px]"
            style={{
              borderColor: 'var(--color-pm-border)',
              background: 'var(--color-pm-bg)',
            }}
            data-testid={`project-chat-task-${message.id}`}
          >
            <span className="font-bold text-text">✓ {message.task_text}</span>
            <span className="text-dim"> · created from this message</span>
            {taskPermit && (
              <>
                <span className="text-dim"> · </span>
                <Link
                  to={`/project/${projectId}?permit=${taskPermit.id}`}
                  className="underline text-de"
                  data-testid={`project-chat-task-permit-${message.id}`}
                >
                  {permitChoiceLabel(taskPermit)}
                </Link>
              </>
            )}
          </div>
        ) : composing ? (
          <ChatTaskComposer
            messageId={message.id}
            projectId={projectId}
            defaultText={message.body.slice(0, 200)}
            permits={permits}
            onDone={() => setComposing(false)}
            onCancel={() => setComposing(false)}
          />
        ) : (
          <div className="flex gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => setComposing(true)}
              disabled={permits.length === 0}
              title={
                permits.length === 0
                  ? 'This project has no permit to hang a task on yet'
                  : 'Create a task from this message'
              }
              className="text-[10.5px] border border-border rounded px-2 py-0.5 text-text hover:bg-s2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`project-chat-create-task-${message.id}`}
            >
              Create task
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
