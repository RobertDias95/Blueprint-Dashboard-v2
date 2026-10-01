// ===========================================================================
// ★★★ fix-364 §3 — "Waiting on", editable, and the city is missing
// ===========================================================================
//
// Bobby: *"For waiting on — can we add it to the settings as an editable
// feature? And we want to put city as a reason, because sometimes a task is
// waiting on the city for a vendor to respond."*
//
// ---------------------------------------------------------------------------
// ★★★ THE DEMAND IS IN THE DATA, NOT ONLY IN THE REQUEST
// ---------------------------------------------------------------------------
// Every value in use, measured on prod 2026-08-20:
//
//     Structural   27 tasks   10 open
//     Surveyor     24         14
//   ★ Other        15       ★ 11
//     Civil        13          3
//     Architect · Arborist · Geotech · Energy · Landscape ·
//     Mechanical · Stormwater · Electrical      1–4 each
//
// ★★ EVERY ONE IS A CONSULTANT DISCIPLINE. There is no City — and "Other" is
// the SECOND-MOST-USED open value. People are already reaching for the escape
// hatch because the right answer is not on the list.
//
// ---------------------------------------------------------------------------
// ★★ WHY City IS A DIFFERENT KIND OF ANSWER, AND WHY THAT IS FINE
// ---------------------------------------------------------------------------
// ★★★ Every other value names a CONSULTANT WE HIRED. The city is the
// JURISDICTION WE ARE WAITING ON. That is not a category error — the question
// this field asks is "who is this task waiting on", and the city is a
// legitimate answer to it. This note exists so a later cleanup does not
// "correct" it back out for being the odd one.
//
// ★ AND IT IS WHY THE LISTS SPLIT HERE. `WAITING_ON_OPTIONS` in database.types
// is ALSO the external-team discipline vocabulary — the keys of
// `projects.external_team` and the `discipline` on the firm directory. A firm
// directory with a "City" entry would be nonsense: we do not hire the city.
// So the consultant vocabulary stays exactly as it was, and the TASK's list is
// derived from it here.

import { readAppConfigStringArray } from '../hooks/useAppConfig';
import { WAITING_ON_OPTIONS } from './database.types';
import { optionIsRetired, retiredOptionLabel } from './retiredOption';

/** ★ The app_config key. Matches the four lists already there —
 *  `cancelReasonOptions`, `holdReasonOptions`, `productTypeOptions`,
 *  `projectTagOptions` — rather than inventing a pattern. `waiting_on` was the
 *  only list of its kind still hardcoded; this makes it consistent. */
export const WAITING_ON_CONFIG_KEY = 'waitingOnOptions';

/** ★★ The one value this ticket adds, named so the reason travels with it. */
export const WAITING_ON_CITY = 'City';

/**
 * ★ The list as it stands before anybody edits it.
 *
 * ★★ NO SEED ROW IS WRITTEN, and that is deliberate: the standing rule for this
 * ticket is that only §1's rename touches data. `readAppConfigStringArray`
 * returns `[]` for an absent key, so the default below IS the list until an
 * admin changes something — at which point the existing `setKey` mutation
 * writes the whole array. One less row to keep in sync, and the app works
 * identically before and after the first edit.
 *
 * ★ City sits after the consultants rather than alphabetically: the list reads
 * as "the disciplines… and the jurisdiction", which is the distinction above.
 */
export const DEFAULT_WAITING_ON_OPTIONS: readonly string[] = [
  ...WAITING_ON_OPTIONS.filter((o) => o !== 'Other'),
  WAITING_ON_CITY,
  // ★ 'Other' stays LAST. It is the escape hatch, and an escape hatch in the
  // middle of a list gets picked by accident. 11 open tasks are on it today,
  // which is the measurement that motivated adding City in the first place.
  'Other',
];

/**
 * ★★★ THE OPTIONS A DROPDOWN SHOULD OFFER — AND EXISTING VALUES SURVIVE.
 *
 * ★ An editable list creates exactly one hard question: what happens to a task
 * already set to an option somebody later deletes? The answer, and it is the
 * same answer fix-232 gave the product-type registry:
 *
 *     THE TASK KEEPS ITS VALUE, AND KEEPS SHOWING IT.
 *
 * `current` is appended when it is not in the configured list, so the select
 * renders it, the row still reads "Structural", and nothing is silently
 * rewritten. Deleting an option stops it being offered for NEW work; it does
 * not reach back and blank the work already using it. A dropdown whose value
 * is not among its options renders BLANK in every browser — which is precisely
 * how an editable list quietly destroys data, and precisely what this prevents.
 */
export function waitingOnOptions(
  configMap: Map<string, unknown>,
  current?: string | null,
): string[] {
  const configured = readAppConfigStringArray(configMap, WAITING_ON_CONFIG_KEY);
  const base = configured.length > 0 ? configured : [...DEFAULT_WAITING_ON_OPTIONS];
  const value = (current ?? '').trim();
  if (value && !base.includes(value)) {
    // ★ Appended rather than inserted: a retired value belongs at the end,
    // where it reads as "this is what it is" rather than as a live choice.
    return [...base, value];
  }
  return base;
}

/**
 * ★ Is this value still one an admin offers? Used to mark a retired value in
 * the UI so a person can see WHY it is at the bottom of the list — without
 * taking it away from them.
 *
 * ★★ fix-606 §A.3: NOW AN ALIAS OF `optionIsRetired`, which fix-605 generalised
 *    out of fix-601's unit types. The predicate was already identical — "is this
 *    stored value absent from the registry" — so this keeps the waiting-on
 *    signature its 2 callers use (config map + value, because the effective list
 *    needs deriving) while the RULE lives in exactly one place.
 */
export function isRetiredWaitingOn(
  configMap: Map<string, unknown>,
  current?: string | null,
): boolean {
  return optionIsRetired((current ?? '').trim(), effectiveWaitingOn(configMap));
}

/** The effective list — configured if an admin has saved one, else the default.
 *  ★ Extracted because four readers derived it identically; a fifth would have
 *  been the one to get it wrong. */
function effectiveWaitingOn(configMap: Map<string, unknown>): string[] {
  const configured = readAppConfigStringArray(configMap, WAITING_ON_CONFIG_KEY);
  return configured.length > 0 ? configured : [...DEFAULT_WAITING_ON_OPTIONS];
}

// ===========================================================================
// ★★★ fix-606 §A.2 (P-302 part 2) — A FIRM DISCIPLINE IS NOT EVERY ANSWER
// ===========================================================================
//
// ★★★ THIS IS A DELIBERATE REVERSAL OF fix-364's SPLIT, AND fix-364 WAS NOT
//     WRONG. Read the note at the top of this file: it decided that the
//     external-team vocabulary (`WAITING_ON_OPTIONS`) and the TASK's list should
//     stay separate, on the entirely sound grounds that *"a firm directory with
//     a 'City' entry would be nonsense: we do not hire the city."*
//
//     What it did not foresee is the cost: three pickers kept reading the CODE
//     constant, so a discipline an admin adds in Settings — the whole point of
//     fix-364 §3 — could never reach the firm directory, and therefore never
//     reach a project. Bobby, 2026-09-30: *"dropdowns match Settings."*
//
// ★★ SO THE LISTS REJOIN AND THE DISTINCTION SURVIVES AS A FILTER. One editable
//    list, with the two entries that are not firms named here and excluded from
//    firm pickers only. fix-364's reasoning is now enforced in one tested place
//    instead of being enforced by a second hard-coded array.
export const NON_FIRM_WAITING_ON: readonly string[] = [WAITING_ON_CITY, 'Other'];

/**
 * The disciplines a FIRM picker offers: the Settings list, minus the answers
 * that are not firms.
 *
 * ★ `current` behaves exactly as it does in {@link waitingOnOptions} — a stored
 *   value absent from the list is appended rather than dropped, so a project
 *   whose blob holds a since-retired discipline still renders it. Deleting an
 *   option stops it being OFFERED; it never blanks work already using it.
 *
 * ★★ AND IT EXCLUDES `City` / `Other` EVEN WHEN STORED. If a blob somehow holds
 *    `City` as a firm key, appending it here would offer the city as a
 *    consultant on every other project. A non-firm value is filtered out at both
 *    ends, which is the one place the asymmetry with `waitingOnOptions` lives.
 */
export function firmDisciplineOptions(
  configMap: Map<string, unknown>,
  current?: string | null,
): string[] {
  const base = effectiveWaitingOn(configMap).filter(
    (o) => !NON_FIRM_WAITING_ON.includes(o),
  );
  const value = (current ?? '').trim();
  if (value && !base.includes(value) && !NON_FIRM_WAITING_ON.includes(value)) {
    return [...base, value];
  }
  return base;
}

/** ★ Is this a non-firm answer — the jurisdiction, or the escape hatch? Named
 *  so a caller asks the question rather than re-listing the two values. */
export function isNonFirmWaitingOn(value: string | null | undefined): boolean {
  return NON_FIRM_WAITING_ON.includes((value ?? '').trim());
}

/** ★★ fix-606: the marker a retired waiting-on value wears. fix-605's rule, its
 *  own word — a discipline is not a "type". */
export const WAITING_ON_RETIRED_MARKER = ' (not a current option)';

/** The label a waiting-on value shows: itself, or itself + the marker when an
 *  admin has retired it. */
export function waitingOnLabel(
  configMap: Map<string, unknown>,
  value: string,
): string {
  return retiredOptionLabel(
    value,
    effectiveWaitingOn(configMap),
    WAITING_ON_RETIRED_MARKER,
  );
}

/** The label a FIRM-discipline option shows, against the firm list. */
export function firmDisciplineLabel(
  configMap: Map<string, unknown>,
  value: string,
): string {
  return retiredOptionLabel(
    value,
    firmDisciplineOptions(configMap),
    WAITING_ON_RETIRED_MARKER,
  );
}
