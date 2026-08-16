import type { MentionablePerson, ProjectMessage } from './database.types';

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

/** Split a body into plain and mention runs, for tinting.
 *
 *  ★ Rendering reads the SAME roster the parser did, so a tinted run and a
 *  stored mention id can never disagree — the alternative (tint anything that
 *  looks like @word) would highlight text that notified nobody. */
export function splitBody(
  body: string,
  people: readonly MentionablePerson[],
): BodySegment[] {
  const sorted = [...people]
    .filter((p) => (p.name ?? '').trim().length > 0)
    .sort((a, b) => (b.name ?? '').length - (a.name ?? '').length);
  const out: BodySegment[] = [];
  let i = 0;
  let plain = '';
  const pushPlain = () => {
    if (plain) out.push({ text: plain, mention: false });
    plain = '';
  };
  const lower = body.toLowerCase();
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = sorted.find((p) => {
        const needle = `@${(p.name ?? '').trim().toLowerCase()}`;
        if (!lower.startsWith(needle, i)) return false;
        const after = lower[i + needle.length];
        return after === undefined || !/[a-z0-9]/i.test(after);
      });
      if (hit) {
        pushPlain();
        const len = 1 + (hit.name ?? '').trim().length;
        out.push({
          text: body.slice(i, i + len),
          mention: true,
          userId: hit.user_id,
        });
        i += len;
        continue;
      }
    }
    plain += body[i];
    i += 1;
  }
  pushPlain();
  return out;
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
