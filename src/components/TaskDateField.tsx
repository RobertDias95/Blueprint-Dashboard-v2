import { useState } from 'react';
import BufferedDateInput from './BufferedDateInput';

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
//
// fix-258: that buffering now lives in the shared <BufferedDateInput> (the same
// bug turned up a third time, in IntakeTracker, because the pattern had been
// hand-rolled in each place). This component keeps its own chrome — the muted
// "—" placeholder that reveals the picker — and delegates the input behaviour.
// Observable behaviour is unchanged except that Escape now reverts the draft,
// which the shared control adds everywhere.

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

  const hasValue = !!(committed && committed.trim() !== '');
  const showInput = hasValue || open;

  return (
    <span className="inline-flex items-center" data-testid={`${testId}-field`}>
      {showInput ? (
        <BufferedDateInput
          value={value}
          disabled={disabled}
          autoFocus={open && !hasValue}
          // fix-237/258: buffered — commits ONCE on blur/Enter, never per
          // keystroke. onEditEnd fires on every blur (changed or not), which is
          // what closes the revealed picker exactly as before.
          onCommit={onChange}
          onEditEnd={() => setOpen(false)}
          ariaLabel={ariaLabel}
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
          testId={testId}
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
