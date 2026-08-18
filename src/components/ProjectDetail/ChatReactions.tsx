import { useMemo, useState } from 'react';
import {
  REACTION_EMOJI,
  useToggleReaction,
  type MessageReaction,
} from '../../hooks/useMessageReactions';
import { reactionAudience } from '../../lib/reactionAudience';
import type { MentionablePerson } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-347 §1 — the reaction bar, and the question it is really for
// ===========================================================================
//
// Bobby: "we can say, we saw fifteen people thumbs up it, and we can hover over
// that thumbs up and see… IF ANYONE MISSED THAT POST AND DIDN'T REACT."
//
// ★★★ THE NEGATIVE IS THE FEATURE. A count is the easy half and it is not what
// he asked for; the row below the emoji — "Not yet: Marc · Fisk" — is. Everything
// else here exists to make that line trustworthy.
//
// ★ THE EXPECTED SET, chosen and stated rather than invented silently (the
// brief's rule):
//
//     a post that TAGGED people  →  exactly the people it notified
//                                   (project_messages.mentions — the resolved
//                                   ids fix-347 §4 stores, so a post that said
//                                   "@project" is diffed against the team it
//                                   ACTUALLY reached, not today's team)
//     an UNTAGGED post           →  this project's team (@project, resolved
//                                   now) — and the UI SAYS SO, because that set
//                                   is a reasonable default and a silent one
//                                   would be a guess presented as a fact
//     neither available          →  no "not yet" line at all. Nothing true can
//                                   be said, so nothing is said — a 0-of-0 is a
//                                   worse answer than an absent one.
//
// ★ A reaction NOTIFIES NOBODY. Nothing in this file writes a mention, a task
// or a board item; the only write is the toggle RPC.

export default function ChatReactions({
  messageId,
  projectId,
  reactions,
  userId,
  people,
  mentions,
  projectTeamIds,
}: {
  messageId: string;
  projectId: string;
  /** Every reaction on this project's chat; filtered here. */
  reactions: readonly MessageReaction[];
  userId: string | null;
  people: readonly MentionablePerson[];
  /** The resolved ids this message notified (project_messages.mentions). */
  mentions: readonly string[] | null | undefined;
  /** `@project` resolved for the project this chat belongs to. */
  projectTeamIds: readonly string[];
}) {
  const toggle = useToggleReaction(projectId);
  const [picking, setPicking] = useState(false);

  const mine = useMemo(
    () => reactions.filter((r) => r.message_id === messageId),
    [reactions, messageId],
  );

  /** emoji → the people who used it, in the order they reacted. */
  const groups = useMemo(() => {
    const m = new Map<string, MessageReaction[]>();
    for (const r of mine) {
      const list = m.get(r.emoji) ?? [];
      list.push(r);
      m.set(r.emoji, list);
    }
    return [...m.entries()];
  }, [mine]);

  const audience = useMemo(
    () => reactionAudience({ mentions, projectTeamIds }),
    [mentions, projectTeamIds],
  );

  /** ★★ THE POINT: who was expected and has not responded — with ANY emoji.
   *  Somebody who replied with ❤️ instead of 👍 has plainly seen it, so the
   *  diff is against reactors, not against one emoji's reactors. */
  const notYet = useMemo(() => {
    if (!audience) return [];
    const reacted = new Set(mine.map((r) => r.user_id));
    return audience.userIds
      .filter((id) => !reacted.has(id))
      .map(
        (id) =>
          people.find((p) => p.user_id === id)?.name ??
          people.find((p) => p.user_id === id)?.email ??
          'Someone',
      );
  }, [audience, mine, people]);

  const nameOf = (r: MessageReaction) => r.user_name ?? 'Someone';

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1" data-testid={`chat-reactions-${messageId}`}>
      {groups.map(([emoji, rows]) => {
        const isMine = !!userId && rows.some((r) => r.user_id === userId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle.mutate({ messageId, emoji })}
            disabled={toggle.isPending}
            // ★ The count is visible WITHOUT interaction; the names are the
            // hover. Bobby asked for both, in that order.
            title={`${emoji} ${rows.map(nameOf).join(', ')}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] transition disabled:opacity-50"
            style={{
              borderColor: isMine ? 'var(--color-de)' : 'var(--color-border)',
              background: isMine ? 'var(--color-de-bg)' : 'var(--color-surface)',
            }}
            data-testid={`chat-reaction-${messageId}-${emoji}`}
            data-mine={isMine ? 'true' : 'false'}
            data-names={rows.map(nameOf).join(', ')}
          >
            <span aria-hidden>{emoji}</span>
            <span className="font-bold tabular-nums text-text">{rows.length}</span>
          </button>
        );
      })}

      {/* ★ The way in. A fixed set, so this is a row of six, not a picker. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="px-1.5 py-0.5 rounded-full border border-border text-[11px] text-dim hover:text-de transition"
          title="React — it tells people you have seen this, and notifies nobody"
          aria-expanded={picking}
          data-testid={`chat-react-open-${messageId}`}
        >
          ☺+
        </button>
        {picking && (
          <div
            className="absolute z-20 mt-1 flex gap-0.5 p-1 rounded-md border border-border bg-surface shadow-lg"
            data-testid={`chat-react-picker-${messageId}`}
          >
            {REACTION_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  toggle.mutate({ messageId, emoji: e });
                  setPicking(false);
                }}
                className="px-1 py-0.5 rounded hover:bg-s2 text-[13px]"
                data-testid={`chat-react-pick-${messageId}-${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ★★★ THE NEGATIVE VIEW. Rendered only when there is a real audience to
          diff against, and it names where that audience came from. */}
      {audience && mine.length > 0 && (
        <span
          className="text-[9.5px] text-dim ml-1"
          title={`Expected: ${audience.label}`}
          data-testid={`chat-reactions-audience-${messageId}`}
          data-audience={audience.label}
          data-expected={String(audience.userIds.length)}
        >
          {audience.userIds.length - notYet.length}/{audience.userIds.length} of{' '}
          {audience.label}
          {notYet.length > 0 && (
            <>
              {' · '}
              <span
                className="text-co font-bold"
                data-testid={`chat-reactions-not-yet-${messageId}`}
                data-not-yet={notYet.join(', ')}
              >
                not yet: {notYet.join(' · ')}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
