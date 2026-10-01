import { useRef, useState } from 'react';

// ===========================================================================
// fix-615 — a number box that saves when you are DONE, not on every keystroke
// ===========================================================================
//
// fix-73's lesson, from the date inputs (BufferedDateInput): a field wired
// straight to a save fires a write per keystroke — typing "210" writes 2, 21
// and 210, and the server's own triggers run on each. So the draft lives here
// and the parent is told ONCE, on blur or Enter. Escape puts the saved value
// back.
//
// ★ It reports a whole number or `null` (empty). Range rules belong to the
//   caller — one column clamps, another refuses — so this never decides them.
// ★ While the box is being edited, a refetch from the server does not
//   overwrite what the person is typing (the `dirty` guard).

export interface BufferedNumberInputProps {
  value: number | null | undefined;
  /** Called once per edit, only when the number actually changed. */
  onCommit: (next: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  ariaLabel?: string;
  testId?: string;
  autoFocus?: boolean;
  /** Called when editing ends without a change (blur, Enter or Escape). */
  onIdle?: () => void;
  className?: string;
}

function parse(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^-?\d+$/.test(t)) return 'invalid';
  return parseInt(t, 10);
}

export default function BufferedNumberInput({
  value,
  onCommit,
  disabled = false,
  placeholder,
  min,
  max,
  ariaLabel,
  testId,
  autoFocus,
  onIdle,
  className,
}: BufferedNumberInputProps) {
  const committed = value == null ? '' : String(value);
  const [draft, setDraft] = useState(committed);
  const [dirty, setDirty] = useState(false);

  // A new value from the server lands unless the person is mid-edit. Adjusted
  // during render from the previous value (React's own pattern) rather than
  // in an effect, which would render twice per refetch.
  const [prevCommitted, setPrevCommitted] = useState(committed);
  if (committed !== prevCommitted) {
    setPrevCommitted(committed);
    if (!dirty) setDraft(committed);
  }

  const doneRef = useRef(false);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const parsed = parse(draft);
    setDirty(false);
    if (parsed === 'invalid' || parsed === (value ?? null)) {
      setDraft(committed);
      onIdle?.();
      return;
    }
    onCommit(parsed);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onFocus={() => {
        doneRef.current = false;
      }}
      onChange={(e) => {
        doneRef.current = false;
        setDraft(e.target.value);
        setDirty(true);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          doneRef.current = true;
          setDraft(committed);
          setDirty(false);
          onIdle?.();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={
        className ??
        'w-20 px-1 py-0.5 text-xs border border-border rounded bg-bg text-text text-center outline-none focus:border-de disabled:opacity-60 placeholder:text-dim placeholder:italic placeholder:text-[10px]'
      }
      data-testid={testId}
    />
  );
}
