// ===========================================================================
// ★★★ fix-520 §B (P-226) — A UNIT'S LABEL SAYS WHICH UNIT IT IS
// ===========================================================================
//
// Bobby, 2026-09-10: *"type is the heading instead of saying unit. If there are
// 4 detached, it would say detached 1, 2, 3."* And the complaint underneath it,
// which is the one that matters: ***"How do I know which unit I am updating
// sqft on?"***
//
// Project Details → Units rendered a **UNIT DIMENSIONS** block and then a
// separate **UNIT SIZE (SF)** block whose rows both read `Detached`, with
// nothing tying a row in one to a row in the other. P-215 shipped the square
// footage editor without a way to tell its rows apart.
//
// ★★★ ONE SCHEME, THREE SURFACES: the Overview matrix's column headers, the
//     dimensions rows and the size rows. If they do not agree there is no
//     answer to Bobby's question, only three guesses.
//
// ★★★ THE ORDINAL IS PER TYPE. Two Detached and one Attached reads
//     `Detached 1 · Detached 2 · Attached 1` — never `Detached 1 · Detached 2 ·
//     Attached 3`, which would number the ROW rather than name the unit.
//     Measured on prod 2026-09-10: **27 of the 117 projects that have unit rows
//     mix types**, and **75 of 117 have a repeated type** — so both halves of
//     that rule are load-bearing today, on most projects.
//
// ★★★ AND fix-507 §E's OBJECTION IS ANSWERED RATHER THAN OVERRULED. It moved
//     the Overview's headers from the type NAME to the ordinals `Unit 1 … Unit
//     n` precisely because a header row reading `Detach…Detach…` on the 59
//     projects whose units are all `Detached` identifies nothing. That is
//     still true of a truncated `Detached 1`. So the label is returned in TWO
//     pieces — `type` and `ordinal` — and every caller renders the type as the
//     truncating half and the ordinal as the half that never truncates:
//     `Detac… 1`, which still identifies the unit.
// ===========================================================================

import type { UnitType } from './database.types';

export interface UnitLabelParts {
  /** The unit's type, as stored. `Unit` when a row carries no label at all —
   *  which `parseUnitTypes` allows and 0 prod rows currently do. */
  type: string;
  /** 1-based, counted WITHIN this type. */
  ordinal: number;
  /** `Detached 2`. The one-piece form, for titles, aria-labels and testids. */
  full: string;
}

/** The fallback when a stored row has no label. ★ Not `—`: this is an
 *  identifier a person has to say out loud, and an em dash is not a name. */
export const UNLABELLED_UNIT = 'Unit';

/**
 * Label every unit on a project, in stored order.
 *
 * ★ Stored order is the identity. The Units tab's rows, the size rows and the
 *   matrix's columns all iterate `unit_types` as stored, so the ordinal is
 *   stable across the three surfaces for free — and it moves only when
 *   somebody reorders the array, which no surface offers.
 */
export function unitLabelParts(
  units: readonly UnitType[] | null | undefined,
): UnitLabelParts[] {
  const seen = new Map<string, number>();
  return (units ?? []).map((u) => {
    const type = (u?.label ?? '').trim() || UNLABELLED_UNIT;
    // ★ Case-insensitive counting, so `Detached` and `detached` are one type
    //   for numbering. The DISPLAYED type is whatever the row stores — this
    //   function labels, it does not normalise.
    const key = type.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { type, ordinal: n, full: `${type} ${n}` };
  });
}

/** The one-piece label for the unit at `index`. */
export function unitLabelAt(
  units: readonly UnitType[] | null | undefined,
  index: number,
): string {
  return unitLabelParts(units)[index]?.full ?? `${UNLABELLED_UNIT} ${index + 1}`;
}
