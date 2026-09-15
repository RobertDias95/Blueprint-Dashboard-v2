import type { UnitType } from '../../lib/database.types';
import {
  ParkingKindSelect,
  RoofDeckSelect,
  StoriesSelect,
} from '../shared/UnitParkingInputs';
import {
  CANONICAL_PARKING,
  CANONICAL_ROOF_DECK,
  CANONICAL_STORIES,
} from '../../lib/unitVocabulary';
import {
  OTHER_UNIT_LABEL,
  nextUnitTypeLabel,
  unitLabelOptions,
} from '../../lib/unitTypeNaming';

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
  /** ★ fix-449 §C: canonical product types for the label picker. */
  productTypeOptions?: string[];
  /**
   * ★★★ fix-562 §A — THE THREE VOCABULARIES, PASSED IN FOR fix-449 §C's REASON.
   *
   * `useAppConfig` is a React Query hook and this component is rendered
   * WITHOUT a provider by its own suite (the fix-442 trap), which is why
   * `productTypeOptions` is a prop here and not a hook call. The same applies
   * to these, so the wizard step above reads all four registries in one place.
   *
   * ★ Defaulted to the canonical lists rather than to `[]`: an empty product
   *   type list makes the label read-only, which is a real state, but an empty
   *   parking list would make the control offer nothing at all.
   */
  parkingOptions?: readonly string[];
  roofDeckOptions?: readonly string[];
  storiesOptions?: readonly string[];
  value: UnitType[];
  onChange: (next: UnitType[]) => void;
}

function nextRow(rows: readonly UnitType[]): UnitType {
  return {
    label: nextUnitTypeLabel(rows.map((r) => r.label)),
    width_ft: null,
    depth_ft: null,
    qty: 0,
    // ★★★ fix-402: a NEW row starts NOT RECORDED on all three, spelled out
    //   rather than left absent — so the intent survives a future refactor
    //   that might otherwise reach for a "sensible default".
    // ★ fix-488 §B: spelled out as null, like the fix-402 trio below — an
    //   absent key and a null key read the same to `parseUnitTypes`, but the
    //   seed is where somebody looks to learn what a unit row holds.
    size_sf: null,
    // ★ fix-562 §A: the two parts of each vocabulary answer, spelled out as
    //   null for the same reason the rest of this seed is — this is where
    //   somebody looks to learn what a unit row holds.
    parking_kind: null,
    parking_count: null,
    roof_deck: null,
    penthouse: null,
    stories: null,
    basement: null,
  };
}

function parseNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function UnitTypesEditor({
  value,
  onChange,
  // ★★ fix-449 §C: the canonical registry, passed IN rather than read from a
  //    hook here. `useAppConfig` is a React Query hook and this component is
  //    rendered without a provider by its own suite — the fix-442 trap. The
  //    wizard step above already holds the list.
  productTypeOptions = [],
  parkingOptions: parkingOpts = CANONICAL_PARKING,
  roofDeckOptions: roofDeckOpts = CANONICAL_ROOF_DECK,
  storiesOptions: storiesOpts = CANONICAL_STORIES,
}: Props) {
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
          Units ({rows.length})
        </span>
        <button
          type="button"
          onClick={add}
          className="text-[11px] px-2 py-0.5 rounded border border-border bg-s2 hover:bg-s3 text-text transition"
          data-testid="unit-types-add"
        >
          + Add type
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-dim italic py-1">No types yet.</div>
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
                {/* ★★★ fix-449 §C1 (P-077) — THE LAST FREE-TEXT UNIT LABEL.
                    Bobby's rule: *"is the set of valid answers fixed? → list."*
                    This box is where the off-list labels came FROM — new rows
                    are seeded by `nextUnitTypeLabel`, which produces "Type A",
                    "Type B", … and 13 of prod's 22 off-list labels are exactly
                    those. It is a pick now, with "Other…" for the deliberate
                    exception, and the seeded value stays visible and marked
                    rather than being silently swapped for a product type. */}
                <select
                  value={row.label}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === OTHER_UNIT_LABEL) {
                      const typed = window.prompt('Type label', row.label);
                      if (typed === null) return;
                      update(i, { label: typed.trim() });
                      return;
                    }
                    update(i, { label: v });
                  }}
                  className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-de"
                  data-testid={`unit-types-label-${i}`}
                >
                  <option value="">Pick type…</option>
                  {unitLabelOptions(productTypeOptions, row.label).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value={OTHER_UNIT_LABEL}>Other…</option>
                </select>
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
              {/* ★★★ fix-402 — PARKING AT CREATION, the front-load rule.
                  Bobby wants the book backfilled; the cheapest way to stop it
                  needing backfilling AGAIN is to ask while the project is
                  being made. ★ Optional and never blocking — a wizard that
                  refused to continue without parking would just get "Garage"
                  typed into every row to get past it, which is worse than NULL
                  because it looks like an answer. */}
              <label className="col-span-4 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  Parking
                </span>
                <ParkingKindSelect
                  kind={row.parking_kind}
                  count={row.parking_count}
                  options={parkingOpts}
                  onChange={(v) =>
                    update(i, {
                      parking_kind: v?.kind ?? null,
                      parking_count: v?.count ?? null,
                    })
                  }
                  testid={`unit-types-parking-kind-${i}`}
                />
              </label>
              {/* ★★★ fix-562 §A — THE STALLS BOX IS GONE FROM THE WIZARD TOO.
                  The count is inside the parking answer now, so asking twice at
                  creation is how the two start disagreeing on day one. */}
              <label className="col-span-3 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  Stories
                </span>
                <StoriesSelect
                  stories={row.stories}
                  basement={row.basement}
                  options={storiesOpts}
                  onChange={(v) =>
                    update(i, {
                      stories: v?.stories ?? null,
                      basement: v?.basement ?? null,
                    })
                  }
                  testid={`unit-types-stories-${i}`}
                />
              </label>
              <label className="col-span-4 flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wide text-dim">
                  Roof Deck
                </span>
                <RoofDeckSelect
                  deck={row.roof_deck}
                  penthouse={row.penthouse}
                  options={roofDeckOpts}
                  onChange={(v) =>
                    update(i, {
                      roof_deck: v?.deck ?? null,
                      penthouse: v?.penthouse ?? null,
                    })
                  }
                  testid={`unit-types-roof-deck-${i}`}
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
