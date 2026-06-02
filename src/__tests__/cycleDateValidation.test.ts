import { describe, it, expect } from 'vitest';
import {
  CYCLE_MAX_DATE,
  CYCLE_MIN_DATE,
  validateCycleChain,
  validateYearRange,
} from '../lib/cycleDateValidation';

// fix-97: pure-helper coverage for the cycle date validation. The
// integration coverage lives in PermitDetailV2Fix97.test.tsx; this file
// just pins the helpers' contracts so future regressions surface here
// instead of in a DOM-mock test.

describe('validateYearRange', () => {
  it('returns null for empty / null / undefined inputs', () => {
    expect(validateYearRange('')).toBeNull();
    expect(validateYearRange(null)).toBeNull();
    expect(validateYearRange(undefined)).toBeNull();
  });

  it('returns null for a date inside [2020, 2030]', () => {
    expect(validateYearRange('2020-01-01')).toBeNull();
    expect(validateYearRange('2026-06-02')).toBeNull();
    expect(validateYearRange('2030-12-31')).toBeNull();
  });

  it('flags Ahmadi-style year typos (0020, 0002)', () => {
    expect(validateYearRange('0020-04-09')).toBe(
      'Year must be between 2020 and 2030',
    );
    expect(validateYearRange('0002-02-02')).toBe(
      'Year must be between 2020 and 2030',
    );
  });

  it('flags year 2019 (just-below boundary)', () => {
    expect(validateYearRange('2019-12-31')).toBe(
      'Year must be between 2020 and 2030',
    );
  });

  it('flags year 2031 (just-above boundary)', () => {
    expect(validateYearRange('2031-01-01')).toBe(
      'Year must be between 2020 and 2030',
    );
  });

  it('leaves partial / non-ISO shapes alone (native input grace)', () => {
    expect(validateYearRange('2026-06')).toBeNull();
    expect(validateYearRange('not-a-date')).toBeNull();
  });

  it('exposes constants matching the input min/max attributes', () => {
    expect(CYCLE_MIN_DATE).toBe('2020-01-01');
    expect(CYCLE_MAX_DATE).toBe('2030-12-31');
  });
});

describe('validateCycleChain', () => {
  it('returns no errors for a fully valid chain', () => {
    expect(
      validateCycleChain({
        submitted: '2026-03-01',
        intake_accepted: '2026-03-05',
        corr_issued: '2026-04-01',
        resubmitted: '2026-04-10',
      }),
    ).toEqual({});
  });

  it('returns no errors when only a subset is populated (partial entry)', () => {
    expect(
      validateCycleChain({
        submitted: '2026-03-01',
        intake_accepted: null,
        corr_issued: '2026-04-10',
        resubmitted: null,
      }),
    ).toEqual({});
  });

  it('flags intake_accepted < submitted with the server-shaped message', () => {
    const errs = validateCycleChain({
      submitted: '2026-06-05',
      intake_accepted: '2026-03-02',
    });
    expect(errs.intake_accepted).toBe(
      'intake_accepted (2026-03-02) cannot precede submitted (2026-06-05)',
    );
  });

  it('flags corr_issued < intake_accepted', () => {
    const errs = validateCycleChain({
      submitted: '2026-01-01',
      intake_accepted: '2026-02-01',
      corr_issued: '2026-01-15',
    });
    expect(errs.corr_issued).toBe(
      'corr_issued (2026-01-15) cannot precede intake_accepted (2026-02-01)',
    );
  });

  it('falls back to corr_issued < submitted when intake is blank', () => {
    const errs = validateCycleChain({
      submitted: '2026-03-01',
      corr_issued: '2026-02-01',
    });
    expect(errs.corr_issued).toBe(
      'corr_issued (2026-02-01) cannot precede submitted (2026-03-01)',
    );
  });

  it('flags resubmitted < submitted', () => {
    const errs = validateCycleChain({
      submitted: '2026-05-15',
      resubmitted: '2026-05-10',
    });
    expect(errs.resubmitted).toBe(
      'resubmitted (2026-05-10) cannot precede submitted (2026-05-15)',
    );
  });

  it('flags resubmitted < corr_issued (chain links transitively)', () => {
    const errs = validateCycleChain({
      submitted: '2026-01-01',
      corr_issued: '2026-04-01',
      resubmitted: '2026-03-15',
    });
    expect(errs.resubmitted).toBe(
      'resubmitted (2026-03-15) cannot precede corr_issued (2026-04-01)',
    );
  });

  it('Ahmadi typo: intake_accepted year 0020 with submitted 2026 — chain check still flags', () => {
    // Year-range guard is a separate check; the chain check sees 0020
    // as a 10-char ISO string and orders it before 2026, so it pair-flags
    // the same way the server's fix-89 RAISE does.
    const errs = validateCycleChain({
      submitted: '2026-04-06',
      intake_accepted: '0020-04-09',
    });
    expect(errs.intake_accepted).toBe(
      'intake_accepted (0020-04-09) cannot precede submitted (2026-04-06)',
    );
  });

  it('does NOT flag city_target as out-of-chain (it is excluded from fix-89)', () => {
    // city_target isn't a key in the returned errors map regardless of
    // its value relative to submitted (the city's scheduled date can
    // legitimately predate or follow submission).
    const errs = validateCycleChain({
      submitted: '2026-03-01',
      resubmitted: '2026-04-01',
    });
    expect((errs as Record<string, string>).city_target).toBeUndefined();
  });

  it('treats empty strings as null (matches server NULLIF(value,""))', () => {
    expect(
      validateCycleChain({
        submitted: '',
        intake_accepted: '2026-03-01',
      }),
    ).toEqual({});
  });
});
