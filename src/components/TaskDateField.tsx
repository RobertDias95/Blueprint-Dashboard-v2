import { useState } from 'react';

// fix-229: a calm date field for the live task editors. An EMPTY date renders as
// a muted "—" (no loud native mm/dd/yyyy); clicking it reveals the date picker.
// A set date renders the compact date input directly. Shared by the permit bar
// meta line + the My Tasks detail form so both views treat empty dates the same.

export interface TaskDateFieldProps {
  /** 'YYYY-MM-DD' or null/'' when unset. */
  value: string | null | undefined;
  /** Fires with the new date string, or null when cleared. */
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
  const [open, setOpen] = useState(false);
  const hasValue = !!(value && value.trim() !== '');
  const showInput = hasValue || open;

  return (
    <span className="inline-flex items-center" data-testid={`${testId}-field`}>
      {showInput ? (
        <input
          type="date"
          value={value ?? ''}
          disabled={disabled}
          autoFocus={open && !hasValue}
          onChange={(e) => onChange(e.target.value || null)}
          onBlur={() => setOpen(false)}
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
