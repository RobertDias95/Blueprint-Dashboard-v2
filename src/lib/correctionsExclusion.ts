import type { CorrectionItem } from './database.types';

// fix-283a: the one place that decides whether a correction row counts.
//
// Roughly a quarter of correction_items was suspected of not being corrections
// at all. Seattle's letters are two-column PDFs — reviewer comments one side,
// the drawing sheet the other — and the indexer reads both, so a door schedule
// sometimes lands in the table as a correction. Every count, prevalence figure
// and repeat rate published off this table was partly counting drawing text.
//
// ★ THE RULES ARE NOT HERE, AND MUST NOT BE. They live in the scraper's
// file_indexer/corrections_filter.py, which sets `is_correction` and
// `exclusion_reason` at extraction time and on --backfill. This repo READS the
// verdict. A second implementation of the heuristics here would be a second
// answer waiting to disagree with the first, and the disagreement would show up
// as the report and the database reporting different totals.
//
// ★ EXCLUDED ROWS ARE NOT DELETED AND MUST NOT BE HIDDEN. The detection is
// heuristic and will have false positives. The report therefore keeps a count
// of what it dropped, visible without being asked, and can list them with the
// reason — if the filter is wrong, somebody has to be able to notice.

/** Rows the filter excluded, by rule. Ordered by production volume: explicit 60,
 *  drawing_text 46, boilerplate 32, scrambled 3 (141 of 2,194). */
export const EXCLUSION_REASONS = [
  'explicit',
  'drawing_text',
  'boilerplate',
  'scrambled',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

/** What each rule means, in words a person reading the report can act on.
 *  These say what was FOUND, not which regex fired. */
export const EXCLUSION_LABEL: Record<string, string> = {
  explicit: 'Marked not a correction',
  drawing_text: 'Drawing text',
  boilerplate: 'Letter boilerplate',
  scrambled: 'Unreadable text',
  // A row excluded with no reason recorded. The database CHECK constraint makes
  // this impossible, so it should never appear — but the count must still have
  // somewhere to go rather than vanishing if it ever does.
  unknown: 'Reason not recorded',
};

export const EXCLUSION_HINT: Record<string, string> = {
  explicit:
    'The letter says so itself — “informational only”, “no action required”, ' +
    'or “not a correction item”.',
  drawing_text:
    'Mostly capitals and asking for nothing: sheet text captured from the ' +
    'other column of a two-column letter, such as a door or window schedule.',
  boilerplate:
    'The “00 Code Edition” block that opens nearly every Seattle letter — ' +
    '“this project has been reviewed for conformance with …”.',
  scrambled:
    'Two columns read as one line, leaving text with no recoverable meaning.',
};

/** A reason the app has no label for — a rule added on the scraper side after
 *  this deploy. Shown as itself rather than dropped or crashed on. */
export function exclusionLabel(reason: string | null | undefined): string {
  if (!reason) return 'Excluded';
  return EXCLUSION_LABEL[reason] ?? reason;
}

/**
 * Does this row count as a correction?
 *
 * ★ A MISSING VALUE MEANS YES. `is_correction` is NOT NULL DEFAULT true in the
 * database, and a caller that does not select the column gets `undefined` — in
 * both cases the row is a correction. Only an explicit `false` excludes, so no
 * amount of missing data can silently shrink a count. That direction matters:
 * under-counting corrections is the failure this ticket exists to fix, and the
 * fix must not be able to cause it in a new way.
 */
export function isRealCorrection(
  row: Pick<CorrectionItem, 'is_correction'> | null | undefined,
): boolean {
  return row ? row.is_correction !== false : false;
}

/** The inverse, for the "what was excluded" affordance. */
export function isExcludedRow(
  row: Pick<CorrectionItem, 'is_correction'> | null | undefined,
): boolean {
  return row ? row.is_correction === false : false;
}

/**
 * Split a set of rows into the ones that count and the ones that do not.
 *
 * Returned together, deliberately: every caller that filters also has to be
 * able to say how many it dropped, and taking both from one pass makes the two
 * numbers impossible to compute from different inputs.
 */
export function partitionCorrections<T extends Pick<CorrectionItem, 'is_correction'>>(
  rows: readonly T[],
): { included: T[]; excluded: T[] } {
  const included: T[] = [];
  const excluded: T[] = [];
  for (const row of rows) {
    if (isExcludedRow(row)) excluded.push(row);
    else included.push(row);
  }
  return { included, excluded };
}

export interface ExclusionCount {
  reason: string;
  label: string;
  count: number;
}

/** Excluded rows grouped by rule, most first. Unknown reasons sort last but are
 *  never dropped — a rule this build has not heard of still has to be visible. */
export function countExclusions<T extends Pick<CorrectionItem, 'exclusion_reason'>>(
  rows: readonly T[],
): ExclusionCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reason = row.exclusion_reason || 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, label: exclusionLabel(reason), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
