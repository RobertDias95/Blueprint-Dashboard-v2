import { useEffect, useRef, useState } from 'react';

// fix-229: a calm date field for the live task editors. An EMPTY date renders as
// a muted "—" (no loud native mm/dd/yyyy); clicking it reveals the date picker.
// A set date renders the compact date input directly. Shared by the permit bar
// meta line + the My Tasks detail form so both views treat empty dates the same.
//
// fix-237: buffered/dirty-flag commit. Previously onChange fired the parent
// mutation on EVERY keystroke of the native type=date input. Each mutation
// invalidates the task query → refetch → the controlled `value` prop re-syncs
// the input mid-typing, so a 4-digit year clobbered to "0002"/blank until the
// user retried several times (the classic controlled-input churn Bobby recorded
// on the D&E/Permitting task rows). This now mirrors the cycle DateCell pattern
// (fix-73): keep a local draft, refuse to overwrite it from a refetch while the
// user is mid-edit (dirty), and commit ONCE on blur/Enter — never per keystroke.

export interface TaskDateFieldProps {
  /** 'YYYY-MM-DD' or null/'' when unset. */
  value: string | null | undefined;
  /** Fires with the new date string, or null when cleared. Commit is
   *  blur/Enter-only (fix-237) — NOT per keystroke. */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Accessible name (e.g. "Start date"). */
  ariaLabel: string;
  /** data-testid for the input; the empty placeholder gets `<testId>-empty` and
   *  the always-present wrapper `<testId>-field`. */
  testId: string;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}

export default function TaskDateField({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  testId,
  inputClassName,
  inputStyle,
}: TaskDateFieldProps) {
  const committed = value ?? '';
  const [open, setOpen] = useState(false);
  // fix-237: local draft is the input's source of truth while editing.
  const [draft, setDraft] = useState(committed);
  // fix-237: dirty gates the value-prop sync effect below. Once the user has
  // typed but not yet committed, a background refetch (from a sibling save, an
  // OCC retry, or this cell's own optimistic invalidate) must NOT overwrite the
  // draft — that was the year-clobber symptom.
  const [dirty, setDirty] = useState(false);
  // Tracks the last committed string so blur without a real change is a no-op
  // (no phantom mutation, no toast).
  const lastCommittedRef = useRef(committed);

  // fix-237: pull server truth into the draft only when the user is NOT
  // mid-edit. lastCommittedRef always advances so the dedupe in commit()
  // compares against the freshest committed value even while dirty.
  useEffect(() => {
    const incoming = value ?? '';
    lastCommittedRef.current = incoming;
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(incoming);
  }, [value, dirty]);

  const hasValue = !!(committed && committed.trim() !== '');
  const showInput = hasValue || open;

  function commit() {
    setOpen(false);
    // Dedupe: nothing typed / same as committed → clear dirty, fire nothing.
    if (draft === lastCommittedRef.current) {
      setDirty(false);
      return;
    }
    lastCommittedRef.current = draft;
    setDirty(false);
    onChange(draft || null);
  }

  return (
    <span className="inline-flex items-center" data-testid={`${testId}-field`}>
      {showInput ? (
        <input
          type="date"
          value={draft}
          disabled={disabled}
          autoFocus={open && !hasValue}
          // fix-237: local-only on change — buffer the keystroke, mark dirty,
          // fire NO mutation. Commit happens on blur/Enter.
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            // Enter routes through blur so commit + dedupe live in one place.
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={ariaLabel}
          className={
            inputClassName ??
            'text-[10px] px-1 py-0.5 border rounded outline-none'
          }
          style={
            inputStyle ?? {
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }
          }
          data-testid={testId}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={`Set ${ariaLabel.toLowerCase()}`}
          title={`Set ${ariaLabel.toLowerCase()}`}
          className="text-[11px] px-1 leading-none disabled:opacity-50"
          style={{ background: 'transparent', border: 0, color: 'var(--color-dim)', cursor: 'pointer' }}
          data-testid={`${testId}-empty`}
        >
          —
        </button>
      )}
    </span>
  );
}
