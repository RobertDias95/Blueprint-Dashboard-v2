import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

// ===========================================================================
// fix-585 — THE CENSUS: one learner, not a third
// ===========================================================================
//
// *This Brain has removed two-writers-of-one-rule five times.* Before fix-585
// there were already two answers to "how long does this take":
// `bp_learn_days` (DB, dead ladder) and `scheduleBenchmarks.ts` (client, its
// own 90/180/365 ladder) — plus fix-253's per-cycle display functions.
//
// ★★★ THIS FAILS when a NEW duration learner appears that does not read
//     `bp_duration_stats` / `bp_learned_durations`. The grandfathered list is
//     SHRINK-ONLY: fix-586 rewires the client and deletes entries; nothing is
//     ever added to it. A stale entry (no longer a learner) also fails, so the
//     list cannot quietly outlive its reason.
//
// ★★ WHAT COUNTS AS A LEARNER, operationally:
//   SQL — a function whose body aggregates (percentile_cont / AVG). The
//         LATEST definition across migrations/ is the one judged.
//   TS  — a non-test module under src/ carrying the recency-window ladder
//         literal (90, 180, 365), importing the client ladder's primitives from
//         scheduleBenchmarks, or calling one of the legacy duration RPCs.
//
// ★ PROVED BY ADDING ONE: the "a new learner is caught" cases below run the
//   same classifier over a synthetic new function and a synthetic new module.
//   The PR also records a scratch run with a real file dropped into src/lib.

const ROOT = process.cwd();

/** The one learner, and the readers of its rows. */
const READS_THE_LEARNER = /\bbp_duration_stats\b|\bbp_learned_durations\b|from '\.\/durationLadder'|from '\.\.\/lib\/durationLadder'/;

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const GRANDFATHERED_SQL: Record<string, string> = {
  bp_learn_target_submit_days:
    'anchor → our-submittal lag (dd_end / go_date / BP milestones). A different quantity from the review clocks; out of the brief\'s scope and left as fix-249 set it.',
  bp_target_submit_benchmark: 'fix-249 display-only benchmark of the lag above.',
  bp_phase_durations: 'fix-253 per-cycle display. Same clocks as bp_duration_stats — fix-586 repoints it.',
  bp_phase_duration_grid: 'fix-253 per-cycle display grid. fix-586 repoints it.',
};
const THE_LEARNER_SQL = 'bp_duration_stats';

const AGGREGATES = /\bpercentile_cont\s*\(|\bavg\s*\(/i;

function stripSqlComments(sql: string): string {
  return sql.split('\n').map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l)).join('\n');
}

function fixNumber(file: string): number {
  const m = /fix_(\d+)/.exec(file);
  return m ? Number(m[1]) : -1;
}

/** name → latest body, judged across migrations/ in fix-number order. */
function latestSqlFunctions(files: Array<{ name: string; sql: string }>): Map<string, string> {
  const out = new Map<string, { n: number; body: string }>();
  for (const f of files) {
    const sql = stripSqlComments(f.sql);
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
    const hits = [...sql.matchAll(re)];
    hits.forEach((h, i) => {
      const body = sql.slice(h.index!, hits[i + 1]?.index ?? sql.length);
      const name = h[1]!.toLowerCase();
      const n = fixNumber(f.name);
      const prev = out.get(name);
      if (!prev || n >= prev.n) out.set(name, { n, body });
    });
  }
  return new Map([...out].map(([k, v]) => [k, v.body]));
}

function sqlLearnerViolations(fns: Map<string, string>): string[] {
  const bad: string[] = [];
  for (const [name, body] of fns) {
    if (!AGGREGATES.test(body)) continue;
    if (name === THE_LEARNER_SQL) continue;
    if (name in GRANDFATHERED_SQL) continue;
    if (READS_THE_LEARNER.test(body)) continue;
    bad.push(name);
  }
  return bad.sort();
}

const MIGRATIONS = readdirSync(resolve(ROOT, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(resolve(ROOT, 'migrations', name), 'utf8') }));

// ---------------------------------------------------------------------------
// TS
// ---------------------------------------------------------------------------

const GRANDFATHERED_TS: Record<string, string> = {
  // — the legacy client learner and its twins (fix-586 rewires these) —
  'src/lib/scheduleBenchmarks.ts': 'the client ladder. Brief: leave it alone here; fix-586 points it at bp_learned_durations.',
  'src/components/Reports/ScheduleBenchmarks.tsx': 'renders scheduleBenchmarks; goes with it in fix-586.',
  'src/lib/targetSubmitLearner.ts': 'client twin of bp_learn_target_submit_days (the lag, not the review clocks).',
  'src/lib/targetSubmitPolicy.ts': 'TS twin of bp_target_submit_benchmark (fix-249 display, the lag).',
  'src/lib/phaseDurations.ts': 'TS twin of bp_phase_durations (fix-253 display); fix-586.',
  'src/hooks/usePhaseDurationGrid.ts': 'fix-253 display RPC hook; fix-586.',
  'src/hooks/useTargetSubmitBenchmark.ts': 'fix-249 display RPC hook for the lag benchmark.',
  // — consumers of computeLearnedSchedule: each is a duration lookup that does
  //   not read bp_duration_stats yet. fix-586 repoints them. —
  'src/components/DrawScheduleGrid.tsx': 'computeLearnedSchedule consumer; fix-586.',
  'src/components/ProjectDetail/ScheduleEstimator.tsx': 'computeLearnedSchedule consumer; fix-586.',
  'src/components/ProjectDetail/ScheduleHealthTable.tsx': 'computeLearnedSchedule consumer; fix-586.',
  'src/hooks/useProjectedApprovalFor.ts': 'computeLearnedSchedule consumer; fix-586.',
  // — measurement reports: they describe finished cycles, they do not forecast —
  'src/lib/metricDrillIn.ts': 'report drill-in medians over finished cycles; not a forecast.',
  'src/lib/trendsDrillIn.ts': 'trends drill-in medians over finished cycles; not a forecast.',
};

const WINDOW_LADDER = /\b90\s*,\s*180\s*,\s*365\b/;
const LADDER_PRIMITIVES =
  /import\s*\{[^}]*\b(WINDOW_TIERS_DAYS|MIN_SAMPLES_FOR_LEARNER|recencyWeight|filteredMean|computeLearnedSchedule|extractSample)\b[^}]*\}\s*from\s*'[./]*(lib\/)?scheduleBenchmarks'/;
const LEGACY_RPC = /\.rpc\(\s*['"`](bp_phase_durations|bp_phase_duration_grid|bp_target_submit_benchmark|bp_learn_days|bp_learn_days_explain|bp_learn_target_submit_days)['"`]/;
/** Its own median/percentile, over the cycle clock fields. */
const OWN_MEDIAN = /function\s+\w*(median|percentile)\w*\s*[(<]|const\s+\w*(median|percentile)\w*\s*=\s*\(/i;
const CYCLE_FIELDS = /corr_issued|resubmitted|intake_accepted/;

function isTsLearner(text: string): boolean {
  return (
    WINDOW_LADDER.test(text) ||
    LADDER_PRIMITIVES.test(text) ||
    LEGACY_RPC.test(text) ||
    (OWN_MEDIAN.test(text) && CYCLE_FIELDS.test(text))
  );
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === '__tests__' || e === 'node_modules') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) {
      acc.push(p);
    }
  }
  return acc;
}

function tsLearnerViolations(files: Array<{ path: string; text: string }>): string[] {
  return files
    .filter((f) => isTsLearner(f.text))
    .filter((f) => !(f.path in GRANDFATHERED_TS))
    .filter((f) => !READS_THE_LEARNER.test(f.text))
    .map((f) => f.path)
    .sort();
}

const SRC_FILES = walk(resolve(ROOT, 'src')).map((p) => ({
  path: relative(ROOT, p).replace(/\\/g, '/'),
  text: readFileSync(p, 'utf8'),
}));

// ---------------------------------------------------------------------------

describe('fix-585 census — SQL', () => {
  const fns = latestSqlFunctions(MIGRATIONS);

  it('★★★ every aggregating function is THE learner, reads it, or is grandfathered', () => {
    expect(sqlLearnerViolations(fns)).toEqual([]);
  });

  it('★★★ bp_learn_days is judged by its LATEST body (fix-585), which reads the learner and aggregates nothing', () => {
    const body = fns.get('bp_learn_days')!;
    expect(body).toMatch(/bp_learn_days_explain/);
    expect(AGGREGATES.test(body)).toBe(false);
    expect(AGGREGATES.test(fns.get('bp_learn_days_explain')!)).toBe(false);
    expect(fns.get('bp_learn_days_explain')).toMatch(/bp_duration_stats\(/);
  });

  it('★★ the grandfathered list has no stale entry', () => {
    for (const name of Object.keys(GRANDFATHERED_SQL)) {
      expect(fns.has(name), `${name} still defined in migrations/`).toBe(true);
      expect(AGGREGATES.test(fns.get(name)!), `${name} still aggregates`).toBe(true);
    }
  });

  it('★★★ PROOF — a new aggregating function that bypasses the learner is caught', () => {
    const planted = new Map(fns);
    const extra = latestSqlFunctions([
      {
        name: 'fix_999_third_learner.sql',
        sql: `CREATE OR REPLACE FUNCTION public.bp_my_ecr_estimate(p_type text) RETURNS integer
              LANGUAGE sql AS $f$ SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.corr_issued - pc.submitted)::int
              FROM permit_cycles pc $f$;`,
      },
    ]);
    for (const [k, v] of extra) planted.set(k, v);
    expect(sqlLearnerViolations(planted)).toEqual(['bp_my_ecr_estimate']);
  });

  it('★★ …and one that READS bp_duration_stats is allowed', () => {
    const planted = new Map(fns);
    planted.set(
      'bp_reads_the_one',
      `CREATE FUNCTION public.bp_reads_the_one() ... SELECT avg(median_days) FROM bp_duration_stats(t) ...`,
    );
    expect(sqlLearnerViolations(planted)).toEqual([]);
  });

  it('★ a later migration redefining a legacy function WITHOUT an aggregate retires it', () => {
    const fns2 = latestSqlFunctions([
      { name: 'fix_100_x.sql', sql: 'create function public.foo() as $$ select avg(x) $$;' },
      { name: 'fix_200_x.sql', sql: 'create or replace function public.foo() as $$ select 1 $$;' },
    ]);
    expect(sqlLearnerViolations(fns2)).toEqual([]);
  });
});

describe('fix-585 census — TS', () => {
  it('★★★ no module under src/ is a duration learner unless it reads the one learner or is grandfathered', () => {
    expect(tsLearnerViolations(SRC_FILES)).toEqual([]);
  });

  it('★★ the grandfathered list has no stale entry', () => {
    for (const path of Object.keys(GRANDFATHERED_TS)) {
      const f = SRC_FILES.find((x) => x.path === path);
      expect(f, `${path} exists`).toBeDefined();
      expect(isTsLearner(f!.text), `${path} is still a learner`).toBe(true);
    }
  });

  it('★★★ PROOF — a new module with its own 90/180/365 ladder is caught', () => {
    const planted = [
      ...SRC_FILES,
      {
        path: 'src/lib/thirdLearner.ts',
        text: `const WINDOWS = [90, 180, 365];\nexport function learn(cycles) { /* median of corr_issued - submitted */ }`,
      },
    ];
    expect(tsLearnerViolations(planted)).toEqual(['src/lib/thirdLearner.ts']);
  });

  it('★★★ PROOF — a new module borrowing scheduleBenchmarks\' ladder is caught', () => {
    const planted = [
      ...SRC_FILES,
      {
        path: 'src/lib/anotherEstimate.ts',
        text: `import { WINDOW_TIERS_DAYS, extractSample } from './scheduleBenchmarks';\n`,
      },
    ];
    expect(tsLearnerViolations(planted)).toEqual(['src/lib/anotherEstimate.ts']);
  });

  it('★★★ PROOF — a new module with its own median over cycle dates is caught', () => {
    const planted = [
      ...SRC_FILES,
      {
        path: 'src/lib/ecrForecast.ts',
        text: `function medianDays(xs: number[]) { return xs[0]; }
const d = c.corr_issued;`,
      },
    ];
    expect(tsLearnerViolations(planted)).toEqual(['src/lib/ecrForecast.ts']);
  });

  it('★★ the ladder READER is not a learner, and the §7 resolver passes because it reads it', () => {
    const ladder = SRC_FILES.find((x) => x.path === 'src/lib/durationLadder.ts')!;
    expect(isTsLearner(ladder.text)).toBe(false);
    const inputs = SRC_FILES.find((x) => x.path === 'src/lib/estimatorInputs.ts')!;
    // It takes a median of the permit's OWN completed cycles (brief §7 rung 1),
    // so it IS classed as a lookup — and it is allowed because it walks the one
    // learner's rows for every other rung.
    expect(isTsLearner(inputs.text)).toBe(true);
    expect(READS_THE_LEARNER.test(inputs.text)).toBe(true);
  });
});
