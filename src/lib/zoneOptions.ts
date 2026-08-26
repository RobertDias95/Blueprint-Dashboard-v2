// ===========================================================================
// ★★★ fix-415 SCOPE A — ZONE IS A REGISTRY, NOT A TEXT BOX
// ===========================================================================
//
// Bobby ruled the whole list on 2026-08-26, all three oddballs included.
//
// ---------------------------------------------------------------------------
// ★★★ WHY: 196 PROJECTS PRODUCED 33 SPELLINGS OF 21 ZONES
// ---------------------------------------------------------------------------
//
// Measured on prod 2026-08-26. The same zone was stored six ways — `LR1`,
// `LR 1`, `LR1 (M)`, `LR 1 (M)`, `LR1 (M1)`, `LR1 M` — because the field was a
// free-text input. The Library's zone filter therefore could not group: asking
// for LR1 found three of the ten projects that are LR1.
//
// ★★ THE `(M)` SUFFIX IS DROPPED ENTIRELY — not kept as a name, not kept as a
// flag. Bobby: *"remove the M as we decided it is not needed in LR 1."*
//
// ★ MIO-37-LR3 IS ITS OWN ENTRY, deliberately not folded into LR3: the MIO
// overlay changes what can be built there, so the two are different answers to
// "what is this lot zoned".
//
// ---------------------------------------------------------------------------
// ★★ THE REGISTRY LIVES IN `app_config`, EXACTLY LIKE `productTypeOptions`
// ---------------------------------------------------------------------------
//
// Same shape (a JSONB array of strings under one key), same reader
// (`readAppConfigStringArray`), same writer (`bp_set_app_config_key`), same
// Settings editor pattern (fix-232's `PillListEditor`). fix-326's rule: do not
// invent a second convention for the same job.

/**
 * ★★★ THE COERCION IS INLINED, NOT IMPORTED FROM `hooks/useAppConfig`.
 *
 * `readAppConfigStringArray` is four lines and does exactly this. Importing it
 * would make this module depend on a HOOK module that ~20 suites mock
 * WHOLESALE — and it did, until the fix-415 suite ran: 86 tests across a dozen
 * files failed with *"No readAppConfigStringArray export is defined on the
 * useAppConfig mock"*, because every file that renders ProjectDetailHeader
 * stubs that module with only the hook it needs.
 *
 * ★★ THAT IS THE SAME LESSON fix-409's `lib/heldWork` took: a lib module must
 * not reach into a heavily-mocked hook module for a pure helper. The four lines
 * are cheaper than twenty mock edits, and they cannot break the next suite
 * either.
 */
function stringArray(map: Map<string, unknown>, key: string): string[] {
  const v = map.get(key);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** The `app_config` key. One string, so a typo cannot half-wire it. */
export const ZONE_OPTIONS_KEY = 'zoneOptions';

/**
 * ★★★ BOBBY'S 21, IN HIS ORDER — and this constant is NOT what the app reads.
 *
 * The dropdowns read the app_config registry, which an admin edits. This array
 * exists for two narrower jobs:
 *
 *   · it is what the fix-415 migration seeded, so a test can assert the shipped
 *     registry and the code agree about what "canonical" means;
 *   · it is the fallback for a tenant whose registry key has never been
 *     written, so a fresh install gets a working dropdown rather than an empty
 *     one.
 *
 * ★ Editing this list does NOT change production. Adding a zone is an admin
 *   action in Settings; this is the floor, not the source.
 */
export const CANONICAL_ZONES: readonly string[] = [
  'NR',
  'NR3',
  'LR1',
  'LR2',
  'LR3',
  'MIO-37-LR3',
  'NC2-40',
  'LDR-S',
  'R-3',
  'R-M1',
  'RE-24',
  'RE-43',
  'RM 1.5',
  'RM 3.6',
  'RS 5.0',
  'RS 7.2',
  'RS 8.5',
  'RSL',
  'RSX 7.2',
  'SR-1',
  'SR-4',
];

/**
 * The options a zone dropdown offers.
 *
 * ★★★ A STORED VALUE THAT IS NO LONGER IN THE REGISTRY IS APPENDED, NOT
 * DROPPED. This is fix-364's `waitingOnOptions` rule, and it is the whole
 * answer to "what happens when an admin deletes a zone that projects are
 * using": the project keeps showing what it is, at the bottom of the list where
 * it reads as a statement rather than a live choice, and the user can move it
 * off. The alternative — a `<select>` whose value matches no option — renders
 * BLANK, which silently tells everyone the project has no zone.
 *
 * ★ Prod has no off-registry zones today (the migration landed all 191 on the
 *   21). This exists for the day an admin retires one.
 */
export function zoneOptions(
  configMap: Map<string, unknown>,
  current?: string | null,
): string[] {
  const configured = stringArray(configMap, ZONE_OPTIONS_KEY);
  const base = configured.length > 0 ? configured : [...CANONICAL_ZONES];
  const value = (current ?? '').trim();
  if (value && !base.includes(value)) return [...base, value];
  return base;
}

/** ★ Is this stored value still one an admin offers? Lets a surface mark a
 *  retired zone so a person can see WHY it is at the bottom — without taking it
 *  away from them. */
export function isRetiredZone(
  configMap: Map<string, unknown>,
  value: string | null | undefined,
): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  const configured = stringArray(configMap, ZONE_OPTIONS_KEY);
  const base = configured.length > 0 ? configured : [...CANONICAL_ZONES];
  return !base.includes(v);
}
