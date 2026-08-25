import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import {
  useDeleteWhatsNewEntry,
  useMarkWhatsNewRead,
  useUpsertWhatsNewEntry,
  useWhatsNewEntries,
  useWhatsNewReads,
  type WhatsNewDraft,
} from '../hooks/useWhatsNew';
import { useOriginState } from '../hooks/useOriginState';
import {
  KIND_LABEL,
  WHATS_NEW_KINDS,
  formatDay,
  groupByDay,
  isAppPath,
  readsLikeATicket,
  type WhatsNewEntry,
  type WhatsNewKind,
} from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-350 — WHAT'S NEW
// ===========================================================================
//
// Bobby: *"We should add a what's new thing to the ribbon so people are aware of
// the features, tips and tricks etc."*
//
// ★★ A PLACE TO LOOK, NOT AN INTERRUPTION. The brief is explicit about what this
// is not: no modal on login, no forced tour, no dismissable banner across the
// app. So the entire announcement mechanism is one dot on one ribbon entry —
// it says "there is something here", once, and then goes quiet.
//
// ★ NOT ADMIN-GATED, and that is the whole point of the ticket. 23 of the 29
// logins are non-admin editors and they are exactly the people who have not been
// told that any of this exists. Writing is admin-only; reading is everyone.
//
// ★ NO COMMENTS, NO REACTIONS, NO DISCUSSION on entries — that is what the
// project chat is for, and the brief rules it out by name.

/** ★ fix-335 §9's treatment, applied unchanged: an unread row is `de-bg` with
 *  the accent rule down its left edge, a read row is flat and dimmed. Named
 *  here exactly as Notifications.tsx names it, so there is no second unread
 *  style — the brief forbids one and this is how that stays true. */
const UNREAD_ROW = 'bg-de-bg';
const READ_ROW = 'bg-surface';

/** The chip beside a title. One closed set, mirroring the CHECK constraint. */
const KIND_CLASS: Record<WhatsNewKind, string> = {
  new: 'bg-de-bg text-de',
  improved: 'bg-ok-bg text-ok',
  tip: 'bg-wa-bg text-wa',
};

export default function WhatsNew() {
  const isAdmin = useIsTenantAdmin();
  const entriesQ = useWhatsNewEntries();
  const readsQ = useWhatsNewReads();
  const markRead = useMarkWhatsNewRead();
  const [editing, setEditing] = useState<WhatsNewEntry | 'new' | null>(null);
  const [kindFilter, setKindFilter] = useState<WhatsNewKind | 'all'>('all');

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const readIds = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);

  // ★★★ THE HIGHLIGHT IS CLEARED WHEN YOU LEAVE, NOT WHEN YOU ARRIVE.
  //
  // ★ The obvious version — mark everything read on mount — makes the page erase
  // its own highlight: the read rows land, the reads query re-resolves, and the
  // tint you came to see disappears while you are still reading it. Every fix
  // for that on the arrival side is a snapshot, and a snapshot is either a ref
  // read during render or a setState inside an effect, both of which the React
  // Compiler refuses for good reasons.
  //
  // ★★ Clearing on UNMOUNT needs no snapshot at all. Nothing invalidates the
  // reads while you are on the page, so `readIds` is stable for the whole visit
  // by construction — the rows simply stay as they were when you arrived. The
  // marks land as you navigate away, and the ribbon's dot goes quiet with them.
  //
  // ★ It also reads better as a rule: you have read it when you have had it
  // open, not in the instant it appeared. Close the tab without leaving and it
  // is still unread next time, which is the honest answer.
  const toClear = useRef<string[]>([]);
  const loading = entriesQ.isLoading || readsQ.isLoading;
  useEffect(() => {
    // Ref writes inside an effect are fine; it is reading one during RENDER
    // that is not, which is why this is here and not in the body.
    toClear.current = loading
      ? []
      : entries.filter((e) => !readIds.has(e.id)).map((e) => e.id);
  }, [loading, entries, readIds]);

  // ★★ THE CLEANUP DEPENDS ON NOTHING, deliberately. `mutate` is referentially
  // stable in TanStack Query v5, so `[mutate]` would work — but if it ever
  // stopped being stable this effect would re-run on every render and mark the
  // page read the instant it painted, silently restoring the exact bug the
  // unmount timing exists to avoid. Held in a ref instead, so "runs once, on the
  // way out" is structural rather than a property of somebody else's library.
  const markRef = useRef(markRead.mutate);
  useEffect(() => {
    markRef.current = markRead.mutate;
  });
  useEffect(
    () => () => {
      if (toClear.current.length > 0) markRef.current(toClear.current);
    },
    [],
  );

  const unreadOnArrival = useMemo(
    () => new Set(entries.filter((e) => !readIds.has(e.id)).map((e) => e.id)),
    [entries, readIds],
  );

  const shown = useMemo(
    () => (kindFilter === 'all' ? entries : entries.filter((e) => e.kind === kindFilter)),
    [entries, kindFilter],
  );
  const days = useMemo(() => groupByDay(shown), [shown]);

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="whats-new-page">
      <div className="flex items-baseline gap-3 mb-2.5 flex-none">
        <h1 className="text-[15px] font-extrabold text-text">What&rsquo;s New</h1>
        <span className="text-[11px] text-muted">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {unreadOnArrival.size > 0 && (
            <span className="text-de font-bold" data-testid="whats-new-unread-count">
              {' · '}
              {unreadOnArrival.size} new to you
            </span>
          )}
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="ml-auto text-[11px] font-bold text-de hover:underline bg-transparent border-none p-0"
            data-testid="whats-new-add"
          >
            + Write an entry
          </button>
        )}
      </div>

      {/* ★ Chips rather than tabs, so the whole vocabulary is visible before you
          commit to one — the same choice fix-336's centre made for its kinds. */}
      <div className="flex items-center gap-1.5 mb-2 flex-none" data-testid="whats-new-filters">
        {(['all', ...WHATS_NEW_KINDS] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${
              kindFilter === k
                ? 'bg-de-bg text-de border-de'
                : 'bg-surface text-muted border-border hover:text-text'
            }`}
            data-testid={`whats-new-filter-${k}`}
            aria-pressed={kindFilter === k}
          >
            {k === 'all' ? 'all' : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {editing && isAdmin && (
        <EntryEditor
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <div
        className="border border-border rounded-md bg-surface flex-1 min-h-0 overflow-y-auto"
        data-testid="whats-new-list"
      >
        {entriesQ.isLoading ? (
          <div className="px-3.5 py-3 text-[11px] text-dim" data-testid="whats-new-loading">
            Loading…
          </div>
        ) : days.length === 0 ? (
          <div className="px-3.5 py-3 text-[11px] text-dim" data-testid="whats-new-empty">
            Nothing here yet.
          </div>
        ) : (
          days.map((day) => (
            <div key={day.date}>
              <div
                className="sticky top-0 z-10 px-3.5 py-1.5 bg-s2 border-b border-border text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted"
                data-testid={`whats-new-day-${day.date}`}
              >
                {formatDay(day.date)}
              </div>
              {day.entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  unread={unreadOnArrival.has(e.id)}
                  isAdmin={isAdmin}
                  onEdit={() => setEditing(e)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * ★★★ fix-387 — AN ENTRY THAT TEACHES.
 *
 * Two optional affordances, and neither one interrupts:
 *
 *   "Open it →"     navigates CLIENT-SIDE to the feature. fix-385 just made the
 *                   board tabs addressable, so /board?tab=notifications is
 *                   exactly the sort of value this holds.
 *   "Show me how"   expands the steps in place, COLLAPSED BY DEFAULT, one entry
 *                   at a time, panel state only — nothing is stored and nothing
 *                   is remembered.
 *
 * ★★ fix-350's rules still bind: no modal, no forced tour, no interruption.
 * Teaching is something the reader OPENS, never something that opens itself.
 * An entry with neither column renders exactly as it did before this ticket,
 * which is the case all 23 existing rows are in.
 *
 * ★★★ NEITHER ACTION TOUCHES READ STATE, AND THAT IS NOT AN OMISSION.
 * fix-350 marks every entry that was unread ON ARRIVAL as read when the page
 * UNMOUNTS — "you have read it when you have had it open". So:
 *   · clicking "Open it →" navigates away, which unmounts the page, which marks
 *     it read through the existing mechanism. It already works; adding anything
 *     here would be a second write racing the first.
 *   · expanding the how-to marks nothing on its own, and must not: it would be
 *     a SECOND read-marking rule clearing one entry while its neighbours wait
 *     for unmount, so two entries you read identically would end up in
 *     different states. It gets marked on the way out like everything else.
 * One mechanism, unchanged.
 */
function EntryRow({
  entry,
  unread,
  isAdmin,
  onEdit,
}: {
  entry: WhatsNewEntry;
  unread: boolean;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const del = useDeleteWhatsNewEntry();
  const navigate = useNavigate();
  const originState = useOriginState();
  const [showHow, setShowHow] = useState(false);
  const href = entry.go_href?.trim() || '';
  // ★ Belt to the CHECK's braces: a value that somehow reached the client
  // without passing the constraint still does not render a link.
  const canGo = href !== '' && isAppPath(href);
  const how = entry.how_to?.trim() || '';
  return (
    <div
      className={`px-3.5 py-2.5 border-b border-border/50 transition ${
        unread ? UNREAD_ROW : READ_ROW
      }`}
      style={{ borderLeft: `3px solid ${unread ? 'var(--color-de)' : 'transparent'}` }}
      data-testid={`whats-new-entry-${entry.id}`}
      data-unread={unread ? 'true' : 'false'}
      data-kind={entry.kind}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-bold text-text">{entry.title}</span>
        <span
          className={`inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg align-[1px] ${KIND_CLASS[entry.kind]}`}
          data-testid={`whats-new-kind-${entry.id}`}
        >
          {KIND_LABEL[entry.kind]}
        </span>
        {isAdmin && (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="text-[10px] text-de hover:underline bg-transparent border-none p-0"
              data-testid={`whats-new-edit-${entry.id}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => del.mutate(entry.id)}
              disabled={del.isPending}
              className="text-[10px] text-co hover:underline bg-transparent border-none p-0 disabled:opacity-40"
              data-testid={`whats-new-delete-${entry.id}`}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      <div className="text-[11px] text-muted mt-1 leading-relaxed whitespace-pre-line">
        {entry.body}
      </div>

      {(canGo || how !== '') && (
        <div className="flex items-center gap-3 mt-1.5">
          {canGo && (
            <button
              type="button"
              // ★★ navigate(), not an <a href>. react-router keeps it in the
              // app — no reload, no chance of leaving the origin whatever the
              // string says.
              // ★ fix-408: an entry can point at a project, so the click
              // records What's New as the origin — Previous brings you back to
              // the announcement you were reading rather than to Project View.
              onClick={() => navigate(href, { state: originState() })}
              className="text-[10.5px] font-bold text-de hover:underline bg-transparent border-none p-0"
              data-testid={`whats-new-go-${entry.id}`}
              data-href={href}
            >
              Open it →
            </button>
          )}
          {how !== '' && (
            <button
              type="button"
              onClick={() => setShowHow((v) => !v)}
              aria-expanded={showHow}
              aria-controls={`whats-new-how-${entry.id}`}
              className="text-[10.5px] text-muted hover:text-text bg-transparent border-none p-0"
              data-testid={`whats-new-how-toggle-${entry.id}`}
            >
              {showHow ? 'Hide' : 'Show me how'}
            </button>
          )}
        </div>
      )}

      {how !== '' && showHow && (
        <div
          id={`whats-new-how-${entry.id}`}
          // ★ whitespace-pre-line, the same treatment `body` gets. Line breaks
          // are the only formatting a three-sentence how-to needs, and no
          // markdown renderer was added to provide them.
          className="text-[11px] text-text mt-1.5 leading-relaxed whitespace-pre-line border-l-2 border-border pl-2.5"
          data-testid={`whats-new-how-${entry.id}`}
        >
          {how}
        </div>
      )}
    </div>
  );
}

/** ★★ The admin editor, on the page rather than buried in Settings.
 *
 *  ★ It lives beside the thing it writes, which is the shortest path from "I
 *  watched somebody do it the long way" to "there is now a tip about it". A
 *  Settings section would have needed its own route, its own ribbon decision
 *  and one more click, for a form that belongs next to its output.
 *
 *  ★★ HIDDEN HERE, REFUSED IN THE DATABASE. The admin check below decides what
 *  renders; the RLS policy decides what is allowed. fix-234's lesson, and the
 *  one fix-331 §6 had to go back and apply — a hidden control is a decoration,
 *  not a permission. */
function EntryEditor({
  entry,
  onClose,
}: {
  entry: WhatsNewEntry | null;
  onClose: () => void;
}) {
  const upsert = useUpsertWhatsNewEntry();
  const [draft, setDraft] = useState<WhatsNewDraft>(() => ({
    id: entry?.id,
    published_on: entry?.published_on ?? new Date().toISOString().slice(0, 10),
    kind: entry?.kind ?? 'new',
    title: entry?.title ?? '',
    body: entry?.body ?? '',
    sort_order: entry?.sort_order ?? 0,
    // ★★ fix-387: '' is the editor's representation of "not set". The hook
    // turns a blank back into NULL on save, so clearing a field really removes
    // it rather than storing an empty string.
    go_href: entry?.go_href ?? '',
    how_to: entry?.how_to ?? '',
  }));
  const set = <K extends keyof WhatsNewDraft>(k: K, v: WhatsNewDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // ★ A WARNING, NOT A REFUSAL. The audience is the team, not the repo, and an
  // entry that says "fix-347" teaches people this page is not for them. But a
  // tool that refuses to save is a tool arguing with the person writing the
  // words — so it says so and gets out of the way.
  // ★★ fix-387: the how-to is linted too. It is the field MOST likely to slip
  // into ticket-speak, because whoever writes it has just finished the ticket.
  const ticketish = readsLikeATicket(
    `${draft.title} ${draft.body} ${draft.how_to ?? ''}`,
  );
  // ★★★ fix-387: the client half of the database CHECK, so the editor says no
  // before the database does. "Starts with /" is NOT the rule — //evil.com
  // starts with a slash and is a protocol-relative URL. See isAppPath.
  const hrefDraft = (draft.go_href ?? '').trim();
  const hrefBad = hrefDraft !== '' && !isAppPath(hrefDraft);
  const canSave =
    draft.title.trim() !== '' && draft.body.trim() !== '' && !hrefBad;

  return (
    <div
      className="border border-border rounded-md bg-surface p-3 mb-2 flex-none"
      data-testid="whats-new-editor"
    >
      <div className="flex items-center gap-2 mb-2">
        <input
          type="date"
          value={draft.published_on}
          onChange={(e) => set('published_on', e.target.value)}
          className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de"
          data-testid="whats-new-editor-date"
          aria-label="Published on"
        />
        <select
          value={draft.kind}
          onChange={(e) => set('kind', e.target.value as WhatsNewKind)}
          className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none"
          data-testid="whats-new-editor-kind"
          aria-label="Kind"
        >
          {WHATS_NEW_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Title — what a person would call it"
          className="flex-1 px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de"
          data-testid="whats-new-editor-title"
          aria-label="Title"
        />
      </div>
      <textarea
        value={draft.body}
        onChange={(e) => set('body', e.target.value)}
        rows={4}
        placeholder="A sentence or two, in the words the team uses. Not a ticket title."
        className="w-full px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de resize-y"
        data-testid="whats-new-editor-body"
        aria-label="Body"
      />
      {/* ★★★ fix-387 — the two teaching fields, both OPTIONAL. An entry that
          announces a behaviour with no single destination leaves the path
          blank, and an entry that needs no steps leaves the how-to blank; that
          is the shape all 23 existing entries are in. */}
      <input
        value={draft.go_href ?? ''}
        onChange={(e) => set('go_href', e.target.value)}
        placeholder="Where is it? An app path like /board?tab=notifications (optional)"
        className={`w-full mt-1.5 px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none ${
          hrefBad ? 'border-co' : 'border-border focus:border-de'
        }`}
        data-testid="whats-new-editor-go-href"
        aria-label="Link to the feature"
      />
      {hrefBad && (
        <div className="text-[10px] text-co mt-1" data-testid="whats-new-editor-href-error">
          Must be a path inside the app — one leading slash, no backslashes.
          &ldquo;//example.com&rdquo; looks like a path but leaves the site.
        </div>
      )}
      <textarea
        value={draft.how_to ?? ''}
        onChange={(e) => set('how_to', e.target.value)}
        rows={3}
        placeholder="How do you use it? One step per line (optional). Shown behind “Show me how”."
        className="w-full mt-1.5 px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de resize-y"
        data-testid="whats-new-editor-how-to"
        aria-label="How to use it"
      />
      {ticketish && (
        <div className="text-[10px] text-wa mt-1" data-testid="whats-new-editor-warning">
          This mentions a ticket number. The audience is the team, not the repo —
          &ldquo;fix-347&rdquo; means nothing to a design associate.
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => upsert.mutate(draft, { onSuccess: onClose })}
          disabled={!canSave || upsert.isPending}
          className="text-[11px] font-bold text-white bg-de rounded px-2.5 py-1 border-none disabled:opacity-40"
          data-testid="whats-new-editor-save"
        >
          {entry ? 'Save' : 'Publish'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted hover:text-text bg-transparent border-none p-0"
          data-testid="whats-new-editor-cancel"
        >
          Cancel
        </button>
        {upsert.isError && (
          <span className="text-[10px] text-co" data-testid="whats-new-editor-error">
            {/* ★ The database refusing a non-admin surfaces here rather than
                silently doing nothing. */}
            Could not save — {upsert.error.message}
          </span>
        )}
      </div>
    </div>
  );
}
