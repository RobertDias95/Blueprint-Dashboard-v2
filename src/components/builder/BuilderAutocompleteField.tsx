import { useEffect, useRef, useState } from 'react';
import { useBuilderSearch } from '../../hooks/useBuilderSearch';
import type { Builder } from '../../lib/database.types';

// fix-23f: Builder/Owner autocomplete input. Used 4-up across the Builder
// panel on both surfaces (wizard Step 1 + Project Settings modal). The
// suggestion list is symmetric across fields — typing in Name, Company,
// Email, or Phone fires the same OR-ILIKE query and shows the same
// candidate set. Picking a suggestion calls `onSelectBuilder` so the
// parent can fill all four sibling fields in one shot.
//
// UX notes:
//   - Suggestions open on focus once value.length >= 1 (don't flash a
//     dropdown the moment the field gains focus with empty content).
//   - Arrow up/down navigates; Enter picks the highlighted item; Esc
//     dismisses; Tab/blur dismisses after a short delay so the mousedown
//     on a suggestion fires first.
//   - Click-outside dismisses via a document mousedown listener wired
//     only while the dropdown is open.
//   - No autocomplete on the input element (autoComplete="off") so the
//     browser's own credential/contact suggestions don't fight ours.

type BuilderField = 'name' | 'company' | 'email' | 'phone';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSelectBuilder: (builder: Builder) => void;
  field: BuilderField;
  label: string;
  placeholder?: string;
  /** Disabled while OCC is missing (Project Settings) or while a save is
   *  in flight. */
  disabled?: boolean;
  testid?: string;
  /** Optional className passthrough so each call site can apply its own
   *  layout (the wizard panel uses a slightly different input style than
   *  the modal's). */
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  /** fix-24d: fires when the user genuinely tabs/clicks away (NOT when
   *  they're picking a suggestion — that path is suppressed via the
   *  internal mousedown ref). Lets the Project Overview surface commit
   *  per-field on blur the same way the plain inputs used to. */
  onBlur?: () => void;
}

/** Picks the right HTML input type for each builder field — email for
 *  Email (browser validation), tel for Phone (mobile numpad), text for
 *  the rest. */
function htmlInputType(field: BuilderField): string {
  if (field === 'email') return 'email';
  if (field === 'phone') return 'tel';
  return 'text';
}

/** Returns the secondary disambiguation line for a suggestion. v1 picked
 *  company; falls back to email then phone when company is missing. */
function suggestionSubtitle(b: Builder): string {
  return b.company ?? b.email ?? b.phone ?? '';
}

export default function BuilderAutocompleteField({
  value,
  onChange,
  onSelectBuilder,
  field,
  label,
  placeholder,
  disabled,
  testid,
  inputClassName,
  inputStyle,
  onBlur,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track whether the most recent mousedown landed inside our suggestion
  // list — if so, treat the input blur as "user is clicking a suggestion"
  // and don't close immediately. The mousedown click handler that follows
  // (on the suggestion) calls handleSelect and closes the menu naturally.
  const suggestionMouseDownRef = useRef(false);

  const { data: suggestions, isLoading } = useBuilderSearch(open ? value : '');

  // Reset highlight whenever the visible list changes to keep arrow-down
  // behaviour intuitive after a query change.
  useEffect(() => {
    setHighlightIdx(0);
  }, [suggestions]);

  // Outside-click dismiss. Listener only attaches while the dropdown is
  // open; cleanup removes it.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function handleSelect(b: Builder) {
    onSelectBuilder(b);
    setOpen(false);
    // Intentionally do NOT re-focus the input here — refocusing fires the
    // input's onFocus auto-open logic and the menu would immediately
    // re-appear. Selection is "done"; user can click back into the field
    // to re-edit if needed.
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' && value.trim().length > 0) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      setHighlightIdx((i) => (i + 1) % suggestions.length);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      setHighlightIdx(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      const pick = suggestions[highlightIdx];
      if (pick) {
        handleSelect(pick);
        e.preventDefault();
      }
    }
  }

  function onInputBlur() {
    // If the user clicked a suggestion, the mousedown ref will be true
    // for one tick. Defer the close so the click handler can fire first.
    // The parent's onBlur is intentionally NOT fired here — fillFromBuilder
    // already runs inside handleSelect and triggers its own save.
    if (suggestionMouseDownRef.current) {
      suggestionMouseDownRef.current = false;
      return;
    }
    setOpen(false);
    onBlur?.();
  }

  return (
    <div className="relative" ref={containerRef} data-testid={`${testid ?? 'builder-ac'}-wrap`}>
      <input
        ref={inputRef}
        type={htmlInputType(field)}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          // Opening on any change is fine — useBuilderSearch debounces.
          if (!open && e.target.value.trim().length > 0) setOpen(true);
        }}
        onFocus={() => {
          if (value.trim().length > 0) setOpen(true);
        }}
        onBlur={onInputBlur}
        onKeyDown={onKeyDown}
        className={inputClassName}
        style={inputStyle}
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        data-testid={testid}
      />
      {open && (suggestions.length > 0 || isLoading) && (
        <div
          className="absolute left-0 right-0 z-50 mt-0.5 max-h-56 overflow-y-auto rounded border shadow-md"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
          // Track mousedown inside the list so onBlur (which fires before
          // the click) knows to skip the close.
          onMouseDown={() => {
            suggestionMouseDownRef.current = true;
          }}
          data-testid={`${testid ?? 'builder-ac'}-menu`}
        >
          {isLoading && suggestions.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-dim">Searching…</div>
          )}
          {suggestions.map((b, i) => {
            const subtitle = suggestionSubtitle(b);
            const isHi = i === highlightIdx;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelect(b)}
                onMouseEnter={() => setHighlightIdx(i)}
                className="w-full text-left px-2 py-1 flex flex-col gap-0 transition"
                style={{
                  background: isHi ? 'var(--color-s2)' : 'transparent',
                  color: 'var(--color-text)',
                }}
                data-testid={`${testid ?? 'builder-ac'}-option-${b.id}`}
              >
                <span className="text-[12px] font-semibold truncate">
                  {b.name}
                </span>
                {subtitle && (
                  <span
                    className="text-[10px] truncate"
                    style={{ color: 'var(--color-dim)' }}
                  >
                    {subtitle}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
