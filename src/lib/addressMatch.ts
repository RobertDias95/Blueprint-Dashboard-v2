// fix-333 — warn before someone creates a project that already exists.
//
// ★★ THIS IS NOT HYPOTHETICAL. On 2026-08-14 at 22:38 Shire created
// `3623 Othello Ave SW`. The project already existed as `3623 SW Othello St`,
// filed 9 June, along with its `[Redesign 1]`. The duplicate carried the SAME GO
// date and the SAME THREE PERMIT NUMBERS — 3043214-LU, 7100542-CN, 7100543-DM.
// He then spent three minutes backfilling it with portal URLs, submitted dates,
// intake accepted, an approval date and two intake records.
//
// ★ It was honest data entry by somebody who did not know the project existed.
// He typed the address, the search returned nothing, so he created it. Bobby, on
// why it will happen again: "there will be people adding projects to help
// backfill to get more data into this tool."
//
// ---------------------------------------------------------------------------
// ★★ THE MATCHING RULE, AND WHY EVERY OBVIOUS VERSION FAILS
// ---------------------------------------------------------------------------
// Measured on the real pair — `3623 Othello Ave SW` vs `3623 SW Othello St`:
//
//   exact string match ................................. ✗ no match
//   sequence similarity ................................ ✗ 0.62, below any
//                                                          usable threshold
//   lowercase + strip punctuation ...................... ✗ still 0.62
//   token-sort (so `SW Othello St` ≡ `Othello St SW`) ... ✗ STILL fails: the
//                                                          street TYPE differs,
//                                                          `Ave` vs `St`
//   house number + street name + directional,
//   street type DROPPED ................................ ✓ matches
//
// So the key is: HOUSE NUMBER + STREET NAME + DIRECTIONAL, with the street type
// thrown away. A similarity score cannot get there — 0.62 is indistinguishable
// from noise, and any threshold low enough to catch this pair would fire on half
// the database.
//
// ★★ AND THE DIRECTIONAL STAYS IN THE KEY. `5947 32nd Ave S` and
// `5947 32nd Ave SW` are DIFFERENT LOTS; Bobby's draw schedule carries both
// shapes. Dropping the directional "to be safer" would merge two real projects,
// which is a worse bug than the one being fixed. It is a separate, quieter
// signal instead — see MatchKind.

/** The parsed shape of an address, and the key two of them are compared on. */
export interface AddressKey {
  /** The house number as typed, e.g. "3623". Empty when the address has none. */
  house: string;
  /** Non-directional, non-street-type tokens, sorted so word order stops
   *  mattering. `SW Othello St` and `Othello St SW` both yield "othello". */
  street: string;
  /** Directional tokens, sorted. "sw". Empty when there is no directional. */
  dirs: string;
  /** `house|street|dirs` — what an exact same-lot match compares. */
  key: string;
  /** True when the raw text carried a `[Redesign N]` suffix. */
  hadRedesignSuffix: boolean;
  /** N from `[Redesign N]`, when present. */
  redesignIndex: number | null;
  /** True when nothing usable survived normalisation (blank, or punctuation
   *  only). A key with this set never matches anything — an empty key matching
   *  every other empty key would warn on every half-typed address. */
  empty: boolean;
}

/** ★ Street types are normalised to a canonical form and then REMOVED. They are
 *  the token the Othello pair disagreed on, and the only one people reliably get
 *  wrong: nobody misremembers the house number. */
export const STREET_TYPES: Record<string, string> = {
  street: 'st',
  st: 'st',
  avenue: 'ave',
  ave: 'ave',
  av: 'ave',
  drive: 'dr',
  dr: 'dr',
  place: 'pl',
  pl: 'pl',
  road: 'rd',
  rd: 'rd',
  lane: 'ln',
  ln: 'ln',
  court: 'ct',
  ct: 'ct',
  boulevard: 'blvd',
  blvd: 'blvd',
  way: 'way',
  wy: 'way',
  terrace: 'ter',
  ter: 'ter',
  parkway: 'pkwy',
  pkwy: 'pkwy',
  circle: 'cir',
  cir: 'cir',
};

/** ★ Kept IN the key. See the header — two lots on 32nd Ave differ by nothing
 *  else. Spelled-out forms included because people type both. */
export const DIRECTIONALS: Record<string, string> = {
  n: 'n',
  s: 's',
  e: 'e',
  w: 'w',
  ne: 'ne',
  nw: 'nw',
  se: 'se',
  sw: 'sw',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
};

/** ★ The trailing free text the DRAW SCHEDULE carries into addresses. Real
 *  examples from the source: `7708 131st Ave NE                    SFR`,
 *  `8542 Interlake Ave N ... 3 SFR`, `12238 4th Ave NW ... Redesign`. */
const UNIT_WORDS = new Set([
  'sfr',
  'sfrs',
  'dadu',
  'dadus',
  'duplex',
  'townhouse',
  'townhouses',
  'unit',
  'units',
  'redesign',
]);

const REDESIGN_SUFFIX = /\s*\[\s*redesign\s*(\d+)?\s*\]\s*/i;

/**
 * Parse an address into its comparable parts.
 *
 * Order is load-bearing and each step says why:
 */
export function normalizeAddress(raw: string | null | undefined): AddressKey {
  const source = (raw ?? '').toString();

  // 1. ★ The `[Redesign N]` suffix comes off FIRST, before punctuation is
  //    stripped — the brackets are punctuation, so stripping them first would
  //    turn the marker into an unrecognisable bare "redesign 1". It is recorded
  //    rather than merely discarded, because §3 needs to tell "a redesign of its
  //    parent" (expected) from "a second copy of the same project" (the Othello
  //    case).
  const suffixMatch = source.match(REDESIGN_SUFFIX);
  const hadRedesignSuffix = !!suffixMatch;
  const redesignIndex = suffixMatch?.[1] ? Number(suffixMatch[1]) : null;
  let text = source.replace(new RegExp(REDESIGN_SUFFIX, 'gi'), ' ');

  // 2. ★ Cut the trailing free text, before whitespace is collapsed — the
  //    double-space RUN is the only thing separating `7708 131st Ave NE` from
  //    the `SFR` the draw schedule pads after it, and collapsing first would
  //    destroy the evidence.
  //
  //    A COMMA cuts too. The wizard's own placeholder is
  //    "123 Maple St, Seattle WA", so somebody following it types a city that no
  //    stored address has — and the check would silently miss. Measured: not one
  //    of the 146 production addresses contains a comma, so this changes nothing
  //    for existing data and makes the placeholder form match.
  text = text.split(/\r?\n/)[0]!;
  text = text.split(',')[0]!;
  text = text.split(/ {2,}|\t+/)[0]!;

  // 3. Lowercase, punctuation to spaces, collapse.
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // 4. Drop the unit words wherever they landed.
    .filter((t) => !UNIT_WORDS.has(t));

  if (tokens.length === 0) {
    return {
      house: '',
      street: '',
      dirs: '',
      key: '',
      hadRedesignSuffix,
      redesignIndex,
      empty: true,
    };
  }

  // 5. The house number is the first token when it starts with a digit.
  //    `123a` counts; `Lynn` does not. An address with no number still gets a
  //    key — it just has an empty house part and can only match another one.
  let house = '';
  let rest = tokens;
  if (/^\d/.test(tokens[0]!)) {
    house = tokens[0]!;
    rest = tokens.slice(1);
  }

  // 6. ★ Street types are canonicalised and then dropped. This is the step that
  //    makes the Othello pair match at all.
  const dirs: string[] = [];
  const street: string[] = [];
  for (const token of rest) {
    if (DIRECTIONALS[token]) {
      dirs.push(DIRECTIONALS[token]!);
      continue;
    }
    if (STREET_TYPES[token]) continue; // canonicalised, then discarded
    street.push(token);
  }

  // 7. Sort each group, so `SW Othello` and `Othello SW` are one key.
  const streetKey = [...street].sort().join(' ');
  const dirsKey = [...new Set(dirs)].sort().join(' ');
  const empty = house === '' && streetKey === '';

  return {
    house,
    street: streetKey,
    dirs: dirsKey,
    key: `${house}|${streetKey}|${dirsKey}`,
    hadRedesignSuffix,
    redesignIndex,
    empty,
  };
}

/**
 * ★ How strongly two addresses match. Two tiers, and the gap between them is
 * the point — the brief: "same lot, spelled differently reads differently from
 * similar address nearby."
 *
 *   'same-lot' — identical key. The Othello case. Loud.
 *   'nearby'   — same house number and same street, DIFFERENT directional.
 *                `5947 32nd Ave S` against `5947 32nd Ave SW`. Genuinely
 *                confusable, genuinely not the same lot. A hint, not a claim.
 *   null       — everything else.
 *
 * ★★ WHAT IS DELIBERATELY NOT A MATCH: the same street with a different house
 * number. `5949` and `5947 32nd Ave SW` are neighbours, both exist in
 * production, and both must be creatable without a fight. Flagging neighbours
 * would fire constantly — this database holds `4222`/`4228 Latona Ave NE`,
 * `2039`/`2043 N 78th St`, `5623`/`5627 44th Ave SW` and a dozen more — and a
 * warning that fires constantly is one people click through without reading,
 * which is how the next Othello gets created anyway.
 */
export type MatchKind = 'same-lot' | 'nearby';

export function classifyMatch(
  a: AddressKey,
  b: AddressKey,
): MatchKind | null {
  if (a.empty || b.empty) return null;
  if (a.key === b.key) return 'same-lot';
  // Same lot number on the same street, disagreeing only about the directional.
  if (a.house !== '' && a.house === b.house && a.street === b.street) {
    return 'nearby';
  }
  return null;
}

/** The minimum a candidate project needs for the check and for the card that
 *  names it. Deliberately narrow — see useProjectAddressIndex for why this is
 *  its own query rather than a reuse of useProjects. */
export interface AddressCandidate {
  id: string;
  address: string;
  go_date?: string | null;
  archived?: boolean | null;
  /** Set when this project is itself a redesign of another. */
  redesign_of_project_id?: string | null;
  /** Permit numbers, for recognition. The Othello copy would have shown three
   *  identical ones, which is unmissable. */
  permitNums?: string[];
}

export interface AddressMatch {
  project: AddressCandidate;
  kind: MatchKind;
  /**
   * ★ True when this match is the redesign relationship working as intended
   * rather than a duplicate — see §3. Creating `3623 SW Othello St [Redesign 2]`
   * SHOULD match `3623 SW Othello St`; saying "duplicate!" at somebody doing
   * exactly what the tool asked them to do is how a warning gets ignored.
   */
  expectedRedesign: boolean;
}

export interface FindMatchesInput {
  /** What the person has typed. */
  address: string;
  /** Every project the check can see. */
  candidates: readonly AddressCandidate[];
  /**
   * ★ The wizard's `redesign_of_project_id`, when it is in redesign mode.
   *
   * Checked BEFORE the `[Redesign N]` suffix, because it is the definitive
   * signal: `makeRedesignWizardState` sets it, and the suffix is merely the
   * address it also seeds. Somebody who edits that address by hand still gets
   * the right treatment.
   */
  redesignOfProjectId?: string | null;
}

/**
 * Every project the typed address could already be, strongest first.
 *
 * ★ Ranked: same-lot above nearby, and within a tier the oldest project first —
 * the original is the one somebody needs to recognise, not the most recent copy.
 */
export function findAddressMatches({
  address,
  candidates,
  redesignOfProjectId,
}: FindMatchesInput): AddressMatch[] {
  const typed = normalizeAddress(address);
  if (typed.empty) return [];

  const parentId = (redesignOfProjectId ?? '').trim();
  // ★ The PARENT'S key, not merely "we are in redesign mode".
  //
  // The obvious version — "in redesign mode, every same-lot match is expected" —
  // is wrong, and wrong in the direction that loses the whole ticket: somebody
  // who opens a redesign of project A and then hand-edits the address to
  // project B's would get "expected redesign" over a genuine duplicate. So
  // expectedness is anchored to the family this redesign actually belongs to.
  const parentKey = parentId
    ? normalizeAddress(
        candidates.find((c) => c.id === parentId)?.address ?? '',
      ).key
    : null;

  const out: AddressMatch[] = [];
  for (const project of candidates) {
    const existing = normalizeAddress(project.address);
    const kind = classifyMatch(typed, existing);
    if (!kind) continue;
    // ★ A redesign is EXPECTED to match its own family — the parent it was
    // spawned from, and any sibling redesign of the same base address. Both
    // normalise to the parent's key once the suffix is stripped, which is
    // exactly why the suffix has to be recorded rather than silently dropped.
    //
    // Two ways in, and they need different tests:
    //   · spawned from Project Overview → parentId is set, so the match must
    //     belong to THAT project's family;
    //   · address hand-typed with a `[Redesign N]` suffix → there is no parent
    //     id, and every same-lot match shares the typed base key by
    //     construction, so any of them is the family.
    const expectedRedesign =
      kind === 'same-lot' &&
      (parentKey !== null
        ? existing.key === parentKey
        : typed.hadRedesignSuffix);
    out.push({ project, kind, expectedRedesign });
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'same-lot' ? -1 : 1;
    return (a.project.address ?? '').localeCompare(b.project.address ?? '');
  });
}

/**
 * ★ What the whole result means, in one value — so the banner does not
 * re-derive it and the tests can assert it directly.
 *
 *   'duplicate'          — at least one same-lot match that is NOT an expected
 *                          redesign. The Othello case.
 *   'expected-redesign'  — same-lot matches, all of them the redesign family.
 *   'nearby'             — no same-lot match, but something confusable.
 *   'clear'              — nothing.
 */
export type MatchVerdict = 'duplicate' | 'expected-redesign' | 'nearby' | 'clear';

export function verdictFor(matches: readonly AddressMatch[]): MatchVerdict {
  const sameLot = matches.filter((m) => m.kind === 'same-lot');
  if (sameLot.length > 0) {
    return sameLot.every((m) => m.expectedRedesign)
      ? 'expected-redesign'
      : 'duplicate';
  }
  return matches.length > 0 ? 'nearby' : 'clear';
}
