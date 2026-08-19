import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBoardNotifications } from '../hooks/useBoardNotifications';
import { useMarkBoardItemsRead } from '../hooks/useBoardReads';
import { useResolvePostRequest } from '../hooks/usePostRequests';
import { RealtimeStatusLine } from '../components/RealtimeStatusLine';
import {
  acknowledgeableItems,
  hasBeenRead,
  type NewItem,
  type NewItemSource,
} from '../lib/boardReads';
import { targetHref } from '../lib/notificationTargets';
import type { ScraperActivityRow } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-336 §2 — THE NOTIFICATION CENTRE
// ===========================================================================
//
// Bobby: "Under My Board there's no notification center… if you got four
// notifications and you go to My Board, there's nowhere that shows, hey, here
// are your notifications."
//
// ★★ IT READS THE MODEL, IT DOES NOT REBUILD IT. `useBoardNotifications` is the
// same hook the bell's badge counts from, so "the badge and the centre agree"
// is not a thing to keep in step — it is one number and one list, rendered
// twice. That was fix-329's rule, fix-331 §3 and fix-339 both held to it, and
// the brief restates it as §3.
//
// ★ WHAT THE CENTRE ADDS over the dropdown, and it is only ever presentation:
//
//   1. NO CAP. The bell shows `unseen.slice(0, 8)`; this shows all of them, and
//      the READ ones too — the dropdown can only show a read row for as long as
//      the panel stays open (fix-335 §9's panel-local trick), so until now
//      there was nowhere to see what you had acknowledged.
//   2. ★★★ THE SUPPRESSED CATEGORIES, REACHABLE. "28 scraper retries · 14
//      manual-edit guards · 257 changes on permits that aren't yours" has been
//      on the bell since fix-298 as an honesty feature, naming a destination
//      that did not exist. It exists now: three filters that list the rows.
//   3. FILTERING BY KIND, because the volume is what made the cap necessary in
//      the first place. Mentions / Tasks / Permit changes / Requests / Scraper
//      activity, plus Unread — chips, not tabs, so the count of each is visible
//      before you commit to it.
//
// ★ AND NOTHING NEW IS WRITTEN. Read state is fix-307's `board_item_reads` via
// the same mutation the bell uses; a fix-339 SHARED item is resolved, never
// "marked read", because a read row for it would be a row nothing reads.

/** ★ fix-335 §9's treatment, applied unchanged: an unread row is `de-bg` with
 *  the accent rule down its left edge, a read row is flat and dimmed. Written
 *  once here so the centre cannot grow a second unread style. */
const UNREAD_ROW = 'bg-de-bg';
const READ_ROW = 'bg-surface opacity-55';

/** The kind filter. `all` and `unread` are views of the item list; `suppressed`
 *  is the never-notify feed, which is a different shape and gets its own
 *  section rather than being faked into the item list. */
type KindFilter =
  | 'all'
  | 'unread'
  | 'mention'
  | 'task'
  | 'permit'
  | 'request'
  | 'suppressed';

const SOURCE_GROUP: Record<NewItemSource, Exclude<KindFilter, 'all' | 'unread' | 'suppressed'>> = {
  mention: 'mention',
  task: 'task',
  flip: 'permit',
  permit: 'permit',
  handoff: 'permit',
  post_request: 'request',
  post_request_outcome: 'request',
  // ★ fix-354: it IS about tasks — 'six of your tasks were closed' belongs
  // with the other task news rather than in a chip of its own. A new
  // KindFilter for one source would be a filter most people never need.
  auto_closed: 'task',
  // ★ fix-360: applause on your own post is chat news, so it joins the chat
  // filter rather than getting a chip of its own — fix-354's precedent, and its
  // reason: "a new KindFilter for one source would be a filter most people
  // never need". ★ The chip's LABEL changes with it, because "Mentions" stopped
  // being the whole truth the moment a second kind of chat news arrived.
  reaction: 'mention',
};

const KIND_LABEL: Record<KindFilter, string> = {
  all: 'Everything',
  unread: 'Unread',
  mention: 'Chat',
  task: 'Tasks',
  permit: 'Permit changes',
  request: 'Requests',
  suppressed: 'Not shown',
};

const KIND_ORDER: KindFilter[] = [
  'all',
  'unread',
  'mention',
  'task',
  'permit',
  'request',
  'suppressed',
];

function parseKind(raw: string | null): KindFilter {
  return KIND_ORDER.includes(raw as KindFilter) ? (raw as KindFilter) : 'all';
}

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const kind = parseKind(params.get('kind'));

  const { items, readKeys, unseenCount, suppressed, suppressedRows, isLoading } =
    useBoardNotifications();
  const markRead = useMarkBoardItemsRead();
  const resolveRequest = useResolvePostRequest();

  /** ★ The unread test, exactly as `unseenItems` applies it: a SHARED item has
   *  no read row and is unread while it exists (fix-339), a personal one is
   *  unread until its key is in `board_item_reads`. Restated here only because
   *  the centre renders BOTH states and therefore needs the predicate per row
   *  rather than a filtered list.
   *
   *  ★★ fix-360: and the "is it read" half is now IMPORTED rather than spelled
   *  out, because grouping the flip source gave items a second set of keys they
   *  answer to. Two spellings of "read" is how the bell and the centre start
   *  disagreeing about the same row. */
  const isUnread = (i: NewItem) =>
    i.audience === 'shared' ? true : !hasBeenRead(i, readKeys);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = {
      all: items.length,
      unread: items.filter(isUnread).length,
      mention: 0,
      task: 0,
      permit: 0,
      request: 0,
      suppressed:
        suppressed.retries + suppressed.guarded + suppressed.notYours,
    };
    for (const i of items) c[SOURCE_GROUP[i.source]] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, readKeys, suppressed]);

  const shown = useMemo(() => {
    if (kind === 'suppressed') return [];
    if (kind === 'all') return items;
    if (kind === 'unread') return items.filter(isUnread);
    return items.filter((i) => SOURCE_GROUP[i.source] === kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, readKeys]);

  const unreadShown = shown.filter(isUnread);

  return (
    <div className="p-4 flex flex-col h-full" data-testid="notification-centre">
      <div className="flex items-baseline gap-3 mb-2.5 flex-none">
        <h1 className="text-[15px] font-extrabold text-text">Notifications</h1>
        <span className="text-[11px] text-muted" data-testid="notification-centre-count">
          {unseenCount} unread
        </span>
        <Link
          to="/board"
          className="text-[11px] text-de hover:underline no-underline"
          data-testid="notification-centre-board-link"
        >
          My Board →
        </Link>
        <span className="ml-auto">
          <RealtimeStatusLine testId="notification-centre-realtime-status" />
        </span>
      </div>

      {/* ── The kind chips. Counts on the face, so "is there anything in
             Mentions" is answered without clicking. ── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5 flex-none" data-testid="notification-kinds">
        {KIND_ORDER.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                if (k === 'all') next.delete('kind');
                else next.set('kind', k);
                setParams(next, { replace: true });
              }}
              className="text-[10.5px] font-bold px-2.5 py-1 rounded-md border transition"
              style={{
                background: active ? 'var(--color-de)' : 'var(--color-surface)',
                color: active ? '#fff' : 'var(--color-muted)',
                borderColor: active ? 'var(--color-de)' : 'var(--color-border)',
              }}
              data-testid={`notification-kind-${k}`}
              data-active={active ? 'true' : 'false'}
            >
              {KIND_LABEL[k]} · {counts[k]}
            </button>
          );
        })}
        {/* ★ fix-339: SHARED items are excluded from "mark all read" — marking
            one would write a row nothing reads and leave it on screen. Same
            call as the bell's, through the same helper. */}
        {unreadShown.length > 0 && kind !== 'suppressed' && (
          <button
            type="button"
            onClick={() =>
              markRead.mutate(acknowledgeableItems(unreadShown).map((i) => i.key))
            }
            disabled={markRead.isPending}
            className="ml-auto text-[10.5px] text-de hover:underline bg-transparent border-none p-0 disabled:opacity-40"
            data-testid="notification-mark-all-read"
          >
            Mark all read
          </button>
        )}
      </div>

      <div
        className="border border-border rounded-md bg-surface flex-1 min-h-0 overflow-y-auto"
        data-testid="notification-list"
      >
        {isLoading ? (
          <div className="px-3.5 py-3 text-[11px] text-dim" data-testid="notification-loading">
            Loading your notifications…
          </div>
        ) : kind === 'suppressed' ? (
          <SuppressedSections rows={suppressedRows} />
        ) : shown.length === 0 ? (
          <div className="px-3.5 py-3 text-[11px] text-dim" data-testid="notification-empty">
            Nothing here. Zero means you have seen everything new — not that
            there is nothing to do.
          </div>
        ) : (
          shown.map((i) => {
            const unread = isUnread(i);
            return (
              <div
                key={i.key}
                className={`flex items-start gap-2 px-3.5 py-2 border-b border-border transition ${
                  unread ? UNREAD_ROW : READ_ROW
                }`}
                style={{
                  borderLeft: `3px solid ${unread ? 'var(--color-de)' : 'transparent'}`,
                }}
                data-testid={`notification-${i.key}`}
                data-unread={unread ? 'true' : 'false'}
                data-unread-kind={i.audience === 'shared' ? 'shared' : 'personal'}
              >
                <span
                  className="flex-none rounded-full mt-[6px]"
                  style={{
                    width: 6,
                    height: 6,
                    background: unread ? 'var(--color-de)' : 'transparent',
                  }}
                  title={
                    !unread
                      ? 'Read'
                      : i.audience === 'shared'
                        ? 'Open — waiting on anyone it was sent to'
                        : 'Unread'
                  }
                  aria-hidden
                />
                <Link
                  // ★★ fix-362: the same one function the bell uses.
                  to={targetHref(i)}
                  onClick={() => {
                    // A SHARED item is not "seen", it is OUTSTANDING FOR
                    // EVERYONE — going to look at it is not answering it.
                    if (i.audience !== 'shared' && unread) markRead.mutate([i.key]);
                  }}
                  className="min-w-0 flex-1 no-underline"
                  data-testid={`notification-link-${i.key}`}
                >
                  <div className="text-[11.5px] font-bold text-text leading-tight">
                    {i.title}
                  </div>
                  {i.subtitle && (
                    <div className="text-[10.5px] text-muted">{i.subtitle}</div>
                  )}
                  <div className="text-[9.5px] text-dim font-mono truncate">
                    {i.where}
                  </div>
                </Link>
                {/* ★★ fix-339: a shared item is ANSWERED, not acknowledged — and
                    it must never offer "mark read". */}
                {i.audience === 'shared' ? (
                  <button
                    type="button"
                    onClick={() =>
                      resolveRequest.mutate({
                        id: i.key.replace('post_request:', ''),
                        status: 'acknowledged',
                      })
                    }
                    disabled={resolveRequest.isPending}
                    className="text-[9.5px] font-bold text-de hover:underline bg-transparent border-none p-0 flex-none mt-0.5 whitespace-nowrap disabled:opacity-40"
                    title="Acknowledge — this clears it for everyone it was sent to"
                    data-testid={`notification-resolve-${i.key}`}
                  >
                    Got it
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead.mutate([i.key])}
                    disabled={!unread}
                    className="text-[9.5px] text-dim hover:text-de bg-transparent border-none p-0 flex-none mt-0.5 disabled:opacity-0"
                    title="Mark read — it stays on your board"
                    data-testid={`notification-read-${i.key}`}
                  >
                    ✓
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * ★★★ The three never-notify categories, finally reachable.
 *
 * ★ READ-ONLY, AND THAT IS THE POINT. These rows were deliberately kept out of
 * the badge — retries and manual-edit guards mean "working as intended", and
 * the third category is other people's permits. Giving them a ✓ would invite
 * acknowledging things that were never asking for acknowledgement. They are
 * here so a quiet day and a broken notifier stop looking the same, which is the
 * exact sentence the count on the bell was written for.
 */
function SuppressedSections({
  rows,
}: {
  rows: { retries: ScraperActivityRow[]; guarded: ScraperActivityRow[]; notYours: ScraperActivityRow[] };
}) {
  const sections = [
    {
      id: 'retries',
      title: 'Scraper retries',
      why: 'The scraper failed to fetch and recovered on its own. Nothing to do.',
      rows: rows.retries,
    },
    {
      id: 'guarded',
      title: 'Manual-edit guards',
      why: 'The scraper deferred to a recent human edit rather than overwriting it.',
      rows: rows.guarded,
    },
    {
      id: 'notyours',
      title: "Changes on permits that aren't yours",
      why: 'Real changes, on permits you are not the DA or entitlement lead for.',
      rows: rows.notYours,
    },
  ];
  return (
    <div data-testid="notification-suppressed">
      {sections.map((s) => (
        <div key={s.id} data-testid={`notification-suppressed-${s.id}`}>
          <div className="px-3.5 py-1.5 bg-s2 border-b border-border sticky top-0">
            <div className="text-[11px] font-extrabold text-text">
              {s.title} · {s.rows.length}
            </div>
            <div className="text-[9.5px] text-dim">{s.why}</div>
          </div>
          {s.rows.length === 0 ? (
            <div className="px-3.5 py-2 text-[10px] text-dim italic">None in the last 14 days.</div>
          ) : (
            // ★ Capped at 50 per section, and it SAYS when it caps: this feed is
            // ~250 rows on a normal fortnight and the full history has its own
            // screen (/activity). A silent truncation here would be the same
            // dishonesty the counts exist to prevent.
            <>
              {s.rows.slice(0, 50).map((r) => (
                <div
                  key={r.id}
                  className="px-3.5 py-1.5 border-b border-border flex items-baseline gap-2"
                  data-testid={`notification-suppressed-row-${r.id}`}
                >
                  <span className="text-[10.5px] text-text truncate flex-1">
                    {r.address ?? 'Unknown address'}
                    {r.permit_type ? ` · ${r.permit_type}` : ''}
                  </span>
                  <span className="text-[9.5px] text-dim font-mono flex-none">
                    {r.action}
                  </span>
                  <span className="text-[9.5px] text-dim flex-none">
                    {(r.created_at ?? '').slice(0, 10)}
                  </span>
                </div>
              ))}
              {s.rows.length > 50 && (
                <div
                  className="px-3.5 py-1.5 text-[10px] text-dim"
                  data-testid={`notification-suppressed-more-${s.id}`}
                >
                  {s.rows.length - 50} more not listed —{' '}
                  <Link to="/activity" className="text-de">
                    full scraper activity →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
