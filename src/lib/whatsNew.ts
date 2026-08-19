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
 *  refusing to save would be a tool arguing with the person writing the words. */
export function readsLikeATicket(text: string): boolean {
  return /\bfix-\d{2,}\b/i.test(text) || /\B#\d{2,}\b/.test(text);
}
