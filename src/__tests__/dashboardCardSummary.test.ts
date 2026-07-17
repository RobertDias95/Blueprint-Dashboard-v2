import { describe, it, expect } from 'vitest';
import {
  computeCardSlots,
  type PermitCardSummary,
} from '../lib/dashboardCardSummary';

// fix-notes-2/5: the dashboard "waiting on" display rules — at most two
// slots, tasks before notes, grouped by DISCIPLINE (ENT/ARCH; NULL folds to
// ENT server-side) with the NOTE fallback.

function summary(over: Partial<PermitCardSummary>): PermitCardSummary {
  return { entTask: null, archTask: null, note: null, ...over };
}

describe('computeCardSlots', () => {
  it('only an ent-discipline task → one ENT slot', () => {
    const slots = computeCardSlots(summary({ entTask: 'Order survey' }));
    expect(slots).toEqual([{ label: 'ENT', text: 'Order survey' }]);
  });

  it('only an arch-discipline task → one ARCH slot', () => {
    const slots = computeCardSlots(summary({ archTask: 'Redline plans' }));
    expect(slots).toEqual([{ label: 'ARCH', text: 'Redline plans' }]);
  });

  it('both disciplines have a task → both slots, ENT before ARCH, note ignored', () => {
    const slots = computeCardSlots(
      summary({ entTask: 'Order survey', archTask: 'Redline plans', note: 'ignored' }),
    );
    expect(slots).toEqual([
      { label: 'ENT', text: 'Order survey' },
      { label: 'ARCH', text: 'Redline plans' },
    ]);
  });

  it('one task + a note → task first, note fills slot 2', () => {
    const slots = computeCardSlots(
      summary({ entTask: 'Order survey', note: 'Waiting on builder' }),
    );
    expect(slots).toEqual([
      { label: 'ENT', text: 'Order survey' },
      { label: 'NOTE', text: 'Waiting on builder' },
    ]);
  });

  it('an arch task + a note → ARCH first, then NOTE', () => {
    const slots = computeCardSlots(
      summary({ archTask: 'Redline plans', note: 'Client change request' }),
    );
    expect(slots).toEqual([
      { label: 'ARCH', text: 'Redline plans' },
      { label: 'NOTE', text: 'Client change request' },
    ]);
  });

  it('no task but a note → one Note slot', () => {
    const slots = computeCardSlots(summary({ note: 'Holding for ECA review' }));
    expect(slots).toEqual([{ label: 'NOTE', text: 'Holding for ECA review' }]);
  });

  it('nothing → no slots (caller shows "Nothing pending")', () => {
    expect(computeCardSlots(summary({}))).toEqual([]);
  });

  it('null / undefined summary → no slots', () => {
    expect(computeCardSlots(null)).toEqual([]);
    expect(computeCardSlots(undefined)).toEqual([]);
  });

  it('never exceeds two slots', () => {
    const slots = computeCardSlots(
      summary({ entTask: 'a', archTask: 'b', note: 'c' }),
    );
    expect(slots.length).toBeLessThanOrEqual(2);
  });
});
