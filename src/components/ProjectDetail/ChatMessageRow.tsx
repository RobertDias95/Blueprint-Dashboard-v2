import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  permitChoiceLabel,
  useDeleteMessage,
  useEditMessage,
} from '../../hooks/useProjectMessages';
import {
  chatStamp,
  isDeleted,
  isEdited,
  mentionsMe,
  originalBody,
  parseMentions,
} from '../../lib/projectChat';
import { Avatar, MessageBody } from './ChatMessageBody';
import { useRosterFullName } from '../../hooks/useRosterFullName';
import ChatAttachments from './ChatAttachments';
import ChatTaskComposer from './ChatTaskComposer';
import MentionTextarea from './MentionTextarea';
import type {
  MentionablePerson,
  Permit,
  ProjectMessage,
} from '../../lib/database.types';

// fix-334 §4 — one message, with everything a person can do to it.
//
// ★★ EDIT AND DELETE KEEP THE ORIGINAL. Bobby: "we still want to show the
// original text, but then it maybe just kind of gets minimized. That way we can
// keep a record of everything." So an edited message shows its CURRENT text with
// `edited` beside it and the original one click away; a deleted one shows that
// it was deleted, with the same one click to the words that were there.
//
// ★ THE HISTORY IS NOT WRITTEN HERE. `revisions` comes off the row, and the row
// gets it from a database trigger — the client cannot skip, forge or reorder it,
// which is what makes "a record of everything" a fact rather than a promise.
//
// ★ ONLY THE AUTHOR. Admins create posts; that is structure. Rewriting somebody
// else's words is a different thing and nobody asked for it, so the controls
// render only for your own message AND the database refuses anyone else's row —
// proved on prod with a second identity.

export default function ChatMessageRow({
  message,
  projectId,
  userId,
  people,
  permits,
  /** ★ Search lands here: the row scrolls itself into view and flashes. */
  focused = false,
  /** A post's own row is styled a little louder than a reply. */
  variant = 'reply',
}: {
  message: ProjectMessage;
  projectId: string;
  userId: string | null;
  people: MentionablePerson[];
  permits: Permit[];
  focused?: boolean;
  variant?: 'post' | 'reply';
}) {
  // ★★ fix-343 / register #127: THE AVATAR'S INITIALS READ THE ROSTER NOW.
  //
  // `message.author_name` is `team_members.name` — the JOIN KEY, and it is one
  // word ("Bobby", "Dave"), so `initialsOf` fell back to the first two letters
  // and drew BO. The roster gained first_name / last_name on prod 2026-08-18,
  // and this resolves the key to "Bobby Dias" so the same untouched
  // `initialsOf` draws BD.
  //
  // ★ ONLY THE INITIALS. The visible author label below is still the name the
  // rest of the app calls him — mentions are typed and matched against it, so
  // switching the label to a full name would break `@Bobby` for a cosmetic win.
  // The circle is aria-hidden decoration; the name is the identity.
  const fullNameOf = useRosterFullName();
  const toMe = mentionsMe(message, userId);
  const mine = !!userId && message.author_id === userId;
  const deleted = isDeleted(message);
  const made = !!message.task_id;

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [showOriginal, setShowOriginal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const edit = useEditMessage();
  const del = useDeleteMessage();
  const ref = useRef<HTMLDivElement | null>(null);
  const taskPermit = permits.find((p) => p.id === message.task_permit_id) ?? null;
  const original = originalBody(message);

  // ★★ "AND THEN GO FROM THERE" — the search requirement. Listing the hit is not
  // enough; selecting it has to LAND you on the message.
  useEffect(() => {
    if (!focused) return;
    // ★ Guarded, not assumed: scrollIntoView is a browser API and jsdom has no
    // layout, so an unguarded call throws inside the effect and takes the whole
    // row down with it. Landing on the message is the FOCUS RING plus the
    // scroll; the ring is the part that must never depend on the environment.
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' });
    }
  }, [focused]);

  function saveEdit() {
    const next = draft.trim();
    if (!next || next === message.body) {
      setEditing(false);
      return;
    }
    edit.mutate(
      { messageId: message.id, body: next, mentions: parseMentions(next, people) },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <div
      ref={ref}
      className="flex gap-2.5"
      style={{
        ...(toMe && !deleted
          ? {
              background: 'var(--color-de-bg)',
              margin: '-7px -9px',
              padding: '7px 9px',
              borderRadius: 8,
            }
          : {}),
        ...(focused
          ? {
              outline: '2px solid var(--color-de)',
              outlineOffset: 3,
              borderRadius: 8,
            }
          : {}),
      }}
      data-testid={`project-chat-message-${message.id}`}
      data-to-me={toMe ? 'true' : 'false'}
      data-deleted={deleted ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
    >
      <Avatar name={fullNameOf(message.author_name)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={
              variant === 'post'
                ? 'text-[13px] font-bold text-text'
                : 'text-[12.5px] font-bold text-text'
            }
          >
            {message.author_name ?? 'Unknown'}
          </span>
          <span className="text-[10px] text-dim">
            {chatStamp(message.created_at)}
          </span>
          {/* ★ The two markers the brief asks for by name. */}
          {isEdited(message) && !deleted && (
            <span
              className="text-[9.5px] text-dim italic"
              title={`Edited ${chatStamp(message.edited_at!)}`}
              data-testid={`project-chat-edited-${message.id}`}
            >
              edited
            </span>
          )}
          {deleted && (
            <span
              className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 rounded"
              style={{ background: 'var(--color-s2)', color: 'var(--color-dim)' }}
              data-testid={`project-chat-deleted-${message.id}`}
            >
              deleted
            </span>
          )}
        </div>

        {deleted ? (
          // ★ A deleted message is not a hole in the thread. It says what
          // happened and keeps the words one click away.
          <div className="text-[12.5px] text-dim italic mt-0.5">
            This message was deleted by its author.
          </div>
        ) : editing ? (
          <div className="mt-1" data-testid={`project-chat-edit-box-${message.id}`}>
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              people={people}
              onSubmit={saveEdit}
              testId={`project-chat-edit-input-${message.id}`}
            />
            <div className="flex gap-2 mt-1.5">
              <button
                type="button"
                onClick={saveEdit}
                disabled={edit.isPending || !draft.trim()}
                className="bg-de text-white rounded px-2.5 py-0.5 text-[10.5px] font-bold disabled:opacity-50"
                data-testid={`project-chat-edit-save-${message.id}`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(false);
                }}
                className="text-[10.5px] text-dim hover:text-text px-1"
                data-testid={`project-chat-edit-cancel-${message.id}`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="text-[13px] text-text mt-0.5"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            <MessageBody body={message.body} people={people} />
          </div>
        )}

        {!deleted && <ChatAttachments attachments={message.attachments ?? []} />}

        {/* ★★ THE ORIGINAL, MINIMISED — exactly what Bobby described. Present
            for an edit AND for a delete, because both supersede text somebody
            may need to find later. */}
        {original && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="text-[10px] text-dim hover:text-text underline"
              data-testid={`project-chat-show-original-${message.id}`}
            >
              {showOriginal ? 'Hide the original' : 'Show the original'}
            </button>
            {showOriginal && (
              <div
                className="mt-1 rounded border px-2 py-1 text-[11.5px] text-dim"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-s2)',
                  whiteSpace: 'pre-wrap',
                }}
                data-testid={`project-chat-original-${message.id}`}
              >
                {original}
              </div>
            )}
          </div>
        )}

        {made ? (
          // ★ fix-330's link-back, naming the permit the task landed on.
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
        ) : null}

        {!deleted && !editing && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {!made && !composing && (
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
            )}
            {/* ★ Only the author's own. The database agrees — this is not the
                only thing standing between somebody and another person's
                words. */}
            {mine && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.body);
                    setEditing(true);
                  }}
                  className="text-[10.5px] border border-border rounded px-2 py-0.5 text-text hover:bg-s2 transition"
                  data-testid={`project-chat-edit-${message.id}`}
                >
                  Edit
                </button>
                {confirmDelete ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] text-dim">Delete this?</span>
                    <button
                      type="button"
                      onClick={() =>
                        del.mutate(
                          { messageId: message.id },
                          { onSuccess: () => setConfirmDelete(false) },
                        )
                      }
                      disabled={del.isPending}
                      className="text-[10.5px] rounded px-2 py-0.5 font-bold disabled:opacity-50"
                      style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                      }}
                      data-testid={`project-chat-delete-confirm-${message.id}`}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="text-[10.5px] text-dim hover:text-text px-1"
                      data-testid={`project-chat-delete-cancel-${message.id}`}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-[10.5px] border border-border rounded px-2 py-0.5 text-dim hover:text-text transition"
                    data-testid={`project-chat-delete-${message.id}`}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
