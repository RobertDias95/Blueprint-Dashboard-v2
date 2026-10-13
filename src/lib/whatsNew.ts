// fix-350 — What's New: the domain half, kept pure so it can be asserted
// without rendering anything.
//
// Bobby: *"We should add a what's new thing to the ribbon so people are aware of
// the features, tips and tricks etc."*
//
// ★★★ THE PROBLEM IS NOT THAT THE FEATURES ARE MISSING. Between 2026-08-14 and
// 2026-08-19 this tool gained project chat, @mentions, reactions, tags, a
// notification centre, live updates, a new logo and a dozen other things. Bobby
// has seen every one because he asked for it; the other 28 logins have been told
// about none of them. A feature nobody knows exists is indistinguishable from
// one that was never built.

/** ★ Three kinds, chosen against Bobby's own words: "features, tips and tricks".
 *
 *  ★★ `tip` is the one that matters. Without it this is a release-notes list and
 *  the "tips and tricks" half of the request has nowhere to live; with it, an
 *  admin can write an entry about a two-month-old feature and it is not a lie.
 *
 *  CHECK-constrained in the database too, so the chips and the badge colours are
 *  a closed set — the fix-232 lesson about a registry with two sources. */
export type WhatsNewKind = 'new' | 'improved' | 'tip';

export const WHATS_NEW_KINDS: readonly WhatsNewKind[] = ['new', 'improved', 'tip'];

/** What the chip says. Lower case, because fix-320's rule about not shouting is
 *  a house style, not a one-off. */
export const KIND_LABEL: Record<WhatsNewKind, string> = {
  new: 'new',
  improved: 'improved',
  tip: 'tip',
};

export interface WhatsNewEntry {
  id: string;
  /** ★ The date it SHIPPED, not the date the row was written. */
  published_on: string;
  kind: WhatsNewKind;
  title: string;
  body: string;
  sort_order: number;
  updated_at?: string | null;
  /**
   * ★★★ fix-387: an APP-RELATIVE path to the thing this entry announces, or
   * null when it describes a behaviour with no single destination. Rendered as
   * "Open it →" and navigated with react-router, never as a bare href.
   */
  go_href?: string | null;
  /**
   * ★★ fix-387: the steps, behind a "Show me how" expander. Plain multiline
   * text rendered with `whitespace-pre-line` — the same treatment `body`
   * already gets. Deliberately NOT markdown: three sentences do not need a
   * renderer, and a renderer is a dependency plus an injection surface.
   */
  how_to?: string | null;
  /** ★ fix-657: the one-line card text. Null until somebody writes it — the
   *  card falls back to the first sentence of `body` (display only). */
  summary?: string | null;
  /** ★ fix-657: one of app_config `whatsNewAreas`. Null = not yet sorted. */
  area?: string | null;
  /** ★ fix-657: the words people would search for — they act as synonyms. */
  keywords?: string[] | null;
  /** ★ fix-657: a screenshot or GIF — https, or an app path. */
  media_url?: string | null;
}

/**
 * ★★★ fix-387 — IS THIS AN IN-APP PATH? The client half of the database CHECK,
 * and the two must agree.
 *
 * ★★★ "STARTS WITH A SLASH" IS NOT THE RULE, and the gap is the whole point:
 * `//evil.com` starts with a slash and is a PROTOCOL-RELATIVE URL — a browser
 * given it goes to https://evil.com. `/\evil.com` is the same trick with a
 * backslash some browsers fold into a slash. So the rule is ONE leading slash
 * and no backslash anywhere.
 *
 * ★ The page navigates with react-router's `navigate()`, which cannot leave the
 * origin whatever the string says, so this is the second lock rather than the
 * only one. It exists so the admin editor can say no BEFORE the database does.
 */
export function isAppPath(href: string): boolean {
  return /^\/($|[^/\\])/.test(href) && !href.includes('\\');
}

/** ★ Newest first, then by the within-day tie-break, then by title so the order
 *  is total — two entries on one day with the same sort_order must not swap
 *  places between renders. */
export function sortEntries(
  entries: ReadonlyArray<WhatsNewEntry>,
): WhatsNewEntry[] {
  return [...entries].sort(
    (a, z) =>
      z.published_on.localeCompare(a.published_on) ||
      z.sort_order - a.sort_order ||
      a.title.localeCompare(z.title),
  );
}

/** ★★ Which entries this person has not seen.
 *
 *  ★ PER PERSON, and that is enforced in the database rather than here: the read
 *  rows this receives are the caller's own, because RLS on whats_new_reads only
 *  ever returns `user_id = auth.uid()`. Bobby reading an entry cannot clear it
 *  for Cam even if a future caller passes the wrong set. */
export function unreadEntries(
  entries: ReadonlyArray<WhatsNewEntry>,
  readIds: ReadonlySet<string>,
): WhatsNewEntry[] {
  return entries.filter((e) => !readIds.has(e.id));
}

export function unreadCount(
  entries: ReadonlyArray<WhatsNewEntry>,
  readIds: ReadonlySet<string>,
): number {
  return unreadEntries(entries, readIds).length;
}

export interface WhatsNewDay {
  /** ISO date. */
  date: string;
  entries: WhatsNewEntry[];
}

/** Entries grouped under their date, newest day first. The page renders a date
 *  once and the entries under it, rather than repeating the date on every row. */
export function groupByDay(
  entries: ReadonlyArray<WhatsNewEntry>,
): WhatsNewDay[] {
  const days: WhatsNewDay[] = [];
  for (const e of sortEntries(entries)) {
    const last = days[days.length - 1];
    if (last && last.date === e.published_on) last.entries.push(e);
    else days.push({ date: e.published_on, entries: [e] });
  }
  return days;
}

/** ★ "18 Aug 2026" — the one date format fix-320 settled on. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ★★★ THE HOUSE RULE FOR AN ENTRY, as a predicate rather than an instruction
 *  in a brief nobody re-reads.
 *
 *  The audience is the team, not the repo. "fix-347" means nothing to a design
 *  associate, and an entry generated from a commit message is worse than no
 *  entry because it teaches people this page is not for them. A test asserts
 *  every seeded entry passes this; the admin editor warns on it as you type.
 *
 *  ★ It is a WARNING in the UI and an ASSERTION in the tests, deliberately —
 *  refusing to save would be a tool arguing with the person writing the words.
 *
 *  ★★ fix-387: it lints the HOW-TO too. A how-to is the place most likely to
 *  slip into ticket-speak, because whoever writes it has just finished the
 *  ticket — "as of fix-385 §2, the tab is addressable" at a design associate is
 *  precisely the failure this predicate exists to catch. */
export function readsLikeATicket(text: string): boolean {
  return /\bfix-\d{2,}\b/i.test(text) || /\B#\d{2,}\b/.test(text);
}

// ===========================================================================
// ★★★ fix-657 (P-342) — A TIPS-STYLE GUIDE
// ===========================================================================
//
// Bobby, 2026-10-12: "a highlevel summary of what the TIP is, then you click it
// for more info, and details of how to use it if so. think of apples tip app".
// The pure half: what a card says, how the steps split, which area holds what.

/** The area list when app_config has none (or before it loads). The database
 *  seeds the same eleven, in the same order, into `whatsNewAreas`. */
export const DEFAULT_WHATS_NEW_AREAS: readonly string[] = [
  'Projects',
  'Project Overview',
  'Permits & Reviews',
  'Corrections',
  'Chat & Notifications',
  'Draw Schedule',
  'My Tasks & Board',
  'Reports',
  'Library',
  'Settings',
  'Email',
];

/** The editor's target length for a summary; the database refuses > 200. */
export const SUMMARY_TARGET_CHARS = 120;

/**
 * ★★ What the card says. The written summary when there is one; otherwise the
 * first sentence of `body` — computed here, at display time, and never written
 * back (no existing row changes in this ticket).
 *
 * A sentence ends at . ! or ? followed by a space and a capital/digit/quote, or
 * the end — so "7 a.m. on weekdays" is not split, and a body with no full stop
 * is used whole (cut at a word boundary if it runs long).
 */
export function cardSummary(entry: Pick<WhatsNewEntry, 'summary' | 'body'>): string {
  const own = (entry.summary ?? '').trim();
  if (own) return own;
  const body = (entry.body ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?=\s+[A-Z0-9"“(]|$)/.exec(body);
  const first = (m ? m[1]! : body).trim();
  if (first.length <= 160) return first;
  const cut = first.slice(0, 157);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 80 ? space : 157)}…`;
}

/** ★ `how_to` is one step per line. Leading "1." / "1)" / "-" / "•" are
 *  stripped so a writer who numbers by hand does not get "1. 1. Open…". */
export function howToSteps(howTo: string | null | undefined): string[] {
  return (howTo ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((l) => l !== '');
}

/** Entries per area, in the list's own order; entries with no area (or one not
 *  on the list) are counted under `null` so nothing silently disappears. */
export function areaCounts(
  entries: ReadonlyArray<Pick<WhatsNewEntry, 'area'>>,
  areas: ReadonlyArray<string>,
): { area: string | null; count: number }[] {
  const known = new Set(areas);
  const counts = new Map<string | null, number>();
  for (const e of entries) {
    const a = e.area && known.has(e.area) ? e.area : null;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const out: { area: string | null; count: number }[] = areas.map((a) => ({
    area: a,
    count: counts.get(a) ?? 0,
  }));
  const unsorted = counts.get(null) ?? 0;
  if (unsorted > 0) out.push({ area: null, count: unsorted });
  return out;
}

/** A stable id fragment for an area ("Permits & Reviews" → permits-reviews;
 *  null → unsorted). */
export function areaSlug(area: string | null): string {
  if (area === null) return 'unsorted';
  return area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Does this entry belong in the area tile `area` (null = "Not yet sorted")? */
export function inArea(
  entry: Pick<WhatsNewEntry, 'area'>,
  area: string | null,
  areas: ReadonlyArray<string>,
): boolean {
  if (area === null) return !entry.area || !areas.includes(entry.area);
  return entry.area === area;
}

/** ★ 2–3 cards from the same area, newest first, never the entry itself. An
 *  entry with no area has no "Related" — guessing would be noise. */
export function relatedEntries(
  entry: WhatsNewEntry,
  all: ReadonlyArray<WhatsNewEntry>,
  max = 3,
): WhatsNewEntry[] {
  if (!entry.area) return [];
  return sortEntries(all.filter((e) => e.id !== entry.id && e.area === entry.area)).slice(0, max);
}

/** ★★ A media URL the page may load: https, or an in-app path (the same rule
 *  as go_href). Anything else renders nothing. */
export function isSafeMediaUrl(url: string | null | undefined): boolean {
  const u = (url ?? '').trim();
  if (!u) return false;
  if (/^https:\/\/\S+$/i.test(u)) return true;
  return isAppPath(u);
}

/** Video for .mp4/.webm, otherwise an image (PNG, JPG, GIF). */
export function mediaKind(url: string): 'video' | 'image' {
  return /\.(mp4|webm)(\?|#|$)/i.test(url) ? 'video' : 'image';
}

/** ★ The search snippet marks matches with « » (bp_search_whats_new). Split it
 *  into plain and marked runs so the page renders <mark> — never HTML. */
export function snippetParts(snippet: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  const re = /«([^»]*)»/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet))) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), mark: false });
    out.push({ text: m[1]!, mark: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false });
  return out;
}
