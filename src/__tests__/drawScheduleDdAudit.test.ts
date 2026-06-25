import { describe, it, expect } from 'vitest';
import {
  primaryBp,
  unifyBpDdWindow,
  mondayOf,
  findDrawScheduleDdMismatches,
  redesignPermitDd,
  type AuditPermit,
  type DrawBlock,
} from '../lib/drawScheduleDdAudit';

// fix-208: regression guard mirroring the holistic-DD SQL (enforcement in
// bp_create_project_with_permits + detector bp_draw_schedule_dd_mismatches).

function bp(
  id: number,
  ddStart: string | null,
  ddEnd: string | null,
  parentPermitId: number | null = null,
  type = 'Building Permit',
): AuditPermit {
  return { id, type, parentPermitId, ddStart, ddEnd };
}

describe('primaryBp', () => {
  it('is the lowest-id NON-SUB Building Permit', () => {
    const permits = [
      bp(3, '2026-01-05', '2026-02-02'),
      bp(1, '2026-03-02', '2026-03-30'),
      bp(2, '2026-04-06', '2026-05-04'),
    ];
    expect(primaryBp(permits)?.id).toBe(1);
  });

  it('skips sub-permits when picking the anchor (even if lower id)', () => {
    const permits = [
      bp(1, '2099-09-07', '2099-10-05', 5), // sub-permit (parent set) — ignored
      bp(2, '2026-01-05', '2026-02-02'), // first non-sub BP → primary
    ];
    expect(primaryBp(permits)?.id).toBe(2);
  });

  it('ignores non-Building-Permit types and returns null when no non-sub BP', () => {
    expect(primaryBp([bp(1, '2026-01-05', '2026-02-02', null, 'Demolition')])).toBeNull();
    expect(primaryBp([bp(1, '2026-01-05', '2026-02-02', 9)])).toBeNull();
  });
});

describe('unifyBpDdWindow (create-path enforcement mirror)', () => {
  it('snaps every non-sub BP to the primary BP window; leaves sub-permits + non-BPs alone', () => {
    const permits = [
      bp(1, '2026-01-05', '2026-02-02'), // primary
      bp(2, '2026-03-02', '2026-03-30'), // divergent BP → unified
      bp(3, null, null), // BP with no window → unified
      bp(4, '2099-09-07', '2099-10-05', 1), // sub-permit BP → untouched
      bp(5, '2026-07-06', '2026-08-03', null, 'Demolition'), // non-BP → untouched
    ];
    const out = unifyBpDdWindow(permits);
    const byId = new Map(out.map((p) => [p.id, p]));
    // All three non-sub BPs share the primary window.
    for (const id of [1, 2, 3]) {
      expect(byId.get(id)!.ddStart).toBe('2026-01-05');
      expect(byId.get(id)!.ddEnd).toBe('2026-02-02');
    }
    // Exactly one distinct dd_start across non-sub BPs after unify.
    const distinct = new Set(
      out.filter((p) => p.type === 'Building Permit' && p.parentPermitId == null).map((p) => p.ddStart),
    );
    expect(distinct.size).toBe(1);
    // Sub-permit + Demolition untouched.
    expect(byId.get(4)!.ddStart).toBe('2099-09-07');
    expect(byId.get(5)!.ddStart).toBe('2026-07-06');
  });

  it('no non-sub BP → returns the list unchanged', () => {
    const permits = [bp(1, '2026-01-05', '2026-02-02', null, 'Demolition')];
    expect(unifyBpDdWindow(permits)).toEqual(permits);
  });
});

describe('mondayOf', () => {
  it('returns the Monday of the ISO week (Postgres date_trunc week)', () => {
    expect(mondayOf('2026-01-05')).toBe('2026-01-05'); // a Monday
    expect(mondayOf('2026-01-08')).toBe('2026-01-05'); // Thu → same Monday
    expect(mondayOf('2026-01-11')).toBe('2026-01-05'); // Sun → same Monday
    expect(mondayOf('2026-01-12')).toBe('2026-01-12'); // next Monday
  });
});

describe('findDrawScheduleDdMismatches (detector RPC mirror)', () => {
  const blocks: DrawBlock[] = [
    { projectId: 'clean', address: 'Clean St', da: 'Trevor', startWeek: '2026-01-05', endWeek: '2026-02-02' },
    { projectId: 'divergent', address: '10431 SE 19th', da: 'Miles', startWeek: '2026-01-05', endWeek: '2026-02-02' },
    { projectId: 'offweek', address: '621 Daley', da: 'Bobby', startWeek: '2026-02-09', endWeek: '2026-03-09' },
    { projectId: 'nodd', address: 'No DD Ct', da: 'Lindsay', startWeek: '2026-01-05', endWeek: '2026-02-02' },
  ];
  const permitsByProject = new Map<string, AuditPermit[]>([
    // Clean: single BP, block on its Monday → not flagged.
    ['clean', [bp(1, '2026-01-05', '2026-02-02')]],
    // Divergent: two non-sub BPs with distinct dd_start → flagged (distinct>1).
    ['divergent', [bp(1, '2026-01-05', '2026-02-02'), bp(2, '2026-03-02', '2026-03-30')]],
    // Off-week: one BP, but the block start_week ≠ Monday of its dd_start.
    ['offweek', [bp(1, '2026-01-05', '2026-02-02')]],
    // No DD: primary BP has null dd_start → skipped entirely.
    ['nodd', [bp(1, null, null)]],
  ]);

  it('flags a project whose non-sub BPs diverge (distinct dd_start > 1)', () => {
    const out = findDrawScheduleDdMismatches(blocks, permitsByProject);
    const div = out.find((m) => m.projectId === 'divergent');
    expect(div).toBeTruthy();
    expect(div!.distinctDdStarts).toBe(2);
    expect(div!.bpCount).toBe(2);
    expect(div!.primaryDdStart).toBe('2026-01-05');
    expect(div!.expectedStartWeek).toBe('2026-01-05');
  });

  it('flags a block pinned off its primary DD Monday', () => {
    const out = findDrawScheduleDdMismatches(blocks, permitsByProject);
    const off = out.find((m) => m.projectId === 'offweek');
    expect(off).toBeTruthy();
    expect(off!.startWeek).toBe('2026-02-09');
    expect(off!.expectedStartWeek).toBe('2026-01-05');
  });

  it('passes a clean project and skips one with no primary dd_start', () => {
    const out = findDrawScheduleDdMismatches(blocks, permitsByProject);
    const ids = out.map((m) => m.projectId);
    expect(ids).not.toContain('clean');
    expect(ids).not.toContain('nodd');
    // Only the two genuine offenders surface.
    expect(ids.sort()).toEqual(['divergent', 'offweek']);
  });
});

// fix-210: the redesign create writes the DD window to the PERMIT (not just the
// block). Mirror of the bp_create_project_with_permits redesign step.
describe('redesignPermitDd', () => {
  it('permit window = block window: dd_start snapped forward to Monday, dd_end raw', () => {
    // 2026-01-19 is a Monday → snap_to_monday_forward is a no-op (= block dd_start).
    const out = redesignPermitDd({ dd_start: '2026-01-19', dd_end: '2026-01-23' });
    expect(out.ddStart).toBe('2026-01-19');
    expect(out.ddEnd).toBe('2026-01-23');
  });

  it('snaps a mid-week dd_start FORWARD to the next Monday', () => {
    // 2026-01-21 is a Wednesday → next Monday is 2026-01-26.
    const out = redesignPermitDd({ dd_start: '2026-01-21', dd_end: '2026-01-30' });
    expect(out.ddStart).toBe('2026-01-26');
    expect(out.ddEnd).toBe('2026-01-30');
  });

  it('target_submit fallback = dd_end + 21 (engine then overwrites with the canonical offset)', () => {
    const out = redesignPermitDd({ dd_start: '2026-01-19', dd_end: '2026-01-23' });
    expect(out.targetSubmitFallback).toBe('2026-02-13'); // 1/23 + 21
  });
});
