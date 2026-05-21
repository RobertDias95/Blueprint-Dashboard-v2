import { describe, it, expect } from 'vitest';
import { computeCorrRounds } from '../lib/corrRounds';
import type { PermitCycle } from '../lib/database.types';

// fix-40: corr_rounds is engine-derived. These tests lock the canonical client
// mirror (computeCorrRounds) in lockstep with the DB function
// bp_compute_corr_rounds. Buckets mirror the prod-validated blast radius.

type Cyc = Pick<PermitCycle, 'cycle_index' | 'submitted' | 'corr_issued'>;

const cyc = (cycle_index: number, submitted: string | null, corr_issued: string | null): Cyc => ({
  cycle_index,
  submitted,
  corr_issued,
});

describe('computeCorrRounds', () => {
  it('counts closed correction cycles (corr_issued set) at cycle_index >= 1', () => {
    const cycles = [
      cyc(0, '2025-01-01', null), // design placeholder — never counts
      cyc(1, '2025-02-01', '2025-03-01'),
      cyc(2, '2025-03-15', '2025-04-01'),
    ];
    expect(computeCorrRounds(cycles, 'Under Review')).toBe(2);
  });

  it('cycle_index 0 never contributes, even with corr_issued', () => {
    const cycles = [cyc(0, '2025-01-01', '2025-01-15')];
    expect(computeCorrRounds(cycles, 'Under Review')).toBe(0);
  });

  it('terminal / approved permit gets NO +1 even with an open submitted cycle', () => {
    // The final approving submission has submitted set, corr_issued null — but
    // because the status is not a correction status, it must not bump.
    const cycles = [
      cyc(1, '2025-02-01', '2025-03-01'),
      cyc(2, '2025-04-01', null), // approving submission, no corr issued
    ];
    expect(computeCorrRounds(cycles, 'Approved')).toBe(1);
    expect(computeCorrRounds(cycles, 'Issued')).toBe(1);
  });

  it('open submitted round in a correction status adds +1', () => {
    const cycles = [
      cyc(1, '2025-02-01', '2025-03-01'), // closed -> base 1
      cyc(2, '2025-04-01', null), // open submitted round
    ];
    expect(computeCorrRounds(cycles, 'Corrections Required')).toBe(2);
    expect(computeCorrRounds(cycles, 'Awaiting Information')).toBe(2);
    expect(computeCorrRounds(cycles, 'Additional Info Requested')).toBe(2);
  });

  it('status alone does NOT bump without an open submitted review cycle', () => {
    // Correction status, but the only review cycle is already closed (corr
    // issued) — no open submitted round, so no +1. This is the protection that
    // keeps status changes from wrongly flipping the count.
    const cycles = [cyc(1, '2025-02-01', '2025-03-01')];
    expect(computeCorrRounds(cycles, 'Corrections Required')).toBe(1);
  });

  it('correction status with NO review cycles at all stays at 0', () => {
    const cycles = [cyc(0, '2025-01-01', null)];
    expect(computeCorrRounds(cycles, 'Corrections Required')).toBe(0);
  });

  it('same-day corr_issued == submitted counts as a closed corr cycle', () => {
    const cycles = [cyc(1, '2025-02-01', '2025-02-01')];
    expect(computeCorrRounds(cycles, 'Under Review')).toBe(1);
  });

  it('new permit with hand-entered cycles derives the base count', () => {
    // No Socrata, hand-entered review cycles, non-correction status -> base only.
    const cycles = [
      cyc(0, '2025-01-01', null),
      cyc(1, '2025-02-01', '2025-03-01'),
      cyc(2, '2025-03-10', '2025-04-01'),
      cyc(3, '2025-04-10', '2025-05-01'),
    ];
    expect(computeCorrRounds(cycles, 'Under Review')).toBe(3);
  });

  it('Bellevue / no-Socrata permit derives from cycles like any jurisdiction', () => {
    // The formula is jurisdiction-agnostic: same cycles -> same result whether
    // Seattle (Socrata) or Bellevue (never wrote corr_rounds before fix-40).
    const cycles = [
      cyc(1, '2025-02-01', '2025-03-01'),
      cyc(2, '2025-03-15', null), // currently out for correction
    ];
    expect(computeCorrRounds(cycles, 'Corrections Required')).toBe(2);
    // Same cycles, but not yet flagged in a correction status -> just the base.
    expect(computeCorrRounds(cycles, 'Under Review')).toBe(1);
  });

  it('empty cycle list -> 0 for any status', () => {
    expect(computeCorrRounds([], 'Under Review')).toBe(0);
    expect(computeCorrRounds([], 'Corrections Required')).toBe(0);
    expect(computeCorrRounds([], null)).toBe(0);
  });

  it('null status never bumps', () => {
    const cycles = [cyc(1, '2025-04-01', null)];
    expect(computeCorrRounds(cycles, null)).toBe(0);
  });
});
