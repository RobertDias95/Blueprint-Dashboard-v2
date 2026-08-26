import { PARKING_KINDS, type ParkingKind } from '../../lib/database.types';
import { PARKING_KIND_LABEL, NOT_RECORDED } from '../../lib/unitParking';
import {
  WORK_SCOPES,
  WORK_SCOPE_SHORT,
  asWorkScope,
  type WorkScope,
} from '../../lib/unitWorkScope';

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
//   the parking one — `WorkScopeSelect` joins the three fix-402 controls below.
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

export function ParkingKindSelect({
  value,
  onChange,
  disabled,
  testid,
  fill,
}: {
  value: ParkingKind | null | undefined;
  /** null means the user cleared it back to NOT RECORDED. */
  onChange: (next: ParkingKind | null) => void;
  disabled?: boolean;
  testid: string;
  /** ★ fix-412: fill the grid column rather than auto-sizing. */
  fill?: boolean;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : (e.target.value as ParkingKind))
      }
      className={cls(fill)}
      data-testid={testid}
      aria-label="Parking kind"
    >
      <option value="">{NOT_RECORDED}</option>
      {PARKING_KINDS.map((k) => (
        <option key={k} value={k}>
          {PARKING_KIND_LABEL[k]}
        </option>
      ))}
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
}) {
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
      className={
        fill ? `${SELECT_CLASS} w-full text-center` : `${SELECT_CLASS} w-14 text-center`
      }
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
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
  disabled?: boolean;
  testid: string;
  /** ★ fix-412: fill the grid column rather than auto-sizing. */
  fill?: boolean;
}) {
  return (
    <select
      value={value == null ? '' : value ? 'Yes' : 'No'}
      disabled={disabled}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : e.target.value === 'Yes')
      }
      className={cls(fill)}
      data-testid={testid}
      aria-label="Roof deck"
    >
      <option value="">{NOT_RECORDED}</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

/**
 * ★★★ fix-412 Scope B — the three-state work-scope control.
 *
 * Bobby: *"a two-way toggle with a third, default state: No work / Work
 * performed / not yet answered."*
 *
 * ★★ A SELECT, NOT A TOGGLE, and the word "toggle" is why it needs saying. A
 * two-position switch cannot show a third state without inventing a visual for
 * "neither position", which is the ambiguity this field exists to remove.
 * `RoofDeckSelect` beside it already answers a yes/no question in three states
 * with a select, and a person reading the row should not have to learn two
 * grammars for the same shape of answer.
 *
 * ★ Clears back to "—" like every other unit control (fix-402's rule): picking
 * "No work" by mistake must be undoable back to NOT ANSWERED, not merely to the
 * other answer — those are different claims.
 */
export function WorkScopeSelect({
  value,
  onChange,
  disabled,
  testid,
  fill,
}: {
  value: WorkScope | null | undefined;
  /** null means the user cleared it back to NOT ANSWERED. */
  onChange: (next: WorkScope | null) => void;
  disabled?: boolean;
  testid: string;
  fill?: boolean;
}) {
  return (
    <select
      value={asWorkScope(value) ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(asWorkScope(e.target.value))}
      className={cls(fill)}
      data-testid={testid}
      aria-label="Work performed"
    >
      <option value="">{NOT_RECORDED}</option>
      {WORK_SCOPES.map((s) => (
        <option key={s} value={s}>
          {WORK_SCOPE_SHORT[s]}
        </option>
      ))}
    </select>
  );
}
