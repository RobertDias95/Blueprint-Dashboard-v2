import { describe, it, expect } from 'vitest';
import {
  SEEDING_RULES,
  seedExpectedIssue,
  seedTargetSubmit,
} from '../lib/permitSeedingDefaults';

// fix-Phase-B: per-type ACQ Target / Target Submit seeding. Representative
// anchors: GO date 2026-06-01, BP ACQ 2026-12-01.

const GO = '2026-06-01';
const BP = '2026-12-01';
const A = { goDate: GO, bpAcq: BP };

describe('seedExpectedIssue + seedTargetSubmit — the locked table', () => {
  it('Building Permit: no seed for either field (anchor / engine-derived)', () => {
    expect(seedExpectedIssue('Building Permit', A)).toBeNull();
    expect(seedTargetSubmit('Building Permit', A)).toBeNull();
    expect(SEEDING_RULES['Building Permit']).toBeUndefined();
  });

  it('Demolition: ACQ = BP ACQ, no target submit', () => {
    expect(seedExpectedIssue('Demolition', A)).toBe('2026-12-01');
    expect(seedTargetSubmit('Demolition', A)).toBeNull();
  });

  it('IPR: ACQ = BP ACQ, no target submit', () => {
    expect(seedExpectedIssue('IPR', A)).toBe('2026-12-01');
    expect(seedTargetSubmit('IPR', A)).toBeNull();
  });

  it('Grading / Clearing: ACQ = BP ACQ, no target submit', () => {
    expect(seedExpectedIssue('Grading / Clearing', A)).toBe('2026-12-01');
    expect(seedTargetSubmit('Grading / Clearing', A)).toBeNull();
  });

  it('ULS: ACQ = BP ACQ + 120 days, no target submit', () => {
    expect(seedExpectedIssue('ULS', A)).toBe('2027-03-31');
    expect(seedTargetSubmit('ULS', A)).toBeNull();
  });

  it('TRAO: ACQ = BP ACQ, target submit = GO + 3', () => {
    expect(seedExpectedIssue('TRAO', A)).toBe('2026-12-01');
    expect(seedTargetSubmit('TRAO', A)).toBe('2026-06-04');
  });

  it('PAR/Pre-Sub: ACQ = GO + 30, target submit = GO + 3', () => {
    expect(seedExpectedIssue('PAR/Pre-Sub', A)).toBe('2026-07-01');
    expect(seedTargetSubmit('PAR/Pre-Sub', A)).toBe('2026-06-04');
  });

  it('SDOT Tree: ACQ = GO + 30, target submit = GO + 3', () => {
    expect(seedExpectedIssue('SDOT Tree', A)).toBe('2026-07-01');
    expect(seedTargetSubmit('SDOT Tree', A)).toBe('2026-06-04');
  });
});

describe('missing anchors → null', () => {
  it('PAR with no GO date → expected_issue + target_submit null', () => {
    expect(seedExpectedIssue('PAR/Pre-Sub', { goDate: '', bpAcq: BP })).toBeNull();
    expect(seedTargetSubmit('PAR/Pre-Sub', { goDate: '', bpAcq: BP })).toBeNull();
  });

  it('Demolition with no BP ACQ → expected_issue null', () => {
    expect(seedExpectedIssue('Demolition', { goDate: GO, bpAcq: '' })).toBeNull();
  });

  it('treats null/undefined anchors the same as empty', () => {
    expect(seedExpectedIssue('ULS', { goDate: GO, bpAcq: null })).toBeNull();
    expect(seedTargetSubmit('TRAO', {})).toBeNull();
  });
});

describe('types not in the table → both null', () => {
  for (const t of ['ECA Waiver', 'Condo', 'LSM', 'Frobnicator', '']) {
    it(`"${t}" → null / null`, () => {
      expect(seedExpectedIssue(t, A)).toBeNull();
      expect(seedTargetSubmit(t, A)).toBeNull();
    });
  }
});

describe('edge: GO set but BP ACQ empty', () => {
  const E = { goDate: GO, bpAcq: '' };
  it('PAR/SDOT expected_issue is GO-anchored (non-null)', () => {
    expect(seedExpectedIssue('PAR/Pre-Sub', E)).toBe('2026-07-01');
    expect(seedExpectedIssue('SDOT Tree', E)).toBe('2026-07-01');
  });
  it('ULS expected_issue is BP-anchored → null', () => {
    expect(seedExpectedIssue('ULS', E)).toBeNull();
  });
  it('GO-anchored target submits still resolve', () => {
    expect(seedTargetSubmit('PAR/Pre-Sub', E)).toBe('2026-06-04');
    expect(seedTargetSubmit('TRAO', E)).toBe('2026-06-04');
  });
});
