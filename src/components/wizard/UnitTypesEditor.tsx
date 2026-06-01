import type { UnitType } from '../../lib/database.types';
import { nextUnitTypeLabel } from '../../lib/unitTypeNaming';

// fix-22: sub-editor for projects.unit_types (jsonb array). Each entry is
// {label, width_ft, depth_ft, qty}. Used in Step 1; v1 captures these
// at kickoff so the schedule downstream can plan around lot/unit mix.
//
// Empty inputs (width/depth) read back as null on the wire so the DB
// keeps clean NULLs rather than zero-as-missing — matches the spec's
// "treat 0 as missing" guidance for legacy data.
//
// fix-81: + Add seeds the next "Type X" letter via nextUnitTypeLabel so
// the team's intake habit (Type A, B, C, …) is automatic; the user can
// still rename any row freeform (e.g. "Cottage 1") and the next +Add
// still picks the next vacant letter, not "Cottage 2".

interface Props {
  value: UnitType[];
  onChange: (next: UnitType[]) => void;
}

function nextRow(rows: readonly UnitType[]): UnitType {
  return {
    label: nextUnitTypeLabel(rows.map((r) => r.label)),
    width_ft: null,
    depth_ft: null,
    qty: 0,
  };
}

function parseNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function UnitTypesEditor({ value, onChange }: Props) {
  const rows = value.length > 0 ? value : [];

  function update(i: number, patch: Partial<UnitType>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }
  function add() {
    onChange([...rows, nextRow(rows)]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div data-testid="unit-types-editor">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-dim">
          Unit Types ({rows.length})
        </span>
        <button
          type="button"
          onClick={add}
          className="text-[11px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition"
          data-testid="unit-types-add"
        >
          + Add unit type
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-dim italic py-1">No unit types yet.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-1.5 items-end"
              data-testid={`unit-types-row-${i}`}
            >
              <label className="col-span-5 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  Label
                </span>
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. 16×40 4BR"
                  className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text placeholder:text-dim focus:outline-none focus:border-de"
                  data-testid={`unit-types-label-${i}`}
                />
              </label>
              <label className="col-span-3 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  W (ft)
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={row.width_ft ?? ''}
                  onChange={(e) =>
                    update(i, { width_ft: parseNumOrNull(e.target.value) })
                  }
                  className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid={`unit-types-width-${i}`}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  D (ft)
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={row.depth_ft ?? ''}
                  onChange={(e) =>
                    update(i, { depth_ft: parseNumOrNull(e.target.value) })
                  }
                  className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid={`unit-types-depth-${i}`}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  Qty
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={row.qty}
                  onChange={(e) =>
                    update(i, { qty: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid={`unit-types-qty-${i}`}
                />
              </label>
              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="text-co hover:text-co/70 text-base px-1"
                  title="Remove row"
                  data-testid={`unit-types-remove-${i}`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
