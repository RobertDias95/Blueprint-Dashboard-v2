import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { useBoardReads, useMarkBoardItemsRead } from '../../hooks/useBoardReads';
import {
  anchorPermitIdFor,
  useMentionablePeople,
  usePostMessage,
  useProjectMessages,
} from '../../hooks/useProjectMessages';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  chatStamp,
  groupIntoPosts,
  isDeleted,
  keyForMention,
  mentionableAfterRoster,
  mentionsMe,
  parseMentions,
  searchChat,
  unresolvedMentions,
  type ChatPost,
} from '../../lib/projectChat';
import {
  ATTACHMENT_LIMIT_HINT,
  humanSize,
  MAX_ATTACHMENTS_PER_MESSAGE,
  pastedFileName,
  rejectionReason,
  type PendingAttachment,
} from '../../lib/chatAttachments';
import MentionTextarea from './MentionTextarea';
import ChatMessageRow from './ChatMessageRow';
import { OpenPostRequests, RequestPostForm } from './PostRequestPanel';
import { useResolvePostRequest, type ProjectPostRequest } from '../../hooks/usePostRequests';
import ChatTaskFields from './ChatTaskFields';
import {
  disciplineForDraft,
  emptyTaskDraft,
  taskDraftIsReady,
  type ChatTaskDraft,
} from '../../lib/chatTaskDraft';
import type { Permit } from '../../lib/database.types';

// fix-334 — the conversation, organised.
//
// ★★ POSTS, LIKE TEAMS. Bobby: "for a project, there could be a post that is a
// post, and then you can chat within that post, and then different posts for
// different concepts or different categories of chatting… that way you can keep
// a chat more organized." Two panes: the posts on the left, the selected post
// and its replies on the right.
//
// ★★ ONLY ADMINS CREATE POSTS. EVERYONE REPLIES. The structure is controlled;
// the conversation is not. 23 of this tenant's 29 people are editors, and a chat
// only 6 can speak in is not a chat. The button below is hidden for non-admins —
// and the RLS policy REFUSES the insert, which is the half that matters
// (fix-234's lesson, which fix-331 §6 had to go back and apply).
//
// ★ SEARCH IS SCOPED TO THIS PROJECT'S CHAT and lands you on the message, not
// merely on a list of them — "and then go from there" is the requirement.
//
// ★ READING THE THREAD MARKS ITS MENTIONS READ (fix-329, unchanged): the
// `mention:{id}` keys on screen, fix-307's model, no second read model.

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
  const isAdmin = useIsTenantAdmin();
  const messagesQ = useProjectMessages(projectId);
  const peopleQ = useMentionablePeople();
  const readsQ = useBoardReads();
  const markRead = useMarkBoardItemsRead();

  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);
  const posts = useMemo(() => groupIntoPosts(messages), [messages]);

  // ★ fix-321, applied on both sides of the wire — see mentionableAfterRoster.
  const team = useTeamMembers();
  const people = useMemo(
    () => mentionableAfterRoster(peopleQ.data ?? [], team.all),
    [peopleQ.data, team.all],
  );

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newPostOpen, setNewPostOpen] = useState(false);
  // ★ fix-339: a non-admin asks instead of creating.
  const [requestOpen, setRequestOpen] = useState(false);
  // ★★ The request an admin is answering by creating its post. Held here so the
  // new-post composer can be PRE-FILLED from it and the two linked in one step
  // — "created" is one of the three ways a request ends, and the requester is
  // then taken to the actual thread.
  const [fulfilling, setFulfilling] = useState<ProjectPostRequest | null>(null);
  const resolveRequest = useResolvePostRequest();

  // The newest conversation is the one you probably came for.
  const selected: ChatPost | null =
    posts.find((p) => p.post.id === selectedPostId) ?? posts[0] ?? null;

  const hits = useMemo(() => searchChat(posts, query), [posts, query]);

  // ★ Mark the mentions in this thread read — once, for the keys actually on
  // screen. Idempotent (INSERT … ON CONFLICT DO NOTHING), and the guard keeps it
  // from firing on every realtime refresh.
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    const read = new Set(readsQ.data ?? []);
    const keys = messages
      .filter((m) => mentionsMe(m, userId) && !isDeleted(m))
      .map((m) => keyForMention(m.id))
      .filter((k) => !read.has(k) && !markedRef.current.has(k));
    if (keys.length === 0) return;
    keys.forEach((k) => markedRef.current.add(k));
    markRead.mutate(keys);
    // markRead is a stable mutation object; including it would re-fire on every
    // render of the hook's internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, readsQ.data, userId]);

  // Esc closes, like every other overlay. The mention picker stops propagation
  // while it is open, so Escape dismisses the list first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        style={{ width: 'min(1000px, 94vw)', height: 'min(680px, 90vh)' }}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border flex-none">
          <div>
            <div className="text-[14px] font-display font-bold text-text">
              Project chat
            </div>
            <div className="text-[11px] text-dim" data-testid="project-chat-subtitle">
              {posts.length} post{posts.length === 1 ? '' : 's'} ·{' '}
              {messages.length} message{messages.length === 1 ? '' : 's'}
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

        <div className="flex-1 min-h-0 flex">
          {/* ── posts + search ─────────────────────────────────────────── */}
          <aside
            className="flex-none border-r border-border flex flex-col min-h-0"
            style={{ width: 268 }}
            data-testid="project-chat-posts"
          >
            <div className="p-2.5 flex flex-col gap-2 flex-none border-b border-border">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this conversation…"
                className="w-full border border-border rounded px-2 py-1 text-[11.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
                aria-label="Search this conversation"
                data-testid="project-chat-search"
              />
              {/* ★★ ADMINS ONLY — and the policy says so too (fix-334).
                  ★ fix-339: everyone else gets the ASK. Non-admins still cannot
                  create a post; without this their topic just gets buried at
                  the bottom of General, which is the hole fix-334's report
                  flagged. */}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    setFulfilling(null);
                    setNewPostOpen(true);
                  }}
                  className="w-full text-[11px] font-bold rounded py-1 bg-de text-white hover:opacity-90 transition"
                  data-testid="project-chat-new-post"
                >
                  ＋ New post
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setRequestOpen(true)}
                  className="w-full text-[11px] font-bold rounded py-1 border border-de text-de hover:bg-de-bg transition"
                  data-testid="project-chat-request-post"
                >
                  ✋ Request a post
                </button>
              )}
            </div>

            {/* ★ An admin opening the chat sees what has been asked for here,
                whether or not they were a resolved recipient. */}
            {isAdmin && (
              <OpenPostRequests
                projectId={projectId}
                onCreateFrom={(r) => {
                  setFulfilling(r);
                  setNewPostOpen(true);
                }}
              />
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
              {query.trim().length >= 2 ? (
                <SearchResults
                  hits={hits}
                  onOpen={(postId, messageId) => {
                    setSelectedPostId(postId);
                    setFocusMessageId(messageId);
                  }}
                />
              ) : posts.length === 0 ? (
                <div
                  className="text-[11px] text-dim italic px-1.5 py-2"
                  data-testid="project-chat-empty"
                >
                  {isAdmin
                    ? 'No posts yet — start one.'
                    : 'No posts yet. An admin starts a post; anyone can reply.'}
                </div>
              ) : (
                posts.map((p) => (
                  <PostRow
                    key={p.post.id}
                    entry={p}
                    active={selected?.post.id === p.post.id}
                    onSelect={() => {
                      setSelectedPostId(p.post.id);
                      setFocusMessageId(null);
                    }}
                  />
                ))
              )}
            </div>
          </aside>

          {/* ── the selected post ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {requestOpen ? (
              <RequestPostForm
                projectId={projectId}
                onDone={() => setRequestOpen(false)}
                onCancel={() => setRequestOpen(false)}
              />
            ) : newPostOpen ? (
              <NewPostComposer
                projectId={projectId}
                people={people}
                // ★ fix-339: pre-filled when this post is ANSWERING a request.
                initialTitle={fulfilling?.title ?? ''}
                initialBody={fulfilling ? `${fulfilling.reason}` : ''}
                onClose={() => {
                  setNewPostOpen(false);
                  setFulfilling(null);
                }}
                onCreated={(id) => {
                  // ★★ ONE STEP. Creating the post resolves the request for
                  // every recipient AND records which post answered it, so the
                  // requester is taken to the thread rather than told it is
                  // somewhere.
                  if (fulfilling) {
                    resolveRequest.mutate({
                      id: fulfilling.id,
                      status: 'created',
                      createdPostId: id,
                    });
                  }
                  setNewPostOpen(false);
                  setFulfilling(null);
                  setSelectedPostId(id);
                }}
              />
            ) : !selected ? (
              <div className="flex-1 flex items-center justify-center text-[12px] text-dim italic">
                Nothing to show yet.
              </div>
            ) : (
              <>
                <div
                  className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4"
                  data-testid="project-chat-thread"
                >
                  <div>
                    <h3
                      className="text-[15px] font-display font-bold text-text mb-2"
                      data-testid="project-chat-post-title"
                    >
                      {selected.post.title}
                    </h3>
                    <ChatMessageRow
                      message={selected.post}
                      projectId={projectId}
                      userId={userId}
                      people={people}
                      permits={permits}
                      variant="post"
                      focused={focusMessageId === selected.post.id}
                    />
                  </div>

                  {selected.replies.length > 0 && (
                    <div
                      className="border-t border-border pt-3 flex flex-col gap-3.5"
                      data-testid="project-chat-replies"
                    >
                      {selected.replies.map((r) => (
                        <ChatMessageRow
                          key={r.id}
                          message={r}
                          projectId={projectId}
                          userId={userId}
                          people={people}
                          permits={permits}
                          focused={focusMessageId === r.id}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <ReplyComposer
                  key={selected.post.id}
                  projectId={projectId}
                  postId={selected.post.id}
                  people={people}
                  permits={permits}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- post list --

function PostRow({
  entry,
  active,
  onSelect,
}: {
  entry: ChatPost;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded px-2 py-1.5 mb-0.5 transition"
      style={{ background: active ? 'var(--color-de-bg)' : 'transparent' }}
      data-testid={`project-chat-post-${entry.post.id}`}
      data-active={active ? 'true' : 'false'}
    >
      <div className="text-[11.5px] font-bold text-text truncate">
        {entry.post.title}
      </div>
      <div className="text-[9.5px] text-dim truncate">
        {entry.post.author_name ?? 'Unknown'} ·{' '}
        <span data-testid={`project-chat-post-replies-${entry.post.id}`}>
          {entry.replyCount} {entry.replyCount === 1 ? 'reply' : 'replies'}
        </span>{' '}
        · {chatStamp(entry.lastActivityAt)}
      </div>
    </button>
  );
}

function SearchResults({
  hits,
  onOpen,
}: {
  hits: ReturnType<typeof searchChat>;
  onOpen: (postId: string, messageId: string) => void;
}) {
  if (hits.length === 0) {
    return (
      <div
        className="text-[11px] text-dim italic px-1.5 py-2"
        data-testid="project-chat-search-empty"
      >
        Nothing in this conversation matches.
      </div>
    );
  }
  return (
    <div data-testid="project-chat-search-results">
      {hits.map((h) => (
        <button
          key={`${h.message.id}-${h.field}`}
          type="button"
          onClick={() => onOpen(h.postId, h.message.id)}
          className="w-full text-left rounded px-2 py-1.5 mb-0.5 hover:bg-s2 transition"
          data-testid={`project-chat-search-hit-${h.message.id}`}
        >
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-dim truncate">
            {h.postTitle}
          </div>
          <div className="text-[11px] text-text">{h.excerpt}</div>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ new post ------

function NewPostComposer({
  projectId,
  people,
  onClose,
  onCreated,
  initialTitle = '',
  initialBody = '',
}: {
  projectId: string;
  people: import('../../lib/database.types').MentionablePerson[];
  onClose: () => void;
  onCreated: (id: string) => void;
  /** ★ fix-339: seeded from a post request when this post answers one. */
  initialTitle?: string;
  initialBody?: string;
}) {
  const post = usePostMessage();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  function submit() {
    if (!title.trim() || !body.trim()) return;
    post.mutate(
      {
        projectId,
        title: title.trim(),
        parentMessageId: null,
        body: body.trim(),
        mentions: parseMentions(body, people),
      },
      { onSuccess: (id) => id && onCreated(id) },
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2.5" data-testid="project-chat-new-post-form">
      <div className="text-[13px] font-display font-bold text-text">
        New post
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What is this post about?"
        className="w-full border border-border rounded px-2.5 py-1.5 text-[12.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
        aria-label="Post title"
        data-testid="project-chat-new-post-title"
      />
      <MentionTextarea
        value={body}
        onChange={setBody}
        people={people}
        onSubmit={submit}
        placeholder="Start the conversation… type @ to mention someone"
        testId="project-chat-new-post-body"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim() || !body.trim() || post.isPending}
          className="bg-de text-white rounded-lg px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
          data-testid="project-chat-new-post-submit"
        >
          {post.isPending ? 'Posting…' : 'Create post'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11.5px] text-dim hover:text-text px-2"
          data-testid="project-chat-new-post-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- reply --------

/**
 * ★★ fix-334 §5 — the message and its task, in ONE SEND.
 *
 * Bobby: "as you're typing your message, add a task or send it to this permit,
 * and then click send so it's all done in one sweep." Before this you posted,
 * then hunted for a button on the posted message.
 *
 * ★ The task fields are fix-330's, imported — not rebuilt. <ChatTaskFields> is
 * the same permit chooser, the same PrimaryAssigneeEditor and the same buffered
 * TaskDateField the post-hoc composer uses, so the two cannot drift.
 *
 * ★ ONE MUTATION. usePostMessage inserts the message and creates the task, so
 * the two share a failure surface and a task can never exist against a message
 * that did not post.
 */
function ReplyComposer({
  projectId,
  postId,
  people,
  permits,
}: {
  projectId: string;
  postId: string;
  people: import('../../lib/database.types').MentionablePerson[];
  permits: Permit[];
}) {
  const post = usePostMessage();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [withTask, setWithTask] = useState(false);
  const anchorId = useMemo(() => anchorPermitIdFor(permits), [permits]);
  const [task, setTask] = useState<ChatTaskDraft>(() => emptyTaskDraft(anchorId));
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
          setRejected(reason);
          break;
        }
        next.push({
          localId: `${Date.now()}-${i}-${name}`,
          file:
            file.name === name ? file : new File([file], name, { type: file.type }),
          previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : null,
        });
      }
      return next;
    });
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  const unresolved = useMemo(
    () => unresolvedMentions(draft, people),
    [draft, people],
  );

  // ★ A task without a message is not a thing this composer sends — the task
  // hangs off the message, so the message has to exist.
  const canSend =
    (draft.trim().length > 0 || pending.length > 0) &&
    (!withTask || taskDraftIsReady(task)) &&
    !post.isPending;

  function send() {
    if (!canSend) return;
    post.mutate(
      {
        projectId,
        parentMessageId: postId,
        body: draft.trim(),
        mentions: parseMentions(draft, people),
        files: pending.map((p) => p.file),
        task:
          withTask && task.permitId != null
            ? {
                permitId: task.permitId,
                text: task.text.trim().slice(0, 200),
                discipline: disciplineForDraft(task),
                assignedTo: task.assignedTo || null,
                targetDate: task.targetDate,
              }
            : null,
      },
      {
        onSuccess: () => {
          pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
          setDraft('');
          setPending([]);
          setRejected(null);
          setWithTask(false);
          setTask(emptyTaskDraft(anchorId));
        },
      },
    );
  }

  return (
    <div className="flex-none border-t border-border p-3">
      <MentionTextarea
        value={draft}
        onChange={setDraft}
        people={people}
        onSubmit={send}
        onPaste={onPaste}
        placeholder="Reply… type @ to mention someone, or paste a snip"
        testId="project-chat-input"
      />

      {/* ★★ AN UNRESOLVED @word IS NOT A MENTION, AND IT SAYS SO (fix-330). */}
      {unresolved.length > 0 && (
        <div
          className="text-[10.5px] mt-1.5"
          style={{ color: 'var(--color-co)' }}
          data-testid="project-chat-unresolved"
        >
          {unresolved.join(', ')}{' '}
          {unresolved.length === 1 ? 'matches nobody' : 'match nobody'} — it will
          post as plain text, and notify no one. Pick a name from the list to
          mention someone.
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2" data-testid="project-chat-pending">
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
                onClick={() =>
                  setPending((prev) => {
                    const hit = prev.find((x) => x.localId === p.localId);
                    if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
                    return prev.filter((x) => x.localId !== p.localId);
                  })
                }
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

      {/* ★ THE TASK, COMPOSED ALONGSIDE THE MESSAGE. */}
      {withTask && (
        <div
          className="mt-2 rounded-lg border p-2.5 flex flex-col gap-2"
          style={{
            borderColor: 'var(--color-de-border)',
            background: 'var(--color-de-bg)',
          }}
          data-testid="project-chat-send-task"
        >
          <ChatTaskFields
            draft={task}
            onChange={setTask}
            projectId={projectId}
            permits={permits}
            disabled={post.isPending}
            testIdPrefix="project-chat-send-task"
          />
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
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
        <button
          type="button"
          onClick={() => setWithTask((v) => !v)}
          disabled={permits.length === 0}
          title={
            permits.length === 0
              ? 'This project has no permit to hang a task on yet'
              : 'Create a task with this message'
          }
          className="text-[10.5px] border rounded px-2 py-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: withTask ? 'var(--color-de)' : 'var(--color-border)',
            color: withTask ? 'var(--color-de)' : 'var(--color-text)',
            fontWeight: withTask ? 700 : 400,
          }}
          data-testid="project-chat-toggle-task"
          data-on={withTask ? 'true' : 'false'}
        >
          ✓ Add a task
        </button>
        <span className="text-[10.5px] text-dim">
          Enter sends · Shift+Enter for a new line
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
  );
}
