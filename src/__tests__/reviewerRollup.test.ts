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
