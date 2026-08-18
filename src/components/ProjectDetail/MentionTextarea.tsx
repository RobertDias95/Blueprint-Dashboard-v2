import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyMention,
  findMentionQuery,
  initialsOf,
  rankMentionCandidates,
  type MentionSource,
} from '../../lib/projectChat';

// fix-330 — the @ picker Bobby actually asked for.
//
// Bobby: "It'd be nice if I did @ and then as you start to type someone's name,
// it would show all of the names that meet that criteria. Like if I type @MI it
// should pre-populate Miles, or @D shows everyone that starts with a D or has a
// D."
//
// ★★ WHY fix-329's MENTIONS FAILED, measured rather than guessed. The brief
// assumed `@Miles` worked and only `@mi` did not. On prod, profiles.name and
// full_name are NULL for all 29 logins, so bp_mentionable_people was returning
// EMAIL ADDRESSES as names — `@Miles` matched nothing either. The server half of
// that is fix-330's bp_profile_display_name; this component is the half that
// makes a mention something you PICK, so it can never again depend on somebody
// spelling a roster name exactly.
//
// ★ SELECTING RESOLVES. The inserted token is a name the parser is guaranteed to
// match, so `parseMentions` on send records the person by id. Nothing here
// second-guesses that at read time.
//
// ★ AND WHAT IS NOT PICKED IS NOT A MENTION. An unresolved `@word` renders as
// plain text (it always did) — but silence is what let `@mi` LOOK like it
// worked, so the composer below says so out loud before Send.

export interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  /** ★ fix-347: people AND tags. The picker offers exactly what the parser can
   *  resolve — one list, so "what I picked" and "what got notified" cannot
   *  drift apart. */
  people: readonly MentionSource[];
  /** Enter sends; the picker swallows Enter while it is open. */
  onSubmit: () => void;
  /** fix-330: a snip is Ctrl+V, so the composer's paste handler lives here. */
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  testId: string;
}

export default function MentionTextarea({
  value,
  onChange,
  people,
  onSubmit,
  onPaste,
  placeholder,
  testId,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Set after a selection so the caret can be restored past the inserted name. */
  const pendingCaret = useRef<number | null>(null);

  const query = useMemo(
    () => (open ? findMentionQuery(value, caret) : null),
    [open, value, caret],
  );
  const candidates = useMemo(
    () => (query ? rankMentionCandidates(query.query, people) : []),
    [query, people],
  );
  // ★ Zero matches CLOSES the list rather than showing an empty box. An empty
  // dropdown is the same non-answer `@mi` used to give.
  const showing = !!query && candidates.length > 0;

  // The highlight is CLAMPED, not synced in an effect. Each keystroke shortens
  // the list; an effect that reset `active` afterwards would render one frame
  // pointing at an option that no longer exists.
  const activeIndex = Math.min(active, Math.max(0, candidates.length - 1));

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current != null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  function syncCaret() {
    const el = ref.current;
    if (el) setCaret(el.selectionStart ?? 0);
  }

  function choose(person: MentionSource) {
    if (!query) return;
    const next = applyMention(value, query, caret, person.name ?? '');
    pendingCaret.current = next.caret;
    onChange(next.text);
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (Math.min(i, candidates.length - 1) + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (Math.min(i, candidates.length - 1) - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(candidates[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        // ★ Escape closes the PICKER, and stops there — it must not also close
        // the modal out from under a half-typed message.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter sends, Shift+Enter is a newline — the convention every chat this
      // team already uses.
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
          // Typing an `@` (or editing next to one) re-arms the picker; the
          // query lookup below decides whether there is anything to show.
          setOpen(true);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        // A blur that lands on the list must not close it before the click
        // registers, so the list uses onMouseDown and this waits a tick.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text placeholder:text-dim focus:outline-none focus:border-de"
        style={{ minHeight: 58, resize: 'vertical' }}
        role="combobox"
        aria-expanded={showing}
        aria-controls={`${testId}-mention-list`}
        aria-autocomplete="list"
        data-testid={testId}
      />

      {showing && (
        <ul
          id={`${testId}-mention-list`}
          role="listbox"
          aria-label="Mention someone"
          className="absolute left-2 bottom-full mb-1 z-10 rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
          style={{ minWidth: 220, maxHeight: 232, overflowY: 'auto' }}
          data-testid="mention-picker"
        >
          {candidates.map((p, i) => {
            // ★★ fix-347: a TAG is offered beside the people, and is visibly a
            // tag — Bobby asked for them "visibly distinguished". The sigil is
            // the difference the eye catches; the hint says how many it
            // reaches, which is the thing you actually want to know before
            // pressing it.
            const isTag = 'userIds' in p;
            const key = isTag ? `tag:${p.name}` : (p as { user_id: string }).user_id;
            const sub = isTag
              ? (p.hint ?? 'group')
              : ((p as { email?: string | null }).email ?? '');
            return (
            <li key={key} role="none">
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                // onMouseDown, not onClick: the textarea's blur fires first
                // otherwise and the list is gone before the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
                style={{
                  background:
                    i === activeIndex ? 'var(--color-de-bg)' : 'transparent',
                }}
                data-testid={`mention-option-${key}`}
                data-kind={isTag ? (p.kind ?? 'tag') : 'person'}
                data-active={i === activeIndex ? 'true' : 'false'}
              >
                <span
                  className="rounded-full font-bold flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 20,
                    height: 20,
                    fontSize: isTag ? 11 : 8,
                    background: isTag ? 'var(--color-de-bg)' : 'var(--color-s2)',
                    color: isTag ? 'var(--color-de)' : 'var(--color-muted)',
                  }}
                  aria-hidden
                >
                  {isTag ? '@' : initialsOf(p.name)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold text-text truncate">
                    {p.name}
                  </span>
                  {/* ★ The email is shown because 7 of 29 logins have no roster
                      row and so wear their email's local part as a name. Seeing
                      the address is how you tell two of those apart. */}
                  <span className="block text-[9.5px] text-dim truncate">
                    {sub}
                  </span>
                </span>
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
