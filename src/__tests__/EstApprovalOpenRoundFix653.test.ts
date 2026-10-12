import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import type { LearnedEstimate } from '../lib/scheduleBenchmarks';
import { SCHEDULE_DEFAULTS } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-653 (P-340) — "Est. approval" reads the OPEN round's city date,
//     never a closed round's: the same rule as fix-651's board.
// ===========================================================================

const TODAY = '2026-10-12';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1, project_id: 'p1', type: 'Building Permit', approval_date: null, actual_issue: null,
    target_submit: null, extras: null, ...over,
  } as unknown as Permit;
}
function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${over.cycle_index}`, permit_id: 1, submitted: null, city_target: null, corr_issued: null,
    resubmitted: null, intake_accepted: null, created_at: '', updated_at: '', ...over,
  } as PermitCycle;
}
function learned(mostLikelyCycle: number): LearnedEstimate {
  return {
    source: 'test', sampleCount: 5, dateRange: '', goToSubmit: null, avgIntakeToApproval: null,
    cityReview1: 30, corrResponse1: 21, cityReview2: 30, corrResponse2: 21,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3, corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4, corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 5, cr2Count: 5, cr3Count: 0, cr4Count: 0, co1Count: 5, co2Count: 5, co3Count: 0, co4Count: 0,
    avgCycles: mostLikelyCycle, mostLikelyCycle, cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false, isCrossJuris: false, recencyTier: 'last_180d' as const,
  } as LearnedEstimate;
}
const project = (cycles: PermitCycle[], ml: number, p: Partial<Permit> = {}) =>
  computeProjectedApproval({ permit: permit(p), cycles, learnedEstimate: learned(ml) });

/** The same cycles with every city_target on a CLOSED round removed. */
const withoutClosedTargets = (cycles: PermitCycle[]) => {
  const open = Math.max(...cycles.map((c) => c.cycle_index));
  return cycles.map((c) => (c.cycle_index === open ? c : { ...c, city_target: null }));
};

// 10431 SE 19th St, BP 26 110228 BS (permit 253) — prod, 2026-10-12.
const C10431 = [
  cyc({ cycle_index: 1, submitted: '2026-05-01', city_target: '2026-06-05', corr_issued: '2026-06-03', resubmitted: '2026-07-21' }),
  cyc({ cycle_index: 2, submitted: '2026-07-21', city_target: '2026-08-05', corr_issued: '2026-08-14', resubmitted: '2026-08-26' }),
  cyc({ cycle_index: 3, submitted: '2026-08-26', corr_issued: '2026-09-10', resubmitted: '2026-09-29' }),
  cyc({ cycle_index: 4, submitted: '2026-09-29' }),
];

// 8256 Ashworth Ave N, SIP (permit 10305) — prod, 2026-10-12. The walk reads
// cycles 1–4; the open round is cycle 6.
const C10305 = [
  cyc({ cycle_index: 1, submitted: '2025-11-14', city_target: '2025-11-18', corr_issued: '2025-12-17', resubmitted: '2025-12-22' }),
  cyc({ cycle_index: 2, submitted: '2025-12-22', city_target: '2026-06-18', resubmitted: '2026-02-06' }),
  cyc({ cycle_index: 3, submitted: '2026-02-06', city_target: '2026-03-17', corr_issued: '2026-03-12', resubmitted: '2026-03-24' }),
  cyc({ cycle_index: 4, submitted: '2026-03-24', city_target: '2026-04-15', corr_issued: '2026-04-10', resubmitted: '2026-05-18' }),
  cyc({ cycle_index: 5, submitted: '2026-05-18', city_target: '2026-06-23', corr_issued: '2026-06-18', resubmitted: '2026-08-06' }),
  cyc({ cycle_index: 6, submitted: '2026-08-06', city_target: '2026-09-19', corr_issued: '2026-09-14' }),
];

describe('fix-653: a closed round never stands in for the open one', () => {
  it("10431's shape: the closed 08-05 does not anchor the estimate", () => {
    for (const ml of [4, 5]) {
      const r = project(C10431, ml);
      expect(r.projection).toBe(project(withoutClosedTargets(C10431), ml).projection);
      expect(JSON.stringify(r)).not.toContain('2026-08-05');
    }
  });

  it('a closed cycle-1 with no corrections date no longer borrows a later cycle’s target', () => {
    // Cycle 1 closed (resubmitted) without a corr_issued; cycle 2 closed with a
    // city_target; cycle 3 open and undated. v1's shortcut took 2026-09-01 as
    // round 1's end and called the city late.
    const cycles = [
      cyc({ cycle_index: 1, submitted: '2026-05-01', resubmitted: '2026-06-15' }),
      cyc({ cycle_index: 2, submitted: '2026-06-15', city_target: '2026-09-01', corr_issued: '2026-09-05', resubmitted: '2026-09-20' }),
      cyc({ cycle_index: 3, submitted: '2026-09-20' }),
    ];
    const r = project(cycles, 4);
    expect(r.rounds?.corrIssued1).not.toBe('2026-09-01');
    expect(r.routeFacts?.reanchors ?? []).toEqual([]);
    expect(r.projection).toBe(project(withoutClosedTargets(cycles), 4).projection);
  });

  it('8256 Ashworth (open cycle 6): the closed cycle 4’s 04-15 is not the current review’s end', () => {
    const r = project(C10305, 4);
    // Old: cycle 4's city_target, floored to today, + 7 → 10-19. New: learned.
    expect(r.projection).not.toBe('2026-10-19');
    expect(r.projection).toBe(project(withoutClosedTargets(C10305), 4).projection);
  });
});

describe('fix-653: the open round’s own date still counts', () => {
  it('cycle 1 open with its own city_target → round 1 ends on it', () => {
    const r = project([cyc({ cycle_index: 1, submitted: '2026-09-01', city_target: '2026-11-02' })], 2);
    expect(r.rounds?.corrIssued1).toBe('2026-11-02');
  });

  it('the open final round with its own future city_target → approval is that + 7', () => {
    const cycles = [
      cyc({ cycle_index: 1, submitted: '2026-05-01', corr_issued: '2026-06-03', resubmitted: '2026-07-21' }),
      cyc({ cycle_index: 2, submitted: '2026-07-21', city_target: '2026-11-02' }),
    ];
    expect(project(cycles, 2).projection).toBe('2026-11-09');
  });

  it('closed rounds’ ACTUAL corrections and resubmittals are unchanged', () => {
    const r = project(C10431, 5);
    expect(r.rounds).toMatchObject({
      corrIssued1: '2026-06-03', resubmitted1: '2026-07-21',
      corrIssued2: '2026-08-14', resubmitted2: '2026-08-26',
      corrIssued3: '2026-09-10', resubmitted3: '2026-09-29',
    });
  });
});

describe('fix-653: the ULS sibling-BP anchor', () => {
  it("reads the BP's city_target only when that cycle is the BP's open round", () => {
    const bp = permit({ id: 2, type: 'Building Permit' });
    const uls = permit({ id: 3, type: 'ULS' });
    const bpCycles = [
      cyc({ cycle_index: 1, permit_id: 2, submitted: '2026-05-01', city_target: '2026-06-01' }),
      cyc({ cycle_index: 2, permit_id: 2, submitted: '2026-08-01' }),
    ];
    const run = (cycles: PermitCycle[]) =>
      computeProjectedApproval({
        permit: uls, cycles: [], learnedEstimate: null,
        siblingPermits: [bp, uls],
        siblingCyclesByPermitId: new Map([[2, cycles]]),
        siblingLearnedByPermitId: new Map(),
      }).ulsAnchors?.cy1Resub;
    expect(run(bpCycles)).toBe(run(withoutClosedTargets(bpCycles)));
    // The BP's open cycle 1 with a date still drives it.
    // The BP's open cycle 1 with a date still drives it: floored to today, plus
    // the default turnaround.
    const d = new Date(`${TODAY}T12:00:00`);
    d.setDate(d.getDate() + SCHEDULE_DEFAULTS.corrResponse1);
    expect(run([bpCycles[0]!])).toBe(d.toISOString().slice(0, 10));
  });
});
