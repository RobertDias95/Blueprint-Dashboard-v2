import { PARKING_KINDS, type ParkingKind } from '../../lib/database.types';
import { PARKING_KIND_LABEL, NOT_RECORDED } from '../../lib/unitParking';

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

const SELECT_CLASS =
  'bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de disabled:opacity-40';

export function ParkingKindSelect({
  value,
  onChange,
  disabled,
  testid,
}: {
  value: ParkingKind | null | undefined;
  /** null means the user cleared it back to NOT RECORDED. */
  onChange: (next: ParkingKind | null) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : (e.target.value as ParkingKind))
      }
      className={SELECT_CLASS}
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
}: {
  value: string;
  onChange: (raw: string) => void;
  /** ★ Commit on blur, not per keystroke — the fix-73/98 buffered-input rule
   *  every other numeric cell in these tables already follows. */
  onBlur?: () => void;
  disabled?: boolean;
  testid: string;
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
      className={`${SELECT_CLASS} w-14 text-center`}
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
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean | null) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <select
      value={value == null ? '' : value ? 'Yes' : 'No'}
      disabled={disabled}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : e.target.value === 'Yes')
      }
      className={SELECT_CLASS}
      data-testid={testid}
      aria-label="Roof deck"
    >
      <option value="">{NOT_RECORDED}</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}
