import { describe, it, expect } from 'vitest';
import {
  getWeekLabel,
  getWeekMondayKey,
  groupByWeek,
  intakeStatus,
  isPermitSubmitted,
  isUrgent,
  partitionIntakes,
  searchIntakes,
  subtractBusinessDays,
  weekCountTone,
} from '../lib/intakeHelpers';
import type { IntakeRecord, PermitWithCycles } from '../lib/database.types';

// Q6.3.b: pure-helper tests for the intake tracker. Date math is the
// trickiest part — business-day arithmetic, week-of-Monday math, and the
// urgency window all need pinned cases.

function makeIntake(over: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    id: 1,
    project_id: null,
    permit_id: null,
    address: '500 Pike St',
    permit_num: 'BP-001',
    permit_type: 'Building Permit',
    intake_date: '2026-05-15',
    is_placeholder: false,
    portal_url: null,
    link: null,
    updated_at: '2026-05-11T12:00:00Z',
    ...over,
  };
}

function makePermit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
    stage: 'de',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-11T12:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

describe('subtractBusinessDays', () => {
  it('Monday minus 1 = previous Friday (skips weekend)', () => {
    const mon = new Date(2026, 4, 11); // 2026-05-11 is Monday
    expect(subtractBusinessDays(mon, 1)).toBe('2026-05-08');
  });

  it('Wednesday minus 5 = previous Wednesday (skips one weekend)', () => {
    const wed = new Date(2026, 4, 13); // 2026-05-13 is Wednesday
    expect(subtractBusinessDays(wed, 5)).toBe('2026-05-06');
  });

  it('Monday minus 10 = two weeks earlier on Monday', () => {
    const mon = new Date(2026, 4, 11);
    expect(subtractBusinessDays(mon, 10)).toBe('2026-04-27');
  });

  it('0 days returns the same date (truncated to midnight)', () => {
    const wed = new Date(2026, 4, 13);
    expect(subtractBusinessDays(wed, 0)).toBe('2026-05-13');
  });
});

describe('getWeekMondayKey', () => {
  it('Wednesday → previous Monday', () => {
    expect(getWeekMondayKey('2026-05-13')).toBe('2026-05-11');
  });

  it('Monday → same Monday', () => {
    expect(getWeekMondayKey('2026-05-11')).toBe('2026-05-11');
  });

  it('Sunday → previous Monday (not forward to next)', () => {
    expect(getWeekMondayKey('2026-05-17')).toBe('2026-05-11');
  });
});

describe('getWeekLabel', () => {
  it('same-month week renders as "Week of May 11 – 15"', () => {
    expect(getWeekLabel('2026-05-11')).toBe('Week of May 11 – 15');
  });

  it('cross-month week includes both months', () => {
    // 2026-06-29 Monday → Friday 2026-07-03.
    expect(getWeekLabel('2026-06-29')).toBe('Week of Jun 29 – Jul 3');
  });
});

describe('partitionIntakes', () => {
  const today = new Date(2026, 4, 11); // 2026-05-11 Monday

  it('puts dated intakes < today within 10 business days into past', () => {
    const records = [
      makeIntake({ id: 1, intake_date: '2026-05-08' }), // Fri, in past window
      makeIntake({ id: 2, intake_date: '2026-04-24' }), // outside 10-biz-day cutoff
    ];
    const { past } = partitionIntakes(records, today);
    expect(past.map((r) => r.id)).toEqual([1]);
  });

  it('puts intakes >= today + undated into future, sorted earliest first', () => {
    const records = [
      makeIntake({ id: 1, intake_date: '2026-05-15' }),
      makeIntake({ id: 2, intake_date: '2026-05-11' }), // today
      makeIntake({ id: 3, intake_date: null }), // undated → future
    ];
    const { future } = partitionIntakes(records, today);
    expect(future.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it('records strictly before the cutoff are excluded entirely', () => {
    const records = [
      makeIntake({ id: 1, intake_date: '2026-03-01' }),
    ];
    const { past, future } = partitionIntakes(records, today);
    expect(past).toEqual([]);
    expect(future).toEqual([]);
  });
});

describe('groupByWeek', () => {
  it('groups records by Monday of their intake_date', () => {
    const records = [
      makeIntake({ id: 1, intake_date: '2026-05-13' }), // Wed of W2026-05-11
      makeIntake({ id: 2, intake_date: '2026-05-11' }), // Mon of W2026-05-11
      makeIntake({ id: 3, intake_date: '2026-05-22' }), // Fri of W2026-05-18
    ];
    const groups = groupByWeek(records);
    expect(groups.map((g) => g.key)).toEqual(['2026-05-11', '2026-05-18']);
    expect(groups[0].records.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(groups[1].records.map((r) => r.id)).toEqual([3]);
  });

  it('undated records land in an "Unscheduled" group ordered last', () => {
    const records = [
      makeIntake({ id: 1, intake_date: null }),
      makeIntake({ id: 2, intake_date: '2026-05-11' }),
    ];
    const groups = groupByWeek(records);
    expect(groups.map((g) => g.key)).toEqual(['2026-05-11', 'unscheduled']);
    expect(groups[1].label).toBe('Unscheduled');
  });
});

describe('isPermitSubmitted', () => {
  it('returns false for null permit', () => {
    expect(isPermitSubmitted(null)).toBe(false);
    expect(isPermitSubmitted(undefined)).toBe(false);
  });

  it('returns true when cycle 1 has a submitted date', () => {
    const permit = makePermit({
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 1,
          submitted: '2026-05-10',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    });
    expect(isPermitSubmitted(permit)).toBe(true);
  });

  it('returns true when cycle 2 has submitted but cycle 1 does not (resubmit case)', () => {
    const permit = makePermit({
      permit_cycles: [
        {
          id: 'c1',
          permit_id: 1,
          cycle_index: 1,
          submitted: null,
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 'c2',
          permit_id: 1,
          cycle_index: 2,
          submitted: '2026-05-10',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-05T00:00:00Z',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    });
    expect(isPermitSubmitted(permit)).toBe(true);
  });

  it('returns false when no cycle has submitted', () => {
    const permit = makePermit({ permit_cycles: [] });
    expect(isPermitSubmitted(permit)).toBe(false);
  });
});

describe('isUrgent', () => {
  const today = new Date(2026, 4, 11); // 2026-05-11

  it('returns true within the 7-day window when not submitted', () => {
    expect(isUrgent('2026-05-13', false, today)).toBe(true);
    expect(isUrgent('2026-05-18', false, today)).toBe(true); // today + 7
  });

  it('returns false when submitted (regardless of date)', () => {
    expect(isUrgent('2026-05-13', true, today)).toBe(false);
  });

  it('returns false past the urgency window', () => {
    expect(isUrgent('2026-05-19', false, today)).toBe(false);
  });

  it('returns false for null intake_date', () => {
    expect(isUrgent(null, false, today)).toBe(false);
  });
});

describe('intakeStatus precedence', () => {
  const today = new Date(2026, 4, 11);
  const submittedPermit = makePermit({
    permit_cycles: [
      {
        id: 'c1',
        permit_id: 1,
        cycle_index: 1,
        submitted: '2026-05-08',
        city_target: null,
        corr_issued: null,
        resubmitted: null,
        intake_accepted: null,
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-08T00:00:00Z',
      },
    ],
  });
  const emptyPermit = makePermit({ permit_cycles: [] });

  it("submitted overrides everything (even if urgent + placeholder)", () => {
    const rec = makeIntake({
      intake_date: '2026-05-12',
      is_placeholder: true,
    });
    expect(intakeStatus(rec, submittedPermit, today)).toBe('submitted');
  });

  it('urgency wins over placeholder when not submitted', () => {
    const rec = makeIntake({
      intake_date: '2026-05-12',
      is_placeholder: true,
    });
    expect(intakeStatus(rec, emptyPermit, today)).toBe('reschedule');
  });

  it('placeholder when not urgent and not submitted', () => {
    const rec = makeIntake({
      intake_date: '2026-06-15', // outside urgency window
      is_placeholder: true,
    });
    expect(intakeStatus(rec, emptyPermit, today)).toBe('placeholder');
  });

  it('real is the default state', () => {
    const rec = makeIntake({
      intake_date: '2026-06-15',
      is_placeholder: false,
    });
    expect(intakeStatus(rec, emptyPermit, today)).toBe('real');
  });
});

describe('weekCountTone', () => {
  it('zero → empty', () => {
    expect(weekCountTone(0)).toBe('empty');
  });
  it('1 → light', () => {
    expect(weekCountTone(1)).toBe('light');
  });
  it('2-3 → normal', () => {
    expect(weekCountTone(2)).toBe('normal');
    expect(weekCountTone(3)).toBe('normal');
  });
  it('4+ → heavy', () => {
    expect(weekCountTone(4)).toBe('heavy');
    expect(weekCountTone(10)).toBe('heavy');
  });
});

describe('searchIntakes', () => {
  const records = [
    makeIntake({ id: 1, address: '500 Pike St' }),
    makeIntake({ id: 2, address: '750 Oak Way' }),
    makeIntake({ id: 3, address: null }),
  ];

  it('blank query passes everything', () => {
    expect(searchIntakes(records, '').map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('multi-token match narrows by address (case-insensitive)', () => {
    expect(searchIntakes(records, 'pike').map((r) => r.id)).toEqual([1]);
    expect(searchIntakes(records, 'OAK way').map((r) => r.id)).toEqual([2]);
  });

  it('records with null address are filtered out when query is active', () => {
    expect(searchIntakes(records, 'pike').some((r) => r.id === 3)).toBe(false);
  });
});
