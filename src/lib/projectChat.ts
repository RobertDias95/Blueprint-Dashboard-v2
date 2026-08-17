import { isCurrentMember } from './roster';
import type {
  MentionablePerson,
  ProjectMessage,
  TeamMember,
} from './database.types';

// fix-329 (register #71) — the pure half of project chat: parsing mentions out
// of a body, and splitting a body for display.
//
// ★ IT LIVES IN lib BECAUSE TWO SURFACES AND ONE TEST SUITE NEED IT. The rail
// card tints mentions, the modal tints mentions, the composer resolves them to
// user ids on send, and the bell counts them. Four callers of one rule.

/** ★ The mention grammar, deliberately small: `@` followed by a name from the
 *  roster, longest match first.
 *
 *  It is NOT a regex over "@word" — a name can contain a space ("Mary Beth"),
 *  and matching greedily on word characters would silently mention the wrong
 *  person or nobody. Matching against the KNOWN list also means an unresolvable
 *  @thing is left as plain text rather than becoming a mention that can notify
 *  no one, which is the paperclip-that-does-nothing failure in another costume. */
export function parseMentions(
  body: string,
  people: readonly MentionablePerson[],
): string[] {
  const ids = new Set<string>();
  // Longest name first so "@Mary Beth" cannot be consumed by "@Mary".
  const sorted = [...people]
    .filter((p) => (p.name ?? '').trim().length > 0)
    .sort((a, b) => (b.name ?? '').length - (a.name ?? '').length);
  const haystack = body.toLowerCase();
  for (const person of sorted) {
    const needle = `@${(person.name ?? '').trim().toLowerCase()}`;
    if (needle.length <= 1) continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      // ★ A mention ends at a word boundary, so "@Bob" does not match inside
      // "@Bobby" — the reason the list is walked longest-first as well.
      const after = haystack[at + needle.length];
      if (after === undefined || !/[a-z0-9]/i.test(after)) {
        ids.add(person.user_id);
        break;
      }
      from = at + 1;
    }
  }
  return [...ids];
}

export interface BodySegment {
  text: string;
  /** True when this run is an @mention of someone on the roster. */
  mention: boolean;
  /** The mentioned person's user id, when known. */
  userId?: string;
}

/** A resolved mention's span in the body. */
export interface MentionRange {
  start: number;
  /** Exclusive. */
  end: number;
  userId: string;
}

/** ★ ONE SCANNER. `splitBody`, `unresolvedMentions` and any future highlighter
 *  all need the same answer to "where in this text are the real mentions", and
 *  three walks of the string is three chances to disagree about it. */
export function mentionRanges(
  body: string,
  people: readonly MentionablePerson[],
): MentionRange[] {
  const sorted = [...people]
    .filter((p) => (p.name ?? '').trim().length > 0)
    .sort((a, b) => (b.name ?? '').length - (a.name ?? '').length);
  const lower = body.toLowerCase();
  const out: MentionRange[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = sorted.find((p) => {
        const needle = `@${(p.name ?? '').trim().toLowerCase()}`;
        if (!lower.startsWith(needle, i)) return false;
        const after = lower[i + needle.length];
        return after === undefined || !/[a-z0-9]/i.test(after);
      });
      if (hit) {
        const len = 1 + (hit.name ?? '').trim().length;
        out.push({ start: i, end: i + len, userId: hit.user_id });
        i += len;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

/** Split a body into plain and mention runs, for tinting.
 *
 *  ★ Rendering reads the SAME roster the parser did, so a tinted run and a
 *  stored mention id can never disagree — the alternative (tint anything that
 *  looks like @word) would highlight text that notified nobody. */
export function splitBody(
  body: string,
  people: readonly MentionablePerson[],
): BodySegment[] {
  const ranges = mentionRanges(body, people);
  const out: BodySegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      out.push({ text: body.slice(cursor, r.start), mention: false });
    }
    out.push({
      text: body.slice(r.start, r.end),
      mention: true,
      userId: r.userId,
    });
    cursor = r.end;
  }
  if (cursor < body.length) {
    out.push({ text: body.slice(cursor), mention: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ★★ fix-330 — the @ picker, and the honesty rule underneath it
// ---------------------------------------------------------------------------
// Bobby: "When I put in the at symbol and start to type Miles, nothing happens."
//
// ★ Measured on prod 2026-08-17, the reason was worse than "no typeahead":
// profiles.name and full_name are NULL on all 29 logins, so the mentionable
// roster WAS 29 EMAIL ADDRESSES and `@Miles` matched nothing at all. The server
// side of that is fix-330's bp_profile_display_name; this side is the picker
// that makes a mention something you CHOOSE rather than something you spell.
//
// ★★ THE RULE THAT MATTERS MOST: a typed-but-unresolved `@word` must be visibly
// NOT a mention. It already renders as plain text — the parser only ever matched
// known names — but "silently plain" is what let `@mi` look like it worked. The
// composer now says so out loud, before send, in the person's own words.

/** ★ A `@word` that resolves to nobody. Returned in the order typed, deduped.
 *
 *  Only counts an `@` that STARTS a word — otherwise every email address in a
 *  message ("mail dave@blueprintcap.com") would be reported as a failed
 *  mention, and a warning that cries wolf is one people stop reading. */
export function unresolvedMentions(
  body: string,
  people: readonly MentionablePerson[],
): string[] {
  const ranges = mentionRanges(body, people);
  const inside = (i: number) => ranges.some((r) => i >= r.start && i < r.end);
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /@[A-Za-z0-9][A-Za-z0-9._'-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const at = m.index;
    const before = at > 0 ? body[at - 1] : '';
    if (before !== '' && !/\s/.test(before)) continue;
    if (inside(at)) continue;
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m[0]);
  }
  return out;
}

/** The `@…` the caret is currently sitting inside, if any — what the picker
 *  filters on.
 *
 *  ★ ONE SPACE IS ALLOWED, because "Mary Beth" is a name and a picker that
 *  closed on the space could never offer her. Two is not: at that point the
 *  person is writing a sentence, not a name. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** The text between the `@` and the caret. */
  query: string;
}

const MAX_MENTION_QUERY = 32;

export function findMentionQuery(
  text: string,
  caret: number,
): MentionQuery | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const before = at > 0 ? upto[at - 1] : '';
  // An `@` glued to the end of a word is an email address, not a mention.
  if (before !== '' && !/\s/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_MENTION_QUERY) return null;
  if (/[\n\r]/.test(query)) return null;
  if ((query.match(/ /g) ?? []).length > 1) return null;
  return { start: at, query };
}

/** Replace the in-progress `@query` with a resolved `@Name `, and say where the
 *  caret goes. Returned rather than applied so the caller owns the DOM. */
export function applyMention(
  text: string,
  q: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const token = `@${name.trim()} `;
  const next = text.slice(0, q.start) + token + text.slice(caret);
  return { text: next, caret: q.start + token.length };
}

/** How well a person matches what has been typed. Lower is better; the ranking
 *  IS the feature Bobby asked for — *"@D shows everyone that starts with a D or
 *  has a D"* — prefix matches above substring matches, both offered. */
export function mentionMatchRank(
  person: MentionablePerson,
  query: string,
): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const name = (person.name ?? '').toLowerCase();
  const local = (person.email ?? '').split('@')[0].toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (local.startsWith(q)) return 2;
  if (name.includes(q)) return 3;
  if (local.includes(q)) return 4;
  return null;
}

/**
 * ★★ fix-321's rule, as the TS twin of the SQL in fix_330_chat_complete.sql.
 *
 *   CHOOSING someone  →  the current roster only
 *   SHOWING who it is →  whatever is recorded, former or not
 *
 * The picker is a CHOOSING path, so departed staff must never appear in it. The
 * server already applies this inside `bp_mentionable_people`; this applies it
 * again on the way to the list, and the duplication is deliberate — it is the
 * same twin pattern as `disciplineForTeam` ⇄ `bp_discipline_for_team` and
 * `isPermitInCorrections` ⇄ `bp_permit_in_corrections`. It is also the only way
 * the rule can be asserted against a RENDERED picker rather than against a
 * paragraph of SQL.
 *
 * ★ UNKNOWN IS NOT DEPARTED, and getting this backwards is how the rule turns
 * into a bug: 7 of 29 production logins have no roster row at all, and dropping
 * them would silently make live people unmentionable. Only a roster that
 * ACTUALLY SAYS someone has left — every matching row retired — removes them.
 */
export function mentionableAfterRoster(
  people: readonly MentionablePerson[],
  members: readonly TeamMember[] | null | undefined,
): MentionablePerson[] {
  const rows = members ?? [];
  return people.filter((p) => {
    const email = (p.email ?? '').trim().toLowerCase();
    if (!email) return true;
    const mine = rows.filter(
      (m) => (m.email ?? '').trim().toLowerCase() === email,
    );
    if (mine.length === 0) return true;
    return mine.some(isCurrentMember);
  });
}

/** The picker's list: everyone who matches, best first, alphabetical inside a
 *  rank. An empty query offers everybody — typing a bare `@` should show you
 *  who there is, not an empty box. */
export function rankMentionCandidates(
  query: string,
  people: readonly MentionablePerson[],
  limit = 8,
): MentionablePerson[] {
  return people
    .filter((p) => (p.name ?? '').trim().length > 0)
    .map((p) => ({ p, rank: mentionMatchRank(p, query) }))
    .filter((x): x is { p: MentionablePerson; rank: number } => x.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.p.name ?? '').localeCompare(b.p.name ?? ''),
    )
    .slice(0, limit)
    .map((x) => x.p);
}

/** Does this message mention this person? */
export function mentionsMe(
  message: Pick<ProjectMessage, 'mentions'>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return (message.mentions ?? []).includes(userId);
}

/** ★ The bell's key for a mention. `mention:{message_id}` — the message id is a
 *  uuid primary key, so it is the immutable database identity fix-307's scheme
 *  requires and re-derivation can never re-notify. */
export function keyForMention(messageId: string): string {
  return `mention:${messageId}`;
}

/** The last N messages, newest last — what the rail card shows. */
export function lastMessages(
  messages: readonly ProjectMessage[],
  n: number,
): ProjectMessage[] {
  return messages.slice(Math.max(0, messages.length - n));
}

/** A compact "Thu 16:40" stamp, as the mockup shows. Falls back to the raw
 *  string rather than rendering "Invalid Date" at anyone. */
export function chatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Two-letter avatar initials, the mockup's circle. */
export function initialsOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '··';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
