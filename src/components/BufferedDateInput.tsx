import { useEffect, useRef, useState } from 'react';
// ★ fix-602 §B: THE rule, in one place. See `lib/dateUtils`.
import { dateInputRejection } from '../lib/dateUtils';

// fix-258: THE one buffered native date input. Use this anywhere a `type=date`
// commits to the server — do not hand-roll the pattern again.
//
// WHY THIS EXISTS
// A native <input type="date"> fires onChange on EVERY intermediate state:
// every segment typed, every picker click. Wiring onChange straight to a
// mutation therefore SAVES transient garbage. This bug class has now been found
// three separate times:
//
//   fix-73  — PermitDetailV2 DateCell (cycle dates)
//   fix-237 — TaskDateField (task dates; a 4-digit year clobbered to "0002")
//   fix-258 — IntakeTracker InlineDate (Miles: editing 2026-08-04 committed the
//             transient 2026-07-04, the row left the displayed week, and the
//             permit appeared to VANISH from the list — plus the refetch
//             snapped the picker shut mid-edit)
//
// Each was fixed by re-deriving the same pattern in a new place. Three copies
// is why it kept coming back, so the behaviour lives here once now.
//
// THE PATTERN
//   * local `draft` is the input's source of truth while editing
//   * a `dirty` flag stops a refetch from overwriting an in-flight edit
//   * commit ONCE on blur or Enter — never on change
//   * `lastCommittedRef` dedupes, so an unchanged value fires no mutation
//   * Escape reverts to the committed value

export interface BufferedDateInputProps {
  /** 'YYYY-MM-DD', or null/'' when unset. */
  value: string | null | undefined;
  /** Fires ONLY when the committed value actually changed. Blur/Enter only —
   *  never per keystroke. Receives null when the field was cleared. */
  onCommit: (next: string | null) => void;
  /** Fires on every edit-ending interaction (blur, Enter, Escape) regardless of
   *  whether the value changed. For callers that need to close an editor. */
  onEditEnd?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  min?: string;
  max?: string;
}

export default function BufferedDateInput({
  value,
  onCommit,
  onEditEnd,
  disabled = false,
  ariaLabel,
  testId,
  className,
  style,
  autoFocus,
  min,
  max,
}: BufferedDateInputProps) {
  const committed = value ?? '';
  const [draft, setDraft] = useState(committed);
  // Gates the value-prop sync below. Once the user has typed but not yet
  // committed, a background refetch (a sibling save, an OCC retry, or this
  // field's own invalidate) must NOT overwrite the draft.
  const [dirty, setDirty] = useState(false);
  const lastCommittedRef = useRef(committed);
  // commit()/revert() read the draft through this ref, never through the render
  // closure. Escape reverts and then the field may blur in the SAME tick — a
  // closure-read would still hold the pre-revert draft and commit the value the
  // user just escaped out of. The ref is updated synchronously, so it can't.
  const draftRef = useRef(committed);
  /** ★ fix-602 §B: the sentence under the box, or null. Set on a refused
   *  commit, cleared on a good one or on Escape. */
  const [rejection, setRejection] = useState<string | null>(null);

  function setDraftBoth(next: string) {
    draftRef.current = next;
    setDraft(next);
  }

  // Pull server truth into the draft only when the user is NOT mid-edit.
  // lastCommittedRef always advances so the dedupe in commit() compares against
  // the freshest committed value even while dirty.
  useEffect(() => {
    const incoming = value ?? '';
    lastCommittedRef.current = incoming;
    if (dirty) return;
    draftRef.current = incoming;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(incoming);
  }, [value, dirty]);

  function commit() {
    onEditEnd?.();
    // Nothing typed, or identical to what's committed → fire nothing. No
    // phantom mutation, no OCC round-trip, no toast.
    if (draftRef.current === lastCommittedRef.current) {
      setDirty(false);
      setRejection(null);
      return;
    }
    // ★★★ fix-602 §B: AN IMPOSSIBLE YEAR SAVES NOTHING AND KEEPS THE OLD
    //     VALUE. The draft is left on screen so the typo is visible and
    //     fixable — reverting under the cursor would look like the box
    //     eating the keystroke — but `lastCommittedRef` does not move and
    //     `onCommit` is never called, so nothing reaches the server.
    const rejection = dateInputRejection(draftRef.current);
    if (rejection) {
      setRejection(rejection);
      return;
    }
    setRejection(null);
    lastCommittedRef.current = draftRef.current;
    setDirty(false);
    onCommit(draftRef.current || null);
  }

  function revert() {
    setDraftBoth(lastCommittedRef.current);
    setDirty(false);
    // ★ Escape clears the refusal too — the value it was about is gone.
    setRejection(null);
    onEditEnd?.();
  }

  // ★★ A FRAGMENT, NOT A WRAPPER DIV. Callers place this input inside their
  //    own grids and one of them (`ProjectDataEditors`' date rows) sizes the
  //    cell from the input itself — an extra block element would change every
  //    layout that has ever used this. The message is a sibling, shown only
  //    when there is one.
  return (
    <>
    <input
      type="date"
      value={draft}
      aria-invalid={rejection ? true : undefined}
      disabled={disabled}
      autoFocus={autoFocus}
      min={min}
      max={max}
      // Local-only: buffer the keystroke, mark dirty, fire NO mutation.
      onChange={(e) => {
        setDraftBoth(e.target.value);
        setDirty(true);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Route through blur so commit + dedupe live in one place.
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Revert only — deliberately NOT followed by blur(). A blur here
          // would re-enter commit(); harmless thanks to the ref + dedupe, but
          // leaving focus put lets the user keep editing after backing out.
          revert();
        }
      }}
      aria-label={ariaLabel}
      className={className}
      style={style}
      data-testid={testId}
    />
    {rejection && (
      <span
        className="text-[10px] block mt-0.5"
        style={{ color: 'var(--color-co)' }}
        data-testid={testId ? `${testId}-rejection` : undefined}
      >
        {rejection}
      </span>
    )}
    </>
  );
}
