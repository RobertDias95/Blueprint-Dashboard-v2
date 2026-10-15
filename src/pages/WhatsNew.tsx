import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import {
  useDeleteWhatsNewEntry,
  useMarkWhatsNewRead,
  useUpsertWhatsNewEntry,
  useWhatsNewEntries,
  useWhatsNewReads,
  type WhatsNewDraft,
} from '../hooks/useWhatsNew';
import { useWhatsNewAreas, useWhatsNewSearch } from '../hooks/useWhatsNewGuide';
import { useOriginState } from '../hooks/useOriginState';
import { useGuideSearch, useGuideSections } from '../hooks/useGuide';
import { useSelfScope } from '../hooks/useSelfScope';
import GuideTab from '../components/whatsNew/GuideTab';
import { audiencesForRoles, isGuideSlug } from '../lib/guide';
import { allRibbonRoutes } from '../lib/ribbonNav';
import TabStrip from '../components/shared/TabStrip';
import {
  KIND_LABEL,
  SUMMARY_TARGET_CHARS,
  WHATS_NEW_KINDS,
  areaCounts,
  cardSummary,
  formatDay,
  groupByDay,
  howToSteps,
  inArea,
  isAppPath,
  isSafeMediaUrl,
  mediaKind,
  readsLikeATicket,
  relatedEntries,
  snippetParts,
  areaSlug,
  type WhatsNewEntry,
  type WhatsNewKind,
} from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-350 — WHAT'S NEW · ★★★ fix-657 — …AS A TIPS-STYLE GUIDE
// ===========================================================================
//
// fix-350, Bobby: *"We should add a what's new thing to the ribbon so people
// are aware of the features, tips and tricks etc."*
//
// fix-657, Bobby, 2026-10-12, looking at 55 entries in one flat list:
//   *"like a highlevel summary of what the TIP is, then you click it for more
//    info, and details of how to use it if so. think of apples tip app"*
//   *"i think it is good to know what has recently dropped, but maybe there is a
//    categorical function to this, and a smart search"*
//
// ★★ SO THE PAGE HAS THREE WAYS IN, and a card is the same in all of them:
//   · Latest — newest first in date groups, the unread dot. "What dropped".
//   · Browse — one tile per area (app_config `whatsNewAreas`) with a count.
//   · Search — bp_search_whats_new; the words need not match exactly.
//   A card is a title, ONE line, its kind and area. Clicking it opens the
//   detail: summary, details, "How to use it", "Show me →", media, related.
//
// ★★★ fix-670 (P-056) adds the GUIDE as the first tab — the training guide,
//     start to finish, one chapter per role (components/whatsNew/GuideTab).
//     Tabs read Guide · Latest · Browse; the Guide tab exists only when a
//     section does. The one search box searches both (guide hits first).
//
// ★★ fix-350's rules still bind: no modal on arrival, no tour, no banner. The
//    detail panel opens only because the reader clicked a card.
//
// ★ NOT ADMIN-GATED. 23 of the 29 logins are non-admin editors and they are the
//   people this exists for. Writing is admin-only; reading is everyone.

/** ★ fix-335 §9's treatment, applied unchanged: an unread row is `de-bg` with
 *  the accent rule down its left edge, a read row is flat. Named here exactly as
 *  Notifications.tsx names it, so there is no second unread style. */
const UNREAD_ROW = 'bg-de-bg';
const READ_ROW = 'bg-surface';
/** fix-663: the unread accent down the left edge, drawn inside the border. */
const UNREAD_STRIPE = 'inset 3px 0 0 var(--color-de)';

/** The chip beside a title. One closed set, mirroring the CHECK constraint. */
const KIND_CLASS: Record<WhatsNewKind, string> = {
  new: 'bg-de-bg text-de',
  improved: 'bg-ok-bg text-ok',
  tip: 'bg-wa-bg text-wa',
};

const UNSORTED_LABEL = 'Not yet sorted';

// ★★★ fix-670: the Guide is the first tab — Guide · Latest · Browse.
type Tab = 'guide' | 'latest' | 'browse';

function isTab(v: string | null): v is Tab {
  return v === 'guide' || v === 'latest' || v === 'browse';
}

/** Is this entry on screen, given the kind chip, the tab and the area? */
function visible(
  e: WhatsNewEntry,
  kindFilter: WhatsNewKind | 'all',
  tab: Tab,
  area: string | null | undefined,
  areas: string[],
): boolean {
  if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
  return tab !== 'browse' || area === undefined || inArea(e, area, areas);
}

export default function WhatsNew() {
  const isAdmin = useIsTenantAdmin();
  const entriesQ = useWhatsNewEntries();
  const readsQ = useWhatsNewReads();
  const markRead = useMarkWhatsNewRead();
  const areas = useWhatsNewAreas();
  const [editing, setEditing] = useState<WhatsNewEntry | 'new' | null>(null);
  const [kindFilter, setKindFilter] = useState<WhatsNewKind | 'all'>('all');
  // ★★ fix-670: null = "not chosen yet" — the default is decided ONCE, when
  //    the data is in (see below), and a deep link's `?tab=` is a choice.
  const [params, setParams] = useSearchParams();
  const [tabChoice, setTabChoice] = useState<Tab | null>(() => {
    const t = params.get('tab');
    return isTab(t) ? t : null;
  });
  const [focusSlug, setFocusSlug] = useState<string | null>(() => {
    const s = params.get('s');
    return s && isGuideSlug(s) ? s : null;
  });
  // undefined = the tile grid; null = "Not yet sorted"; a string = that area.
  const [area, setArea] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useWhatsNewSearch(query);
  const guideSearch = useGuideSearch(query);
  const sectionsQ = useGuideSections();
  const sections = useMemo(() => sectionsQ.data ?? [], [sectionsQ.data]);
  const hasGuide = sections.length > 0;
  const { identity } = useSelfScope();
  const myChapters = useMemo(() => audiencesForRoles(identity.roles), [identity.roles]);

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const readIds = useMemo(() => new Set(readsQ.data ?? []), [readsQ.data]);

  // ★★★ fix-350: THE HIGHLIGHT IS CLEARED WHEN YOU LEAVE, NOT WHEN YOU ARRIVE.
  //     Marking on mount would erase the tint you came to see. The unread-on-
  //     arrival set is marked as you navigate away, and the ribbon's dot goes
  //     quiet with it. See fix-350 for the whole argument.
  // ★★ fix-657 adds ONE more moment: opening a card's detail marks THAT entry
  //    read straight away (the brief: "Opening it marks the entry read"). Its
  //    dot clears; every other card keeps its tint until you leave.
  const toClear = useRef<string[]>([]);
  const sawCards = useRef(false);
  const loading = entriesQ.isLoading || readsQ.isLoading;
  useEffect(() => {
    toClear.current = loading
      ? []
      : entries.filter((e) => !readIds.has(e.id)).map((e) => e.id);
  }, [loading, entries, readIds]);

  const markRef = useRef(markRead.mutate);
  useEffect(() => {
    markRef.current = markRead.mutate;
  });
  useEffect(
    () => () => {
      if (sawCards.current && toClear.current.length > 0) markRef.current(toClear.current);
    },
    [],
  );

  const unreadOnArrival = useMemo(
    () => new Set(entries.filter((e) => !readIds.has(e.id)).map((e) => e.id)),
    [entries, readIds],
  );

  // ★★★ fix-670 — THE DEFAULT TAB: Latest if you have something unread,
  //     otherwise the Guide. Decided ONCE, when entries, reads and sections are
  //     all in — opening a card marks it read, and a default that re-derived
  //     would yank you onto the Guide the moment your last unread card cleared.
  //     (React's "adjust state while rendering" pattern, not an effect.)
  const settled = !loading && !sectionsQ.isLoading;
  if (tabChoice === null && settled) {
    setTabChoice(unreadOnArrival.size > 0 || !hasGuide ? 'latest' : 'guide');
  }
  // ★ The Guide tab only exists when a section does — never an empty placeholder.
  const tab: Tab =
    tabChoice === null ? 'latest' : tabChoice === 'guide' && !hasGuide ? 'latest' : tabChoice;
  const selectTab = (t: Tab, slug: string | null = null) => {
    setTabChoice(t);
    setFocusSlug(slug);
    const next = new URLSearchParams();
    next.set('tab', t);
    if (slug) next.set('s', slug);
    setParams(next, { replace: true });
  };

  // ★★ fix-670 §D.8: opening the GUIDE does not mark What's New read. The
  //    clear-on-leave above is for the cards you were shown; if you never left
  //    the Guide, you were shown none.
  useEffect(() => {
    if (tab !== 'guide' || query.trim().length >= 2) sawCards.current = true;
  }, [tab, query]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // ★ Search results, in rank order, filtered by kind and (in Browse, inside an
  //   area) by area — the brief: "Filters … work with search and area."
  const hits = useMemo(() => {
    if (!search.active) return null;
    const out: { entry: WhatsNewEntry; snippet: string }[] = [];
    for (const h of search.data ?? []) {
      const e = byId.get(h.id);
      if (e && visible(e, kindFilter, tab, area, areas)) out.push({ entry: e, snippet: h.snippet });
    }
    return out;
  }, [search.active, search.data, byId, kindFilter, tab, area, areas]);

  const shown = useMemo(
    () => entries.filter((e) => visible(e, kindFilter, tab, area, areas)),
    [entries, kindFilter, tab, area, areas],
  );
  const days = useMemo(() => groupByDay(shown), [shown]);
  const tiles = useMemo(
    () => areaCounts(entries.filter((e) => visible(e, kindFilter, 'latest', undefined, areas)), areas),
    [entries, kindFilter, areas],
  );

  const open = openId ? byId.get(openId) ?? null : null;
  const openCard = (e: WhatsNewEntry) => {
    setOpenId(e.id);
    if (!readIds.has(e.id)) markRead.mutate([e.id]);
  };

  const cardProps = (e: WhatsNewEntry) => ({
    entry: e,
    unread: unreadOnArrival.has(e.id),
    isAdmin,
    onOpen: () => openCard(e),
    onEdit: () => setEditing(e),
  });

  const searching = hits !== null;
  // ★★ fix-670 §E: the guide half of the one search box. Its own failure
  //    hides only its own group — the cards still render.
  const guideHits = searching && !guideSearch.isError ? guideSearch.data ?? [] : [];
  const showTiles = tab === 'browse' && area === undefined && !searching;

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="whats-new-page">
      <div className="flex items-baseline gap-3 mb-2 flex-none">
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

      {/* ★★ fix-657: the search box on top — "if someone wants to know how to do
          something … they can search for it in here". */}
      <div className="relative mb-2 flex-none">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — e.g. “email a plan”, “resubmittal deadline”, “drone video”"
          className="w-full px-3 py-1.5 text-[12px] border border-border rounded-md bg-surface text-text outline-none focus:border-de"
          data-testid="whats-new-search"
          aria-label="Search What's New"
        />
        {search.active && search.pending && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-dim"
            data-testid="whats-new-searching"
          >
            searching…
          </span>
        )}
      </div>

      {/* ★ fix-485: the ONE tab strip — Latest and Browse are tabs, the kinds
          are chips. */}
      <TabStrip<Tab>
        tabs={[
          ...(hasGuide ? [{ id: 'guide' as const, label: 'Guide', testid: 'whats-new-tab-guide' }] : []),
          { id: 'latest', label: 'Latest', testid: 'whats-new-tab-latest' },
          { id: 'browse', label: 'Browse', testid: 'whats-new-tab-browse' },
        ]}
        active={tab}
        onSelect={(t) => {
          selectTab(t);
          if (t === 'browse') setArea(undefined);
        }}
        ariaLabel="What's New view"
        testIdPrefix="whats-new"
        className="mb-2 flex-none"
      />

      {/* ★ fix-670: the kind chips filter CARDS — the Guide has none. */}
      {(tab !== 'guide' || searching) && (
        <div className="flex items-center gap-3 mb-2 flex-none flex-wrap">
          {/* ★ Chips rather than tabs, so the whole vocabulary is visible. */}
          <div className="flex items-center gap-1.5" data-testid="whats-new-filters">
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

          {tab === 'browse' && area !== undefined && (
            <button
              type="button"
              onClick={() => setArea(undefined)}
              className="text-[11px] text-de hover:underline bg-transparent border-none p-0"
              data-testid="whats-new-area-back"
            >
              ← All areas
              <span className="text-text font-bold ml-1.5">· {area ?? UNSORTED_LABEL}</span>
            </button>
          )}
        </div>
      )}

      {editing && isAdmin && (
        <EntryEditor
          entry={editing === 'new' ? null : editing}
          areas={areas}
          onClose={() => setEditing(null)}
        />
      )}

      <div
        className="border border-border rounded-md bg-surface flex-1 min-h-0 overflow-y-auto"
        role="tabpanel"
        id={`whats-new-panel-${tab}`}
        aria-labelledby={`whats-new-tab-${tab}`}
        data-testid="whats-new-list"
      >
        {entriesQ.isLoading ? (
          <div className="px-3.5 py-3 text-[11px] text-dim" data-testid="whats-new-loading">
            Loading…
          </div>
        ) : searching ? (
          hits.length === 0 && guideHits.length === 0 && !search.pending ? (
            <div className="p-3.5" data-testid="whats-new-no-match">
              <div className="text-[12px] text-text mb-2.5">No match — try another word.</div>
              <AreaTiles
                tiles={tiles}
                onPick={(a) => {
                  setQuery('');
                  selectTab('browse');
                  setArea(a);
                }}
              />
            </div>
          ) : (
            <div className="p-2 grid gap-1.5" data-testid="whats-new-results">
              {guideHits.length > 0 && (
                // ★★ fix-670: the guide FIRST — it is the manual; the cards are
                //    the tips that hang off it.
                <div className="grid gap-1.5 mb-1" data-testid="whats-new-guide-results">
                  <div className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted px-1">
                    In the guide
                  </div>
                  {guideHits.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setQuery('');
                        selectTab('guide', g.slug);
                      }}
                      className="text-left px-3 py-2 rounded-md border border-border/70 bg-surface hover:border-de"
                      data-testid={`whats-new-guide-hit-${g.slug}`}
                    >
                      <div className="text-[12px] font-bold text-text">{g.title}</div>
                      <div className="text-[11px] text-muted mt-0.5 leading-snug line-clamp-2">
                        <Snippet text={g.snippet} />
                      </div>
                    </button>
                  ))}
                  {hits.length > 0 && (
                    <div className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted px-1 mt-1">
                      Tips
                    </div>
                  )}
                </div>
              )}
              {hits.map((h) => (
                <EntryCard key={h.entry.id} {...cardProps(h.entry)} snippet={h.snippet} />
              ))}
            </div>
          )
        ) : tab === 'guide' ? (
          <GuideTab
            sections={sections}
            mine={myChapters}
            isAdmin={isAdmin}
            entries={entries}
            focusSlug={focusSlug}
            onFocusSlug={(slug) => selectTab('guide', slug)}
            onOpenCard={openCard}
          />
        ) : showTiles ? (
          <div className="p-3" data-testid="whats-new-browse">
            <AreaTiles tiles={tiles} onPick={(a) => setArea(a)} />
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
              <div className="p-2 grid gap-1.5 grid-cols-1 xl:grid-cols-2">
                {day.entries.map((e) => (
                  <EntryCard key={e.id} {...cardProps(e)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {open && (
        <DetailPanel
          entry={open}
          all={entries}
          onClose={() => setOpenId(null)}
          onOpenRelated={openCard}
        />
      )}
    </div>
  );
}

/** One tile per area with its count — the "categorical function". */
function AreaTiles({
  tiles,
  onPick,
}: {
  tiles: { area: string | null; count: number }[];
  onPick: (area: string | null) => void;
}) {
  return (
    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="whats-new-area-tiles">
      {tiles.map((t) => (
        <button
          key={t.area ?? '__unsorted'}
          type="button"
          onClick={() => onPick(t.area)}
          disabled={t.count === 0}
          className="text-left px-3 py-2.5 rounded-md border border-border bg-bg hover:border-de hover:bg-de-bg transition disabled:opacity-45 disabled:hover:bg-bg disabled:hover:border-border"
          data-testid={`whats-new-area-tile-${areaSlug(t.area)}`}
        >
          <div className="text-[12px] font-bold text-text">{t.area ?? UNSORTED_LABEL}</div>
          <div className="text-[10px] text-muted" data-testid={`whats-new-area-count-${areaSlug(t.area)}`}>
            {t.count} {t.count === 1 ? 'entry' : 'entries'}
          </div>
        </button>
      ))}
    </div>
  );
}

/** ★ A highlighted snippet: « » become <mark>; nothing is ever parsed as HTML. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((p, i) =>
        p.mark ? (
          <mark key={i} className="bg-wa-bg text-text rounded-sm px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * ★★★ fix-657 — THE CARD. Title, one line, kind, area, date, unread dot. Compact
 * on purpose, so a screen holds a dozen. Clicking it opens the detail.
 *
 * ★ A focusable div (role="button", tabIndex 0) rather than a <button>, because
 *   an admin's Edit/Delete sit inside it and a button cannot contain buttons.
 *   Enter and Space open it, as a button would.
 */
function EntryCard({
  entry,
  unread,
  isAdmin,
  onOpen,
  onEdit,
  snippet,
}: {
  entry: WhatsNewEntry;
  unread: boolean;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: () => void;
  snippet?: string;
}) {
  const del = useDeleteWhatsNewEntry();
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      className={`px-3 py-2 rounded-md border border-border/70 cursor-pointer hover:border-de transition outline-none focus-visible:border-de ${
        unread ? UNREAD_ROW : READ_ROW
      }`}
      // ★ fix-663 (P-346): the unread stripe is an INSET SHADOW, not a left
      //   border. A 3px left border had to go transparent on a read card, which
      //   left it with three sides. Now every card has the same 1px border on
      //   all four sides (so hover/focus turn all four blue), and the stripe
      //   sits inside it — the text does not move when a card turns read.
      style={unread ? { boxShadow: UNREAD_STRIPE } : undefined}
      data-testid={`whats-new-entry-${entry.id}`}
      data-unread={unread ? 'true' : 'false'}
      data-kind={entry.kind}
      aria-label={`${entry.title} — open details`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {unread && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-none"
            style={{ background: 'var(--color-de)' }}
            data-testid={`whats-new-dot-${entry.id}`}
            aria-label="New to you"
          />
        )}
        <span className="text-[12px] font-bold text-text truncate">{entry.title}</span>
        <span
          className={`inline-block flex-none text-[8px] font-extrabold uppercase px-1.5 rounded-lg ${KIND_CLASS[entry.kind]}`}
          data-testid={`whats-new-kind-${entry.id}`}
        >
          {KIND_LABEL[entry.kind]}
        </span>
        {isAdmin && (
          <span className="ml-auto flex items-center gap-2 flex-none">
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onEdit();
              }}
              className="text-[10px] text-de hover:underline bg-transparent border-none p-0"
              data-testid={`whats-new-edit-${entry.id}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                del.mutate(entry.id);
              }}
              disabled={del.isPending}
              className="text-[10px] text-co hover:underline bg-transparent border-none p-0 disabled:opacity-40"
              data-testid={`whats-new-delete-${entry.id}`}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      <div
        className="text-[11px] text-muted mt-0.5 leading-snug line-clamp-2"
        data-testid={`whats-new-summary-${entry.id}`}
      >
        {snippet ? <Snippet text={snippet} /> : cardSummary(entry)}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[9.5px] text-dim">
        {entry.area && (
          <span
            className="px-1.5 rounded border border-border text-muted"
            data-testid={`whats-new-area-${entry.id}`}
          >
            {entry.area}
          </span>
        )}
        <span>{formatDay(entry.published_on)}</span>
      </div>
    </div>
  );
}

/**
 * ★★★ fix-657 — THE DETAIL. Opened by a click, never by itself (fix-350's rule).
 *
 * Sections show only when there is something to show: the summary, the
 * details (`body`), "How to use it" (numbered, from `how_to`), "Show me →"
 * (from `go_href`, navigated in-app), the media, and up to three related cards
 * from the same area.
 *
 * ★ Escape closes it — listened for on the DOCUMENT, because a keydown handler
 *   on a non-focusable div never fires (fix-440).
 */
function DetailPanel({
  entry,
  all,
  onClose,
  onOpenRelated,
}: {
  entry: WhatsNewEntry;
  all: WhatsNewEntry[];
  onClose: () => void;
  onOpenRelated: (e: WhatsNewEntry) => void;
}) {
  const navigate = useNavigate();
  const originState = useOriginState();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
  }, [entry.id]);

  const summary = (entry.summary ?? '').trim();
  const steps = howToSteps(entry.how_to);
  const href = entry.go_href?.trim() || '';
  // ★ Belt to the CHECK's braces: a value that is not an app path renders no
  //   button at all.
  const canGo = href !== '' && isAppPath(href);
  const media = entry.media_url?.trim() || '';
  const showMedia = isSafeMediaUrl(media);
  const related = relatedEntries(entry, all, 3);

  return (
    <div
      className="fixed inset-0 z-[9300] flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="whats-new-detail-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        className="h-full w-full max-w-[520px] bg-surface border-l border-border shadow-xl overflow-y-auto"
        data-testid="whats-new-detail"
      >
        <div className="sticky top-0 bg-surface border-b border-border px-4 py-3 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[14px] font-extrabold text-text" data-testid="whats-new-detail-title">
                {entry.title}
              </h2>
              <span
                className={`inline-block text-[8px] font-extrabold uppercase px-1.5 rounded-lg ${KIND_CLASS[entry.kind]}`}
              >
                {KIND_LABEL[entry.kind]}
              </span>
            </div>
            <div className="text-[10px] text-dim mt-0.5">
              {entry.area ? `${entry.area} · ` : ''}
              {formatDay(entry.published_on)}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 rounded border border-border text-muted hover:text-text bg-transparent"
            data-testid="whats-new-detail-close"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3.5">
          {summary && (
            <p className="text-[13px] text-text font-semibold leading-snug" data-testid="whats-new-detail-summary">
              {summary}
            </p>
          )}

          <section>
            <h3 className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mb-1">
              Details
            </h3>
            <div
              className="text-[12px] text-text leading-relaxed whitespace-pre-line"
              data-testid="whats-new-detail-body"
            >
              {entry.body}
            </div>
          </section>

          {steps.length > 0 && (
            <section>
              <h3 className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mb-1">
                How to use it
              </h3>
              <ol
                className="list-decimal pl-5 text-[12px] text-text leading-relaxed flex flex-col gap-0.5"
                id={`whats-new-how-${entry.id}`}
                data-testid={`whats-new-how-${entry.id}`}
              >
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          )}

          {canGo && (
            <div>
              <button
                type="button"
                // ★★ navigate(), not an <a href>: react-router keeps it in the
                // app, whatever the string says. The origin is What's New, so
                // Previous comes back here (fix-408).
                onClick={() => navigate(href, { state: originState() })}
                className="text-[12px] font-bold text-white bg-de rounded px-3 py-1.5 border-none"
                data-testid={`whats-new-go-${entry.id}`}
                data-href={href}
              >
                Show me →
              </button>
            </div>
          )}

          {showMedia && (
            <div data-testid={`whats-new-media-${entry.id}`}>
              {mediaKind(media) === 'video' ? (
                <video
                  src={media}
                  controls
                  muted
                  className="w-full rounded border border-border"
                />
              ) : (
                <img
                  src={media}
                  alt={`${entry.title} — screenshot`}
                  loading="lazy"
                  className="w-full rounded border border-border"
                />
              )}
            </div>
          )}

          {related.length > 0 && (
            <section data-testid="whats-new-related">
              <h3 className="text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mb-1">
                Related
              </h3>
              <div className="flex flex-col gap-1">
                {related.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenRelated(r)}
                    className="text-left px-2.5 py-1.5 rounded border border-border bg-bg hover:border-de"
                    data-testid={`whats-new-related-${r.id}`}
                  >
                    <div className="text-[11.5px] font-bold text-text">{r.title}</div>
                    <div className="text-[10.5px] text-muted line-clamp-1">{cardSummary(r)}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** ★★ The admin editor, on the page beside its output.
 *
 *  ★★ HIDDEN HERE, REFUSED IN THE DATABASE. The admin check decides what
 *  renders; the RLS policy decides what is allowed (fix-234, fix-331 §6). */
function EntryEditor({
  entry,
  areas,
  onClose,
}: {
  entry: WhatsNewEntry | null;
  areas: string[];
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
    // ★★ fix-387: '' is the editor's "not set"; the hook writes it as NULL.
    go_href: entry?.go_href ?? '',
    how_to: entry?.how_to ?? '',
    summary: entry?.summary ?? '',
    area: entry?.area ?? '',
    keywords: entry?.keywords ?? [],
    media_url: entry?.media_url ?? '',
  }));
  const [kwInput, setKwInput] = useState('');
  const set = <K extends keyof WhatsNewDraft>(k: K, v: WhatsNewDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // ★ A WARNING, NOT A REFUSAL (fix-350). The how-to and the summary are linted
  //   too — they are the fields most likely to slip into ticket-speak.
  const ticketish = readsLikeATicket(
    `${draft.title} ${draft.body} ${draft.how_to ?? ''} ${draft.summary ?? ''}`,
  );
  // ★★★ fix-387: the client half of the CHECK — see isAppPath.
  const hrefDraft = (draft.go_href ?? '').trim();
  const hrefBad = hrefDraft !== '' && !isAppPath(hrefDraft);
  const mediaDraft = (draft.media_url ?? '').trim();
  const mediaBad = mediaDraft !== '' && !isSafeMediaUrl(mediaDraft);
  const summaryLen = (draft.summary ?? '').trim().length;
  const canSave =
    draft.title.trim() !== '' && draft.body.trim() !== '' && !hrefBad && !mediaBad && summaryLen <= 200;

  const keywords = draft.keywords ?? [];
  const addKeywords = (raw: string) => {
    const add = raw.split(',').map((w) => w.trim()).filter(Boolean);
    if (add.length === 0) return;
    set('keywords', [...new Set([...keywords, ...add])]);
    setKwInput('');
  };
  const routes = useMemo(() => allRibbonRoutes(), []);
  const areaChoices =
    draft.area && !areas.includes(draft.area) ? [...areas, draft.area] : areas;

  const inputCls =
    'w-full px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de';
  const label = 'text-[9px] font-extrabold uppercase tracking-[0.06em] text-muted mt-2 mb-0.5 block';

  return (
    <div
      className="border border-border rounded-md bg-surface p-3 mb-2 flex-none max-h-[60vh] overflow-y-auto"
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
        <select
          value={draft.area ?? ''}
          onChange={(e) => set('area', e.target.value)}
          className="px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none"
          data-testid="whats-new-editor-area"
          aria-label="Area"
        >
          <option value="">Area…</option>
          {areaChoices.map((a) => (
            <option key={a} value={a}>
              {a}
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

      <label className={label} htmlFor="wn-summary">
        Summary — one line on the card{' '}
        <span
          className={summaryLen > SUMMARY_TARGET_CHARS ? 'text-wa' : 'text-dim'}
          data-testid="whats-new-editor-summary-count"
        >
          {summaryLen}/{SUMMARY_TARGET_CHARS}
        </span>
      </label>
      <input
        id="wn-summary"
        value={draft.summary ?? ''}
        onChange={(e) => set('summary', e.target.value.replace(/[\r\n]+/g, ' '))}
        placeholder="What it does, in one line. Blank = the first sentence of the details."
        className={inputCls}
        data-testid="whats-new-editor-summary"
        aria-label="Summary"
      />

      <label className={label}>Details</label>
      <textarea
        value={draft.body}
        onChange={(e) => set('body', e.target.value)}
        rows={4}
        placeholder="A sentence or two, in the words the team uses. Not a ticket title."
        className={`${inputCls} resize-y`}
        data-testid="whats-new-editor-body"
        aria-label="Body"
      />

      <label className={label}>How to use it — one step per line</label>
      <textarea
        value={draft.how_to ?? ''}
        onChange={(e) => set('how_to', e.target.value)}
        rows={3}
        placeholder={'Open a project.\nClick Site Data.\nClick “Drone footage ↗”.'}
        className={`${inputCls} resize-y`}
        data-testid="whats-new-editor-how-to"
        aria-label="How to use it"
      />

      <label className={label}>“Show me” link — where it is in the Bridge</label>
      <input
        value={draft.go_href ?? ''}
        onChange={(e) => set('go_href', e.target.value)}
        list="whats-new-route-list"
        placeholder="An app path like /board?tab=notifications (optional)"
        className={`w-full px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none ${
          hrefBad ? 'border-co' : 'border-border focus:border-de'
        }`}
        data-testid="whats-new-editor-go-href"
        aria-label="Link to the feature"
      />
      <datalist id="whats-new-route-list">
        {routes.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {hrefBad && (
        <div className="text-[10px] text-co mt-1" data-testid="whats-new-editor-href-error">
          Must be a path inside the app — one leading slash, no backslashes.
          &ldquo;//example.com&rdquo; looks like a path but leaves the site.
        </div>
      )}

      <label className={label}>Search words — what people might type</label>
      <div className="flex items-center gap-1 flex-wrap" data-testid="whats-new-editor-keywords-list">
        {keywords.map((k) => (
          <span
            key={k}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg text-text flex items-center gap-1"
            data-testid={`whats-new-editor-keyword-${k}`}
          >
            {k}
            <button
              type="button"
              onClick={() => set('keywords', keywords.filter((x) => x !== k))}
              className="text-dim hover:text-co bg-transparent border-none p-0 leading-none"
              aria-label={`Remove ${k}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={kwInput}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) addKeywords(v);
            else setKwInput(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addKeywords(kwInput);
            }
          }}
          onBlur={() => addKeywords(kwInput)}
          placeholder="deadline, due date… (Enter or comma)"
          className="flex-1 min-w-[160px] px-2 py-1 text-[11px] border border-border rounded bg-bg text-text outline-none focus:border-de"
          data-testid="whats-new-editor-keywords"
          aria-label="Search words"
        />
      </div>

      <label className={label}>Screenshot or GIF — link (optional)</label>
      <input
        value={draft.media_url ?? ''}
        onChange={(e) => set('media_url', e.target.value)}
        placeholder="https://… or an app path"
        className={`w-full px-2 py-1 text-[11px] border rounded bg-bg text-text outline-none ${
          mediaBad ? 'border-co' : 'border-border focus:border-de'
        }`}
        data-testid="whats-new-editor-media"
        aria-label="Screenshot or GIF link"
      />
      {mediaBad && (
        <div className="text-[10px] text-co mt-1" data-testid="whats-new-editor-media-error">
          Must start with https:// or be a path inside the app.
        </div>
      )}

      {ticketish && (
        <div className="text-[10px] text-wa mt-1" data-testid="whats-new-editor-warning">
          This mentions a ticket number. The audience is the team, not the repo —
          &ldquo;fix-347&rdquo; means nothing to a design associate.
        </div>
      )}
      <div className="flex items-center gap-2 mt-2.5">
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
            Could not save — {upsert.error.message}
          </span>
        )}
      </div>
    </div>
  );
}
