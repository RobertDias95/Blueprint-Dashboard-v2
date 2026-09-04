import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { SCHEDULE_DEFAULTS, type LearnedEstimate } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle, ProjectHold } from '../lib/database.types';

// fix-262 (PART A): projectedApproval.ts is hold-aware.
//
// fix-170 defined "effect C" — a future projected date is pushed out by the days
// a project has already spent under an ACTIVE hold — and shipped the arithmetic
// in holdOverlap.activeHoldElapsedDays. But the sweep never reached this module:
// the shift lived only in ScheduleEstimator's HeadlineProjection, so the
// draw-schedule block date and Schedule Health's date ignored holds entirely.
// fix-262 moves the shift INTO computeProjectedApproval so every caller agrees.
//
// The invariants pinned here:
//   1. no holds / no ACTIVE hold  → byte-identical to pre-fix-262
//   2. active hold                → projection + (today - hold_start)
//   3. ACTUAL dates never shift (the event already happened)
//   4. a CLOSED hold never shifts (its days are credited by accountableDays;
//      shifting here too would double-count)
//   5. intermediate `rounds` dates do NOT shift — only the headline
//   6. the ULS branch shifts ONCE, not twice (BP anchor recurses into the
//      unshifted core)

function permit(over: Partial<Permit> = {}): Permit {
  return {
    id: 1,
    project_id: 'p1',
    type: 'Building Permit',
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
    ...over,
  };
}

function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return {
    id: `c-${over.cycle_index}`,
    permit_id: 1,
    submitted: null,
    city_target: null,
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

function learned(over: Partial<LearnedEstimate> = {}): LearnedEstimate {
  return {
    source: 'test',
    sampleCount: 5,
    dateRange: '',
    goToSubmit: null,
    avgIntakeToApproval: null,
    cityReview1: SCHEDULE_DEFAULTS.cityReview1,
    corrResponse1: SCHEDULE_DEFAULTS.corrResponse1,
    cityReview2: SCHEDULE_DEFAULTS.cityReview2,
    corrResponse2: SCHEDULE_DEFAULTS.corrResponse2,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3,
    corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4,
    corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 0,
    cr2Count: 0,
    cr3Count: 0,
    cr4Count: 0,
    co1Count: 0,
    co2Count: 0,
    co3Count: 0,
    co4Count: 0,
    avgCycles: 2,
    mostLikelyCycle: 1,
    cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false,
    isCrossJuris: false,
    recencyTier: 'last_180d' as const,
    ...over,
  };
}

function hold(over: Partial<ProjectHold> = {}): ProjectHold {
  return {
    id: 'h1',
    tenant_id: 't1',
    project_id: 'p1',
    reason: 'MHA',
    note: null,
    hold_start: '2026-01-01',
    hold_end: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// Pinned "today" so activeHoldElapsedDays and flooredAnchor are deterministic.
const TODAY = '2026-03-02';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
afterEach(() => {
  vi.useRealTimers();
});

/** A permit whose projection is a plain multi-cycle walk (not the holistic
 *  shortcut), so the shift is easy to reason about. */
function walkInput() {
  return {
    permit: permit(),
    cycles: [cyc({ cycle_index: 1, submitted: '2026-01-10' })],
    learnedEstimate: learned({
      cityReview1: 30,
      cr1Count: 3,
      corrResponse1: 10,
      co1Count: 3,
      cityReview2: 20,
      cr2Count: 3,
    }),
    targetCycleOverride: 2,
  };
}

describe('fix-262: computeProjectedApproval hold-awareness', () => {
  it('no holds → unchanged, and heldShiftDays is 0', () => {
    const base = computeProjectedApproval(walkInput());
    const withEmpty = computeProjectedApproval({ ...walkInput(), holds: [] });
    const withNull = computeProjectedApproval({ ...walkInput(), holds: null });
    expect(base.projection).toBeTruthy();
    expect(withEmpty.projection).toBe(base.projection);
    expect(withNull.projection).toBe(base.projection);
    expect(base.heldShiftDays).toBe(0);
  });

  it('an ACTIVE hold pushes the projection out by (today - hold_start)', () => {
    const base = computeProjectedApproval(walkInput());
    const held = computeProjectedApproval({
      ...walkInput(),
      // 2026-01-01 → 2026-03-02 is 60 days.
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
    });
    expect(held.heldShiftDays).toBe(60);
    const b = new Date(`${base.projection}T12:00:00`).getTime();
    const h = new Date(`${held.projection}T12:00:00`).getTime();
    expect(Math.round((h - b) / 86_400_000)).toBe(60);
  });

  it('a CLOSED hold does NOT shift (its days are credited by accountableDays)', () => {
    const base = computeProjectedApproval(walkInput());
    const closed = computeProjectedApproval({
      ...walkInput(),
      holds: [hold({ hold_start: '2026-01-01', hold_end: '2026-02-01' })],
    });
    expect(closed.projection).toBe(base.projection);
    expect(closed.heldShiftDays).toBe(0);
  });

  it('an ACTUAL approval_date is never shifted', () => {
    const r = computeProjectedApproval({
      ...walkInput(),
      permit: permit({ approval_date: '2026-02-10' }),
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
    });
    expect(r.projection).toBe('2026-02-10');
    expect(r.isActual).toBe(true);
    expect(r.heldShiftDays).toBe(0);
  });

  it('an ACTUAL actual_issue is never shifted', () => {
    const r = computeProjectedApproval({
      ...walkInput(),
      permit: permit({ actual_issue: '2026-02-14' }),
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
    });
    expect(r.projection).toBe('2026-02-14');
    expect(r.isActual).toBe(true);
    expect(r.heldShiftDays).toBe(0);
  });

  it('only the headline shifts — intermediate round dates are untouched', () => {
    const base = computeProjectedApproval(walkInput());
    const held = computeProjectedApproval({
      ...walkInput(),
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
    });
    expect(held.rounds?.corrIssued1).toBe(base.rounds?.corrIssued1);
    expect(held.rounds?.resubmitted1).toBe(base.rounds?.resubmitted1);
    expect(held.projection).not.toBe(base.projection);
  });

  it('the holistic-shortcut branch shifts too', () => {
    const input = {
      permit: permit({ target_submit: '2026-01-10' }),
      cycles: [] as PermitCycle[],
      learnedEstimate: learned({ avgIntakeToApproval: 100 }),
    };
    const base = computeProjectedApproval(input);
    const held = computeProjectedApproval({
      ...input,
      holds: [hold({ hold_start: '2026-02-01', hold_end: null })],
    });
    expect(held.heldShiftDays).toBe(29); // 2026-02-01 → 2026-03-02
    const b = new Date(`${base.projection}T12:00:00`).getTime();
    const h = new Date(`${held.projection}T12:00:00`).getTime();
    expect(Math.round((h - b) / 86_400_000)).toBe(29);
  });

  it('multiple holds use the longest-running ACTIVE one, ignoring closed ones', () => {
    const held = computeProjectedApproval({
      ...walkInput(),
      holds: [
        hold({ id: 'closed', hold_start: '2025-06-01', hold_end: '2025-09-01' }),
        hold({ id: 'open', hold_start: '2026-02-01', hold_end: null }),
      ],
    });
    expect(held.heldShiftDays).toBe(29);
  });

  it('ULS shifts ONCE — the BP anchor recursion must not double-count', () => {
    const bp = permit({ id: 10, type: 'Building Permit', target_submit: '2026-01-05' });
    const uls = permit({ id: 11, type: 'ULS' });
    const bpCycles = [cyc({ cycle_index: 1, submitted: '2026-01-05' })];
    const input = {
      permit: uls,
      cycles: [] as PermitCycle[],
      learnedEstimate: learned({ avgIntakeToApproval: 90 }),
      siblingPermits: [bp, uls],
      siblingCyclesByPermitId: new Map<number, PermitCycle[]>([
        [10, bpCycles],
        [11, []],
      ]),
      siblingLearnedByPermitId: new Map<number, LearnedEstimate | null>([
        [10, learned({ avgIntakeToApproval: 90 })],
        [11, null],
      ]),
    };
    const base = computeProjectedApproval(input);
    const held = computeProjectedApproval({
      ...input,
      holds: [hold({ hold_start: '2026-02-01', hold_end: null })],
    });
    expect(base.targetCycle).toBe(0); // proves we took the ULS branch
    expect(held.heldShiftDays).toBe(29);
    const b = new Date(`${base.projection}T12:00:00`).getTime();
    const h = new Date(`${held.projection}T12:00:00`).getTime();
    // Exactly one shift of 29 days — not 58.
    expect(Math.round((h - b) / 86_400_000)).toBe(29);
  });

  it('a null projection stays null and reports no shift', () => {
    const r = computeProjectedApproval({
      permit: permit(),
      cycles: [],
      learnedEstimate: null,
      // no base anchor at all → projection null
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
    });
    expect(r.projection).toBeNull();
    expect(r.heldShiftDays).toBe(0);
  });

  it('accepts an injected `today` so callers can pin the shift', () => {
    const held = computeProjectedApproval({
      ...walkInput(),
      holds: [hold({ hold_start: '2026-01-01', hold_end: null })],
      today: '2026-01-31',
    });
    expect(held.heldShiftDays).toBe(30);
  });
});
