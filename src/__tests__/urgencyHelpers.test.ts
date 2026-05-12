import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  businessDaysSince,
  businessDaysUntil,
  cardUrgency,
  permitUrgency,
} from '../lib/urgencyHelpers';
import type { Permit, PermitCycle } from '../lib/database.types';

// Q9.5.c: urgency helpers ported from v1 (index.html:2520-2577). Fixed
// today = 2026-05-13 (Wed) — gives deterministic business-day math
// across all stage cases. Mon = 2026-05-11.

const FIXED_TODAY = new Date(2026, 4, 13, 9, 0, 0); // Wed 2026-05-13 morning

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
});
afterEach(() => {
  vi.useRealTimers();
});

function makePermit(p: Partial<Permit>): Permit {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: null,
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    go_date: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    units: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    zone: null,
    product_type: null,
    project_tags: null,
    unit_types: null,
    parking_type: null,
    parking_stalls: null,
    lot_width: null,
    lot_depth: null,
    alley: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-13T00:00:00Z',
    ...p,
  } as Permit;
}

function makeCycle(c: Partial<PermitCycle>): PermitCycle {
  return {
    id: 'c-1',
    permit_id: 1,
    cycle_index: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...c,
  };
}

describe('businessDaysUntil', () => {
  it('returns null for missing / unparseable dates', () => {
    expect(businessDaysUntil(null)).toBeNull();
    expect(businessDaysUntil(undefined)).toBeNull();
    expect(businessDaysUntil('')).toBeNull();
    expect(businessDaysUntil('not-a-date')).toBeNull();
  });

  it('returns 0 when target is today', () => {
    expect(businessDaysUntil('2026-05-13')).toBe(0);
  });

  it('counts business days forward, skipping weekends', () => {
    // Wed 5/13 → Mon 5/18 spans Thu/Fri/Mon = 3 business days
    expect(businessDaysUntil('2026-05-18')).toBe(3);
    // Wed 5/13 → Wed 5/20 = 5 business days (Thu/Fri/Mon/Tue/Wed)
    expect(businessDaysUntil('2026-05-20')).toBe(5);
  });

  it('returns negative count when target is in the past', () => {
    // Mon 5/11 → Wed 5/13 = 2 days forward, so until = -2
    expect(businessDaysUntil('2026-05-11')).toBe(-2);
  });

  it('handles a target landing on Saturday — counts to the date, not past it', () => {
    // Wed 5/13 → Sat 5/16 = Thu/Fri = 2 BDs (Sat itself isn't counted)
    expect(businessDaysUntil('2026-05-16')).toBe(2);
  });
});

describe('businessDaysSince', () => {
  it('returns null for missing dates', () => {
    expect(businessDaysSince(null)).toBeNull();
    expect(businessDaysSince('')).toBeNull();
  });

  it('returns 0 when the date is today', () => {
    expect(businessDaysSince('2026-05-13')).toBe(0);
  });

  it('counts forward from past dates, skipping weekends', () => {
    // Mon 5/11 to Wed 5/13 = 2 BDs (Tue + Wed)
    expect(businessDaysSince('2026-05-11')).toBe(2);
    // Mon 5/4 to Wed 5/13 = 7 BDs (5/5,5/6,5/7,5/8,5/11,5/12,5/13)
    expect(businessDaysSince('2026-05-04')).toBe(7);
  });

  it('returns negative when the date is in the future', () => {
    expect(businessDaysSince('2026-05-15')).toBe(-2); // Wed → Fri = 2
  });
});

describe('permitUrgency (de stage)', () => {
  it('ok when target_submit missing', () => {
    const p = makePermit({ target_submit: null });
    expect(permitUrgency(p, [], 'de')).toBe('ok');
  });
  it('red when target_submit is in the past', () => {
    const p = makePermit({ target_submit: '2026-05-11' }); // 2 BD ago
    expect(permitUrgency(p, [], 'de')).toBe('red');
  });
  it('yellow when target_submit within 5 BDs', () => {
    const p = makePermit({ target_submit: '2026-05-18' }); // +3 BD
    expect(permitUrgency(p, [], 'de')).toBe('yellow');
  });
  it('yellow at exactly 5 BDs (boundary)', () => {
    const p = makePermit({ target_submit: '2026-05-20' }); // +5 BD
    expect(permitUrgency(p, [], 'de')).toBe('yellow');
  });
  it('ok at 6 BDs (just past boundary)', () => {
    const p = makePermit({ target_submit: '2026-05-21' }); // +6 BD
    expect(permitUrgency(p, [], 'de')).toBe('ok');
  });
});

describe('permitUrgency (pm stage)', () => {
  it('uses latest city_target across cycles', () => {
    const p = makePermit({});
    const cycles = [
      makeCycle({ cycle_index: 1, city_target: '2026-05-11' }), // older, past
      makeCycle({ cycle_index: 2, city_target: '2026-05-20' }), // latest, +5 BD
    ];
    // Latest is 5/20 → yellow, not red even though older one is past.
    expect(permitUrgency(p, cycles, 'pm')).toBe('yellow');
  });
  it('ok when no cycles have city_target', () => {
    const p = makePermit({});
    expect(permitUrgency(p, [makeCycle({})], 'pm')).toBe('ok');
  });
  it('red when latest city_target is past', () => {
    const p = makePermit({});
    const cycles = [makeCycle({ city_target: '2026-05-08' })]; // past
    expect(permitUrgency(p, cycles, 'pm')).toBe('red');
  });
});

describe('permitUrgency (co stage)', () => {
  it('prefers the open corr_issued (no resubmitted)', () => {
    const p = makePermit({});
    const cycles = [
      makeCycle({
        cycle_index: 1,
        corr_issued: '2026-05-01',
        resubmitted: '2026-05-05',
      }), // closed
      makeCycle({
        cycle_index: 2,
        corr_issued: '2026-05-11',
        resubmitted: null,
      }), // open, 2 BD ago
    ];
    expect(permitUrgency(p, cycles, 'co')).toBe('ok'); // 2 BDs < 5
  });
  it('yellow at 5 BDs since open corr_issued', () => {
    const p = makePermit({});
    const cycles = [
      makeCycle({ corr_issued: '2026-05-06', resubmitted: null }), // 5 BD ago
    ];
    expect(permitUrgency(p, cycles, 'co')).toBe('yellow');
  });
  it('red at 10 BDs since open corr_issued', () => {
    const p = makePermit({});
    const cycles = [
      makeCycle({ corr_issued: '2026-04-29', resubmitted: null }), // 10 BD ago
    ];
    expect(permitUrgency(p, cycles, 'co')).toBe('red');
  });
  it('falls back to latest closed corr if no open one', () => {
    const p = makePermit({});
    const cycles = [
      makeCycle({
        cycle_index: 1,
        corr_issued: '2026-04-29', // 10 BD ago
        resubmitted: '2026-05-04',
      }),
    ];
    // Closed, but still measured against the corr_issued date.
    expect(permitUrgency(p, cycles, 'co')).toBe('red');
  });
});

describe('permitUrgency (ap stage)', () => {
  it('never red, only yellow at ≥20 BDs since approval', () => {
    // 20 BDs back from 2026-05-13 = ~ 2026-04-15 (Wed)
    const recent = makePermit({ approval_date: '2026-05-01' }); // 8 BD ago
    expect(permitUrgency(recent, [], 'ap')).toBe('ok');
    const stuck = makePermit({ approval_date: '2026-04-13' }); // ~22 BD ago
    expect(permitUrgency(stuck, [], 'ap')).toBe('yellow');
  });
  it('ok when approval_date missing', () => {
    const p = makePermit({ approval_date: null });
    expect(permitUrgency(p, [], 'ap')).toBe('ok');
  });
});

describe('permitUrgency (is stage)', () => {
  it('always ok regardless of dates', () => {
    const p = makePermit({
      actual_issue: '2026-05-01',
      approval_date: '2026-04-01', // stale
    });
    expect(permitUrgency(p, [], 'is')).toBe('ok');
  });
});

describe('cardUrgency', () => {
  it('returns worst level across the group', () => {
    const p1 = makePermit({ id: 1, target_submit: '2026-05-21' }); // ok
    const p2 = makePermit({ id: 2, target_submit: '2026-05-11' }); // red
    const p3 = makePermit({ id: 3, target_submit: '2026-05-18' }); // yellow
    expect(
      cardUrgency(
        [
          { permit: p1, cycles: [] },
          { permit: p2, cycles: [] },
          { permit: p3, cycles: [] },
        ],
        'de',
      ),
    ).toBe('red');
  });
  it('returns yellow when no red but some yellow', () => {
    const p1 = makePermit({ id: 1, target_submit: '2026-05-21' }); // ok
    const p2 = makePermit({ id: 2, target_submit: '2026-05-18' }); // yellow
    expect(
      cardUrgency(
        [
          { permit: p1, cycles: [] },
          { permit: p2, cycles: [] },
        ],
        'de',
      ),
    ).toBe('yellow');
  });
  it('returns ok for empty group', () => {
    expect(cardUrgency([], 'de')).toBe('ok');
  });
});
