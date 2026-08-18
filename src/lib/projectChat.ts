import { isCurrentMember } from './roster';
import { personTarget, type MentionTarget } from './mentionTags';
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

// ---------------------------------------------------------------------------
// ★★ fix-347 — THE SCANNER NOW MATCHES TAGS TOO, without a second walk
// ---------------------------------------------------------------------------
//
// A person is "a name that notifies one id"; a tag is "a name that notifies
// several". That is the ONLY difference, so the grammar, the longest-match rule
// and the word-boundary rule are shared rather than duplicated — three scanners
// would be three chances to disagree about where a mention is.
//
// ★ EVERY EXISTING CALLER STILL PASSES `MentionablePerson[]` and still works:
// the functions take either shape and normalise. New callers pass targets
// (lib/mentionTags), which is how `@project` and a custom tag reach the same
// code path as `@Miles`.

/** Either shape the mention functions accept. */
export type MentionSource = MentionablePerson | MentionTarget;

function asTarget(s: MentionSource): MentionTarget {
  return 'userIds' in s ? s : personTarget(s);
}

function asTargets(sources: readonly MentionSource[]): MentionTarget[] {
  return sources
    .map(asTarget)
    .filter((t) => t.name.trim().length > 0)
    // Longest first so "@Mary Beth" cannot be consumed by "@Mary", and a tag
    // called "projectleads" is not eaten by "project".
    .sort((a, b) => b.name.length - a.name.length);
}

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
  sources: readonly MentionSource[],
): string[] {
  // ★★ fix-347: built from the SAME ranges the display tints, so what is
  // highlighted and what is stored can never disagree — and a tag contributes
  // its RESOLVED ids (§4), never its name.
  const ids = new Set<string>();
  for (const r of mentionRanges(body, sources)) {
    for (const id of r.userIds) ids.add(id);
  }
  return [...ids];
}

export interface BodySegment {
  text: string;
  /** True when this run is an @mention of someone on the roster. */
  mention: boolean;
  /** The mentioned person's user id, when known. First of `userIds`. */
  userId?: string;
  /** ★ fix-347: everyone the run notifies — several, for a tag. */
  userIds?: string[];
  /** ★ fix-347: 'person' | 'tag' | 'smart', so a tag can be styled as one. */
  kind?: MentionTarget['kind'];
}

/** A resolved mention's span in the body. */
export interface MentionRange {
  start: number;
  /** Exclusive. */
  end: number;
  /** ★ fix-347: EVERYONE this run notifies — one for a person, many for a tag,
   *  and legitimately NONE for a tag that currently resolves to nobody (which
   *  the composer warns about before send rather than swallowing). */
  userIds: string[];
  /** What was matched, so a renderer can style a tag differently. */
  kind: MentionTarget['kind'];
  /** The matched name, without the `@`. */
  name: string;
}

/** ★ ONE SCANNER. `splitBody`, `unresolvedMentions` and any future highlighter
 *  all need the same answer to "where in this text are the real mentions", and
 *  three walks of the string is three chances to disagree about it. */
export function mentionRanges(
  body: string,
  sources: readonly MentionSource[],
): MentionRange[] {
  const sorted = asTargets(sources);
  const lower = body.toLowerCase();
  const out: MentionRange[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = sorted.find((t) => {
        const needle = `@${t.name.trim().toLowerCase()}`;
        if (needle.length <= 1) return false;
        if (!lower.startsWith(needle, i)) return false;
        const after = lower[i + needle.length];
        return after === undefined || !/[a-z0-9]/i.test(after);
      });
      if (hit) {
        const len = 1 + hit.name.trim().length;
        out.push({
          start: i,
          end: i + len,
          userIds: hit.userIds,
          kind: hit.kind,
          name: hit.name.trim(),
        });
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
  sources: readonly MentionSource[],
): BodySegment[] {
  const ranges = mentionRanges(body, sources);
  const out: BodySegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      out.push({ text: body.slice(cursor, r.start), mention: false });
    }
    out.push({
      text: body.slice(r.start, r.end),
      mention: true,
      // ★ fix-347: THE TAG'S TEXT IS WHAT RENDERS — "@project" reads better
      // than five names, and the ids it stands for are on the segment for
      // anything that needs them (the hover, the audience diff).
      userId: r.userIds[0],
      userIds: r.userIds,
      kind: r.kind,
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
  sources: readonly MentionSource[],
): string[] {
  const ranges = mentionRanges(body, sources);
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

/**
 * ★★ fix-347 — the OTHER thing worth warning about before send: a tag that
 * MATCHED but currently notifies nobody.
 *
 * `unresolvedMentions` catches "@mi", a token that means nothing. This catches
 * "@project" on a project whose roles are all empty, or a custom tag whose
 * membership has been emptied — text that LOOKS like a working mention, is
 * highlighted like one, and would reach no one. The brief: "A tag that resolves
 * to nobody must tell the sender before it posts."
 *
 * Returned as the names typed, deduped, in order.
 */
export function emptyMentionTargets(
  body: string,
  sources: readonly MentionSource[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of mentionRanges(body, sources)) {
    if (r.userIds.length > 0) continue;
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.name);
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
 *  has a D"* — prefix matches above substring matches, both offered.
 *
 *  ★ fix-347: a TAG is ranked by exactly the same rules. It has no email, so the
 *  two local-part clauses simply never fire for one. */
export function mentionMatchRank(
  person: MentionSource,
  query: string,
): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const name = ('name' in person ? (person.name ?? '') : '').toLowerCase();
  const local = ('email' in person ? (person.email ?? '') : '')
    .split('@')[0]
    .toLowerCase();
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
export function rankMentionCandidates<T extends MentionSource>(
  query: string,
  sources: readonly T[],
  limit = 8,
): T[] {
  return sources
    .filter((p) => ((p as { name?: string | null }).name ?? '').trim().length > 0)
    .map((p) => ({ p, rank: mentionMatchRank(p, query) }))
    .filter((x): x is { p: T; rank: number } => x.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (((a.p as { name?: string | null }).name ?? '')).localeCompare(
          ((b.p as { name?: string | null }).name ?? ''),
        ),
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

// ---------------------------------------------------------------------------
// ★★ fix-334 — posts, and the pure half of everything they need
// ---------------------------------------------------------------------------
//
// Bobby: "Similar to Teams, there is a way to do posts within a chat… different
// posts for different concepts or different categories of chatting, that way you
// can keep a chat more organized."
//
// ★ TWO LEVELS. A post is a titled top-level entry; replies hang under it and
// nothing hangs under a reply. Teams does not nest further and neither does
// this — the database refuses a third level, and this groups accordingly.

/** A post with its replies, in the shape both surfaces render. */
export interface ChatPost {
  post: ProjectMessage;
  replies: ProjectMessage[];
  /** Live replies (deleted ones excluded), from the RPC where available. */
  replyCount: number;
  /** Newest of the post and its live replies — how the list is ordered. */
  lastActivityAt: string;
}

/** True when this message has been soft-deleted. */
export function isDeleted(m: Pick<ProjectMessage, 'deleted_at'>): boolean {
  return !!m.deleted_at;
}

/** True when the body on screen is not the body that was first written. */
export function isEdited(m: Pick<ProjectMessage, 'edited_at'>): boolean {
  return !!m.edited_at;
}

/**
 * ★ The text a deleted or edited message USED to carry — the thing Bobby asked
 * to keep: "we still want to show the original text, but then it maybe just
 * kind of gets minimized."
 *
 * The FIRST revision, not the last: revisions are appended oldest-first, so
 * entry 0 is what was originally written. An edit-then-delete leaves two
 * entries and the original is still the one worth surfacing.
 */
export function originalBody(
  m: Pick<ProjectMessage, 'revisions' | 'body'>,
): string | null {
  const revs = m.revisions ?? [];
  return revs.length > 0 ? revs[0]!.body : null;
}

/**
 * Group a flat thread into posts and their replies.
 *
 * ★ THE FLAT LIST IS THE WIRE SHAPE and this is the only place it becomes a
 * tree. The RPC returns one row per message because the realtime refresh has to
 * diff a list; nesting it server-side would have meant two shapes for one
 * thread and a second grouping rule to keep in step.
 *
 * ★ AN ORPHANED REPLY IS NOT DROPPED. If a reply's post is somehow absent from
 * the payload it is collected under a synthetic post rather than silently
 * vanishing — silently vanishing is how the pre-post messages would have been
 * lost, and it is the failure mode this whole ticket is guarding.
 */
export function groupIntoPosts(
  messages: readonly ProjectMessage[],
): ChatPost[] {
  const posts = messages.filter((m) => m.parent_message_id === null);
  const byPost = new Map<string, ProjectMessage[]>();
  for (const m of messages) {
    if (m.parent_message_id === null) continue;
    const list = byPost.get(m.parent_message_id);
    if (list) list.push(m);
    else byPost.set(m.parent_message_id, [m]);
  }

  const out: ChatPost[] = posts.map((post) => {
    const replies = (byPost.get(post.id) ?? []).sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    byPost.delete(post.id);
    return {
      post,
      replies,
      replyCount:
        post.reply_count ?? replies.filter((r) => !isDeleted(r)).length,
      lastActivityAt:
        post.last_activity_at ??
        replies.filter((r) => !isDeleted(r)).reduce(
          (max, r) => (r.created_at > max ? r.created_at : max),
          post.created_at,
        ),
    };
  });

  // Whatever is left points at a post this payload does not contain.
  for (const [parentId, replies] of byPost) {
    const sorted = [...replies].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    out.push({
      post: {
        ...sorted[0]!,
        id: parentId,
        parent_message_id: null,
        title: 'Unfiled',
        body: '',
        attachments: [],
        revisions: [],
      },
      replies: sorted,
      replyCount: sorted.filter((r) => !isDeleted(r)).length,
      lastActivityAt: sorted[sorted.length - 1]!.created_at,
    });
  }

  // Newest conversation first — a post someone replied to this morning matters
  // more than one nobody has touched since June.
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

// ---------------------------------------------------------------------------
// ★ Search within one project's conversation
// ---------------------------------------------------------------------------
//
// Bobby: "Maybe add a search feature within that chat. So then, if you're like,
// oh, where was this talked about, you can find it and then go from there."
//
// ★ CLIENT-SIDE, AND THAT IS A DECISION. The corpus is ONE project's chat and it
// is already in memory — the thread has to be loaded to render at all. A
// server-side search would add an RPC, an index and a round trip per keystroke
// to search a few dozen rows the browser is already holding. It is not the
// app-wide search fix-331 §5 deleted: that one had nothing behind it; this has
// a real corpus and a real scope.
//
// ★★ "AND THEN GO FROM THERE" IS THE REQUIREMENT. A hit carries the post it
// lives in, so selecting it can OPEN that post and land on the message — not
// merely list it. The caller uses `postId` + `message.id` to do exactly that.

export interface ChatSearchHit {
  /** The post this hit lives in — what the caller opens. */
  postId: string;
  /** The post's title, for the result row. */
  postTitle: string;
  /** The matching message. For a title hit this IS the post. */
  message: ProjectMessage;
  /** Did the POST TITLE match, or a body? */
  field: 'title' | 'body';
  /** A window of the body around the hit, for recognition. */
  excerpt: string;
}

/** Roughly 70 characters of context around the match. */
function excerptAround(body: string, at: number, needle: number): string {
  const start = Math.max(0, at - 30);
  const end = Math.min(body.length, at + needle + 40);
  return (
    (start > 0 ? '…' : '') +
    body.slice(start, end).trim() +
    (end < body.length ? '…' : '')
  );
}

/**
 * Search post titles and reply bodies within one project's chat.
 *
 * ★ A DELETED MESSAGE IS NOT SEARCHABLE. Its words are still kept — that is §4's
 * whole point — but surfacing them in search would undo the deletion for every
 * practical purpose.
 */
export function searchChat(
  posts: readonly ChatPost[],
  query: string,
): ChatSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: ChatSearchHit[] = [];
  for (const { post, replies } of posts) {
    const title = post.title ?? '';
    if (title.toLowerCase().includes(q)) {
      hits.push({
        postId: post.id,
        postTitle: title,
        message: post,
        field: 'title',
        excerpt: title,
      });
    }
    for (const m of [post, ...replies]) {
      if (isDeleted(m)) continue;
      const at = m.body.toLowerCase().indexOf(q);
      if (at === -1) continue;
      hits.push({
        postId: post.id,
        postTitle: title,
        message: m,
        field: 'body',
        excerpt: excerptAround(m.body, at, q.length),
      });
    }
  }
  return hits;
}
