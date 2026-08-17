import { useState } from 'react';
import {
  useProjectPostRequests,
  useRequestPost,
  useResolvePostRequest,
  type ProjectPostRequest,
} from '../../hooks/usePostRequests';
import { chatStamp } from '../../lib/projectChat';

// fix-339 — "request a post", and what an admin does with one.
//
// ★★ fix-334 GATED POST CREATION TO ADMINS, and my own report flagged the hole
// that left: "an editor who wants a new topic has no way to ask for one, so an
// unrelated question gets buried at the bottom of General." Bobby reached the
// same conclusion and went further — the request should ROUTE, to "the
// oversight people + the ent lead for that project", and clear from all of
// their queues once anyone acts.
//
// ★ The request is NOT a way to create a post. It is a way to ask. Non-admins
// still cannot create one, and the RLS policy still refuses it — this is the
// escape hatch, not a loophole.

/** ★ What a non-admin sees where an admin sees "New post". */
export function RequestPostForm({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const request = useRequestPost();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const ready = title.trim().length > 0 && reason.trim().length > 0;

  function submit() {
    if (!ready || request.isPending) return;
    request.mutate(
      { projectId, title, reason },
      { onSuccess: () => onDone() },
    );
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2.5"
      data-testid="post-request-form"
    >
      <div className="text-[13px] font-display font-bold text-text">
        Request a post
      </div>
      <p className="text-[10.5px] text-dim leading-relaxed">
        Posts are opened by admins. This asks the oversight team and this
        project&apos;s entitlement lead to open one — whoever gets to it first.
      </p>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What should the post be called?"
        className="w-full border border-border rounded px-2.5 py-1.5 text-[12.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
        aria-label="Requested post title"
        data-testid="post-request-title"
      />
      {/* ★ A reason is required, and the DB agrees. Whoever picks this up should
          be able to open the right thread without a conversation about it. */}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why does this need its own thread?"
        className="w-full border border-border rounded px-2.5 py-1.5 text-[12.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
        style={{ minHeight: 64, resize: 'vertical' }}
        aria-label="Reason for the request"
        data-testid="post-request-reason"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!ready || request.isPending}
          className="bg-de text-white rounded-lg px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
          data-testid="post-request-submit"
        >
          {request.isPending ? 'Sending…' : 'Send request'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11.5px] text-dim hover:text-text px-2"
          data-testid="post-request-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * ★ What an ADMIN sees: the open requests on this project, with the two actions
 * that end them.
 *
 * ★★ "Create this post" is ONE STEP — it pre-fills the new-post composer from
 * the request and links the two, so the person who asked is taken to the thread
 * rather than told it exists somewhere.
 */
export function OpenPostRequests({
  projectId,
  onCreateFrom,
}: {
  projectId: string;
  /** Hands the request up to the modal, which opens the new-post composer
   *  pre-filled and reports back the created post's id. */
  onCreateFrom: (request: ProjectPostRequest) => void;
}) {
  const requestsQ = useProjectPostRequests(projectId);
  const resolve = useResolvePostRequest();
  const requests = requestsQ.data ?? [];
  if (requests.length === 0) return null;

  return (
    <div
      className="border-b border-border p-2.5 flex flex-col gap-2"
      data-testid="post-requests-open"
    >
      <div className="text-[8.5px] font-extrabold uppercase tracking-[0.06em] text-dim">
        Requested posts ({requests.length})
      </div>
      {requests.map((r) => (
        <div
          key={r.id}
          className="rounded border px-2 py-1.5 flex flex-col gap-1"
          style={{
            borderColor: 'var(--color-co-border)',
            background: 'var(--color-co-bg)',
          }}
          data-testid={`post-request-${r.id}`}
        >
          <div className="text-[11.5px] font-bold text-text">{r.title}</div>
          <div className="text-[10px] text-muted leading-snug">{r.reason}</div>
          <div className="text-[9px] text-dim">
            {r.requester_name ?? 'Someone'} · {chatStamp(r.created_at)}
          </div>
          {/* ★★ A recipient nobody could reach is stated, not hidden. Dave holds
              oversight and his roster row carries no email, so his login cannot
              be matched to it — and an admin looking at this should know the
              request did not reach everybody it named. */}
          {r.unresolved_recipients.length > 0 && (
            <div
              className="text-[9px]"
              style={{ color: 'var(--color-co)' }}
              data-testid={`post-request-unreachable-${r.id}`}
            >
              Not notified: {r.unresolved_recipients.join(', ')} — no email on
              their roster row.
            </div>
          )}
          <div className="flex gap-1.5 mt-0.5">
            <button
              type="button"
              onClick={() => onCreateFrom(r)}
              className="text-[10px] font-bold rounded px-2 py-0.5 bg-de text-white hover:opacity-90"
              data-testid={`post-request-create-${r.id}`}
            >
              Create this post
            </button>
            <button
              type="button"
              onClick={() =>
                resolve.mutate({ id: r.id, status: 'declined' })
              }
              disabled={resolve.isPending}
              className="text-[10px] rounded px-2 py-0.5 border border-border bg-surface text-dim hover:text-text disabled:opacity-50"
              title="Decline — this clears it for everyone it was sent to"
              data-testid={`post-request-decline-${r.id}`}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
