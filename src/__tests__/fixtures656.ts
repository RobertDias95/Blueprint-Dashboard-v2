import type { Permit, PermitCycle } from '../lib/database.types';
import { SCHEDULE_DEFAULTS, type LearnedEstimate } from '../lib/scheduleBenchmarks';

export const permit = (over: Partial<Permit> = {}): Permit =>
  ({ id: 1, project_id: 'p1', type: 'Building Permit', approval_date: null, actual_issue: null,
    target_submit: null, extras: null, ...over } as unknown as Permit);
export const cyc = (over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle =>
  ({ id: `c-${over.cycle_index}`, permit_id: 1, submitted: null, city_target: null, corr_issued: null,
    resubmitted: null, intake_accepted: null, created_at: '', updated_at: '', ...over } as PermitCycle);
export const learned = (ml: number): LearnedEstimate =>
  ({ source: 'test', sampleCount: 9, dateRange: '', goToSubmit: null, avgIntakeToApproval: null,
    cityReview1: 30, corrResponse1: 21, cityReview2: 25, corrResponse2: 18,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3, corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: 18, corrResponse4: 12,
    cr1Count: 5, cr2Count: 5, cr3Count: 0, cr4Count: 2, co1Count: 5, co2Count: 5, co3Count: 0, co4Count: 2,
    avgCycles: ml, mostLikelyCycle: ml, cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false, isCrossJuris: false, recencyTier: 'last_180d' } as LearnedEstimate);

/** ≤4-round fixtures whose outputs were pinned from the pre-fix-656 code. */
export const FIX: { name: string; input: Record<string, unknown> }[] = [
  { name: 'one round, in review', input: { permit: permit(), cycles: [cyc({ cycle_index: 1, submitted: '2026-09-01' })], learnedEstimate: learned(2) } },
  { name: 'open round 2 with a city date', input: { permit: permit(), cycles: [
    cyc({ cycle_index: 1, submitted: '2026-05-01', corr_issued: '2026-06-03', resubmitted: '2026-07-21' }),
    cyc({ cycle_index: 2, submitted: '2026-07-21', city_target: '2026-11-02' })], learnedEstimate: learned(3) } },
  { name: '10431 shape, 4 rounds', input: { permit: permit(), cycles: [
    cyc({ cycle_index: 1, submitted: '2026-05-01', city_target: '2026-06-05', corr_issued: '2026-06-03', resubmitted: '2026-07-21' }),
    cyc({ cycle_index: 2, submitted: '2026-07-21', city_target: '2026-08-05', corr_issued: '2026-08-14', resubmitted: '2026-08-26' }),
    cyc({ cycle_index: 3, submitted: '2026-08-26', corr_issued: '2026-09-10', resubmitted: '2026-09-29' }),
    cyc({ cycle_index: 4, submitted: '2026-09-29' })], learnedEstimate: learned(4) } },
  { name: 'four rounds of corrections, round 4 in corrections', input: { permit: permit(), cycles: [
    cyc({ cycle_index: 1, submitted: '2026-01-05', corr_issued: '2026-02-01', resubmitted: '2026-03-01' }),
    cyc({ cycle_index: 2, submitted: '2026-03-01', corr_issued: '2026-04-01', resubmitted: '2026-05-01' }),
    cyc({ cycle_index: 3, submitted: '2026-05-01', corr_issued: '2026-06-01', resubmitted: '2026-07-01' }),
    cyc({ cycle_index: 4, submitted: '2026-07-01', corr_issued: '2026-09-20' })], learnedEstimate: learned(2) } },
  { name: 'override to 8, two rounds', input: { permit: permit(), cycles: [
    cyc({ cycle_index: 1, submitted: '2026-05-01', corr_issued: '2026-06-03', resubmitted: '2026-07-21' }),
    cyc({ cycle_index: 2, submitted: '2026-07-21' })], learnedEstimate: learned(2), targetCycleOverride: 8 } },
  { name: 'no learner, no cycles', input: { permit: permit({ target_submit: '2026-11-01' }), cycles: [], learnedEstimate: null } },
];
