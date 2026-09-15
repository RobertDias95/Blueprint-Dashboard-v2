import type { ParkingKind } from '../../lib/database.types';
import {
  NOT_RECORDED,
  decodeParking,
  decodeRoofDeck,
  decodeStories,
  parkingLabel,
  roofDeckLabel,
  storiesLabel,
  withCurrent,
} from '../../lib/unitVocabulary';

// ===========================================================================
// ★★★ fix-402 → fix-562 §A — THE THREE UNIT-MATRIX CONTROLS, ONE IMPLEMENTATION
// ===========================================================================
//
// Bobby, 2026-09-14: parking is *"one-car, two-car, three, four, or
// surface/none"*; the roof deck is *"W/ PH · W/O PH · None"*; stories run
// *"1 · 1+B · 2 · 2+B · 3 · 3+B · 4 · 4+B"*, where B is a basement.
//
// ★★ THREE MOUNTS, ONE DEFINITION. These render in the wizard's
// `UnitTypesEditor` (at creation), the Project Details unit matrix, and the
// Library's unit table. Each caller supplies its own cell markup; only the
// CONTROL lives here, so the vocabulary and the clear-to-NULL affordance cannot
// drift between three screens the way the acq role string did (fix-401).
//
// ★★★ AND THE VOCABULARY ITSELF IS NOT HERE EITHER — it is in
// `app_config.parkingOptions` / `roofDeckOptions` / `storiesOptions`, read
// through `lib/unitVocabulary`. fix-232's rule: a dropdown's options are
// canonical in `app_config` and the control is dropdown-only. Hard-coding a
// fourth, fifth and sixth list is the drift P-173 is about.
//
// ★★★ EVERY ONE OF THEM CLEARS BACK TO NULL, and after §B's wipe that is the
// state of every unit on prod: 123 parking, 123 roof deck and 256 stories
// values were snapshotted and cleared, and the team refills by hand. Somebody
// who picks `Surface / None` by mistake must be able to get back to NOT
// RECORDED — those are different answers (fix-386's rule).
//
// ★★★ NO FREE TEXT AND NO STALLS INPUT. `StallsInput` is DELETED: Bobby folded
// the stall count into the parking answer, so a separate number box is a second
// way to say the same thing. The 123 rows that held one are in
// `_fix562_unit_matrix_snapshot`, not converted.
//
// ★ The filename predates the second and third vocabulary; renaming it would
//   touch three mounts and their suites for no behavioural gain, so it is noted
//   rather than done (fix-412 left the same note).

const SELECT_CLASS =
  'bg-bg border border-border rounded px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:border-de disabled:opacity-40';

/** ★★★ fix-412 Scope C: fill the grid column you are placed in.
 *
 *  These controls had NO width once, so they auto-sized to their widest option
 *  — which is exactly why "Parking" pushed the row right and "Roof Deck" sat
 *  under the wrong header. In a grid cell they must fill the cell instead.
 *
 *  ★ Opt-IN, defaulting to the old behaviour, so the wizard's UnitTypesEditor —
 *  which lays itself out differently — is unchanged. */
function cls(fill?: boolean): string {
  return fill ? `${SELECT_CLASS} w-full` : SELECT_CLASS;
}

// ---------------------------------------------------------------------------
// ★★★ fix-572 §C (P-277) — THE CODED CELL IS DELETED, AND SO IS ITS LAST
//     CALLER. Recorded rather than dropped, because it was a real solution to a
//     real constraint and the reasoning is worth keeping.
// ---------------------------------------------------------------------------
//
// ★★ WHAT IT WAS. A native `<select>`'s closed face is the selected option's
//    own text, so *"G closed, Garage open"* is not two states of one element —
//    it is two elements. Hand-rolling a `<button>` + `<ul role="listbox">` would
//    have re-implemented type-ahead, Escape, arrow keys, the mobile picker and
//    the screen-reader contract the platform already ships. So the real
//    `<select>` stayed and was laid over a painted face at zero opacity:
//    keyboard, type-ahead, the native menu and the a11y tree all the platform's,
//    only the face ours. fix-562 §A narrowed the face from a letter code
//    (`G`/`S`/`B`) to the short form of the real answer (`2G`, `PH`, `3+B`).
//
// ★★★ WHY IT GOES. The whole mechanism existed to fit an answer into a 26px
//     matrix cell. §C retires that matrix, and the only surface that ever
//     passed `code` was the modal's unit row — the Overview card has printed
//     the answers in full since fix-507/508 transposed it, and the wizard's
//     `UnitTypesEditor` never used it. **With `code` unset everywhere, keeping
//     the prop would leave a shape the next reader would believe was live.**
//     §A's rule, applied to a prop instead of a callback: *"A prop left
//     dangling is how the next grep lies."*
//
// ★ `fill` STAYS: it is what makes a select take the width it is given, which
//   is exactly what a field in the new form needs (fix-412 Scope C's rule, and
//   the reason "Parking" once pushed the row right).

/**
 * ★★ ONE SHAPE FOR ALL THREE CONTROLS. Each takes the OPTIONS (from the
 * registry, threaded by the caller) and the CURRENT composed label, and hands
 * back the decoded parts — so no caller ever parses a label itself.
 */
function VocabularySelect({
  value,
  options,
  onPick,
  disabled,
  testid,
  ariaLabel,
  fill,
}: {
  value: string;
  options: readonly string[];
  onPick: (label: string | null) => void;
  disabled?: boolean;
  testid: string;
  ariaLabel: string;
  fill?: boolean;
}) {
  // ★ fix-415/fix-364's append rule: a stored answer the registry no longer
  //   offers is shown at the BOTTOM rather than dropped, because a `<select>`
  //   whose value matches no option renders BLANK and silently claims the field
  //   is empty.
  const offered = withCurrent(options, value === NOT_RECORDED ? null : value);
  const menu = (
    <>
      <option value="">{NOT_RECORDED} not recorded</option>
      {offered.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </>
  );
  const shared = {
    value: value === NOT_RECORDED ? '' : value,
    disabled,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
      onPick(e.target.value === '' ? null : e.target.value),
    'data-testid': testid,
    'aria-label': ariaLabel,
  };
  return (
    <select {...shared} className={cls(fill)}>
      {menu}
    </select>
  );
}

export function ParkingKindSelect({
  kind,
  count,
  options,
  onChange,
  disabled,
  testid,
  fill,
}: {
  kind: ParkingKind | null | undefined;
  count: number | null | undefined;
  /** `app_config.parkingOptions`, read by the caller through
   *  `lib/unitVocabulary.parkingOptions`. */
  options: readonly string[];
  /** ★★★ BOTH PARTS MOVE TOGETHER, ALWAYS. There is no vocabulary entry that
   *  sets a kind without its count, so there is no callback that can. `null`
   *  means the user cleared it back to NOT RECORDED. */
  onChange: (next: { kind: ParkingKind; count: number | null } | null) => void;
  disabled?: boolean;
  testid: string;
  fill?: boolean;
}) {
  const label = parkingLabel(kind, count);
  return (
    <VocabularySelect
      value={label}
      options={options}
      disabled={disabled}
      testid={testid}
      ariaLabel="Parking"
      fill={fill}
      onPick={(picked) => {
        if (picked === null) return onChange(null);
        const parts = decodeParking(picked);
        // ★ An option this app cannot decode writes NOTHING rather than half an
        //   answer. `unitVocabularyIssues` is what makes such an entry visible
        //   in Settings, where somebody typed it.
        if (!parts) return;
        onChange({ kind: parts.kind, count: parts.count });
      }}
    />
  );
}

export function RoofDeckSelect({
  deck,
  penthouse,
  options,
  onChange,
  disabled,
  testid,
  fill,
}: {
  deck: boolean | null | undefined;
  penthouse: boolean | null | undefined;
  options: readonly string[];
  onChange: (next: { deck: boolean; penthouse: boolean } | null) => void;
  disabled?: boolean;
  testid: string;
  fill?: boolean;
}) {
  const label = roofDeckLabel(deck, penthouse);
  return (
    <VocabularySelect
      value={label}
      options={options}
      disabled={disabled}
      testid={testid}
      ariaLabel="Roof deck"
      fill={fill}
      onPick={(picked) => {
        if (picked === null) return onChange(null);
        const parts = decodeRoofDeck(picked);
        if (!parts) return;
        onChange(parts);
      }}
    />
  );
}

export function StoriesSelect({
  stories,
  basement,
  options,
  onChange,
  disabled,
  testid,
  fill,
}: {
  stories: number | null | undefined;
  basement: boolean | null | undefined;
  options: readonly string[];
  onChange: (next: { stories: number; basement: boolean } | null) => void;
  disabled?: boolean;
  testid: string;
  fill?: boolean;
}) {
  // ★★★ fix-562 §A — STORIES BECOMES A DROPDOWN. It was a free-text number box
  //     in all three mounts, which is what let `0`, blanks and half-typed
  //     values reach the parser; the basement half has no honest text form at
  //     all. Bobby's list is closed, so the control is.
  const label = storiesLabel(stories, basement);
  return (
    <VocabularySelect
      value={label}
      options={options}
      disabled={disabled}
      testid={testid}
      ariaLabel="Stories"
      fill={fill}
      onPick={(picked) => {
        if (picked === null) return onChange(null);
        const parts = decodeStories(picked);
        if (!parts) return;
        onChange(parts);
      }}
    />
  );
}

// ★★★ fix-486 §D — `WorkScopeSelect` IS DELETED. Bobby, 2026-09-03: one way to
// say remodel, and it is the TYPE.
//
// ★★★ fix-562 §A — AND `StallsInput` IS DELETED, for the same shape of reason:
// the count it asked for is inside the parking answer now. Its coercion helper
// `parseStalls` went with it — a rule with nothing to parse is not a rule.
// 123 unit rows carried a stall count and every one is in
// `_fix562_unit_matrix_snapshot`; nothing infers a parking option from one,
// because the wipe is the ruling rather than a fallback.
