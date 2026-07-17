import { describe, it, expect } from 'vitest';
import {
  computeCardSlots,
  type PermitCardSummary,
} from '../lib/dashboardCardSummary';

// fix-notes-2: the dashboard "waiting on" display rules — at most two slots,
// tasks before notes.

function summary(over: Partial<PermitCardSummary>): PermitCardSummary {
  return { entTask: null, archTask: null, note: null, ...over };
}

describe('computeCardSlots', () => {
  it('only a de (Entitlement) task → one Entitlement slot', () => {
    const slots = computeCardSlots(summary({ entTask: 'Order survey' }));
    expect(slots).toEqual([{ label: 'Entitlement', text: 'Order survey' }]);
  });

  it('only a pm (Architecture) task → one Architecture slot', () => {
    const slots = computeCardSlots(summary({ archTask: 'Redline plans' }));
    expect(slots).toEqual([{ label: 'Architecture', text: 'Redline plans' }]);
  });

  it('both tasks → both slots, Entitlement before Architecture, note ignored', () => {
    const slots = computeCardSlots(
      summary({ entTask: 'Order survey', archTask: 'Redline plans', note: 'ignored' }),
    );
    expect(slots).toEqual([
      { label: 'Entitlement', text: 'Order survey' },
      { label: 'Architecture', text: 'Redline plans' },
    ]);
  });

  it('one task + a note → task first, note fills slot 2', () => {
    const slots = computeCardSlots(
      summary({ entTask: 'Order survey', note: 'Waiting on builder' }),
    );
    expect(slots).toEqual([
      { label: 'Entitlement', text: 'Order survey' },
      { label: 'Note', text: 'Waiting on builder' },
    ]);
  });

  it('a pm task + a note → Architecture first, then Note', () => {
    const slots = computeCardSlots(
      summary({ archTask: 'Redline plans', note: 'Client change request' }),
    );
    expect(slots).toEqual([
      { label: 'Architecture', text: 'Redline plans' },
      { label: 'Note', text: 'Client change request' },
    ]);
  });

  it('no task but a note → one Note slot', () => {
    const slots = computeCardSlots(summary({ note: 'Holding for ECA review' }));
    expect(slots).toEqual([{ label: 'Note', text: 'Holding for ECA review' }]);
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
