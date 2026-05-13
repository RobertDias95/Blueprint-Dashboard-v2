import { useEffect, useRef, useState } from 'react';

// Q9.5.f Item 2: generic multi-select dropdown. Click the chip → popover
// with checkbox list + an "All" toggle pinned at top. Empty Set means "no
// filter" (treat as match-all). Used by the Dashboard stage filters and
// will be reused by Reports filters (Item 6).
//
// Single-select variant: caller passes `multi={false}` — selecting an
// option closes the popover and replaces the previous selection. "All"
// translates to an empty Set in that mode too.

export interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  multi?: boolean;
  width?: number;
  testId?: string;
}

export default function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  multi = true,
  width = 160,
  testId,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside-to-close. Mounted only while the dropdown is open so the
  // listener doesn't run for every page click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggleOption(opt: string) {
    if (!multi) {
      onChange(new Set([opt]));
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  }

  function selectAll() {
    onChange(new Set());
  }

  const isAll = selected.size === 0;
  // Chip label shows "All" when empty, a single value when only one, or
  // "<label>: N" when multiple. Keeps the chip width predictable.
  const chipText = isAll
    ? label
    : selected.size === 1
      ? Array.from(selected)[0]
      : `${label}: ${selected.size}`;

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-block' }}
      data-testid={testId ?? `filter-${label.toLowerCase()}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-2 py-1 rounded-md border bg-bg text-text inline-flex items-center gap-1.5 whitespace-nowrap"
        style={{
          borderColor: isAll ? 'var(--color-border)' : 'var(--color-de)',
          background: isAll ? 'var(--color-bg)' : 'var(--color-de-bg)',
        }}
        data-testid={testId ? `${testId}-btn` : undefined}
      >
        <span
          className="font-bold"
          style={{ color: isAll ? 'var(--color-muted)' : 'var(--color-de)' }}
        >
          {chipText}
        </span>
        <span
          className="text-[9px]"
          style={{
            color: isAll ? 'var(--color-dim)' : 'var(--color-de)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            width,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-dropdown, 0 4px 16px rgba(0,0,0,.15))',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          <label
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer hover:bg-s2 border-b"
            style={{ borderBottomColor: 'var(--color-border)' }}
            data-testid={testId ? `${testId}-all` : undefined}
          >
            <input
              type="checkbox"
              checked={isAll}
              onChange={selectAll}
              className="cursor-pointer"
            />
            <span className="font-bold text-text">All</span>
          </label>
          {options.length === 0 ? (
            <div className="text-[11px] text-dim italic px-2 py-2 text-center">
              (no options)
            </div>
          ) : (
            options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer hover:bg-s2"
                data-testid={testId ? `${testId}-opt-${opt}` : undefined}
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => toggleOption(opt)}
                  className="cursor-pointer"
                />
                <span className="text-text">{opt}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
