import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useBoardReads, useMarkBoardItemsRead } from '../../hooks/useBoardReads';
import {
  anchorPermitIdFor,
  useCreateTaskFromMessage,
  useMentionablePeople,
  usePostMessage,
  useProjectMessages,
} from '../../hooks/useProjectMessages';
import {
  chatStamp,
  keyForMention,
  mentionsMe,
  parseMentions,
} from '../../lib/projectChat';
import { Avatar, MessageBody } from './ProjectChatCard';
import type {
  MentionablePerson,
  Permit,
  ProjectMessage,
} from '../../lib/database.types';

// fix-329 (register #71) — the full conversation, per Project_Chat_Mockup_v2.
//
// ★ READING THE THREAD MARKS ITS MENTIONS READ. Opening this is the moment a
// mention stops being news, so it writes board_item_reads for exactly the
// `mention:{id}` keys on screen — fix-307's model, reused. It does NOT mark
// anything else read, and reading is not doing: no task is touched, no message
// changes, nothing leaves the thread.
//
// ★★ PHASE 1 IS TEXT ONLY. The attach control is rendered DISABLED with an
// honest label, because this codebase has shipped a live-looking control that
// does nothing six times and spent tickets undoing it. Nothing in this
// application has ever uploaded a file from the browser — there is no upload
// path, no bucket, no size or type limit and no orphan story — so attachments
// are a ticket, not a section of one.

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
  const people = useMemo(() => peopleQ.data ?? [], [peopleQ.data]);

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

  // Esc closes, like every other overlay in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [draft, setDraft] = useState('');
  const anchorPermitId = useMemo(() => anchorPermitIdFor(permits), [permits]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    post.mutate(
      { projectId, body, mentions: parseMentions(body, people) },
      { onSuccess: () => setDraft('') },
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
                userId={userId}
                people={people}
                anchorPermitId={anchorPermitId}
              />
            ))
          )}
        </div>

        <div className="flex-none border-t border-border p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline — the convention every
              // chat this team uses already has.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message the project team… type @ to mention someone"
            className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
            style={{ minHeight: 58, resize: 'vertical' }}
            data-testid="project-chat-input"
          />
          <div className="flex items-center gap-2 mt-2">
            {/* ★★ THE ATTACH CONTROL IS DISABLED AND SAYS WHY. Not absent (the
                mockup shows it, and hiding it would lose the promise), not live
                (there is no upload path in this app at all). An honest disabled
                control is the third option this codebase learned the hard way. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Attachments arrive in a later phase — this build is text only"
              className="text-[10.5px] text-dim border border-border rounded px-2 py-1 cursor-not-allowed opacity-60"
              data-testid="project-chat-attach"
            >
              📎 Attach — coming later
            </button>
            <span className="text-[10.5px] text-dim">
              Enter sends · Shift+Enter for a new line
            </span>
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || post.isPending}
              className="ml-auto bg-de text-white rounded-lg px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
              data-testid="project-chat-send"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullMessage({
  message,
  userId,
  people,
  anchorPermitId,
}: {
  message: ProjectMessage;
  userId: string | null;
  people: MentionablePerson[];
  anchorPermitId: number | null;
}) {
  const toMe = mentionsMe(message, userId);
  const createTask = useCreateTaskFromMessage();
  const made = !!message.task_id;

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

        {made ? (
          // ★ The link-back, from the same RPC that lists the thread.
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
          </div>
        ) : (
          <div className="flex gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => {
                if (anchorPermitId == null) return;
                createTask.mutate({
                  messageId: message.id,
                  permitId: anchorPermitId,
                  // ★ The message IS the task text — pre-filled, and editable
                  // afterwards in the task editor like any other task.
                  text: message.body.slice(0, 200),
                  discipline: 'ent',
                });
              }}
              disabled={anchorPermitId == null || createTask.isPending}
              title={
                anchorPermitId == null
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
