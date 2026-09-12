import { useState } from 'react';
import { parseLotDimensionFt } from '../lib/lotDimensions';
import { pushToast } from '../stores/toastStore';

// ===========================================================================
// ★★★ fix-532 §A — THE LIBRARY'S FIRST WRITE SURFACE SINCE fix-506 §H
// ===========================================================================
//
// fix-506 §H removed the Library's only write path — *"this file makes ZERO
// calls to `useUpdateProject`"* — because Bobby ruled it was not a write
// surface. **It is one again, for one person**: `cameron@blueprintcap.com`, the
// only holder of `profiles.may_edit_library`.
//
// ★★★ AND THE DIFFERENCE FROM fix-206's EDITOR IS THE GATE, NOT THE CONTROL.
//     fix-206 wrote `projects` directly, so "may Cam edit this" could only ever
//     have been a browser decision. Every write here goes through
//     `bp_update_library_fields`, which refuses a caller without the capability
//     with `42501` — proven against prod in fix-527 §B. **These components
//     decide what to RENDER; they decide nothing about what may be saved.**
//
// ★★ COMMIT ON BLUR AND ENTER, never per keystroke. The Unit Dimensions editor
//    saves on every change and that is what put three writes in flight for one
//    row (fix-532 §B / P-246). A table cell that saved per character would do
//    the same thing thirty times, and the OCC token fix should not be the only
//    thing standing between a typist and a queue of writes.
//
// ★ ESCAPE REVERTS. A cell that cannot be abandoned is a cell people stop
//   clicking into.

const CELL_INPUT =
  'w-full bg-transparent border border-border rounded px-1 py-0.5 text-center ' +
  'font-mono text-[11px] text-text focus:outline-none focus:border-de';

/** A read-only cell's exact markup, so the two states differ only in whether
 *  there is an input. ★ One definition: a cell that renders differently when it
 *  is not editable is a cell that moves under the reader as they gain a
 *  capability. */
function ReadOnly({ text }: { text: string | null }) {
  return text ? (
    <span className="font-mono text-text">{text}</span>
  ) : (
    <span className="text-dim">—</span>
  );
}

/**
 * A lot width or depth.
 *
 * ★★★ §A4 — BOUNDED BEFORE IT REACHES THE SERVER. `parseLotDimensionFt` refuses
 *     scientific notation and anything whose square would overflow
 *     `lot_size_sf` (an `integer`, P-198). The refusal is a sentence about the
 *     number, shown where the person is typing — never the driver's.
 */
export function LibraryDimensionCell({
  value,
  editable,
  label,
  testId,
  onCommit,
}: {
  value: number | null;
  editable: boolean;
  /** What a rejection calls it. */
  label: string;
  testId: string;
  onCommit: (next: number | null) => void;
}) {
  const shown = value == null || value === 0 ? null : String(value);
  const [draft, setDraft] = useState<string | null>(null);

  if (!editable) return <ReadOnly text={shown} />;

  function commit() {
    if (draft === null) return;
    const parsed = parseLotDimensionFt(draft);
    setDraft(null);
    if (!parsed.ok) {
      // ★ The number is refused and the cell goes back to what it held. Nothing
      //   was sent, and the message says so.
      pushToast(`${label}: ${parsed.message}`, 'error');
      return;
    }
    if ((parsed.value ?? null) === (value ?? null)) return;
    onCommit(parsed.value);
  }

  return (
    <input
      className={CELL_INPUT}
      value={draft ?? shown ?? ''}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      data-testid={testId}
    />
  );
}

/**
 * A zone or an alley — a closed list, so a select.
 *
 * ★★ A SELECT RATHER THAN A TEXT BOX, and that is fix-415's finding rather than
 *    a preference: the zone registry exists because free text produced values
 *    nothing in the app offers, and a substring filter then let `NR` swallow
 *    `NR3`. A typist with a capability should not be able to reintroduce that.
 */
export function LibraryChoiceCell({
  value,
  options,
  editable,
  testId,
  onCommit,
}: {
  value: string | null;
  /** Without the blank — it is prepended, because clearing is an answer. */
  options: readonly string[];
  editable: boolean;
  testId: string;
  onCommit: (next: string | null) => void;
}) {
  if (!editable) return <ReadOnly text={value || null} />;
  return (
    <select
      className={CELL_INPUT}
      value={value ?? ''}
      onChange={(e) => {
        const next = e.target.value.trim();
        onCommit(next === '' ? null : next);
      }}
      data-testid={testId}
    >
      {/* ★ An empty option, because "not recorded" is a state a person needs to
          be able to get back to — the same reasoning fix-410 left on the Site
          card's blank option. */}
      <option value="">—</option>
      {/* ★ The row's CURRENT value is offered even when the registry no longer
          lists it, or selecting the box would silently propose changing it.
          fix-406's lesson: removing a value from a union does not remove it
          from the rows that already hold it. */}
      {(value && !options.includes(value) ? [value, ...options] : options).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
