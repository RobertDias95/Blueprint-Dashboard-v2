// ===========================================================================
// ★★★ fix-374 — the reviewer numbers on this page are wrong, and it says so
// ===========================================================================
//
// Bobby: *"we should know reviewers by discipline i.e. Jessica Batterman is a
// drainage reviewer for SDCI, meaning her corrections are drainage specific."*
//
// He is right, and it is measured: of 118 reviewers, **85 write in exactly one
// discipline** and **102 are ≥80% one discipline, covering 89% of all items**.
//
// ★★★ BUT IT IS A CHECK, NOT A FIX. `discipline` is directly observed and
// already correct; replacing it with something derived from the reviewer would
// be swapping a fact for an inference. So nothing here overwrites anything.
// What reviewer→discipline earns is ONE thing: finding where the two disagree.
//
// ---------------------------------------------------------------------------
// ★★★ AND THE COUNT ITSELF IS INFLATED. Two defects, both measured on prod
// 2026-08-20, both belonging to the SCRAPER's parser (fix-375) and neither
// fixable from here:
//
//   (a) SPLIT IDENTITIES. `Jessica` (145 items) and `Jessica Batterman` (28)
//       are one person.
//   (b) BODY TEXT CAPTURED AS A NAME. 26 of 123 distinct reviewer values are
//       longer than 30 characters — 256 items. Real examples:
//           "Jessica sewer main) and that is incorrect."
//           "Jessica On the Construction Stormwater Control & Post Constr"
//
// Together those four values are ONE human being holding 181 items.
//
// ★★ This page cannot fix that and must not pretend it away. What it owes is
// honesty: the count is presented as an upper bound with the reason attached,
// never as a fact. A silently wrong number is the thing to avoid.

/** Longer than this and it is a sentence, not a name. 26 values, 256 items. */
export const NAME_MAX_LEN = 30;

/** Punctuation that no reviewer name contains but body text always does. */
const SENTENCE_MARKS = /[.)(;:]|\d{2,}/;

/**
 * ★★ True when a `reviewer` value is plainly body text the parser mistook for
 * a name. Deliberately conservative: length alone is the primary test, because
 * inventing a cleverer rule here would be doing the parser's job in the wrong
 * repo, and a false positive hides a real person.
 */
export function looksLikeBodyText(reviewer: string | null | undefined): boolean {
  const value = (reviewer ?? '').trim();
  if (value === '') return false;
  if (value.length > NAME_MAX_LEN) return true;
  // Short but still obviously a fragment: "Jessica sewer main)".
  return SENTENCE_MARKS.test(value) && value.split(/\s+/).length > 2;
}

/**
 * The FIRST word of a value, for grouping only.
 *
 * ★ One word, not two, and that is the whole trick: the four values that are
 * Jessica differ from the second word onwards — `Jessica Batterman`,
 * `Jessica sewer main)…` — so a two-word stem puts each in its own group and
 * finds nothing. It will occasionally pair two real people who share a first
 * name; that is the right way to be wrong here, because the output is a
 * "worth a look" list for a human and never a merge.
 */
function nameStem(reviewer: string): string {
  const first = reviewer.trim().split(/\s+/)[0] ?? '';
  return first.toLowerCase().replace(/[^a-z.]/g, '').trim();
}

export interface ReviewerCount {
  /** Distinct non-empty `reviewer` values — the raw, inflated number. */
  distinct: number;
  /** Values that are plainly body text rather than a name. */
  suspect: number;
  /** distinct − suspect. Still an upper bound: split identities remain. */
  plausible: number;
  /** Items carrying no reviewer at all. ★ Never dropped, always stated. */
  noReviewer: number;
  /** Items behind the suspect values. */
  suspectItems: number;
  /** ★★★ Always true while fix-375 stands. The UI must not print `distinct`
   *  as a fact, and `test_the_reviewer_count_is_not_exact` asserts the caveat
   *  is actually rendered. */
  approximate: boolean;
}

export interface ReviewerItem {
  reviewer: string | null;
  discipline?: string | null;
}

/** The reviewer headline, with its own uncertainty attached. */
export function reviewerCount(items: ReviewerItem[]): ReviewerCount {
  const values = new Set<string>();
  const suspects = new Set<string>();
  let noReviewer = 0;
  let suspectItems = 0;
  for (const item of items ?? []) {
    const value = (item.reviewer ?? '').trim();
    if (value === '') {
      noReviewer += 1;
      continue;
    }
    values.add(value);
    if (looksLikeBodyText(value)) {
      suspects.add(value);
      suspectItems += 1;
    }
  }
  return {
    distinct: values.size,
    suspect: suspects.size,
    plausible: values.size - suspects.size,
    noReviewer,
    suspectItems,
    approximate: true,
  };
}

/**
 * ★★ Values that are probably one person under several spellings.
 *
 * Grouping is by first name (see `nameStem`), which is what catches
 * `Jessica` / `Jessica Batterman` / `Jessica sewer main) and that is incorrect.`
 * ★★★ REPORTED, NEVER MERGED. The fix is a parser fix in the other repo; this
 * only says where to look, so nobody reads 123 as a headcount.
 */
export function likelySameReviewer(
  items: ReviewerItem[],
): Array<{ stem: string; values: string[]; items: number }> {
  const byStem = new Map<string, Map<string, number>>();
  for (const item of items ?? []) {
    const value = (item.reviewer ?? '').trim();
    if (value === '') continue;
    const stem = nameStem(value);
    if (stem === '') continue;
    const bucket = byStem.get(stem) ?? new Map<string, number>();
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
    byStem.set(stem, bucket);
  }
  return [...byStem.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([stem, values]) => ({
      stem,
      values: [...values.keys()].sort(),
      items: [...values.values()].reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.items - a.items || a.stem.localeCompare(b.stem));
}

export interface ReviewerDisciplineOutlier {
  reviewer: string;
  dominant: string;
  dominantItems: number;
  total: number;
  odd: Array<{ discipline: string; items: number }>;
}

/** A reviewer must write this much of one discipline before a stray counts as odd. */
export const OUTLIER_DOMINANT_SHARE = 0.8;
/** And the stray itself must be this small, or it is a second speciality. */
export const OUTLIER_MINORITY_SHARE = 0.1;

/**
 * ★★★ THE ONE THING REVIEWER→DISCIPLINE GENUINELY EARNS: disagreements.
 *
 * `Jessica` is Drainage 140 and Structural 5. That 5 is either a mis-parse or a
 * different person, and either way somebody should look. **Surfaced, never
 * auto-corrected** — using a derived signal to overwrite a directly-observed
 * one is a downgrade, and the brief says so.
 *
 * ★ The two thresholds are what stop this crying wolf. `Jeanie McConnell` is
 * Engineering 72 / Clearing & Grading 38: a 35% minority is a second
 * speciality, not an anomaly, and she is correctly not flagged. Measured on
 * prod, the rule flags Jessica and leaves Jeanie alone.
 *
 * Body-text values are excluded outright — they are the parser defect, not a
 * disagreement worth a person's attention.
 */
export function reviewerDisciplineOutliers(
  items: ReviewerItem[],
  minItems = 10,
): ReviewerDisciplineOutlier[] {
  const byReviewer = new Map<string, Map<string, number>>();
  for (const item of items ?? []) {
    const reviewer = (item.reviewer ?? '').trim();
    const discipline = (item.discipline ?? '').trim();
    if (reviewer === '' || discipline === '') continue;
    if (looksLikeBodyText(reviewer)) continue;
    const bucket = byReviewer.get(reviewer) ?? new Map<string, number>();
    bucket.set(discipline, (bucket.get(discipline) ?? 0) + 1);
    byReviewer.set(reviewer, bucket);
  }

  const out: ReviewerDisciplineOutlier[] = [];
  for (const [reviewer, counts] of byReviewer) {
    const sorted = [...counts.entries()]
      .map(([discipline, n]) => ({ discipline, items: n }))
      .sort((a, b) => b.items - a.items || a.discipline.localeCompare(b.discipline));
    const total = sorted.reduce((n, r) => n + r.items, 0);
    if (total < minItems || sorted.length < 2) continue;
    const top = sorted[0];
    if (top.items / total < OUTLIER_DOMINANT_SHARE) continue;
    const odd = sorted.slice(1).filter((r) => r.items / total <= OUTLIER_MINORITY_SHARE);
    if (odd.length === 0) continue;
    out.push({ reviewer, dominant: top.discipline, dominantItems: top.items,
               total, odd });
  }
  return out.sort((a, b) => b.total - a.total || a.reviewer.localeCompare(b.reviewer));
}
