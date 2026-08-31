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

// ===========================================================================
// ★★★ fix-465 §A (P-114) — THE COLUMNS, AND THEIR WIDTHS, IN ONE PLACE
// ===========================================================================
//
// ★★★ 0d — WHY THIS IS THE SINGLE SOURCE, AND WHY THE DEFECT WAS NOT "no
// shared widths". There is already exactly ONE component rendering all five
// sections (`SnapshotSection`), so "five tables with five width lists" was
// never the shape. The real defect is narrower and worse: that one table had
// **no `table-layout: fixed` and no widths at all**, so each of the five
// auto-sized to its OWN content. Section A's three rows and section B's three
// rows land on different column boundaries, and the reader's eye — which is
// tracking one report down a page — has to re-find the columns five times.
//
// So the fix is not to de-duplicate a list; it is to STATE the widths once,
// here beside the sort keys they already share, and render one `<colgroup>`
// from them. Adding a column now forces both halves at the same moment.
//
// ★★ THE WIDTHS ARE PERCENTAGES, NOT PIXELS. The same table renders at ~1076px
// in the Weekly Update modal and wider on the Agenda page; a pixel list would
// be right in one place and wrong in the other. Percentages keep the five
// sections aligned WITH EACH OTHER at every width, which is the property being
// bought here — not any particular pixel count.
//
// ★★★ MEASURED, NOT COPIED FROM THE MOCK — AND THE MEASUREMENT CHANGED FIVE OF
// THE EIGHT. `harness/snapshot-widths.html` renders a candidate list in Chrome
// against the real worst-case strings measured on prod 2026-08-31 (a 30-char
// address, a 17-char `SPUE-IPR-26-00004`, an 18-char "Grading / Clearing", a
// 33-char "Approved - Additional Information") plus the longest header a
// section can name, and reports the slack per column. Change a number here,
// re-run that file, re-read the report.
//
// The mock draws its table at 1204px (`.wrap{max-width:1240px;padding:18px}`);
// the modal gives it 1076px, 11% less. THE BRIEF'S PROPOSED
// `19/15/11/9/9/12/8/17` FAILS THERE — Type −3px, the date header −6px, the age
// header −15px, City status −28px — while Permit # sat on 27px of spare and ENT
// lead and DA on 23px each. ★ And the age column is 5px short even at the
// MOCK'S OWN width, so the mock truncates its own "DAYS WAITING".
//
// ★★★ THE RULE USED TO REDISTRIBUTE, because 1044px of worst case will not go
// into 1076px of table with every column comfortable:
//   1. NO HEADER EVER TRUNCATES. A header the reader cannot read is a column
//      they cannot sort — and the two that were truncating are the two the
//      SECTION names, which are precisely the ones a reader checks.
//   2. THE COLUMNS THAT IDENTIFY A ROW NEVER TRUNCATE: Project and Permit #.
//      Those are what a reader matches against what they already know.
//   3. THE COLUMNS THAT DESCRIBE IT MAY: Type and City status. `text-overflow:
//      ellipsis` is deliberate; measuring puts the ellipsis where it costs
//      least, it does not abolish it.
// At 1204px and above, NOTHING truncates under this allocation.
export interface SnapshotColumn {
  key: SortKey;
  /** Fixed header text. Two columns have none — the SECTION names them. */
  label?: string;
  /** Percentage of the table width. The eight must total 100. */
  width: number;
  /** Right-aligned, tabular figures. */
  num?: boolean;
  /** Rendered in the monospace stack, where character alignment carries
   *  meaning: a permit number and an ISO date are both read column-wise. */
  mono?: boolean;
  /** ★★ §B2 — the ink ladder. `false` (the default) is full-strength
   *  `--color-text`; `true` steps back to `--color-muted`, which measures
   *  5.48:1 on white. NOTHING uses `--color-dim` (2.82:1) any more. */
  soft?: boolean;
}

export const SNAPSHOT_COLUMNS: readonly SnapshotColumn[] = [
  // width   brief   slack at 1076px (the modal — the binding case)
  { key: 'address', label: 'Project', width: 19 },                    // 19  +12
  { key: 'num', label: 'Permit #', width: 13, mono: true, soft: true }, // 15  +5
  { key: 'type', label: 'Type', width: 11, soft: true },              // 11   −3 ellipsis, by rule 3
  { key: 'ent_lead', label: 'ENT lead', width: 8, soft: true },       //  9  +12
  { key: 'da', label: 'DA', width: 8, soft: true },                   //  9  +12
  { key: 'on_date', width: 13, mono: true, soft: true },              // 12   +4  section's date label
  { key: 'age_days', width: 10, num: true },                          //  8   +7  section's age label
  { key: 'status', label: 'City status', width: 18, soft: true },     // 17  −18 ellipsis, by rule 3
];

/**
 * ★★ THE WIDTH BELOW WHICH THE GRID CANNOT HOLD ITS OWN HEADERS, so the table
 * scrolls sideways instead of crushing eight columns into a phone. Derived, not
 * picked: the binding header is "Corrections issued" at 135px in a 13% column,
 * which needs 135 / 0.13 = 1038px of table. Rule 1 above is the whole reason
 * this constant exists — squeezing is not a gentler failure than scrolling, it
 * is the same failure applied to all eight columns at once.
 */
export const SNAPSHOT_MIN_WIDTH_PX = 1040;

/**
 * ★★★ §B3 — THE URGENCY TINT, AND WHY THESE TWO NUMBERS AND NO OTHERS.
 *
 * `backlogBreakdown` below already states section B's tail as *"88 are over a
 * month, 52 over three months"* — 30 and 90 days. Those thresholds are
 * therefore ALREADY in this file, already shown to the reader in words, and
 * already the vocabulary the report speaks. The tint reuses them exactly, so
 * the colour of a number and the sentence underneath it can never disagree.
 * Inventing a second pair would have produced a table where a row is tinted
 * "hot" while the line below counts it as ordinary.
 *
 * ★★★ THE MOCK'S PER-ROW TONES ARE NOT A RULE, AND COPYING THEM WOULD HAVE
 * SHIPPED A CONTRADICTION. They are hand-authored illustration: it paints 194
 * days "hot" in section D while painting 216 days "warn" in section C, and 126
 * "warn" against 48 "calm" in section E. There is no monotone function through
 * those points. So the mock wins on APPEARANCE — two tints, these two inks —
 * and the brief wins on MECHANISM: the rule is derived and stated here.
 *
 * ★★★ SECTION A IS DELIBERATELY UNTINTED. Its number is a COUNTDOWN ("due in
 * 14"), not an overrun — nothing in that section is late, and tinting a
 * fortnight's notice the same red as a permit 1,126 days past due would teach
 * the reader to ignore the colour. The tint means "this has run over", so it
 * appears only where the number measures elapsed time: B, C, D and E.
 */
export const TINT_WARN_DAYS = 30;
export const TINT_HOT_DAYS = 90;

export type AgeTone = 'hot' | 'warn' | null;

export function ageTone(bucket: SnapshotBucket, age: number | null): AgeTone {
  // ★ A countdown is not an overrun — see above.
  if (bucket === 'a') return null;
  if (age == null) return null;
  if (age > TINT_HOT_DAYS) return 'hot';
  if (age > TINT_WARN_DAYS) return 'warn';
  return null;
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
