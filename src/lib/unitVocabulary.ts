// ===========================================================================
// ★★★ fix-562 §A (P-268) — THE UNIT MATRIX SAYS WHAT DRIVES THE FLOOR PLAN
// ===========================================================================
//
// Bobby, 2026-09-14:
//
//   *"the main thing we're trying to identify is, does this unit width/depth
//    or unit size, how is parking driving that? Is it one-car, two-car, three,
//    four, or surface/none?"*
//
// The unit matrix is a design-feasibility tool and PARKING is the constraint it
// exists to expose. Three vocabularies replace what fix-402 and fix-205 left:
//
//   parking    1-car garage · 2-car garage · 3-car garage · 4-car garage ·
//              Surface / None        (`parking_stalls` is GONE from the product)
//   roof deck  W/ PH · W/O PH · None (with penthouse, without, none)
//   stories    1 · 1+B · 2 · 2+B · 3 · 3+B · 4 · 4+B      (B is a basement)
//
// ---------------------------------------------------------------------------
// ★★★ STORE THE PARTS, COMPOSE THE LABEL — AND THE REASON IS THE SORTER
// ---------------------------------------------------------------------------
//
// The screen reads identically either way, so this is not a taste call. It was
// settled by reading `lib/libraryUnitRows.sortUnitRows` and
// `lib/libraryHelpers.matchStoriesTier`, both of which are NUMERIC on stories:
//
//   · a stored `"3+B"` makes the STORIES column sort as text, so `10` lands
//     between `1` and `2` the moment anybody records a tall one, and `3+B`
//     sorts away from `3`;
//   · and *"every 3-storey unit"* would become TWO filter values instead of
//     one — fix-415's `NR` / `NR3` lesson in a different field.
//
// ★★ fix-571 §A NOTE: Bobby has since ruled that the FILTER should ask for one
//    of the eight labels (`3` returns only `3`), which spends that second
//    benefit deliberately. The FIRST one — the numeric sort — is why the parts
//    are still stored separately, and it is untouched. A ruling changing does
//    not make the reasoning behind the other half wrong.
//
// ★★ Parking gets the same benefit for free: `parking_kind` alone answers
//    *"every garage unit"* and `parking_count` alone answers *"every 2-car"*,
//    which is precisely the pair of questions the sentence that asked for this
//    ticket is about.
//
// ★★★ AND §B WIPES THE DATA ANYWAY, so the better shape costs nothing to
//     adopt: there is no conversion to write and no legacy to carry. That is
//     the whole reason this was worth deciding rather than splitting.
//
// ---------------------------------------------------------------------------
// ★★★ A MODIFIER IS NOT AN INDEPENDENT FIELD — THE ONE PLACE fix-386 BENDS
// ---------------------------------------------------------------------------
//
// `basement` modifies a recorded `stories`; `penthouse` modifies a recorded
// `roof_deck: true`; `parking_count` modifies a recorded `parking_kind:
// 'garage'`. None of the three is separately askable: every vocabulary entry
// sets BOTH parts, and there is no option meaning *"3 storeys, basement
// unknown"*.
//
// ★★ So a missing modifier beside a recorded head reads as the negative
//    (`3`, `W/O PH`) rather than as `—`. NULL-is-not-recorded (fix-386) is
//    untouched where it matters — a null HEAD is still `—`, never a default —
//    and `parseUnitTypes` refuses the one combination that has no label at all
//    (a garage with no count), so an impossible pair is collapsed at the
//    boundary instead of being rendered as a sixth display string.
//
// ---------------------------------------------------------------------------
// ★★ THE LISTS LIVE IN `app_config`, BESIDE `productTypeOptions`
// ---------------------------------------------------------------------------
//
// fix-232's rule: a dropdown's options are canonical in `app_config` and the
// control is dropdown-only. Same shape as `zoneOptions` (fix-415) — a JSONB
// string array under one key, a `CANONICAL_*` fallback for a tenant that has
// never been seeded, a Settings `PillListEditor`.
//
// ★★★ AND THE HONEST LIMIT, STATED RATHER THAN HIDDEN. Parking and stories
//     decode BY SHAPE, so an admin who adds `5-car garage` or `5+B` gets a
//     working option with no deploy. **Roof deck does not**: its three labels
//     map onto a fixed (deck, penthouse) pair, so a renamed or invented fourth
//     entry has nowhere to be stored. `unitVocabularyIssues` names exactly
//     those entries and Settings marks them, so the failure is visible where
//     somebody types it rather than silent in a dropdown.

/** How a NULL renders, everywhere. Never "none", never blank. ★ Moved here
 *  from `lib/unitParking` with the vocabulary it belongs to; that module is
 *  gone (see the gravestone in `lib/libraryUnitColumns`). */
export const NOT_RECORDED = '—';

// ---------------------------------------------------------------------------
// The app_config keys
// ---------------------------------------------------------------------------

export const PARKING_OPTIONS_KEY = 'parkingOptions';
export const ROOF_DECK_OPTIONS_KEY = 'roofDeckOptions';
export const STORIES_OPTIONS_KEY = 'storiesOptions';

/** ★ The three keys as one list, so a test can assert the registry seed and
 *  the Settings editor cover the same set. */
export const UNIT_VOCABULARY_KEYS = [
  PARKING_OPTIONS_KEY,
  ROOF_DECK_OPTIONS_KEY,
  STORIES_OPTIONS_KEY,
] as const;

// ---------------------------------------------------------------------------
// The canonical lists — the seed and the fallback, NOT what the app reads
// ---------------------------------------------------------------------------

/** ★★★ Bobby's five, in his order. `both` is NOT here: fix-402's fourth kind
 *  is gone by design and the 11 rows that held it are in §B's snapshot. */
export const CANONICAL_PARKING: readonly string[] = [
  '1-car garage',
  '2-car garage',
  '3-car garage',
  '4-car garage',
  'Surface / None',
];

/** ★ With penthouse, without penthouse, none. Replaces fix-402's Yes/No. */
export const CANONICAL_ROOF_DECK: readonly string[] = ['W/ PH', 'W/O PH', 'None'];

/** ★ `B` is a basement. */
export const CANONICAL_STORIES: readonly string[] = [
  '1',
  '1+B',
  '2',
  '2+B',
  '3',
  '3+B',
  '4',
  '4+B',
];

// ---------------------------------------------------------------------------
// The stored parts
// ---------------------------------------------------------------------------

/**
 * ★★★ TWO KINDS, NOT FOUR. fix-402's set was `garage · surface · both · none`;
 * the count lived beside it in `parking_stalls`. Bobby's vocabulary folds the
 * count into the answer and collapses the tail: *"surface/none"* is ONE answer,
 * because for a floor plan a surface stall and no stall constrain the same way
 * — nothing is taken out of the building.
 *
 * ★ `surface_none` rather than `surface`: the value should not read as half of
 *   what the label says.
 */
export const PARKING_KINDS = ['garage', 'surface_none'] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

export function isParkingKind(v: unknown): v is ParkingKind {
  return typeof v === 'string' && (PARKING_KINDS as readonly string[]).includes(v);
}

export interface ParkingParts {
  kind: ParkingKind;
  /** Garage stalls, 1+. `null` on `surface_none`, which takes no count. */
  count: number | null;
}

export interface RoofDeckParts {
  deck: boolean;
  /** Only meaningful when `deck` is true. */
  penthouse: boolean;
}

export interface StoriesParts {
  stories: number;
  basement: boolean;
}

// ---------------------------------------------------------------------------
// ★★★ THE CODECS — label ⇄ parts
// ---------------------------------------------------------------------------

/** ★ Case- and whitespace-tolerant, because a registry entry is typed by hand.
 *  `  2-Car  Garage ` and `2-car garage` are the same option. */
function norm(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

const GARAGE_RE = /^(\d{1,2})-car garage$/;

/**
 * ★★ SHAPE-BASED, so the registry is genuinely open: `5-car garage` decodes
 * without a code change. The only closed half is the surface answer, which has
 * no number in it to read.
 */
export function decodeParking(label: string): ParkingParts | null {
  const n = norm(label);
  if (n === 'surface / none' || n === 'surface/none') {
    return { kind: 'surface_none', count: null };
  }
  const m = GARAGE_RE.exec(n);
  if (!m) return null;
  const count = Number(m[1]);
  if (!Number.isInteger(count) || count < 1) return null;
  return { kind: 'garage', count };
}

/**
 * ★★★ THE FIXED HALF, AND THE ONE THE PR HAS TO NAME. Three labels, three
 * (deck, penthouse) pairs, decoded by identity. A fourth entry an admin adds
 * cannot be stored — `unitVocabularyIssues` reports it so Settings can say so.
 */
export function decodeRoofDeck(label: string): RoofDeckParts | null {
  switch (norm(label)) {
    case 'w/ ph':
      return { deck: true, penthouse: true };
    case 'w/o ph':
      return { deck: true, penthouse: false };
    case 'none':
      return { deck: false, penthouse: false };
    default:
      return null;
  }
}

const STORIES_RE = /^(\d{1,2})(\+b)?$/;

/** ★★ Shape-based like parking: `5+B` works with no code change. */
export function decodeStories(label: string): StoriesParts | null {
  const m = STORIES_RE.exec(norm(label));
  if (!m) return null;
  const stories = Number(m[1]);
  if (!Number.isInteger(stories) || stories < 1) return null;
  return { stories, basement: m[2] !== undefined };
}

// ---------------------------------------------------------------------------
// ★★★ THE COMPOSERS — what every surface prints
// ---------------------------------------------------------------------------

/**
 * One unit's parking, as the vocabulary says it.
 *
 * ★★★ `—` WHEN THE HEAD IS NOT RECORDED, and never a guessed default. After
 *     §B's wipe almost every unit is empty, so this is the common case rather
 *     than the corner — a blank that looks like a real answer is worse than a
 *     blank (fix-386, in the place it bites hardest).
 *
 * ★ A garage with no count has no label in the vocabulary. `parseUnitTypes`
 *   refuses that pair outright, so this returns `—` only defensively.
 */
export function parkingLabel(
  kind: ParkingKind | null | undefined,
  count: number | null | undefined,
): string {
  if (kind === 'surface_none') return 'Surface / None';
  if (kind === 'garage' && count != null && count >= 1) return `${count}-car garage`;
  return NOT_RECORDED;
}

/** One unit's roof deck. ★ `deck: false` is a RECORDED no and reads `None`;
 *  only a null deck is `—`. `penthouse` is a modifier — see the header. */
export function roofDeckLabel(
  deck: boolean | null | undefined,
  penthouse: boolean | null | undefined,
): string {
  if (deck == null) return NOT_RECORDED;
  if (!deck) return 'None';
  return penthouse === true ? 'W/ PH' : 'W/O PH';
}

/** One unit's stories. ★ `basement` is a modifier — a missing one beside a
 *  recorded storey count reads as no basement, never as `—`. */
export function storiesLabel(
  stories: number | null | undefined,
  basement: boolean | null | undefined,
): string {
  if (stories == null) return NOT_RECORDED;
  return basement === true ? `${stories}+B` : `${stories}`;
}

// ---------------------------------------------------------------------------
// ★★★ THE OPTION READERS — the registry, with the canonical list as a floor
// ---------------------------------------------------------------------------

/**
 * ★★★ THE COERCION IS INLINED, NOT IMPORTED FROM `hooks/useAppConfig`.
 *
 * fix-415's `lib/zoneOptions` carries the full argument and it cost 86 tests
 * across a dozen files: every suite that renders `ProjectDetailHeader` mocks
 * that hook module PARTIALLY, so a `lib/` module reaching in for a four-line
 * pure helper fails all of them. Fourth recording of the partial-mock trap.
 */
function stringArray(map: Map<string, unknown> | null | undefined, key: string): string[] {
  const v = map?.get(key);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

function options(
  map: Map<string, unknown> | null | undefined,
  key: string,
  fallback: readonly string[],
): string[] {
  const configured = stringArray(map, key);
  return configured.length > 0 ? configured : [...fallback];
}

/** ★ The options a parking dropdown offers, in registry order. */
export function parkingOptions(map: Map<string, unknown> | null | undefined): string[] {
  return options(map, PARKING_OPTIONS_KEY, CANONICAL_PARKING);
}

export function roofDeckOptions(map: Map<string, unknown> | null | undefined): string[] {
  return options(map, ROOF_DECK_OPTIONS_KEY, CANONICAL_ROOF_DECK);
}

export function storiesOptions(map: Map<string, unknown> | null | undefined): string[] {
  return options(map, STORIES_OPTIONS_KEY, CANONICAL_STORIES);
}

/**
 * ★★★ THE APPEND RULE (fix-364 / fix-415), APPLIED TO A COMPOSED LABEL.
 *
 * A `<select>` whose value matches no option renders BLANK, which silently
 * claims the field is empty. So the row's CURRENT answer is offered even when
 * the registry no longer lists it — at the bottom, where it reads as a
 * statement rather than a live choice.
 */
export function withCurrent(opts: readonly string[], current: string | null): string[] {
  if (!current || current === NOT_RECORDED || opts.includes(current)) return [...opts];
  return [...opts, current];
}

// ---------------------------------------------------------------------------
// ★★★ WHAT THE REGISTRY CANNOT STORE — reported, never swallowed
// ---------------------------------------------------------------------------

export interface UnitVocabularyIssue {
  key: string;
  label: string;
}

/**
 * Registry entries this app cannot decode into stored parts.
 *
 * ★★★ THE POINT IS THAT IT IS NOT SILENT. Dropping an undecodable entry from a
 *     dropdown and saying nothing is how a Settings screen starts lying about
 *     what it controls. Settings renders a `⚠` on exactly these pills.
 *
 * ★ Parking and stories decode by shape, so in practice this only ever reports
 *   a roof-deck entry — which is the limit the PR states out loud.
 */
export function unitVocabularyIssues(
  map: Map<string, unknown> | null | undefined,
): UnitVocabularyIssue[] {
  const out: UnitVocabularyIssue[] = [];
  for (const label of parkingOptions(map)) {
    if (!decodeParking(label)) out.push({ key: PARKING_OPTIONS_KEY, label });
  }
  for (const label of roofDeckOptions(map)) {
    if (!decodeRoofDeck(label)) out.push({ key: ROOF_DECK_OPTIONS_KEY, label });
  }
  for (const label of storiesOptions(map)) {
    if (!decodeStories(label)) out.push({ key: STORIES_OPTIONS_KEY, label });
  }
  return out;
}

/** ★ Is this one entry storable? The per-pill form of the above. */
export function isStorableVocabularyEntry(key: string, label: string): boolean {
  if (key === PARKING_OPTIONS_KEY) return decodeParking(label) !== null;
  if (key === ROOF_DECK_OPTIONS_KEY) return decodeRoofDeck(label) !== null;
  if (key === STORIES_OPTIONS_KEY) return decodeStories(label) !== null;
  return true;
}

// ---------------------------------------------------------------------------
// ★★★ THE FILTERS — matched on the COMPOSED LABEL
// ---------------------------------------------------------------------------

/**
 * ★★ A picked option requires that exact recorded answer; a unit nobody has
 *    answered for does not match. Same rule fix-402 set for parking and
 *    fix-122 set for corner lots: a filter is a question about known data.
 *
 * ★★★ MATCHING ON THE LABEL, NOT ON THE PARTS, is what makes the filter
 *     registry-driven for free — an admin who adds `5-car garage` gets a
 *     filter value for it in the same edit, with no union to extend.
 */
export function matchParkingOption(
  kind: ParkingKind | null | undefined,
  count: number | null | undefined,
  want: string,
): boolean {
  if (want === '') return true;
  const have = parkingLabel(kind, count);
  if (have === NOT_RECORDED) return false;
  return norm(have) === norm(want);
}

export function matchRoofDeckOption(
  deck: boolean | null | undefined,
  penthouse: boolean | null | undefined,
  want: string,
): boolean {
  if (want === '') return true;
  const have = roofDeckLabel(deck, penthouse);
  if (have === NOT_RECORDED) return false;
  return norm(have) === norm(want);
}

/**
 * ★★★ fix-571 §A (P-276) — STORIES FILTERS AS EIGHT VALUES, NOT AS A BASE
 *     STOREY. THIS REVERSES fix-562's RULING, AND fix-562 FLAGGED IT.
 *
 * Bobby, 2026-09-15: *"i figured, in the unit stories, it would show 1, 1+b, 2,
 * 2+B, etc."*
 *
 * fix-562 §A read the split storage as licence to ask ONE question — *"every
 * 3-storey unit"* — and said in its own PR that Bobby could have them apart for
 * two more options. He can, and this is it: picking `3` returns **only** `3`.
 *
 * ★★ SUPERSEDED, NOT MISTAKEN (fix-400's rule). The STORAGE decision that
 *    ticket rests on is untouched and is what makes this a two-line change:
 *    `stories` is still an int and `basement` still a bool, so the column still
 *    SORTS numerically (`2`, `2+B`, `3`, `10`) while the FILTER asks for a
 *    label. Had the label been stored, this ticket would have had to fix the
 *    sort as well.
 *
 * ★★★ AND IT IS THE SAME FUNCTION SHAPE AS ITS TWO SIBLINGS ABOVE, which is
 *     the point: three columns, three registries, one way of matching. A
 *     vocabulary that is right on two of three is the half-applied treatment
 *     fix-553 kept finding.
 */
export function matchStoriesOption(
  stories: number | null | undefined,
  basement: boolean | null | undefined,
  want: string,
): boolean {
  if (want === '') return true;
  const have = storiesLabel(stories, basement);
  if (have === NOT_RECORDED) return false;
  return norm(have) === norm(want);
}
