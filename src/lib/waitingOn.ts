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

/** ★ Is this value still one an admin offers? Used to mark a retired value in
 *  the UI so a person can see WHY it is at the bottom of the list — without
 *  taking it away from them. */
export function isRetiredWaitingOn(
  configMap: Map<string, unknown>,
  current?: string | null,
): boolean {
  const value = (current ?? '').trim();
  if (!value) return false;
  const configured = readAppConfigStringArray(configMap, WAITING_ON_CONFIG_KEY);
  const base = configured.length > 0 ? configured : [...DEFAULT_WAITING_ON_OPTIONS];
  return !base.includes(value);
}
