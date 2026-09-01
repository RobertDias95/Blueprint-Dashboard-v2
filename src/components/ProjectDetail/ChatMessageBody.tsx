import { useMemo } from 'react';
import { initialsOf, splitBody, type MentionSource } from '../../lib/projectChat';

// fix-331 §3 — the two pieces of chat rendering that BOTH surfaces need.
//
// They used to live in ProjectChatCard.tsx, which fix-331 deletes: the chat has
// one home now, inside the Team card, and a rail card that no longer exists is
// the wrong place to keep the modal's dependencies. Lifted verbatim — nothing
// about how a message renders changed in the move.

/** ★ Shared by the Team section and the modal: mentions tint, everything else
 *  does not. The tint reads the SAME roster the parser did, so a highlighted run
 *  and a stored mention id can never disagree. */
export function MessageBody({
  body,
  people,
}: {
  body: string;
  /** ★ fix-347: people OR mention targets — a tag tints exactly like a person,
   *  because to the reader it is the same thing: a run of text that reached
   *  somebody. */
  people: readonly MentionSource[];
}) {
  const segments = useMemo(() => splitBody(body, people), [body, people]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mention ? (
          <span
            key={i}
            className="font-semibold text-de"
            style={{
              background: 'var(--color-de-bg)',
              borderRadius: 3,
              padding: '0 2px',
            }}
            data-testid="project-chat-mention"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

// ★ fix-346 §1b: the author circle, now used ONLY on individual messages inside
// the modal — Bobby took it off the Team-card preview rows, where the unit is a
// THREAD and an author answers a question nobody asked. The testid is here so
// "no avatar in the preview, avatars still in the modal" is one assertion each
// rather than a guess at a class name.
//
// ★ `initialsOf` is deliberately untouched: register #127 (BO should be BD) is
// a separate fix that lands with the roster names, and it still matters here.
// ★★ fix-467 §1: `titled` exists because the chat HEADER shows avatars with no
// name beside them, and there the circle is the only identity there is. In a
// message row the name is printed alongside, so the circle stays decoration and
// `aria-hidden` — the comment above is still exactly right for that case. One
// component, two truthful states, rather than a second avatar for the header.
// ★ fix-468: `title` overrides what the tooltip says while `name` still decides
//   the initials. The chat header needs "Design Manager · Brittani Ard" — the
//   ROLE is the half you cannot get from a circle of letters — but the letters
//   must still come from the person's name.
export function Avatar({
  name,
  titled = false,
  title,
}: {
  name: string | null | undefined;
  titled?: boolean;
  title?: string;
}) {
  const full = (title ?? name ?? '').trim();
  return (
    <span
      className="rounded-full bg-s2 text-muted font-bold flex items-center justify-center flex-shrink-0"
      style={{ width: 22, height: 22, fontSize: 8.5 }}
      aria-hidden={titled ? undefined : true}
      title={titled && full ? full : undefined}
      aria-label={titled && full ? full : undefined}
      data-testid="chat-avatar"
    >
      {initialsOf(name)}
    </span>
  );
}
