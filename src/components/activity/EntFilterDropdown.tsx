import { useEffect, useRef, useState } from 'react';

// fix-28: multi-select dropdown for entitlement leads. Three checkboxes
// (Bobby / Briana / Miles) + an "All" master that toggles the lot.
// Selection is owned by the parent (ActivityPage) and persisted there;
// this component is pure UI.

interface Props {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export default function EntFilterDropdown({
  options,
  selected,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allSelected = selected.size >= options.length;
  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  }
  function toggleAll() {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(options));
    }
  }

  const label =
    allSelected
      ? 'All leads'
      : selected.size === 0
        ? 'No leads'
        : selected.size === 1
          ? Array.from(selected)[0]
          : `${selected.size} leads`;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg transition font-display flex items-center gap-1"
        data-testid="activity-ent-toggle"
      >
        <span className="uppercase tracking-wide text-dim">Lead</span>
        <span>{label}</span>
        <span className="text-dim text-[8px]">▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md border bg-surface shadow-lg z-20 py-1"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="activity-ent-menu"
        >
          <label className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text hover:bg-bg cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              data-testid="activity-ent-all"
            />
            <span className="font-display font-bold">All</span>
          </label>
          <div
            className="border-t my-0.5"
            style={{ borderColor: 'var(--color-border)' }}
          />
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text hover:bg-bg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                data-testid={`activity-ent-opt-${opt}`}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
