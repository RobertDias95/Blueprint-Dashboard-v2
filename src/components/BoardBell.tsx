import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import OriginLink from './OriginLink';
// ★★ fix-446 §0a: one assembly of BoardInput, shared with My Board and My
// Tasks. It brings the task source, the holds and fix-348's ownership resolver
// with it, so this file no longer names them one by one.
import { useBoardInput } from '../hooks/useBoardInput';
import { acknowledgeableItems, type NewItem } from '../lib/boardReads';
import { targetHref } from '../lib/notificationTargets';
import { useMarkBoardItemsRead } from '../hooks/useBoardReads';
// ★★ fix-336: the notification MODEL — items, unseen, read keys, suppression —
// is one hook now, shared with the notification centre. The badge and the
// centre are the same query by construction, which was fix-329's rule and this
// brief's §3.
import { useBoardNotifications } from '../hooks/useBoardNotifications';
// ★ fix-339: resolving a shared request clears it for everyone it was sent to.
import { useResolvePostRequest } from '../hooks/usePostRequests';
import { useAcknowledgeCondition } from '../hooks/usePermitConditions';
import { conditionIdFromKey } from '../lib/permitConditions';
import { RealtimeStatusLine } from './RealtimeStatusLine';
import {
  buildForecast,
  buildQueue,
} from '../lib/myBoard';

// fix-298 Phase 1 — the board bell and its dropdown.
//
// ★ "Open my board →" IS THE FIRST THING IN IT. The dropdown is a doorway, not
// a feed: short, skimmable, and it hands you to the board rather than trying to
// be the board.
//
// ★ fix-331: and now it is the only bell in the top bar at all — error triage
// moved into the ribbon, admin-gated. The comment below is kept because the
// lesson in it is the reason this one is still accurate.
//
// ★ fix-326: THIS IS THE ONLY NOTIFICATION BELL. The comment here used to say
// it was the second of two, sitting beside fix-27/28's scraper-activity bell.
// That stopped being true somewhere between fix-298 and fix-307 — and the stale
// comment is what
// made a later brief instruct me to "remove NotificationBell from the top bar",
// a component that was not on screen. Bobby caught it: "the current bell I see is
// the myboard notification bell, not the scraper bell?" He was right.
//
// NotificationBell.tsx is deleted. This bell absorbed both questions: it carries
// the personal board feed AND, for oversight viewers, the scraper flips
// (useScraperActivity below), with fix-307's per-user read state and suppression
// counts. The feed itself still has a home at /activity, reachable from the
// Reporting hub (fix-325) and from the health panel on My Board.

export default function BoardBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // ★ The "where you stand" numbers still need the raw board input; the
  // notification half comes from the shared model below. React Query dedupes
  // the overlap, so this costs no extra fetch.
  // ★ fix-390: the permit-scoped siblings, one bulk fetch like its sibling.
  const markRead = useMarkBoardItemsRead();
  const resolveRequest = useResolvePostRequest();
  // ★★ fix-438: a standing condition is ACKNOWLEDGED, never resolved — see
  //    lib/permitConditions for why a condition cannot be finished.
  const acknowledgeCondition = useAcknowledgeCondition();

  // ★★ fix-336: ONE model, shared with /notifications.
  const { unseen, suppressed, signature, activityTruncationNote } =
    useBoardNotifications();

  // ★★★ fix-446 §0a — THE ASSEMBLY MOVED, AND THIS CALLER'S TWO OMISSIONS ARE
  //     NOW DECLARED RATHER THAN ACCIDENTAL.
  //
  // This component never passed `acks` or `showHeldWork`. The consequence is
  // real: the two counters below ("Past due", "Today") therefore count
  // milestones somebody has already ACKNOWLEDGED, and can read higher than the
  // board they link to.
  //
  // ★★ fix-446 does NOT fix that — its brief requires this caller to behave
  // exactly as before, and a smaller number IS a behaviour change. Passing the
  // flags explicitly means the next person sees the decision instead of an
  // absent field, and correcting it is one boolean.
  const { input } = useBoardInput({ withAcks: false, withHeldWork: false });

  const forecast = useMemo(() => buildForecast(input), [input]);
  const queue = useMemo(() => buildQueue(input), [input]);

  // ★★ fix-335 §9 — the READ half of "look unread and read".
  //
  // `unseen` is, by construction, only unread items: acknowledge one and it
  // leaves the list, so the row disappeared out from under the cursor and the
  // panel had no read state to look at. That is what made the section a
  // uniform block with a heading rather than a feed with two states in it.
  //
  // ★ SO A ROW ACKNOWLEDGED WHILE THE PANEL IS OPEN STAYS PUT, rendered read.
  // The list below is the union of "still unread" and "you just read this",
  // which is the only combination that puts both states on screen at once.
  //
  // ★ IT IS PANEL-LOCAL AND DELIBERATELY FORGETFUL — cleared every time the
  // bell is opened, so the next visit shows only what is genuinely new. It is
  // presentation, and it writes nothing: fix-307's `board_item_reads` remains
  // the only record of what has been read. Two sources for "what is waiting on
  // me" must not disagree (fix-329's rule), and these cannot, because this one
  // is not a source — it is a list of things the read model has already
  // accepted.
  const [readInPanel, setReadInPanel] = useState<NewItem[]>([]);
  const keepAsRead = (items: NewItem[]) =>
    setReadInPanel((prev) => {
      const have = new Set(prev.map((p) => p.key));
      return [...prev, ...items.filter((i) => !have.has(i.key))];
    });

  /** What the New section renders: unread first, then anything read in this
   *  session of the panel.
   *
   *  ★ THE CLICK WINS, not the server. `readInPanel` takes precedence over
   *  `unseen` rather than the other way round, because the read row is written
   *  asynchronously — until the refetch lands the item is still "unseen", and
   *  deferring to that would leave the row looking untouched for as long as the
   *  round trip takes. The point of the read state is that the click has an
   *  immediate, visible consequence.
   *
   *  ★ The 8-row cap applies to the UNREAD half only — a read row must never
   *  push a genuinely new one out of view. */
  const shown = useMemo(() => {
    const readNow = new Set(readInPanel.map((i) => i.key));
    return [
      ...unseen
        .filter((i) => !readNow.has(i.key))
        .slice(0, 8)
        .map((item) => ({ item, unread: true })),
      ...readInPanel.map((item) => ({ item, unread: false })),
    ];
  }, [unseen, readInPanel]);

  // ★ fix-307: THE BADGE COUNTS WHAT IS UNSEEN, NOT WHAT IS UNDONE.
  //
  // It used to count past due + today + blocked — outstanding work, which never
  // reaches zero, so the number stopped being a signal and became decoration.
  // Zero now means "I have seen everything new", never "I have nothing to do".
  // The counts that used to drive it are still in the dropdown as CONTEXT and
  // never contribute here.
  //
  // Always personal: `unseen` comes from the viewer's own items and knows
  // nothing about the queue's scope, so switching to My team cannot move it.
  const actionable = unseen.length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          // ★ fix-335 §9: every open starts clean. Yesterday's acknowledgements
          // are not news and must not be shown as read rows tomorrow.
          if (!open) setReadInPanel([]);
          setOpen((v) => !v);
        }}
        className="relative bg-transparent border border-border text-muted hover:text-text px-2 py-1 rounded-md transition inline-flex items-center"
        title="My board"
        aria-expanded={open}
        data-testid="board-bell-button"
      >
        <span aria-hidden>🔔</span>
        {actionable > 0 && (
          <span
            // ★★★ fix-360 §2 — THE BELL POPS, EVEN WHEN THE NUMBER DOES NOT.
            //
            // Bobby: "it's one notification, but it pops up the bell 12 times
            // and mark it as read then three times". A 16th reaction on a post
            // that is already unread leaves the badge on the same number — that
            // is what grouping MEANS — and he still wants to feel it land.
            //
            // ★ THE KEY IS THE MECHANISM, and that is deliberate. React
            // remounts an element whose `key` changed, and a CSS animation
            // replays on mount, so the pop needs no state, no effect and no
            // timer to clear — which also keeps it clear of the React Compiler
            // rule that bit fix-350 twice. `signature` is a fingerprint of WHAT
            // is unread rather than how much, so it moves when a reaction lands
            // and stays put across an idle refetch.
            key={signature}
            data-signature={signature}
            className="board-bell-pop absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-co text-white text-[9px] font-extrabold flex items-center justify-center"
            data-testid="board-bell-badge"
          >
            {actionable > 99 ? '99+' : actionable}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-[290px] bg-surface border border-border rounded-md shadow-lg z-50 overflow-hidden"
          data-testid="board-bell-dropdown"
        >
          {/* ★ First thing in the dropdown, per the mockup. */}
          <Link
            to="/board"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2.5 bg-s2 border-b border-border text-[12px] font-extrabold text-de hover:bg-de-bg transition"
            data-testid="board-bell-open-board"
          >
            Open my board →
          </Link>

          <div className="px-3.5 py-2 border-b border-border" data-testid="board-bell-standing">
            <div className="text-[8px] font-extrabold uppercase tracking-wide text-muted mb-0.5">
              Where you stand
            </div>
            <Row label="Past due" value={forecast.past_due.total} urgent testid="bell-past-due" />
            <Row label="Today" value={forecast.today.total} urgent testid="bell-today" />
            {/* ★★★ fix-397 — "Blocked on you", "Waiting on design" and
                "Waiting on the city" used to be three rows here, one per queue
                group. The queue no longer HAS groups, and two of the three were
                ruled out by Bobby on 2026-08-24:

                  "i am not sure how well 'Blocked on you' and 'Waiting on
                   design' is built out and if it is serving a function. i think
                   we remove those for the time being until that gets built out
                   in depth better. but this will serve a better purpose i
                   think."

                ★★ The bell's job is unchanged — "where you stand" — so the rows
                are restated in the queue's new vocabulary rather than dropped
                outright: what is late, and what lands before the week is out.
                Both numbers come from the SAME buildQueue the panel renders, so
                the bell can never disagree with the list it links to. */}
            <Row
              label="Queue · past due"
              value={queue.pastDue}
              urgent
              testid="bell-queue-past-due"
            />
            <Row
              label="Queue · due this week"
              value={queue.dueThisWeek}
              testid="bell-queue-week"
            />
          </div>

          {/* ★ fix-307 (register #37): the dropdown shows BOTH — the unseen
              items, which are the badge's population and each acknowledgeable,
              and "where you stand", which is context and never contributes to
              the badge. */}
          <div className="border-b border-border" data-testid="board-bell-new">
            <div className="px-3.5 pt-2 pb-1 flex items-baseline gap-2">
              <span className="text-[8px] font-extrabold uppercase tracking-wide text-muted">
                New
              </span>
              {unseen.length > 0 && (
                <button
                  type="button"
                  // ★ fix-339: SHARED items are excluded. Marking one read
                  // would write a row nothing reads and leave the item on
                  // screen — a control that lies. Resolving it is a different
                  // act with its own button below.
                  onClick={() => {
                    const acked = acknowledgeableItems(unseen);
                    markRead.mutate(acked.map((i) => i.key));
                    keepAsRead(acked);
                  }}
                  disabled={markRead.isPending}
                  className="ml-auto text-[9px] text-de hover:underline bg-transparent border-none p-0 disabled:opacity-40"
                  data-testid="board-bell-mark-all-read"
                >
                  Mark all read
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              // ★ Zero means "seen everything new", NOT "nothing to do" — so
              // the empty state says so, with the standing counts right below.
              <div
                className="px-3.5 pb-2 text-[10px] text-dim"
                data-testid="board-bell-new-empty"
              >
                Nothing new. You are up to date on what has changed.
              </div>
            ) : (
              shown.map(({ item: i, unread }) => (
                <div
                  key={i.key}
                  // ★★ fix-335 §9: AN UNREAD ITEM LOOKS UNREAD.
                  //
                  // Bobby: "The new notifications aren't really standing out. We
                  // want a way that makes them look unread and read — whether it
                  // is a color fill over the notification etc."
                  //
                  // He is describing this panel exactly. Every row in it —
                  // "Where you stand", "New", "Not shown" — was the same weight
                  // on the same white, so the only thing saying these particular
                  // rows were news was the 8px word "New" above them. The
                  // section heading was doing all the work.
                  //
                  // ★ THE FILL IS `de-bg`, WHICH ALREADY MEANS THIS. fix-307
                  // tints an unseen row on My Board with it and fix-329 tints a
                  // message that mentions you. Same idea, same colour — a new
                  // "unread" colour would have split one meaning across two
                  // palettes and made neither reliable. The left rule is the
                  // same accent at full strength, so the row reads as unread
                  // even where the tint is too pale to survive a projector.
                  //
                  // ★★ AND A READ ROW IS THE CONTRAST, NOT AN ABSENCE. "look
                  // unread and read" needs both on screen; before this, reading
                  // an item made it VANISH under the cursor, which is neither a
                  // read state nor a confirmation. A row acknowledged while the
                  // panel is open now stays put, dimmed and unfilled, until the
                  // panel closes — so the click has visible consequences and the
                  // two states can be told apart side by side. Next open it is
                  // gone, because it is no longer new.
                  className={`flex items-start gap-2 px-3.5 py-1.5 transition ${
                    unread ? 'bg-de-bg hover:bg-s2' : 'bg-surface opacity-55 hover:bg-s2'
                  }`}
                  style={{
                    borderLeft: `3px solid ${
                      unread ? 'var(--color-de)' : 'transparent'
                    }`,
                  }}
                  data-testid={`bell-new-${i.key}`}
                  data-unread={unread ? 'true' : 'false'}
                  // ★★ fix-339's SHARED items have no per-user read state — they
                  // are unseen by definition while open. They get the SAME fill,
                  // because "this is waiting on you" is the same fact either
                  // way; what differs is what clears it, and that is already
                  // said by the control at the end of the row ("Got it", not
                  // "✓") and by the dot's own title below.
                  //
                  // ★ A shared item can therefore NEVER render in the read
                  // style: nothing writes a read row for it, so it is either
                  // outstanding and shown unread, or resolved and gone. The
                  // treatment must not imply it can be individually marked read
                  // — and it cannot, because `keepAsRead` is only ever handed
                  // acknowledgeable items.
                  data-unread-kind={i.audience === 'shared' ? 'shared' : 'personal'}
                >
                  {/* ★ A MARKER AS WELL AS A FILL, deliberately. A tint alone is
                      invisible to anyone who cannot separate pale blue from
                      white, and it is the first thing a cheap monitor loses.
                      Read rows keep the slot so nothing reflows on the click —
                      it is the dot that goes, not the space it sat in. */}
                  <span
                    className="flex-none rounded-full mt-[5px]"
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
                    data-testid={`bell-new-dot-${i.key}`}
                  />
                  <OriginLink
                    // ★★ fix-362: WHERE THE THING IS, not merely the page
                    // containing it. One function, shared with the centre —
                    // two copies of a routing rule is how the bell and the
                    // centre start disagreeing about the same row.
                    to={targetHref(i)}
                    onClick={() => {
                      // Following the item is plainly seeing it — but a SHARED
                      // item is not "seen", it is OUTSTANDING FOR EVERYONE, and
                      // going to look at it is not the same as answering it.
                      if (i.audience !== 'shared') markRead.mutate([i.key]);
                      // ★ fix-335 §9: no keepAsRead here. The panel is closing
                      // and the page is changing underneath it, so there is
                      // nobody left to show a read row to.
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1"
                    data-testid={`bell-new-link-${i.key}`}
                  >
                    <div className="text-[11px] font-bold text-text leading-tight">
                      {i.title}
                    </div>
                    {i.subtitle && (
                      <div className="text-[10px] text-muted">{i.subtitle}</div>
                    )}
                    <div className="text-[9px] text-dim font-mono truncate">{i.where}</div>
                  </OriginLink>
                  {/* ★ Acknowledgement is a CLICK. Opening the bell must never
                      mark things read implicitly. */}
                  {/* ★★ fix-339: a SHARED item is answered, not acknowledged.
                      Acting on it clears it from EVERY recipient's queue, so
                      the control says so rather than looking like the personal
                      ✓ beside it. */}
                  {/* ★★★ fix-438 — THE THIRD CONTROL, AND IT IS NEITHER OF THE
                      OTHER TWO.

                      ✓ (personal)   "I have seen this" — read state only, the
                                     thing stays on the board.
                      Got it (shared) "somebody has answered this" — clears it
                                     for every recipient at once.
                      I know (condition) "stop telling me until this CHANGES" —
                                     a domain write against the condition row.
                                     There is no Resolve: the condition ends
                                     when the permit stops being in that state,
                                     which only the next scrape can decide.

                      ★★ IT DOES NOT MARK THE ITEM READ, deliberately. A read
                      row would make the re-surfaced item — same key, because
                      the key carries first_seen and not the detail — arrive
                      already-read and never reach the badge, quietly undoing
                      the one thing acknowledging is meant to leave working. */}
                  {i.source === 'condition' ? (
                    <button
                      type="button"
                      onClick={() =>
                        acknowledgeCondition.mutate({
                          id: conditionIdFromKey(i.key),
                        })
                      }
                      disabled={acknowledgeCondition.isPending}
                      className="text-[9px] font-bold text-de hover:underline bg-transparent border-none p-0 flex-none mt-0.5 whitespace-nowrap disabled:opacity-40"
                      title="I know — this comes back if the condition changes"
                      data-testid={`bell-new-acknowledge-${i.key}`}
                    >
                      I know
                    </button>
                  ) : i.audience === 'shared' ? (
                    <button
                      type="button"
                      onClick={() =>
                        resolveRequest.mutate({
                          id: i.key.replace('post_request:', ''),
                          status: 'acknowledged',
                        })
                      }
                      disabled={resolveRequest.isPending}
                      className="text-[9px] font-bold text-de hover:underline bg-transparent border-none p-0 flex-none mt-0.5 whitespace-nowrap disabled:opacity-40"
                      title="Acknowledge — this clears it for everyone it was sent to"
                      data-testid={`bell-new-resolve-${i.key}`}
                    >
                      Got it
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        markRead.mutate([i.key]);
                        keepAsRead([i]);
                      }}
                      disabled={!unread}
                      className="text-[9px] text-dim hover:text-de bg-transparent border-none p-0 flex-none mt-0.5 disabled:opacity-0"
                      title="Mark read — it stays on your board"
                      data-testid={`bell-new-read-${i.key}`}
                    >
                      ✓
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ★ CONTEXT, not notification. These are the counts the badge used
              to be built from; they stay visible because "where do I stand" is
              a real question, and they contribute nothing to the badge. */}
          {/* ★ NEVER NOTIFY, BUT SHOW THE COUNT. The scraper's retries and
              manual-edit guards are the two largest event categories in the
              system and both mean "working as intended" — they must never
              reach a person. Showing what was suppressed is how a quiet day
              and a broken notifier stop looking the same. Renders even at
              zero, for exactly that reason. */}
          {/* ★★★ fix-336 §2: THE LINE NOW NAMES A PLACE THAT EXISTS.
              This has said "28 scraper retries · 14 manual-edit guards · 257
              changes on permits that aren't yours" since fix-298, as an honesty
              feature — and for four tickets it was a dead end: the categories
              were counted and unreachable. The notification centre is the
              destination it was always describing, so the whole block is the
              link to it. */}
          <Link
            to="/notifications?kind=suppressed"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2 text-[9.5px] text-dim leading-relaxed hover:bg-s2 transition no-underline"
            data-testid="board-bell-suppressed"
          >
            <div className="font-bold uppercase tracking-wide text-[8px] text-muted mb-0.5">
              Not shown
            </div>
            <span data-testid="bell-suppressed-retries">
              {suppressed.retries} scraper retries
            </span>
            {' · '}
            <span data-testid="bell-suppressed-guarded">
              {suppressed.guarded} manual-edit guards
            </span>
            {' · '}
            <span data-testid="bell-suppressed-notyours">
              {suppressed.notYours} changes on permits that aren&apos;t yours
            </span>
            {/* ★★★ fix-370: THE FIRST TWO NUMBERS ARE NOW TRUE.
                They came from the fetched page until this ticket, and the page
                was 300 rows of a 1,600-row fortnight — so this line read "295"
                where the honest answer was 925. It understated the thing it
                exists to make visible by about four times.

                ★ The third is still counted here, over the rows that arrived,
                because "not yours" is a different answer for every person. It
                is exact while the feed is not truncated, which is what the
                sentence below is for. */}
            {activityTruncationNote && (
              <span
                className="block text-muted mt-0.5"
                data-testid="bell-activity-truncated"
              >
                {activityTruncationNote} The last count is a floor.
              </span>
            )}
            <span className="block text-de font-bold mt-0.5">See them →</span>
          </Link>

          {/* ★ fix-336 §2: everything the 8-row cap hides, and the read history
              the panel forgets on close. The dropdown stays a doorway. */}
          <div className="px-3.5 py-2 border-t border-border flex items-center gap-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] font-extrabold text-de hover:underline no-underline"
              data-testid="board-bell-open-notifications"
            >
              All notifications
              {unseen.length > 8 ? ` (${unseen.length})` : ''} →
            </Link>
            {/* ★★ "a dead socket that looks alive is the bug this ticket is
                fixing, reintroduced" — so the panel says which it is. */}
            <span className="ml-auto">
              <RealtimeStatusLine testId="board-bell-realtime-status" />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  urgent,
  testid,
}: {
  label: string;
  value: number;
  urgent?: boolean;
  testid: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5" data-testid={testid}>
      <span className="text-[11px] text-muted">{label}</span>
      <span
        className={`ml-auto text-[12px] font-extrabold tabular-nums ${
          urgent && value > 0 ? 'text-co' : 'text-text'
        }`}
        data-testid={`${testid}-value`}
      >
        {value}
      </span>
    </div>
  );
}
