// ===========================================================================
// ★★★ fix-463 §A (P-108) — THE FIVE SECTIONS, AND HOW A READER SORTS THEM
// ===========================================================================
//
// The mock-up is the spec (Bobby iterated it four times and approved v4). This
// module holds the parts that are logic rather than markup: the section
// vocabulary, the three-state disclosure, and the type-aware sort.

export type SnapshotBucket = 'a' | 'b' | 'c' | 'd' | 'e';

/** One permit row, exactly the eight columns the mock-up shows. */
export interface SnapshotRow {
  bucket: SnapshotBucket;
  permit_id: number;
  /** ★ §A6: every row opens its permit, and a permit is opened through its
   *  PROJECT (`/project/:id?permit=N`). Carried here so the link needs no
   *  second lookup against the whole permits cache. */
  project_id: string | null;
  address: string | null;
  num: string | null;
  type: string | null;
  ent_lead: string | null;
  da: string | null;
  status: string | null;
  /** The section's date column — target submit / submitted / corrections
   *  issued / approved, depending on the bucket. */
  on_date: string | null;
  /** The section's age column, in days. Negative in section A ("due in N"). */
  age_days: number | null;
}

/**
 * ★★ THE SECTION HEADINGS ARE THE MOCK-UP'S WORDS, and the two variable column
 * labels with them. Five sections, one definition each, in one place — so the
 * heading, the date column and the age column can never drift apart.
 */
export interface SectionSpec {
  key: SnapshotBucket;
  title: string;
  /** Header for the date column. */
  dateLabel: string;
  /** Header for the age column. */
  ageLabel: string;
}

export const SNAPSHOT_SECTIONS: readonly SectionSpec[] = [
  { key: 'a', title: 'Intake due in the next 14 days', dateLabel: 'Target submit', ageLabel: 'Due in' },
  { key: 'b', title: 'Intake past due, still not submitted', dateLabel: 'Target submit', ageLabel: 'Days late' },
  { key: 'c', title: 'Submitted, intake fee not paid', dateLabel: 'Submitted', ageLabel: 'Days waiting' },
  { key: 'd', title: 'In corrections more than 7 days', dateLabel: 'Corrections issued', ageLabel: 'Days out' },
  { key: 'e', title: 'Approved, not yet issued', dateLabel: 'Approved', ageLabel: 'Days since' },
];

/** ★ §A2: collapsed shows the top three. Expanded shows about ten and scrolls. */
export const TOP_N = 3;
export const EXPANDED_ROWS = 10;

/** Every column a section can be sorted by, and what kind of value it holds —
 *  which is what makes §A4's sort correct rather than lexical. */
export type SortKey =
  | 'address'
  | 'num'
  | 'type'
  | 'ent_lead'
  | 'da'
  | 'on_date'
  | 'age_days'
  | 'status';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

/**
 * ★★★ §A4 — TYPE-AWARE, BECAUSE A STRING SORT PUTS 9 AFTER 103.
 *
 * The mock-up's `key()` does this by sniffing the rendered text; here the types
 * are known, so it is decided by column instead of guessed from characters.
 * Three kinds:
 *   · `age_days`  NUMERIC   — 9 before 103, and −4 ("due in 4") before both.
 *   · `on_date`   ISO DATE  — lexical IS chronological for `YYYY-MM-DD`, which
 *                             is why the column is stored that way; stated
 *                             rather than assumed, because the day somebody
 *                             renders it as "31 Aug" this stops being true.
 *   · everything else        alphabetical, case-insensitive.
 *
 * ★★ NULLS SORT LAST IN BOTH DIRECTIONS, deliberately. A permit with no number
 * yet is not "the smallest number" — it is an absence, and floating it to the
 * top of an ascending sort would bury the rows the reader asked to see.
 */
export function compareRows(a: SnapshotRow, b: SnapshotRow, sort: SortState): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const av = a[sort.key];
  const bv = b[sort.key];

  const aNull = av === null || av === undefined || av === '';
  const bNull = bv === null || bv === undefined || bv === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1; // ★ last, whichever direction
  if (bNull) return -1;

  if (sort.key === 'age_days') {
    return ((av as number) - (bv as number)) * dir;
  }
  // ISO dates and plain text both compare lexically; `localeCompare` keeps
  // accented names in a sane order for the four text columns.
  return String(av).localeCompare(String(bv)) * dir;
}

/** Sort a section's rows. Pure, and returns a new array — the caller memoises. */
export function sortRows(
  rows: readonly SnapshotRow[],
  sort: SortState,
): SnapshotRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort));
}

/**
 * ★★ §A5 — search filters ONE section and reports "n of N".
 *
 * Matched across every column the reader can see, because somebody searching
 * "Miles" means the ENT lead and somebody searching "7065" means the permit
 * number, and asking them which is not a kindness.
 */
export function filterRows(
  rows: readonly SnapshotRow[],
  query: string,
): SnapshotRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  return rows.filter((r) =>
    [r.address, r.num, r.type, r.ent_lead, r.da, r.status, r.on_date]
      .some((v) => (v ?? '').toLowerCase().includes(q)),
  );
}

/**
 * ★★★ §A3 — RE-SORTING RE-PICKS THE TOP THREE.
 *
 * The preview must reflect the reader's chosen order, not a frozen list. Sorting
 * by "Days late" and still seeing the three the server happened to return first
 * would make the toggle a lie — and it is the one interaction in the mock-up
 * that is easy to implement wrongly, because taking the first three of the
 * ORIGINAL array looks identical until somebody clicks a header.
 *
 * So: sort, then filter, then slice. In that order, always.
 */
export function visibleRows(
  rows: readonly SnapshotRow[],
  sort: SortState,
  query: string,
  expanded: boolean,
): { shown: SnapshotRow[]; matched: number; total: number } {
  const matched = filterRows(sortRows(rows, sort), query);
  return {
    shown: expanded ? matched : matched.slice(0, TOP_N),
    matched: matched.length,
    total: rows.length,
  };
}

/**
 * ★★ B's remainder sentence — the mock-up's "88 more are over a month late —
 * 52 over three months, 8 over a year."
 *
 * ★★★ B IS A BACKLOG, NOT A WEEK'S NEWS, and this is how the report says so
 * without dumping 101 rows into a modal. Measured on prod 2026-08-30: 13 of 101
 * are within 30 days; 88 are over a month, 52 over three months, 8 over a year,
 * the oldest target 2023-08-01. A number the reader cannot drill into would be a
 * rumour, so the rows are all still there behind Show all and the search.
 */
export function backlogBreakdown(rows: readonly SnapshotRow[]): {
  overMonth: number;
  overQuarter: number;
  overYear: number;
} {
  let overMonth = 0;
  let overQuarter = 0;
  let overYear = 0;
  for (const r of rows) {
    const d = r.age_days ?? 0;
    if (d > 30) overMonth += 1;
    if (d > 90) overQuarter += 1;
    if (d > 365) overYear += 1;
  }
  return { overMonth, overQuarter, overYear };
}
