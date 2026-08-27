import { PARKING_KINDS, type ParkingKind, type UnitType } from './database.types';

// ===========================================================================
// ★★★ fix-402 — PARKING BELONGS TO THE UNIT
// ===========================================================================
//
// Bobby, 2026-08-25:
//
//   "Remove [parking] from the holistic site and merge that under the units for
//    proposal … by unit it's broken down: is it a garage, is it surface, is it
//    both, and how many stalls per unit … we need to go back and backfill all
//    the units parking … in the Project Overview and in the Library, we need to
//    make that not only a searchable but a displayable thing."
//
// And, separately: *"just a yes or no, roof deck"* — per unit, same treatment.
//
// ★★★ THE ONE RULE THIS WHOLE FILE ENFORCES: NULL IS NOT "none".
//
// `none` is somebody's recorded answer that a unit has no parking. NULL is the
// absence of an answer. 231 unit rows across 102 projects start NULL on the day
// this ships and are backfilled by hand, so for a while MOST rows are NULL —
// which makes every "treat NULL as the empty case" shortcut wrong at scale
// rather than in the corner. fix-386's rule, in the place it bites hardest.

/** How a NULL renders, everywhere. Never "none", never blank. */
export const NOT_RECORDED = '—';

export const PARKING_KIND_LABEL: Record<ParkingKind, string> = {
  garage: 'Garage',
  surface: 'Surface',
  both: 'Both',
  none: 'None',
};

/** ★ The dropdown's options, in the order Bobby named them, plus the clear-back
 *  -to-NULL choice every field needs. */
export const PARKING_KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: NOT_RECORDED },
  ...PARKING_KINDS.map((k) => ({ value: k, label: PARKING_KIND_LABEL[k] })),
];

// ---------------------------------------------------------------------------
// ★★★ fix-422 — THE LETTER CODES, AND THE ONE PLACE I DID NOT FOLLOW THE BRIEF
// ---------------------------------------------------------------------------
//
// Bobby, 2026-08-27: *"Parking can be like P — the drop-down can have the
// words, but when you select it, then it says G for garage, or S for surface.
// … Roof deck could be RD, and it just needs to show a Y."*
//
// ★★★ THE BRIEF MAPPED BOTH `none` AND NULL TO `—`, AND THAT IS THE ONE THING
// THIS FILE EXISTS TO PREVENT. Its opening rule, from fix-402 and Bobby's own
// ruling: *"NULL IS NOT none. `none` is somebody's recorded answer that a unit
// has no parking. NULL is the absence of an answer."* Prod has 4 NULL
// `parking_kind` rows against 1 recorded `none`, so collapsing them would make
// the commonest state indistinguishable from the rarest recorded one — on the
// field the whole backfill is about.
//
// ★★ SO `none` IS `N` AND ONLY NULL IS `—`, and P's tooltip gains one clause to
// say so. Everything else in Scope 6's copy is verbatim. Flagged in the PR body
// so Bobby can overrule it — it is his rule I am protecting, not my preference.
//
// ★ ROOF DECK NEEDS NO SUCH CARE: it is a boolean, so `Y` / `N` / `—` already
//   maps three states onto three glyphs with nothing conflated.

/** ★ One glyph per RECORDED kind. NULL is handled by the caller, as `—`. */
export const PARKING_KIND_CODE: Record<ParkingKind, string> = {
  garage: 'G',
  surface: 'S',
  both: 'B',
  none: 'N',
};

/** The matrix cell's glyph for a unit's parking. NULL → "—". */
export function parkingKindCode(kind: ParkingKind | null | undefined): string {
  return kind ? PARKING_KIND_CODE[kind] : NOT_RECORDED;
}

/** The matrix cell's glyph for a unit's roof deck. NULL → "—", false → "N". */
export function roofDeckCode(deck: boolean | null | undefined): string {
  return deck == null ? NOT_RECORDED : deck ? 'Y' : 'N';
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** One unit's parking, as words. NULL → "—". */
export function parkingKindLabel(kind: ParkingKind | null | undefined): string {
  return kind ? PARKING_KIND_LABEL[kind] : NOT_RECORDED;
}

/** One unit's stalls. ★ 0 renders as "0", not as "—" — a recorded zero is an
 *  answer, and hiding it would re-create the very conflation this ticket is
 *  about. */
export function stallsLabel(stalls: number | null | undefined): string {
  return stalls == null ? NOT_RECORDED : String(stalls);
}

/** One unit's roof deck. ★ false renders as "No", not "—". */
export function roofDeckLabel(deck: boolean | null | undefined): string {
  return deck == null ? NOT_RECORDED : deck ? 'Yes' : 'No';
}

// ---------------------------------------------------------------------------
// ★★★ THE ROLLUP — what a Library results row says before you expand it
// ---------------------------------------------------------------------------

export interface ParkingRollup {
  /** The single kind when every RECORDED unit agrees, else null. */
  kind: ParkingKind | null;
  /** True when the recorded units disagree — renders as "mixed". */
  mixed: boolean;
  /** Sum of recorded stalls. null when NO unit has a recorded stall count —
   *  because 0 would claim "no stalls", which is a different sentence. */
  stalls: number | null;
  /** How many units have a NULL parking_kind. */
  unrecordedKinds: number;
  /** Total units on the project. */
  total: number;
  /** ★★ True when ANY unit is missing a kind — the chip says so rather than
   *  quietly averaging over a half-empty book. */
  partial: boolean;
  /** The chip's text. */
  label: string;
}

/**
 * ★★★ THE CHIP, AND WHAT IT REFUSES TO SAY.
 *
 * Same recorded kind everywhere → that kind ("Garage · 4 stalls").
 * Recorded kinds disagree       → "Mixed · 4 stalls".
 * Nothing recorded at all       → "—", and nothing else. Not "none", not "0".
 *
 * ★★ THE PARTIAL MARKER. When SOME units have a kind and others do not, the
 * chip appends "· N of M recorded". During the backfill that will be the common
 * case, and a chip that read a confident "Garage · 4 stalls" off two of five
 * units would be actively misleading — the reader would have no way to tell a
 * finished project from a half-entered one.
 *
 * ★ Stalls sum over RECORDED values only, and are omitted entirely when none is
 * recorded. Summing NULLs to 0 would print "0 stalls" on a project nobody has
 * touched yet.
 */
export function parkingRollup(units: readonly UnitType[]): ParkingRollup {
  const total = units.length;
  const kinds = units
    .map((u) => u.parking_kind ?? null)
    .filter((k): k is ParkingKind => k !== null);
  const unrecordedKinds = total - kinds.length;

  const stallValues = units
    .map((u) => u.parking_stalls ?? null)
    .filter((s): s is number => s !== null);
  const stalls = stallValues.length > 0
    ? stallValues.reduce((a, b) => a + b, 0)
    : null;

  const distinct = [...new Set(kinds)];
  const mixed = distinct.length > 1;
  const kind = distinct.length === 1 ? distinct[0]! : null;
  const partial = total > 0 && unrecordedKinds > 0;

  const head = mixed ? 'Mixed' : kind ? PARKING_KIND_LABEL[kind] : null;
  const parts: string[] = [];
  if (head) parts.push(head);
  if (stalls !== null) parts.push(`${stalls} stall${stalls === 1 ? '' : 's'}`);
  if (partial && head) parts.push(`${kinds.length} of ${total} recorded`);

  const label = parts.length > 0 ? parts.join(' · ') : NOT_RECORDED;
  return { kind, mixed, stalls, unrecordedKinds, total, partial, label };
}

/** ★ Roof deck across a project, as "N of M". Only RECORDED trues count in N,
 *  and M is the units with a recorded answer — so an untouched project reads
 *  "—" rather than "0 of 5", which would assert five recorded noes. */
export function roofDeckRollup(units: readonly UnitType[]): {
  yes: number;
  recorded: number;
  total: number;
  label: string;
} {
  const recordedUnits = units.filter((u) => u.roof_deck != null);
  const yes = recordedUnits.filter((u) => u.roof_deck === true).length;
  const label =
    recordedUnits.length === 0
      ? NOT_RECORDED
      : `${yes} of ${recordedUnits.length}`;
  return { yes, recorded: recordedUnits.length, total: units.length, label };
}

// ---------------------------------------------------------------------------
// ★★★ THE FILTERS — and the conjunction rule that makes them honest
// ---------------------------------------------------------------------------

/** Stalls-per-unit tier. '' = Any. */
export type StallsTier = '' | '1+' | '2+';
/** Tri-state, like fix-122's corner filter. */
export type RoofDeckFilter = '' | 'Yes' | 'No';

/** ★ A picked tier requires a RECORDED count that clears the bar. NULL fails —
 *  correct until the backfill lands, and silently, because a filter is a
 *  question about known data. */
export function matchStallsTier(
  stalls: number | null | undefined,
  tier: StallsTier,
): boolean {
  if (tier === '') return true;
  if (stalls == null) return false;
  return tier === '1+' ? stalls >= 1 : stalls >= 2;
}

/** ★ Tri-state. Yes/No each require a non-null match — an unanswered unit is
 *  not a "No" (fix-122's corner-lot rule, same shape). */
export function matchRoofDeck(
  deck: boolean | null | undefined,
  want: RoofDeckFilter,
): boolean {
  if (want === '') return true;
  if (deck == null) return false;
  return want === 'Yes' ? deck === true : deck === false;
}

/** ★ '' = Any. A picked kind requires exactly that recorded kind; NULL fails.
 *  ★★ Picking `none` is a real query — "show me units with no parking" — and it
 *  matches ONLY units somebody recorded as none, never unanswered ones. */
export function matchParkingKind(
  kind: ParkingKind | null | undefined,
  want: '' | ParkingKind,
): boolean {
  if (want === '') return true;
  return kind === want;
}

/**
 * ★★ The one coercion for a stalls text box, shared by all three editor mounts.
 *
 * Blank → null (NOT RECORDED). A non-negative integer → that number. Anything
 * else → null, because a half-typed "-" or "abc" is not an answer either.
 *
 * ★★★ ZERO SURVIVES. `0` is a recorded zero and must not fall through a falsy
 * check into null — the single most likely way this file could quietly
 * re-create the NULL-vs-none conflation the whole ticket is about.
 *
 * ★ IT LIVES HERE, NOT WITH THE INPUT COMPONENT, because a coercion rule is
 * not a component: `react-refresh/only-export-components` refuses a mixed
 * module, and the rule is right — this belongs beside the other parsing and
 * matching rules above, which is also where a reader looks for it.
 */
export function parseStalls(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
