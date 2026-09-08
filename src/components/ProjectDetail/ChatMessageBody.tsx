import { useMemo, useState } from 'react';
import { initialsOf, splitBody, type MentionSource } from '../../lib/projectChat';
import { useAvatarPathFor, useSignedAvatarUrl } from '../../hooks/useAvatars';

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
// ===========================================================================
// ★★★ fix-505 §C (P-162) — THE PICTURE, WHERE THE LETTERS WERE
// ===========================================================================
//
// Bobby, 2026-09-04: *"in our teams… where it says our name or letters for our
// first and last name, it would show our picture there."*
//
// ★★★ ONE COMPONENT, SO EVERY CIRCLE CHANGES AT ONCE. This is the only avatar
//     in the app — message rows, the chat header strip and the Team card roster
//     all render it — so the picture goes INSIDE it rather than beside it, and
//     no call site learns anything new. (`size` exists for the top-right chip,
//     which draws the same identity at 28px.)
//
// ★★★ THE LOOKUP TAKES THE NAME IT IS ALREADY GIVEN. Callers hand this
//     `fullNameOf(rosterKey)` — "Bobby Dias", not "Bobby" — while
//     `bp_avatar_paths()` returns the roster key. `buildAvatarIndex` carries
//     BOTH strings for the same path precisely so no prop had to be added here
//     and no call site had to know which of the two it holds.
//
// ★★ INITIALS REMAIN THE ANSWER, not a placeholder for one. No picture, no
//    migration yet, a signature that has not arrived, a name with no login, an
//    <img> that fails to load — every one of those falls back to exactly what
//    this component drew before, which is why nothing regresses while prod is
//    still pre-migration.
export function Avatar({
  name,
  titled = false,
  title,
  size = 22,
}: {
  name: string | null | undefined;
  titled?: boolean;
  title?: string;
  /** ★ 22 everywhere it has ever been used; the top-right chip passes 28. The
   *  font scales with it so the letters do not swim in a bigger circle. */
  size?: number;
}) {
  const full = (title ?? name ?? '').trim();
  const pathFor = useAvatarPathFor();
  const path = pathFor(name);
  const urlQ = useSignedAvatarUrl(path);
  // ★★ A BROKEN IMAGE FALLS BACK TO INITIALS, NOT TO A BROKEN-IMAGE GLYPH.
  //    Local to this circle and keyed off the url, so one person's expired
  //    signature cannot blank anybody else's.
  const [failed, setFailed] = useState<string | null>(null);
  const url = urlQ.data && urlQ.data !== failed ? urlQ.data : null;

  return (
    <span
      className="rounded-full bg-s2 text-muted font-bold flex items-center justify-center flex-shrink-0 overflow-hidden"
      style={{ width: size, height: size, fontSize: size * (8.5 / 22) }}
      aria-hidden={titled ? undefined : true}
      title={titled && full ? full : undefined}
      aria-label={titled && full ? full : undefined}
      data-testid="chat-avatar"
      data-has-picture={url ? 'true' : 'false'}
    >
      {url ? (
        <img
          src={url}
          // ★ `alt` mirrors the letters it replaces: named when the circle is
          //   the only identity there is (fix-467 §1's `titled`), and empty
          //   when a name is printed alongside — an image whose alt repeats the
          //   adjacent text is noise to a screen reader.
          alt={titled && full ? full : ''}
          onError={() => setFailed(url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          data-testid="chat-avatar-img"
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
