// ===========================================================================
// ★★★ fix-374 — the report knows the discipline and shows the junk drawer
// ===========================================================================
//
// Bobby, on a drainage correction: *"whats interesting, is it said General for
// this item, but it is a drainage correction, as mentioned in the first few
// words."*
//
// ★★★ THE DATA ALREADY KNEW. Measured on prod 2026-08-20: **all 476 items whose
// `subject` is `General` carry a real, non-empty `discipline`. One hundred
// percent.** `General` is the city's junk drawer — it is not a category, it is
// the absence of one — and `discipline` was sitting in the next column,
// populated and correct, and used for everything except organising the view.
//
// So nothing here re-parses anything. This module does two small jobs:
//   1. tidy the raw `discipline` value for DISPLAY (never for storage);
//   2. decide what one cluster's discipline is, and say so honestly when the
//      answer is "more than one".
//
// ★★★ AND THE ANSWER FOR `General` IS "MORE THAN ONE", WHICH IS THE POINT.
// The `subject:general` pile breaks down as:
//
//     Drainage 206 · Energy 203 · Reveg 7 · Compiled 6
//
// Two disciplines, near enough half each. Picking a single winner there would
// be a coin toss presented as a fact, so `clusterDiscipline` refuses to and
// says the pile spans disciplines instead. That is the honest reading of what
// Bobby found: `General` is not one recurring correction, it is at least two.

/** No discipline recorded, or a value that is plainly parse debris. */
export const NOT_RECORDED = 'Not recorded';

/** The letter deliberately covered several disciplines (`Combined`/`Compiled`). */
export const SEVERAL = 'Several disciplines';

/**
 * ★★ THE FULL MEASURED VALUE LIST, 2026-08-20 — 40 distinct values.
 *
 * Real disciplines, by item count:
 *   Zoning 589 · Drainage 560 · Building 525 · Land Use 360 · OS 353 ·
 *   Energy 267 · Engineering 202 · Tree 152 · Addressing 120 · ECA 109 ·
 *   Clearing & Grading 38 · Planning 30 · Structural 30 · MHA 27 ·
 *   Ordinance 21 · SCL 17 · Reveg 16 · Fire 8 · Shoring 6 · Arborist 5 ·
 *   Side Sewer 5 · Conveyance 4 · Housing 2
 *
 * ★ And the rest, which is why this table exists. Each entry below is one of
 * these, and nothing is folded that was not measured:
 */
const CANONICAL: Record<string, string> = {
  // Misspellings — same discipline, typed twice.
  ordinace: 'Ordinance',            // 10 items
  strucutral: 'Structural',         // 3
  drsinge: 'Drainage',              // 1
  drinage: 'Drainage',              // 1
  addresssing: 'Addressing',        // 1
  combine: 'Combined',              // 1
  // Two names for one thing.
  revegetation: 'Reveg',            // 6  (vs Reveg 16)
  'city light': 'SCL',              // 7  (Seattle City Light, vs SCL 17)
  'spu ss': 'Side Sewer',           // 5  (SPU side sewer, vs Side Sewer 5)
  'sdot shoring': 'Shoring',        // 3  (vs Shoring 6)
  'structural calcs': 'Structural', // 1
};

/** ★ NOT disciplines: the letter spanned several. Kept as their own state
 *  rather than folded into "not recorded", because "we covered everything in
 *  one letter" and "we do not know" are different facts. 16 items. */
const MEANS_SEVERAL = new Set(['combined', 'compiled']);

/** A value that begins with digits is an address the parser caught by mistake —
 *  `4113 Sw Ida`, `4052- -Tree`, `4222- Zoning`. Where a real discipline is
 *  hiding behind the number it is recovered; where nothing is, it is `Not
 *  recorded` rather than a new junk drawer of its own. 10 items in total. */
const LEADING_ADDRESS = /^\d[\w.-]*\s*-*\s*/;

/** Every discipline seen on prod, lowercased, after the folds above. Used only
 *  to decide whether something hiding behind an address is real. */
const KNOWN = new Set([
  'zoning', 'drainage', 'building', 'land use', 'os', 'energy', 'engineering',
  'tree', 'addressing', 'eca', 'clearing & grading', 'planning', 'structural',
  'mha', 'ordinance', 'scl', 'reveg', 'fire', 'shoring', 'arborist',
  'side sewer', 'conveyance', 'housing',
]);

function tidy(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * The value to SHOW for one item's discipline.
 *
 * ★★★ Display only. Nothing is written back, and `correction_items.discipline`
 * is never edited — this ticket does not touch a row. A caller that needs the
 * stored value still has it.
 */
export function canonicalDiscipline(raw: string | null | undefined): string {
  const value = tidy(raw ?? '');
  if (value === '') return NOT_RECORDED;

  // ★ Fold the spelling FIRST, then ask what it means. `Combine` folds to
  // `Combined`, which means "several" — asking in the other order returned the
  // tidied spelling and stopped, which is the sort of thing only a test finds.
  const lower = value.toLowerCase();
  const folded = CANONICAL[lower] ?? value;
  if (MEANS_SEVERAL.has(folded.toLowerCase())) return SEVERAL;
  if (CANONICAL[lower]) return folded;
  if (KNOWN.has(lower)) return value;

  // Parse debris: an address glued to the front. Recover the discipline if one
  // is actually there, otherwise admit we do not know.
  if (/^\d/.test(value)) {
    const stripped = tidy(value.replace(LEADING_ADDRESS, '')).toLowerCase();
    if (CANONICAL[stripped]) return CANONICAL[stripped];
    if (MEANS_SEVERAL.has(stripped)) return SEVERAL;
    if (KNOWN.has(stripped)) {
      // Give back the properly-cased spelling rather than the mangled one.
      return tidy(value.replace(LEADING_ADDRESS, ''));
    }
    return NOT_RECORDED;
  }

  // ★ Anything genuinely new passes through untouched. Folding an unrecognised
  // value into "not recorded" would hide a discipline the city has only just
  // started using, which is exactly the junk-drawer mistake this ticket is
  // about — committed a second time, by us.
  return value;
}

/** True for the two buckets that are not a discipline anybody reviews in. */
export function isRealDiscipline(label: string): boolean {
  return label !== NOT_RECORDED && label !== SEVERAL;
}

export interface DisciplineSlice {
  discipline: string;
  items: number;
}

export interface ClusterDiscipline {
  /** What to show as the pile's discipline. */
  label: string;
  /** The largest single discipline, canonicalised. */
  dominant: string;
  /** dominant items / total items, 0–1. */
  share: number;
  /** ★★★ True when no single discipline owns the pile — see DOMINANT_SHARE. */
  mixed: boolean;
  /** Canonicalised and merged, largest first. */
  breakdown: DisciplineSlice[];
  items: number;
}

/**
 * ★★★ Above this share, one discipline owns the pile and naming it is a fact.
 * Below it, naming one would be a coin toss presented as a fact.
 *
 * Set at 60% deliberately. `subject:general` is Drainage 206 / Energy 203 —
 * 50.4% — and the entire complaint that started this ticket is that pile being
 * given one name it does not deserve. A threshold that called it "Drainage"
 * would have reproduced the bug with a different word.
 */
export const DOMINANT_SHARE = 0.6;

/** One cluster's discipline, from its per-discipline item counts. */
export function clusterDiscipline(rows: DisciplineSlice[]): ClusterDiscipline {
  const merged = new Map<string, number>();
  for (const row of rows ?? []) {
    const label = canonicalDiscipline(row.discipline);
    merged.set(label, (merged.get(label) ?? 0) + (row.items ?? 0));
  }
  const breakdown = [...merged.entries()]
    .map(([discipline, items]) => ({ discipline, items }))
    .sort((a, b) =>
      b.items - a.items || a.discipline.localeCompare(b.discipline));

  const items = breakdown.reduce((n, r) => n + r.items, 0);
  if (items === 0) {
    return { label: NOT_RECORDED, dominant: NOT_RECORDED, share: 0,
             mixed: false, breakdown: [], items: 0 };
  }

  // ★ The winner is judged among REAL disciplines. A pile that is half
  // "not recorded" is still a Drainage pile as far as anyone reading it is
  // concerned, and calling it "Not recorded" would bury the useful half.
  const real = breakdown.filter((r) => isRealDiscipline(r.discipline));
  const realItems = real.reduce((n, r) => n + r.items, 0);
  if (real.length === 0) {
    const top = breakdown[0];
    return { label: top.discipline, dominant: top.discipline, share: 1,
             mixed: false, breakdown, items };
  }

  const top = real[0];
  const share = top.items / realItems;
  const mixed = real.length > 1 && share < DOMINANT_SHARE;
  return {
    label: mixed ? SEVERAL : top.discipline,
    dominant: top.discipline,
    share,
    mixed,
    breakdown,
    items,
  };
}

/** `Drainage 206 · Energy 203` — what a mixed pile says instead of a name. */
export function breakdownSummary(d: ClusterDiscipline, max = 3): string {
  return d.breakdown
    .slice(0, max)
    .map((r) => `${r.discipline} ${r.items}`)
    .join(' · ');
}

/**
 * ★★★ Group ranked clusters under their discipline, KEEPING THE RANK ORDER.
 *
 * The brief: *"The change is which field ORGANISES the view, not which fields
 * exist."* So fix-372's comparator still decides the order inside every group,
 * and the groups themselves are ordered by their best-ranked member — never by
 * item count, which is the ranking mistake fix-372 exists to prevent.
 */
export function groupByDiscipline<T>(
  rows: T[],
  disciplineOf: (row: T) => string,
): Array<{ discipline: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = disciplineOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  // ★★★ INSERTION ORDER IS BEST-RANK ORDER, because `rows` arrives ranked, and
  // it is returned UNTOUCHED. No special case, and specifically not one that
  // sinks `Several disciplines` to the bottom:
  //
  // `General` is 75 projects and 63.6% — the highest-reach pattern in the
  // corpus — AND it is the pile with no single discipline. Sinking the mixed
  // group would bury the biggest recurring correction there is at the foot of
  // the view whose entire job is to rank them, which is the fix-372 ranking
  // mistake wearing a different hat. It stays first; what changed is that it
  // now says "Drainage 206 · Energy 203" instead of pretending to be one thing.
  return [...groups.entries()].map(([discipline, groupRows]) => ({
    discipline, rows: groupRows,
  }));
}
