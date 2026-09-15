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
  allowClear = true,
  onCommit,
}: {
  value: string | null;
  /** Without the blank — it is prepended, because clearing is an answer. */
  options: readonly string[];
  editable: boolean;
  testId: string;
  /** ★★★ fix-562 §G — `projects.juris` is `NOT NULL`, so for that ONE field
   *  clearing is not an answer and offering it would be a control that can only
   *  fail. Defaulted to true so zone and alley are unchanged. */
  allowClear?: boolean;
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
          card's blank option. ★ fix-562 §G: suppressed for a NOT NULL column. */}
      {allowClear && <option value="">—</option>}
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

// ===========================================================================
// ★★★ fix-562 §G (P-274) — THE REST OF THE LIBRARY BECOMES EDITABLE
// ===========================================================================
//
// fix-532 §A offered a capability holder exactly four cells: lot width, lot
// depth, unit width and unit depth. Everything else on the screen was read-only
// — not because the server refused it, but because the screen never offered it.
// These three cells close that, and every one of them is the SAME markup when
// `editable` is false, so a cell does not move under a reader as they gain a
// capability (fix-532 §A's rule).

/**
 * A whole-number field — `lot_size_sf` is the one this exists for, blank on
 * **179 of 221 projects** (measured 2026-09-15) and the biggest hole in the
 * Library.
 *
 * ★★★ IT WRITES ONLY WHAT A PERSON TYPES, AND THAT IS WORTH SAYING BECAUSE OF
 *     fix-555. 39 projects hold a `lot_size_sf` that is NOT width × depth, and
 *     fix-555 (P-261) is told to read those and change none of them. Making the
 *     field editable does not change them either: nothing here derives, rounds
 *     or reconciles — the `~` marker on the read-only cell stays the only place
 *     a derived size is spoken about.
 *
 * ★ Blank commits `null`, which the RPC now writes (§G). Before this ticket a
 *   null meant "leave unchanged" and clearing was impossible.
 */
export function LibraryIntegerCell({
  value,
  editable,
  label,
  max,
  testId,
  onCommit,
}: {
  value: number | null;
  editable: boolean;
  label: string;
  /** Bounded before the server, fix-532 §A's rule. `lot_size_sf` is an
   *  `integer` (P-198), so the ceiling is derived rather than picked. */
  max: number;
  testId: string;
  onCommit: (next: number | null) => void;
}) {
  const shown = value == null ? null : String(value);
  const [draft, setDraft] = useState<string | null>(null);

  if (!editable) return <ReadOnly text={shown} />;

  function commit() {
    if (draft === null) return;
    const t = draft.trim();
    setDraft(null);
    if (t === '') {
      if (value == null) return;
      return onCommit(null);
    }
    const n = Number(t);
    if (!Number.isFinite(n) || !/^\d+$/.test(t) || n < 0 || n > max) {
      pushToast(`${label}: enter a whole number between 0 and ${max}.`, 'error');
      return;
    }
    if (n === value) return;
    onCommit(n);
  }

  return (
    <input
      className={CELL_INPUT}
      value={draft ?? shown ?? ''}
      inputMode="numeric"
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
 * A yes / no / not-recorded field — `is_corner_lot`.
 *
 * ★★ THREE STATES, NOT TWO (fix-122). `null` is *"nobody has answered"* and is
 *    a different fact from a recorded No; the blank option is how a person gets
 *    back to it after a mis-click, and it only works because §G taught the RPC
 *    to write a null.
 */
export function LibraryTriStateCell({
  value,
  editable,
  testId,
  onCommit,
}: {
  value: boolean | null;
  editable: boolean;
  testId: string;
  onCommit: (next: boolean | null) => void;
}) {
  const shown = value == null ? null : value ? 'Yes' : 'No';
  if (!editable) return <ReadOnly text={shown} />;
  return (
    <select
      className={CELL_INPUT}
      value={value == null ? '' : value ? 'Yes' : 'No'}
      onChange={(e) =>
        onCommit(e.target.value === '' ? null : e.target.value === 'Yes')
      }
      data-testid={testId}
    >
      <option value="">—</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

/**
 * ★★★ A UNIT VOCABULARY CELL — parking, roof deck or stories, in the Library.
 *
 * Takes the COMPOSED label and the registry options and hands back the picked
 * label; the caller decodes. ★ No free text and no clear-to-a-guess: the blank
 * option is `—`, which is NOT RECORDED, and after §B's wipe that is what almost
 * every unit holds.
 */
export function LibraryVocabularyCell({
  value,
  options,
  editable,
  testId,
  onCommit,
}: {
  /** The composed label, or the NOT-RECORDED dash. */
  value: string;
  options: readonly string[];
  editable: boolean;
  testId: string;
  onCommit: (label: string | null) => void;
}) {
  const recorded = value === '—' ? null : value;
  if (!editable) return <ReadOnly text={recorded} />;
  // ★ fix-415/fix-364's append rule: a stored answer the registry no longer
  //   offers is shown at the bottom rather than dropped — a `<select>` whose
  //   value matches no option renders BLANK and lies about the field.
  const offered =
    recorded && !options.includes(recorded) ? [...options, recorded] : options;
  return (
    <select
      className={CELL_INPUT}
      value={recorded ?? ''}
      onChange={(e) => onCommit(e.target.value === '' ? null : e.target.value)}
      data-testid={testId}
    >
      <option value="">—</option>
      {offered.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
