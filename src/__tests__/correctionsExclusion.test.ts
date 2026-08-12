import { describe, it, expect } from 'vitest';
import {
  EXCLUSION_LABEL,
  countExclusions,
  exclusionLabel,
  isExcludedRow,
  isRealCorrection,
  partitionCorrections,
} from '../lib/correctionsExclusion';

// fix-283a: the read side of the indexer's is_correction verdict.
//
// The RULES are not tested here and do not live here — they are the scraper's
// (file_indexer/corrections_filter.py), and duplicating them would create a
// second answer that could disagree with the database. What is tested is the
// thing this repo owns: that a false flag removes a row from every count, that
// a MISSING flag never does, and that the excluded rows stay reachable.

type Row = { is_correction?: boolean; exclusion_reason?: string | null };

describe('isRealCorrection — only an explicit false excludes', () => {
  it('keeps a row flagged true', () => {
    expect(isRealCorrection({ is_correction: true })).toBe(true);
  });

  it('excludes a row flagged false', () => {
    expect(isRealCorrection({ is_correction: false })).toBe(false);
  });

  // ★ The direction that matters. is_correction is NOT NULL DEFAULT true in the
  // database, and a caller that does not select the column gets undefined. If
  // either shape excluded, a deploy that forgot the column would silently zero
  // the report — the same class of failure this ticket exists to fix.
  it('keeps a row whose flag was never selected', () => {
    expect(isRealCorrection({})).toBe(true);
    expect(isRealCorrection({ is_correction: undefined })).toBe(true);
  });

  it('is safe on null and undefined rows', () => {
    expect(isRealCorrection(null)).toBe(false);
    expect(isRealCorrection(undefined)).toBe(false);
  });
});

describe('isExcludedRow is the strict inverse for real rows', () => {
  it('is true only for an explicit false', () => {
    expect(isExcludedRow({ is_correction: false })).toBe(true);
    expect(isExcludedRow({ is_correction: true })).toBe(false);
    expect(isExcludedRow({})).toBe(false);
  });
});

describe('partitionCorrections', () => {
  const rows: Row[] = [
    { is_correction: true },
    { is_correction: false, exclusion_reason: 'drawing_text' },
    {},
    { is_correction: false, exclusion_reason: 'explicit' },
  ];

  it('splits kept from excluded and loses nothing', () => {
    const { included, excluded } = partitionCorrections(rows);
    expect(included).toHaveLength(2);
    expect(excluded).toHaveLength(2);
    expect(included.length + excluded.length).toBe(rows.length);
  });

  it('preserves input order within each half', () => {
    const { excluded } = partitionCorrections(rows);
    expect(excluded.map((r) => r.exclusion_reason)).toEqual([
      'drawing_text',
      'explicit',
    ]);
  });

  it('handles an empty set', () => {
    expect(partitionCorrections([])).toEqual({ included: [], excluded: [] });
  });
});

describe('countExclusions', () => {
  it('groups by reason, largest first', () => {
    const counts = countExclusions([
      { exclusion_reason: 'drawing_text' },
      { exclusion_reason: 'explicit' },
      { exclusion_reason: 'drawing_text' },
      { exclusion_reason: 'drawing_text' },
      { exclusion_reason: 'explicit' },
      { exclusion_reason: 'scrambled' },
    ]);
    expect(counts.map((c) => [c.reason, c.count])).toEqual([
      ['drawing_text', 3],
      ['explicit', 2],
      ['scrambled', 1],
    ]);
  });

  it('carries the human label, not the rule name', () => {
    const [first] = countExclusions([{ exclusion_reason: 'drawing_text' }]);
    expect(first.label).toBe(EXCLUSION_LABEL.drawing_text);
    expect(first.label).not.toBe('drawing_text');
  });

  // ★ The scraper owns the rule list and can add one without this app being
  // redeployed. An unrecognised reason must still be COUNTED and VISIBLE — a
  // rule nobody can see is exactly what the brief forbids.
  it('shows a reason this build has never heard of rather than dropping it', () => {
    const counts = countExclusions([{ exclusion_reason: 'some_new_rule' }]);
    expect(counts).toEqual([
      { reason: 'some_new_rule', label: 'some_new_rule', count: 1 },
    ]);
  });

  it('buckets a missing reason rather than losing the row', () => {
    const counts = countExclusions([{ exclusion_reason: null }, {}]);
    expect(counts).toEqual([
      { reason: 'unknown', label: EXCLUSION_LABEL.unknown, count: 2 },
    ]);
  });
});

describe('exclusionLabel', () => {
  it('names every shipped rule', () => {
    for (const reason of Object.keys(EXCLUSION_LABEL)) {
      expect(exclusionLabel(reason)).toBe(EXCLUSION_LABEL[reason]);
    }
  });

  it('falls back to something readable', () => {
    expect(exclusionLabel(null)).toBe('Excluded');
    expect(exclusionLabel('')).toBe('Excluded');
  });
});
