import { describe, it, expect } from 'vitest';
import {
  likelySameReviewer,
  looksLikeBodyText,
  NAME_MAX_LEN,
  reviewerCount,
  reviewerDisciplineOutliers,
} from '../lib/correctionReviewers';

// ===========================================================================
// fix-374 · §4 and §5 — the reviewer numbers, and the honesty they owe
// ===========================================================================
//
// Every fixture is a real value measured on prod 2026-08-20.

/** The four values that are one human being, with their real item counts. */
const JESSICA = [
  ['Jessica', 145],
  ['Jessica Batterman', 28],
  ['Jessica sewer main) and that is incorrect.', 5],
  ['Jessica On the Construction Stormwater Control & Post Constr', 3],
] as const;

function items(pairs: ReadonlyArray<readonly [string, number]>,
                discipline = 'Drainage') {
  return pairs.flatMap(([reviewer, n]) =>
    Array.from({ length: n }, () => ({ reviewer, discipline })));
}

describe('fix-374 §5 the reviewer count is inflated and says so', () => {
  it('★★★ spots body text the parser captured as a name', () => {
    expect(looksLikeBodyText('Jessica sewer main) and that is incorrect.')).toBe(true);
    expect(looksLikeBodyText(
      'Jessica On the Construction Stormwater Control & Post Constr')).toBe(true);
  });

  it('leaves real names alone', () => {
    for (const name of ['Jessica', 'Jessica Batterman', 'Matt Lewis', 'adelia',
                        'cici.sun', 'theresa neylon', 'Deborah McGarry']) {
      expect(looksLikeBodyText(name)).toBe(false);
    }
    expect(looksLikeBodyText(null)).toBe(false);
    expect(looksLikeBodyText('')).toBe(false);
  });

  it('the length rule matches the measured one', () => {
    expect(NAME_MAX_LEN).toBe(30);
    expect(looksLikeBodyText('x'.repeat(31))).toBe(true);
    expect(looksLikeBodyText('x'.repeat(30))).toBe(false);
  });

  it('★★★ never presents the count as exact', () => {
    const count = reviewerCount(items(JESSICA));
    expect(count.approximate).toBe(true);
    expect(count.distinct).toBe(4);
    expect(count.suspect).toBe(2);
    expect(count.plausible).toBe(2);
    expect(count.suspectItems).toBe(8);
  });

  it('★★ items with no reviewer are counted, never dropped', () => {
    const count = reviewerCount([
      { reviewer: 'Jessica' }, { reviewer: null }, { reviewer: '  ' },
    ]);
    expect(count.noReviewer).toBe(2);
    expect(count.distinct).toBe(1);
  });

  it('★★★ reports the split identity rather than merging it', () => {
    const same = likelySameReviewer(items(JESSICA));
    expect(same).toHaveLength(1);
    expect(same[0].values).toContain('Jessica');
    expect(same[0].values).toContain('Jessica Batterman');
    expect(same[0].items).toBe(181);
    // Reported, NOT merged: the fix is a parser fix in the other repo.
    const count = reviewerCount(items(JESSICA));
    expect(count.distinct).toBe(4);
  });

  it('does not invent a duplicate out of two different people', () => {
    expect(likelySameReviewer(items([['Matt Lewis', 3], ['David Sachs', 4]])))
      .toEqual([]);
  });
});

describe('fix-374 §4 reviewer→discipline is a check, not a fix', () => {
  it('★★★ flags the Jessica outlier — 140 Drainage, 5 Structural', () => {
    const rows = [
      ...items([['Jessica', 140]], 'Drainage'),
      ...items([['Jessica', 5]], 'Structural'),
    ];
    const [flag] = reviewerDisciplineOutliers(rows);
    expect(flag.reviewer).toBe('Jessica');
    expect(flag.dominant).toBe('Drainage');
    expect(flag.dominantItems).toBe(140);
    expect(flag.odd).toEqual([{ discipline: 'Structural', items: 5 }]);
  });

  it('★ leaves a genuine two-discipline reviewer alone', () => {
    // Jeanie McConnell: Engineering 72, Clearing & Grading 38. A 35% minority
    // is a second speciality, not an anomaly — crying wolf here would make the
    // whole flag worthless.
    const rows = [
      ...items([['Jeanie McConnell', 72]], 'Engineering'),
      ...items([['Jeanie McConnell', 38]], 'Clearing & Grading'),
    ];
    expect(reviewerDisciplineOutliers(rows)).toEqual([]);
  });

  it('ignores body-text values — that is the parser defect, not a disagreement', () => {
    const rows = [
      ...items([['Jessica sewer main) and that is incorrect.', 20]], 'Drainage'),
      ...items([['Jessica sewer main) and that is incorrect.', 1]], 'Structural'),
    ];
    expect(reviewerDisciplineOutliers(rows)).toEqual([]);
  });

  it('says nothing about a reviewer with too few comments to judge', () => {
    const rows = [
      ...items([['Someone New', 4]], 'Drainage'),
      ...items([['Someone New', 1]], 'Zoning'),
    ];
    expect(reviewerDisciplineOutliers(rows)).toEqual([]);
  });

  it('★★★ never changes a discipline — it only reports', () => {
    const rows = [
      ...items([['Jessica', 140]], 'Drainage'),
      ...items([['Jessica', 5]], 'Structural'),
    ];
    const before = rows.map((r) => r.discipline);
    reviewerDisciplineOutliers(rows);
    expect(rows.map((r) => r.discipline)).toEqual(before);
  });
});
