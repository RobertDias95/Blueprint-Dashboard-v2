import { describe, expect, it } from 'vitest';
import {
  bucketStatus,
  latestCycleIndex,
  rollupCounts,
  rowsForCycle,
  statusLabel,
} from '../lib/reviewerRollup';
import type {
  PermitCycleReviewer,
  ReviewerStatus,
} from '../lib/database.types';

// fix-31: pure helpers for the Project Overview reviewer rollup. Tests
// pin the bucket mapping and rollup math so future status-vocabulary
// changes can't silently shift the chip counts.

function makeReviewer(
  over: Partial<PermitCycleReviewer> = {},
): PermitCycleReviewer {
  return {
    id: `r-${over.reviewer_name ?? 'X'}-${over.cycle_index ?? 1}`,
    tenant_id: 'tenant-0',
    permit_id: 1,
    cycle_index: 1,
    reviewer_name: 'placeholder',
    discipline: null,
    current_status: 'pending',
    last_event_date: null,
    created_at: '2026-05-19T12:00:00Z',
    updated_at: '2026-05-19T12:00:00Z',
    // Override spread last so caller fields cleanly win + no duplicate
    // keys (TS2783 caught this when Render ran tsc -b strict mode).
    ...over,
  };
}

describe('bucketStatus', () => {
  it('collapses in_process / in_review / assigned into in_review bucket', () => {
    expect(bucketStatus('in_process')).toBe('in_review');
    expect(bucketStatus('in_review')).toBe('in_review');
    expect(bucketStatus('assigned')).toBe('in_review');
  });

  it('keeps approved / corrections / pending / not_required distinct', () => {
    expect(bucketStatus('approved')).toBe('approved');
    expect(bucketStatus('corrections_required')).toBe('corrections');
    expect(bucketStatus('pending')).toBe('pending');
    expect(bucketStatus('not_required')).toBe('not_required');
  });
});

describe('latestCycleIndex', () => {
  it('returns null on empty input', () => {
    expect(latestCycleIndex([])).toBeNull();
  });

  it('picks the highest cycle_index regardless of array order', () => {
    expect(
      latestCycleIndex([
        makeReviewer({ reviewer_name: 'A', current_status: 'approved', cycle_index: 2 }),
        makeReviewer({ reviewer_name: 'B', current_status: 'approved', cycle_index: 1 }),
        makeReviewer({ reviewer_name: 'C', current_status: 'approved', cycle_index: 3 }),
      ]),
    ).toBe(3);
  });
});

describe('rowsForCycle', () => {
  it('filters down to exact cycle_index', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'approved', cycle_index: 1 }),
      makeReviewer({ reviewer_name: 'B', current_status: 'approved', cycle_index: 2 }),
      makeReviewer({ reviewer_name: 'C', current_status: 'approved', cycle_index: 2 }),
    ];
    expect(rowsForCycle(rows, 2).map((r) => r.reviewer_name)).toEqual(['B', 'C']);
  });
});

describe('rollupCounts — Bobby user story', () => {
  it('"9 reviewers · 3 approved · 2 corrections · 4 pending"', () => {
    // Bobby's verbatim example from 2026-05-19: 9 reviewers; 3 approved;
    // 2 corrections; remaining 4 are some mix of in_process / pending /
    // assigned that collectively roll up as 4 in_review + pending.
    const rows: PermitCycleReviewer[] = [
      makeReviewer({ reviewer_name: 'A', current_status: 'approved' }),
      makeReviewer({ reviewer_name: 'B', current_status: 'approved' }),
      makeReviewer({ reviewer_name: 'C', current_status: 'approved' }),
      makeReviewer({ reviewer_name: 'D', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'E', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'F', current_status: 'in_process' }),
      makeReviewer({ reviewer_name: 'G', current_status: 'in_review' }),
      makeReviewer({ reviewer_name: 'H', current_status: 'assigned' }),
      makeReviewer({ reviewer_name: 'I', current_status: 'pending' }),
    ];
    const counts = rollupCounts(rows);
    expect(counts.total).toBe(9);
    expect(counts.approved).toBe(3);
    expect(counts.correctionsRequired).toBe(2);
    // 3 of (F, G, H) collapse to in_review; I stays in pending.
    expect(counts.inReview).toBe(3);
    expect(counts.pending).toBe(1);
    expect(counts.notRequired).toBe(0);
  });

  it('empty input returns zeroes', () => {
    expect(rollupCounts([])).toEqual({
      total: 0,
      approved: 0,
      correctionsRequired: 0,
      inReview: 0,
      pending: 0,
      notRequired: 0,
    });
  });

  it('not_required reviewers count separately (visible distinction)', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'not_required' }),
      makeReviewer({ reviewer_name: 'B', current_status: 'not_required' }),
      makeReviewer({ reviewer_name: 'C', current_status: 'approved' }),
    ];
    const counts = rollupCounts(rows);
    expect(counts.total).toBe(3);
    expect(counts.notRequired).toBe(2);
    expect(counts.approved).toBe(1);
    expect(counts.inReview).toBe(0);
  });
});

describe('rollupCounts with permitStatus override (fix-31b, type-scoped fix-41)', () => {
  // fix-41 (2026-05-21): the terminal-positive override now requires a
  // no-issuance permit type (SDOT Tree / PAR/Pre-Sub / ECA Waiver / ULS).
  // For issuance-bearing types the per-reviewer current_status is real
  // (fix-31g) and must NOT be collapsed to all-approved.
  it('terminal-positive + no-issuance type collapses every reviewer to approved', () => {
    // SDOTTRLA0002310 scenario: Anne-Marie's last per-reviewer event
    // was corrections_required, but the permit's Record Status is
    // "Conceptually Approved" and SDOT Tree never issues — workflow
    // moved past her individual step. All reviewers green, no ⚠ pill.
    const rows = [
      makeReviewer({ reviewer_name: 'Anne-Marie', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'Tom', current_status: 'approved' }),
      makeReviewer({ reviewer_name: 'Jane', current_status: 'in_process' }),
    ];
    const counts = rollupCounts(rows, 'Conceptually Approved', 'SDOT Tree');
    expect(counts.total).toBe(3);
    expect(counts.approved).toBe(3);
    expect(counts.correctionsRequired).toBe(0);
    expect(counts.inReview).toBe(0);
    expect(counts.pending).toBe(0);
    expect(counts.notRequired).toBe(0);
  });

  it('terminal-positive + issuance-bearing type shows REAL counts (fix-41)', () => {
    // Same reviewer mix, but an Issued Building Permit. fix-31g populates
    // real per-reviewer status here, so the override must NOT fire — the
    // chip shows the genuine 1 approved / 1 corrections / 1 in_review.
    const rows = [
      makeReviewer({ reviewer_name: 'Anne-Marie', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'Tom', current_status: 'approved' }),
      makeReviewer({ reviewer_name: 'Jane', current_status: 'in_process' }),
    ];
    const counts = rollupCounts(rows, 'Issued', 'Building Permit');
    expect(counts.total).toBe(3);
    expect(counts.approved).toBe(1);
    expect(counts.correctionsRequired).toBe(1);
    expect(counts.inReview).toBe(1);
  });

  it('terminal-positive but missing permitType does NOT override (issuance-bearing default)', () => {
    // fix-41: unknown/absent type is treated as issuance-bearing — the
    // safer default (show real counts rather than a blanket all-✓).
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'B', current_status: 'approved' }),
    ];
    const counts = rollupCounts(rows, 'Conceptually Approved');
    expect(counts.approved).toBe(1);
    expect(counts.correctionsRequired).toBe(1);
  });

  it('regression 7087866-CN: Issued Building Permit reads 14/8, not 14/14', () => {
    // fix-41 motivating bug. 14 reviewers: 8 approved, 4 assigned,
    // 1 in_process, 1 pending. Pre-fix-41 the Issued status forced all
    // 14 to ✓; now the chip shows the real 8 approved (assigned +
    // in_process collapse to in_review = 5; pending = 1).
    const rows: PermitCycleReviewer[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeReviewer({ reviewer_name: `Approved${i}`, current_status: 'approved' }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeReviewer({ reviewer_name: `Assigned${i}`, current_status: 'assigned' }),
      ),
      makeReviewer({ reviewer_name: 'InProc', current_status: 'in_process' }),
      makeReviewer({ reviewer_name: 'Pend', current_status: 'pending' }),
    ];
    const counts = rollupCounts(rows, 'Issued', 'Building Permit');
    expect(counts.total).toBe(14);
    expect(counts.approved).toBe(8);
    expect(counts.inReview).toBe(5); // 4 assigned + 1 in_process
    expect(counts.pending).toBe(1);
    expect(counts.correctionsRequired).toBe(0);
  });

  it('non-terminal status leaves individual buckets intact (any type)', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
      makeReviewer({ reviewer_name: 'B', current_status: 'approved' }),
    ];
    // Even a no-issuance type doesn't override when status isn't terminal.
    const counts = rollupCounts(rows, 'Reviews In Process', 'SDOT Tree');
    expect(counts.approved).toBe(1);
    expect(counts.correctionsRequired).toBe(1);
  });

  it('null / undefined / empty permitStatus does not override', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
    ];
    expect(rollupCounts(rows, null, 'SDOT Tree').correctionsRequired).toBe(1);
    expect(rollupCounts(rows, undefined, 'SDOT Tree').correctionsRequired).toBe(1);
    expect(rollupCounts(rows, '', 'SDOT Tree').correctionsRequired).toBe(1);
    expect(rollupCounts(rows).correctionsRequired).toBe(1);
  });

  it('every TERMINAL_POSITIVE_STATUSES value triggers the override for a no-issuance type', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
    ];
    for (const status of [
      'Conceptually Approved',
      'Approved',
      'Issued',
      'Completed',
      'Ready for Issuance',
      'Closed',
    ]) {
      const counts = rollupCounts(rows, status, 'PAR/Pre-Sub');
      expect(counts.approved).toBe(1);
      expect(counts.correctionsRequired).toBe(0);
    }
  });

  it('every no-issuance type triggers the override under a terminal-positive status', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
    ];
    for (const type of ['SDOT Tree', 'PAR/Pre-Sub', 'ECA Waiver', 'ULS']) {
      const counts = rollupCounts(rows, 'Issued', type);
      expect(counts.approved).toBe(1);
      expect(counts.correctionsRequired).toBe(0);
    }
  });

  it('whitespace tolerance on permitStatus and permitType (trim before match)', () => {
    const rows = [
      makeReviewer({ reviewer_name: 'A', current_status: 'corrections_required' }),
    ];
    expect(
      rollupCounts(rows, '  Conceptually Approved  ', '  SDOT Tree  ').approved,
    ).toBe(1);
  });
});

describe('statusLabel', () => {
  it('returns a human-readable label for every status', () => {
    const cases: Array<[ReviewerStatus, string]> = [
      ['approved', 'Approved'],
      ['corrections_required', 'Corrections'],
      ['in_process', 'In Process'],
      ['in_review', 'In Review'],
      ['assigned', 'Assigned'],
      ['pending', 'Pending'],
      ['not_required', 'Not Required'],
    ];
    for (const [status, label] of cases) {
      expect(statusLabel(status)).toBe(label);
    }
  });
});
