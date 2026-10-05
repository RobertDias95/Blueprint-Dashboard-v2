import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { correctionSignalFor, type CorrectionOddsPayload } from '../lib/correctionOdds';
import { computeProjectedApproval } from '../lib/projectedApproval';
import { reanchorSentences } from '../lib/estimatorRouteCopy';
import type { LearnedEstimate } from '../lib/scheduleBenchmarks';
import { SCHEDULE_DEFAULTS } from '../lib/scheduleBenchmarks';
import type { Permit, PermitCycle } from '../lib/database.types';

// ===========================================================================
// fix-625 (P-319) — the city-lateness figure is the cautious one, and a thin
// window can't swing it. Bobby, 2026-10-05: "Cautious, as you ruled."
// ===========================================================================

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8').split('\r\n').join('\n');
const RAW = read('migrations/fix_625_cautious_city_lateness.sql');
const SQL = RAW.replace(/--.*$/gm, '');
const section = (from: string, to: string) => SQL.slice(SQL.indexOf(from), SQL.indexOf(to, SQL.indexOf(from)));
const LEARNER = section('CREATE FUNCTION public.bp_duration_stats', '$function$;');
const LEARNED = section('CREATE OR REPLACE FUNCTION public.bp_learned_durations', '$function$;');
const ODDS = section('CREATE OR REPLACE FUNCTION public.bp_correction_odds', '$function$;');

const TODAY = '2026-10-02';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

function permit(): Permit {
  return { id: 1, project_id: 'p1', type: 'Demolition', approval_date: null, actual_issue: null, target_submit: null, extras: null } as unknown as Permit;
}
function cyc(over: Partial<PermitCycle> & { cycle_index: number }): PermitCycle {
  return { id: `c-${over.cycle_index}`, permit_id: 1, submitted: null, city_target: null, corr_issued: null,
    resubmitted: null, intake_accepted: null, created_at: '', updated_at: '', ...over } as PermitCycle;
}
function learned(): LearnedEstimate {
  return {
    source: 'test', sampleCount: 5, dateRange: '', goToSubmit: null, avgIntakeToApproval: null,
    cityReview1: 30, corrResponse1: 21, cityReview2: 30, corrResponse2: 21,
    cityReview3: SCHEDULE_DEFAULTS.cityReview3, corrResponse3: SCHEDULE_DEFAULTS.corrResponse3,
    cityReview4: SCHEDULE_DEFAULTS.cityReview4, corrResponse4: SCHEDULE_DEFAULTS.corrResponse4,
    cr1Count: 5, cr2Count: 5, cr3Count: 0, cr4Count: 0, co1Count: 5, co2Count: 5, co3Count: 0, co4Count: 0,
    avgCycles: 2, mostLikelyCycle: 2, cycleDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
    isAllTime: false, isCrossJuris: false, recencyTier: 'last_180d' as const,
  } as LearnedEstimate;
}
// Cycle 2 in review at the city, past its own review date (Sep 26).
const CYCLES = [
  cyc({ cycle_index: 1, submitted: '2026-06-01', corr_issued: '2026-07-01', resubmitted: '2026-08-01' }),
  cyc({ cycle_index: 2, submitted: '2026-08-01', city_target: '2026-09-26' }),
];
const project = (payload: CorrectionOddsPayload) =>
  computeProjectedApproval({
    permit: permit(),
    cycles: CYCLES,
    learnedEstimate: learned(),
    correctionSignal: correctionSignalFor(payload, { id: 1, type: 'Demolition' }, 'Seattle'),
  });

// ---------------------------------------------------------------------------
describe('fix-625 §A: the re-anchor reads the CAUTIOUS figure', () => {
  const payload = (late: CorrectionOddsPayload['lateness']): CorrectionOddsPayload => ({ cells: [], permits: [], lateness: late });

  it('★★★ the 80th percentile, not the median, is what the estimate allows for', () => {
    const r = project(payload([{ type: 'Demolition', juris: 'Seattle', late_rounds: 66, cautious_days: 19, typical_days: 10, window_tier: '365d' }]));
    expect(r.routeFacts?.reanchors).toEqual([
      { kind: 'city_late', daysLate: 6, due: '2026-09-26', plannedDays: 19, lateRounds: 66 },
    ]);
    expect(r.projection).toBe('2026-10-28'); // today + 19, + the 7-day approval buffer
  });

  it('★★ the sentence says it plainly', () => {
    const r = project(payload([{ type: 'Demolition', juris: 'Seattle', late_rounds: 66, cautious_days: 19, window_tier: '365d' }]));
    expect(reanchorSentences(r.routeFacts!)).toBe(
      'City is 6 days past its own review date (due Sep 26); it often runs up to 19 days late here, so the estimate allows for that.',
    );
  });

  it('★★★ not enough history (no row) → today, and said so', () => {
    const r = project(payload([]));
    expect(r.projection).toBe('2026-10-09');
    expect(reanchorSentences(r.routeFacts!)).toBe(
      'City is 6 days past its own review date (due Sep 26); too few late answers here to judge how late it runs, so the estimate plans from today.',
    );
  });

  it('★★ a payload without the cautious figure (before the migration) is "no signal" — never the median', () => {
    const sig = correctionSignalFor(
      { cells: [], permits: [], lateness: [{ type: 'Demolition', juris: 'Seattle', late_rounds: 10, typical_days: 83 }] },
      { id: 1, type: 'Demolition' },
      'Seattle',
    );
    expect(sig).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fix-625 §B: city_late\'s own ladder — a thin window cannot swing it', () => {
  /** Test-only mirror of the lateness CTE in bp_correction_odds. */
  type Row = { window_tier: '90d' | '180d' | '365d' | 'all'; n: number; p80: number };
  const ORDER = { '90d': 1, '180d': 2, '365d': 3, all: 4 } as const;
  const pick = (rows: Row[]) =>
    rows
      .filter((r) => r.p80 > 0 && ((r.window_tier !== 'all' && r.n >= 30) || (r.window_tier === 'all' && r.n >= 5)))
      .sort((a, b) => ORDER[a.window_tier] - ORDER[b.window_tier])[0] ?? null;

  it('★★★ Seattle Demolition (measured 2026-10-05) falls to 365 days, not the 83- or 100-day thin reads', () => {
    expect(
      pick([
        { window_tier: '90d', n: 10, p80: 143 },
        { window_tier: '180d', n: 29, p80: 100 },
        { window_tier: '365d', n: 66, p80: 19 },
        { window_tier: 'all', n: 167, p80: 19 },
      ]),
    ).toEqual({ window_tier: '365d', n: 66, p80: 19 });
  });

  it('★★ a recent window with enough late rounds is used (Seattle Building Permits: 90 days)', () => {
    expect(pick([
      { window_tier: '90d', n: 39, p80: 17 }, { window_tier: 'all', n: 411, p80: 19 },
    ])?.window_tier).toBe('90d');
  });

  it('★★ thin recent windows fall back to all-time', () => {
    expect(pick([
      { window_tier: '90d', n: 14, p80: 25 }, { window_tier: '180d', n: 15, p80: 25 }, { window_tier: 'all', n: 16, p80: 25 },
    ])?.window_tier).toBe('all');
  });

  it('★★★ all-time with fewer than 5 → nothing (the estimate plans from today)', () => {
    expect(pick([{ window_tier: 'all', n: 4, p80: 30 }])).toBeNull();
  });

  it('★★★ the SQL is that ladder', () => {
    expect(ODDS).toMatch(
      /AND \(\(ls\.window_tier <> 'all' AND ls\.n >= 30\) OR \(ls\.window_tier = 'all' AND ls\.n >= 5\)\)/,
    );
    expect(ODDS).toMatch(/ls\.p80_days AS cautious_days/);
    expect(ODDS).toMatch(/public\.bp_duration_stats\(t\.tenant_id, NULL, 'city_late'\)/);
  });
});

// ---------------------------------------------------------------------------
describe('fix-625: in the ONE learner, and nothing else moves', () => {
  it('★★★ the 80th percentile lives in bp_duration_stats beside the median', () => {
    expect(LEARNER).toMatch(/round\(percentile_cont\(0\.5\) WITHIN GROUP \(ORDER BY days\)::numeric\)::integer AS median_days/);
    expect(LEARNER).toMatch(/round\(percentile_cont\(0\.8\) WITHIN GROUP \(ORDER BY days\)::numeric\)::integer AS p80_days/);
    // ★ the old 8 columns, in their old order, then the new one
    expect(LEARNER).toMatch(
      /RETURNS TABLE\(type text, juris text, cycle_index integer, clock text, scope text, window_tier text, n integer, median_days integer, p80_days integer\)/,
    );
  });

  it('★★★ no percentile anywhere but the learner', () => {
    expect(ODDS).not.toMatch(/percentile_cont|\bavg\s*\(/i);
    expect(LEARNED).not.toMatch(/percentile_cont|\bavg\s*\(/i);
  });

  it('★★★ bp_learned_durations keeps its 8 columns (what the client reads)', () => {
    expect(LEARNED).toMatch(
      /RETURNS TABLE\(type text, juris text, cycle_index integer, clock text, scope text, window_tier text, n integer, median_days integer\)/,
    );
    expect(LEARNED).toMatch(/SELECT s\.type, s\.juris, s\.cycle_index, s\.clock, s\.scope, s\.window_tier, s\.n, s\.median_days/);
    expect(LEARNED).not.toMatch(/SELECT s\.\*/);
  });

  it('★★ other clocks keep fix-585\'s ladder: bp_learn_days_explain is not touched', () => {
    expect(SQL).not.toMatch(/FUNCTION public\.bp_learn_days_explain/);
  });

  it('★★ the DROP is guarded, and the ACL is restated (never anon)', () => {
    expect(SQL.indexOf('$guard$')).toBeLessThan(SQL.indexOf('DROP FUNCTION public.bp_duration_stats'));
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.bp_duration_stats\(uuid, text, text\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.bp_duration_stats\(uuid, text, text\) TO authenticated, service_role;/);
    // the only destructive statement is that one DROP; no row is written
    expect((SQL.match(/^[ \t]*(DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b.*$/gm) ?? []).map((l) => l.trim())).toEqual([
      'DROP FUNCTION public.bp_duration_stats(uuid, text, text);',
    ]);
  });
});
