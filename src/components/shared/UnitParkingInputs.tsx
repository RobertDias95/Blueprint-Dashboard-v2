import type { ReactNode } from 'react';
import { PARKING_KINDS, type ParkingKind } from '../../lib/database.types';
import {
  PARKING_KIND_LABEL,
  NOT_RECORDED,
  parkingKindCode,
  roofDeckCode,
} from '../../lib/unitParking';

// ===========================================================================
// ★★★ fix-402 — THE THREE UNIT-PARKING CONTROLS, ONE IMPLEMENTATION
// ===========================================================================
//
// Bobby, 2026-08-25: *"by unit it's broken down: is it a garage, is it surface,
// is it both, and how many stalls per unit"* — plus *"just a yes or no, roof
// deck"*.
//
// ★★ THREE MOUNTS, ONE DEFINITION. These render in the wizard's UnitTypesEditor
// (at creation), the Project Overview unit rows, and the Library's editable
// unit table. Each caller supplies its own cell/row markup; only the CONTROL
// lives here, so the vocabulary, the clear-to-NULL affordance and the coercion
// rules cannot drift between three screens the way the acq role string did
// (fix-401).
//
// ★★★ EVERY ONE OF THEM CLEARS BACK TO NULL, and that is the load-bearing
// property. 231 unit rows ship NULL and are backfilled by hand; somebody who
// picks "Garage" by mistake must be able to get back to NOT RECORDED, not just
// to "None" — those are different answers (fix-386's rule).
//
// ★ The blank option renders as "—", the same glyph the read-only views use for
// a NULL, so the editor and the display speak the same language.

// ★ fix-412: this file is the shared UNIT-CELL control module now, not only
//   the parking one. ★ fix-486 §D retired `WorkScopeSelect`; the three
//   fix-402 controls below are what remain.
//   The filename predates the second field; renaming it would touch three
//   mounts and their suites for no behavioural gain, so it is noted rather than
//   done.
const SELECT_CLASS =
  'bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de disabled:opacity-40';

/** ★★★ fix-412 Scope C: fill the grid column you are placed in.
 *
 *  These three controls had NO width, so they auto-sized to their widest option
 *  — which is exactly why "Parking" pushed the row right and "Roof Deck" sat
 *  under the wrong header. In a grid cell they must fill the cell instead.
 *
 *  ★ Opt-IN, defaulting to the old behaviour, so the wizard's UnitTypesEditor
 *  and the Library's unit table — which lay themselves out differently — are
 *  byte-identical to before this ticket. */
function cls(fill?: boolean): string {
  return fill ? `${SELECT_CLASS} w-full` : SELECT_CLASS;
}

// ---------------------------------------------------------------------------
// ★★★ fix-422 — A CELL THAT SHOWS A LETTER AND A MENU THAT SHOWS THE WORDS
// ---------------------------------------------------------------------------
//
// Bobby: *"the drop-down can have the words, but when you select it, then it
// says G for garage, or S for surface."*
//
// ★★★ A NATIVE `<select>` CANNOT DO THAT ON ITS OWN. Its closed face is the
// selected `<option>`'s own text, so "G closed, Garage open" is not two states
// of one element — it is two elements.
//
// ★★ AND THE OBVIOUS FIX IS THE WRONG ONE. Replacing it with a `<button>` plus
// a `<ul role="listbox">` would hand-roll type-ahead, Escape, arrow keys, the
// mobile picker and the screen-reader contract that the platform already ships
// — in a 26px cell, eight times per project.
//
// ★★★ SO THE REAL `<select>` STAYS AND IS LAID OVER THE GLYPH AT ZERO OPACITY.
// Keyboard, type-ahead, the native menu and the accessibility tree are all the
// platform's, unmodified; only the painted face is ours. Three things make that
// honest rather than a trick:
//
//   · the glyph is `aria-hidden` — the select is the only thing in the tree, so
//     nothing is announced twice and nothing is announced wrongly;
//   · the wrapper takes a visible ring on `focus-within`, because hiding a
//     control's own focus ring is how this pattern usually goes wrong;
//   · `cursor-pointer` and the full-cell hit area sit on the select itself, so
//     the click target is the control and not a decoration beside it.
function CodedCell({
  code,
  children,
  disabled,
}: {
  code: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <span
      className={`relative flex items-center justify-center w-full h-[16px] rounded border border-border bg-bg text-[9px] font-bold text-text focus-within:border-de focus-within:ring-1 focus-within:ring-de ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      <span aria-hidden="true" className="pointer-events-none select-none">
        {code}
      </span>
      {children}
    </span>
  );
}

/** ★ The real control, invisible but entirely present. */
const OVERLAY_CLASS =
  'absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default';

export function ParkingKindSelect({
  value,
  onChange,
  disabled,
  testid,
  fill,
  code,
}: {
  value: ParkingKind | null | undefined;
  /** null means the user cleared it back to NOT RECORDED. */
  onChange: (next: ParkingKind | null) => void;
  disabled?: boolean;
  testid: string;
  /** ★ fix-412: fill the grid column rather than auto-sizing. */
  fill?: boolean;
  /** ★ fix-422: paint the cell as a letter code. The MENU still says the words
   *  — see CodedCell for why that needs two elements. */
  code?: boolean;
}) {
  const menu = (
    <>
      <option value="">{NOT_RECORDED} not recorded</option>
      {PARKING_KINDS.map((k) => (
        <option key={k} value={k}>
          {PARKING_KIND_LABEL[k]}
        </option>
      ))}
    </>
  );
  const shared = {
    value: value ?? '',
    disabled,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
      onChange(e.target.value === '' ? null : (e.target.value as ParkingKind)),
    'data-testid': testid,
    'aria-label': 'Parking kind',
  };
  if (code) {
    return (
      <CodedCell code={parkingKindCode(value)} disabled={disabled}>
        <select {...shared} className={OVERLAY_CLASS}>
          {menu}
        </select>
      </CodedCell>
    );
  }
  return (
    <select {...shared} className={cls(fill)}>
      {menu}
    </select>
  );
}

export function StallsInput({
  value,
  onChange,
  onBlur,
  disabled,
  testid,
  fill,
  compact,
}: {
  value: string;
  onChange: (raw: string) => void;
  /** ★ Commit on blur, not per keystroke — the fix-73/98 buffered-input rule
   *  every other numeric cell in these tables already follows. */
  onBlur?: () => void;
  disabled?: boolean;
  testid: string;
  /** ★ fix-412: fill the grid column rather than a fixed w-14. */
  fill?: boolean;
  /** ★ fix-422: a 20px matrix cell. Same input and same coercion — the native
   *  spinner is suppressed, because two arrows in a one-digit box leave no room
   *  for the digit. */
  compact?: boolean;
}) {
  const base = compact
    ? 'bg-bg border border-border rounded text-[9px] font-bold text-text w-full h-[16px] text-center px-0 focus:outline-none focus:border-de focus:ring-1 focus:ring-de disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
    : fill
      ? `${SELECT_CLASS} w-full text-center`
      : `${SELECT_CLASS} w-14 text-center`;
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={NOT_RECORDED}
      className={base}
      data-testid={testid}
      aria-label="Parking stalls"
    />
  );
}

export function RoofDeckSelect({
  value,
  onChange,
  disabled,
  testid,
  fill,
  code,
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
  disabled?: boolean;
  testid: string;
  /** ★ fix-412: fill the grid column rather than auto-sizing. */
  fill?: boolean;
  /** ★ fix-422: paint the cell as Y / N / —, with the words still in the menu. */
  code?: boolean;
}) {
  const menu = (
    <>
      <option value="">{NOT_RECORDED} not recorded</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </>
  );
  const shared = {
    value: value == null ? '' : value ? 'Yes' : 'No',
    disabled,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
      onChange(e.target.value === '' ? null : e.target.value === 'Yes'),
    'data-testid': testid,
    'aria-label': 'Roof deck',
  };
  if (code) {
    return (
      <CodedCell code={roofDeckCode(value)} disabled={disabled}>
        <select {...shared} className={OVERLAY_CLASS}>
          {menu}
        </select>
      </CodedCell>
    );
  }
  return (
    <select {...shared} className={cls(fill)}>
      {menu}
    </select>
  );
}

// ★★★ fix-486 §D — `WorkScopeSelect` IS DELETED. Bobby, 2026-09-03: one way to
// say remodel, and it is the TYPE. The control asked a question a `Remodel`
// label had already answered, and prod says nobody ever answered it twice: 245
// unit rows, zero non-null `work_scope`.
//
// ★ Its three siblings — `ParkingKindSelect`, `StallsInput`, `RoofDeckSelect`
//   (fix-402) — are untouched. They describe things a label cannot.
