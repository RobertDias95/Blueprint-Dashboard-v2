import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLAMP_HIGH,
  CLAMP_LOW,
  LAST_RESORT_MIN_SAMPLES,
  LEARN_MIN_SAMPLES,
  OUR_CLOCK_FLOOR_DAYS,
  OUTLIER_CAP_DAYS,
  SCOPE_ORDER,
  WINDOW_ORDER,
  walkLadder,
  type DurationClock,
  type DurationStatRow,
  type LadderScope,
  type PolicyRow,
  type WindowTier,
} from '../lib/durationLadder';

// ===========================================================================
// fix-585 — one learner, and the cycle it is in
// ===========================================================================
//
// No live DB in CI (fix-153 pattern). Two halves:
//   §A  a pure-TS mirror of `bp_duration_stats` (TEST-ONLY — it must never
//       ship in src/lib, that would be the third learner) feeding the real
//       `walkLadder`, pinning every behaviour the brief lists;
//   §B  the migration text, asserted so the SQL and the TS twin cannot drift.
// The live proofs (Kirkland ≠ Seattle on prod, manual rows untouched by a
// recompute) were run as rolled-back probes and are recorded in the PR.

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'migrations/fix_585_one_learner.sql'),
  'utf8',
);

/** Strip `--` comments so prose can't satisfy or trip a scanner. */
function executableSql(sql: string): string {
  return sql
    .split('\n')
    .map((l) => {
      const i = l.indexOf('--');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
}
const SQL = executableSql(MIGRATION);

// ---------------------------------------------------------------------------
// §A — test-only mirror of bp_duration_stats
// ---------------------------------------------------------------------------

interface Sample {
  type: string;
  juris: string | null;
  cycle: number | null;
  clock: DurationClock;
  days: number;
  /** days before TODAY the clock ended */
  endedAgo: number;
}

const WINDOW_DAYS: Record<WindowTier, number | null> = { '90d': 90, '180d': 180, '365d': 365, all: null };

/** percentile_cont(0.5) → numeric → round() half away from zero. */
function pgMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  const v = (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
  return Math.sign(v) * Math.round(Math.abs(v));
}

function statsMirror(samples: Sample[]): DurationStatRow[] {
  const ok = samples.filter((s) => s.days >= 0 && s.days <= OUTLIER_CAP_DAYS);
  const cells = new Map<string, { row: Omit<DurationStatRow, 'n' | 'median_days'>; days: number[] }>();
  const perCycle = (c: DurationClock) => c === 'city_review' || c === 'our_turnaround';
  for (const s of ok) {
    for (const w of WINDOW_ORDER) {
      const wd = WINDOW_DAYS[w];
      if (wd != null && s.endedAgo > wd) continue;
      if (s.juris == null) continue; // no jurisdiction, nothing to learn for
      const sets: Array<[LadderScope, string | null, number | null]> = [
        ['type_juris_cycle', s.juris, s.cycle],
        ['type_juris', s.juris, null],
      ];
      for (const [scope, juris, cycle] of sets) {
        if (!perCycle(s.clock) && scope === 'type_juris_cycle') continue;
        const key = [s.type, juris, cycle, s.clock, scope, w].join('|');
        const cell = cells.get(key) ?? {
          row: { type: s.type, juris, cycle_index: cycle, clock: s.clock, scope, window_tier: w },
          days: [],
        };
        cell.days.push(s.days);
        cells.set(key, cell);
      }
    }
  }
  return [...cells.values()].map((c) => ({ ...c.row, n: c.days.length, median_days: pgMedian(c.days) }));
}

const rep = (n: number, s: Omit<Sample, 'endedAgo'> & { endedAgo?: number }): Sample[] =>
  Array.from({ length: n }, () => ({ endedAgo: 30, ...s }));

const BP_POLICY: PolicyRow = { intake_to_approval_days: 210, c1_resub_offset_days: null };

describe('fix-585 §A — the ladder over the one learner', () => {
  it('★★★ two jurisdictions with different histories get different numbers (the short-circuit is gone)', () => {
    const rows = statsMirror([
      ...rep(10, { type: 'Building Permit', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 158 }),
      ...rep(10, { type: 'Building Permit', juris: 'Kirkland', cycle: null, clock: 'intake_to_approval', days: 127 }),
    ]);
    const sea = walkLadder(rows, { type: 'Building Permit', juris: 'Seattle', clock: 'intake_to_approval', policy: BP_POLICY });
    const kir = walkLadder(rows, { type: 'Building Permit', juris: 'Kirkland', clock: 'intake_to_approval', policy: BP_POLICY });
    expect(sea.days).toBe(158);
    expect(kir.days).toBe(127);
    expect(sea.days).not.toBe(kir.days);
    // …and neither is the policy 210 that fix-249 returned for both.
    expect(sea.tier).toBe('type_juris');
    expect(kir.tier).toBe('type_juris');
  });

  it('★★ a type with no history still returns its policy number', () => {
    const r = walkLadder([], { type: 'Building Permit', juris: 'Atlantis', clock: 'intake_to_approval', policy: BP_POLICY });
    expect(r).toMatchObject({ days: 210, tier: 'policy' });
  });

  it('★ …and with no policy row either, the unchanged hardcoded table answers', () => {
    const r = walkLadder([], { type: 'Vault', juris: 'Seattle', clock: 'intake_to_approval', policy: null });
    expect(r).toMatchObject({ days: 210, tier: 'hardcoded' });
    const c1 = walkLadder([], { type: 'ULS', juris: 'Seattle', clock: 'c1_resub_offset', policy: null });
    expect(c1).toMatchObject({ days: 30, tier: 'hardcoded' });
  });

  it('★★ c1_resub_offset policy is intake_to_approval / 3 when unset (fix-249 heuristic kept)', () => {
    const r = walkLadder([], {
      type: 'ULS', juris: 'Seattle', clock: 'c1_resub_offset',
      policy: { intake_to_approval_days: 90, c1_resub_offset_days: null },
    });
    expect(r).toMatchObject({ days: 30, tier: 'policy' });
  });

  it('★★★ a learned value outside the clamp is clamped — both ends', () => {
    const rows = statsMirror([
      ...rep(6, { type: 'Building Permit', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 600 }),
      ...rep(6, { type: 'Building Permit', juris: 'Kirkland', cycle: null, clock: 'intake_to_approval', days: 20 }),
    ]);
    const hi = walkLadder(rows, { type: 'Building Permit', juris: 'Seattle', clock: 'intake_to_approval', policy: BP_POLICY });
    expect(hi).toMatchObject({ days: 420, learnedDays: 600, clamped: true });
    const lo = walkLadder(rows, { type: 'Building Permit', juris: 'Kirkland', clock: 'intake_to_approval', policy: BP_POLICY });
    expect(lo).toMatchObject({ days: 105, learnedDays: 20, clamped: true });
    const inside = walkLadder(
      statsMirror(rep(6, { type: 'Building Permit', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 158 })),
      { type: 'Building Permit', juris: 'Seattle', clock: 'intake_to_approval', policy: BP_POLICY },
    );
    expect(inside).toMatchObject({ days: 158, clamped: false });
  });

  it('★★★ the median is a median: [10, 10, 10, 1000] → 10, not 257', () => {
    // 1000 is over the 730 cap, so prove it with a value UNDER the cap too.
    const rows = statsMirror([
      ...rep(3, { type: 'Demolition', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 10 }),
      ...rep(1, { type: 'Demolition', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 700 }),
      ...rep(1, { type: 'Demolition', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 10 }),
    ]);
    const cell = rows.find((r) => r.scope === 'type_juris' && r.window_tier === '90d')!;
    expect(cell.median_days).toBe(10); // the mean would be 148
    expect(pgMedian([10, 10, 10, 1000])).toBe(10);
    expect(pgMedian([10, 10, 10, 1000])).not.toBe(257);
  });

  it('★★★ the OUR-clock floor holds: all-zero samples return 3, not 0', () => {
    const rows = statsMirror(rep(15, { type: 'Building Permit', juris: 'Seattle', cycle: 4, clock: 'our_turnaround', days: 0 }));
    const r = walkLadder(rows, { type: 'Building Permit', juris: 'Seattle', clock: 'our_turnaround', cycle: 4 });
    expect(r.learnedDays).toBe(0);
    expect(r.days).toBe(OUR_CLOCK_FLOOR_DAYS);
    expect(r.days).toBe(3);
  });

  it('★ the floor is OUR clock only — a 0-day city review is not floored', () => {
    const rows = statsMirror(rep(6, { type: 'Building Permit', juris: 'Seattle', cycle: 2, clock: 'city_review', days: 0 }));
    expect(walkLadder(rows, { type: 'Building Permit', juris: 'Seattle', clock: 'city_review', cycle: 2 }).days).toBe(0);
  });

  it('★★★ the ladder degrades IN ORDER — asserting the tier, not just the number', () => {
    const q = { type: 'Building Permit', juris: 'Kirkland', clock: 'city_review' as const, cycle: 3 };
    const policy = { intake_to_approval_days: 210, c1_resub_offset_days: null };
    const qi = { type: 'Building Permit', juris: 'Kirkland', clock: 'intake_to_approval' as const, policy };
    // Each tier gets its own distinctive median so a coincidence cannot pass.
    const tjc = rep(5, { type: 'Building Permit', juris: 'Kirkland', cycle: 3, clock: 'city_review', days: 11 });
    const tj = rep(5, { type: 'Building Permit', juris: 'Kirkland', cycle: 1, clock: 'city_review', days: 33 });

    let r = walkLadder(statsMirror([...tjc, ...tj]), q);
    expect(r.tier).toBe('type_juris_cycle');
    expect(r.days).toBe(11);

    // 4 cycle-3 samples < 5 → type×juris (all cycles, 9 samples: 4×11 + 5×33)
    r = walkLadder(statsMirror([...tjc.slice(1), ...tj]), q);
    expect(r.tier).toBe('type_juris');
    expect(r.days).toBe(33);

    r = walkLadder(statsMirror(tj), q);
    expect(r.tier).toBe('type_juris');
    expect(r.days).toBe(33);

    // ★ Last resort: the type×juris ALL-TIME window answers with a single sample.
    r = walkLadder(statsMirror(tj.slice(0, 1)), q);
    expect(r).toMatchObject({ tier: 'type_juris', windowTier: 'all', n: 1, days: 33 });

    // Zero history: the per-cycle clock has no policy column → no number…
    r = walkLadder(statsMirror([]), q);
    expect(r.tier).toBe('none');
    expect(r.days).toBeNull();
    // …and a whole-permit clock falls to policy.
    expect(walkLadder(statsMirror([]), qi)).toMatchObject({ tier: 'policy', days: 210 });
  });

  it("★★★ RULING 2026-09-29 — a jurisdiction with ZERO history returns policy, never another city's median", () => {
    const policy = { intake_to_approval_days: 210, c1_resub_offset_days: null };
    // Plenty of Seattle history, at every window and every cycle.
    const rows = statsMirror([
      ...rep(50, { type: 'Building Permit', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 158 }),
      ...rep(50, { type: 'Building Permit', juris: 'Seattle', cycle: 1, clock: 'city_review', days: 63 }),
    ]);
    const r = walkLadder(rows, { type: 'Building Permit', juris: 'Kirkland', clock: 'intake_to_approval', policy });
    expect(r).toMatchObject({ tier: 'policy', days: 210, learnedDays: null });
    expect(r.days).not.toBe(158);
    // per-cycle: no policy column, and still never Seattle's 63
    const c = walkLadder(rows, { type: 'Building Permit', juris: 'Kirkland', clock: 'city_review', cycle: 1 });
    expect(c).toMatchObject({ tier: 'none', days: null });
    // and there is no cross-juris row to borrow in the first place
    expect(rows.every((x) => x.juris === 'Seattle')).toBe(true);
    expect(new Set(rows.map((x) => x.scope))).toEqual(new Set(['type_juris', 'type_juris_cycle']));
  });

  it('★★★ RULING 2026-09-29 — a jurisdiction with ONE sample returns that sample, clamped', () => {
    const policy = { intake_to_approval_days: 210, c1_resub_offset_days: null };
    expect(LAST_RESORT_MIN_SAMPLES).toBe(1);
    const one = (days: number, endedAgo = 400) =>
      statsMirror(rep(1, { type: 'Building Permit', juris: 'Kirkland', cycle: null, clock: 'intake_to_approval', days, endedAgo }));
    const q = { type: 'Building Permit', juris: 'Kirkland', clock: 'intake_to_approval' as const, policy };
    expect(walkLadder(one(127), q)).toMatchObject({ days: 127, tier: 'type_juris', windowTier: 'all', n: 1, clamped: false });
    expect(walkLadder(one(600), q)).toMatchObject({ days: 420, learnedDays: 600, n: 1, clamped: true });
    expect(walkLadder(one(40), q)).toMatchObject({ days: 105, learnedDays: 40, n: 1, clamped: true });
    // ★ A recent single sample still answers — through the all-time window,
    //   because the 90/180/365 windows need five.
    expect(walkLadder(one(127, 10), q)).toMatchObject({ days: 127, windowTier: 'all', n: 1 });
  });

  it('★★ inside a tier, the window ladder is 90 → 180 → 365 → all', () => {
    const q = { type: 'ULS', juris: 'Seattle', clock: 'c1_resub_offset' as const };
    const old = rep(5, { type: 'ULS', juris: 'Seattle', cycle: null, clock: 'c1_resub_offset', days: 75, endedAgo: 300 });
    const recent = rep(5, { type: 'ULS', juris: 'Seattle', cycle: null, clock: 'c1_resub_offset', days: 60, endedAgo: 20 });
    expect(walkLadder(statsMirror([...old, ...recent]), q)).toMatchObject({ windowTier: '90d', days: 60 });
    expect(walkLadder(statsMirror(old), q)).toMatchObject({ windowTier: '365d', days: 75 });
    const ancient = old.map((s) => ({ ...s, endedAgo: 900 }));
    expect(walkLadder(statsMirror(ancient), q)).toMatchObject({ windowTier: 'all', tier: 'type_juris' });
  });

  it('★★ whole-permit clocks have no cycle cells — a p_cycle does not change their answer', () => {
    const rows = statsMirror(rep(6, { type: 'ULS', juris: 'Seattle', cycle: null, clock: 'c1_resub_offset', days: 75 }));
    expect(rows.some((r) => r.clock === 'c1_resub_offset' && r.scope.endsWith('cycle'))).toBe(false);
    const a = walkLadder(rows, { type: 'ULS', juris: 'Seattle', clock: 'c1_resub_offset', cycle: 1 });
    const b = walkLadder(rows, { type: 'ULS', juris: 'Seattle', clock: 'c1_resub_offset' });
    expect(a).toEqual(b);
    expect(a.tier).toBe('type_juris');
  });

  it(`★★ LEARN_MIN_SAMPLES = ${LEARN_MIN_SAMPLES}: four samples never win a WINDOWED cell or a cycle cell`, () => {
    expect(LEARN_MIN_SAMPLES).toBe(5);
    const four = statsMirror(rep(4, { type: 'ULS', juris: 'Seattle', cycle: 2, clock: 'city_review', days: 40, endedAgo: 10 }));
    const r = walkLadder(four, { type: 'ULS', juris: 'Seattle', clock: 'city_review', cycle: 2 });
    // the cycle cell and the 90d/180d/365d windows are skipped; only all-time answers
    expect(r).toMatchObject({ tier: 'type_juris', windowTier: 'all', n: 4 });
  });

  it('★ out-of-range samples (negative, > 730) never enter a cell', () => {
    const rows = statsMirror([
      ...rep(5, { type: 'IPR', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: -3 }),
      ...rep(5, { type: 'IPR', juris: 'Seattle', cycle: null, clock: 'intake_to_approval', days: 731 }),
    ]);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B — the migration, as text
// ---------------------------------------------------------------------------

function fnBody(name: string): string {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const start = SQL.search(re);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const rest = SQL.slice(start);
  const end = rest.search(/\$function\$\s*;/);
  return rest.slice(0, end);
}

describe('fix-585 §B — the SQL and its TS twin say the same thing', () => {
  it('★★★ the constants are the same numbers in both places', () => {
    const body = fnBody('bp_learn_days_explain');
    expect(body).toMatch(new RegExp(`c_learn_min_samples\\s+CONSTANT integer := ${LEARN_MIN_SAMPLES};`));
    expect(body).toMatch(new RegExp(`c_last_resort_min\\s+CONSTANT integer := ${LAST_RESORT_MIN_SAMPLES};`));
    expect(body).toMatch(/s\.scope = 'type_juris' AND s\.window_tier = 'all' AND s\.n >= c_last_resort_min/);
    expect(body).toMatch(new RegExp(`c_our_clock_floor_days\\s+CONSTANT integer := ${OUR_CLOCK_FLOOR_DAYS};`));
    expect(body).toMatch(new RegExp(`c_clamp_low\\s+CONSTANT numeric := ${CLAMP_LOW};`));
    expect(body).toMatch(new RegExp(`c_clamp_high\\s+CONSTANT numeric := ${CLAMP_HIGH.toFixed(1)};`));
    expect(fnBody('bp_duration_stats')).toMatch(new RegExp(`days BETWEEN 0 AND ${OUTLIER_CAP_DAYS}`));
  });

  it('★★★ the tier and window order match walkLadder', () => {
    const body = fnBody('bp_learn_days_explain');
    const scopes = [...body.matchAll(/WHEN '(type_juris_cycle|type_juris)'\s+THEN (\d)/g)].map((m) => [m[1], Number(m[2])]);
    expect(scopes).toEqual([['type_juris_cycle', 1], ['type_juris', 2]]);
    expect(SCOPE_ORDER).toEqual(['type_juris_cycle', 'type_juris']);
    const windows = [...body.matchAll(/WHEN '(90d|180d|365d)'\s+THEN (\d)/g)].map((m) => m[1]);
    expect(windows).toEqual(['90d', '180d', '365d']);
    expect(WINDOW_ORDER).toEqual(['90d', '180d', '365d', 'all']);
  });

  it('★★★ RULING 2026-09-29 — the SQL has no cross-jurisdiction tier anywhere', () => {
    expect(SQL).not.toMatch(/'type_cycle'|'type'\s*(THEN|END|,|\))/);
    const stats = fnBody('bp_duration_stats');
    const sets = stats.slice(stats.indexOf('GROUPING SETS'), stats.indexOf('GROUPING SETS') + 200);
    const groups = sets.match(/\(ptype[^)]*\)/g)!;
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g).toContain('pjuris');
    expect(stats).toMatch(/AND pjuris IS NOT NULL/);
    // the ladder filters on juris for every tier
    expect(fnBody('bp_learn_days_explain')).toMatch(/WHERE s\.juris = p_juris\s+AND \(/);
  });

  it('★★★ MEDIAN, NOT AVERAGE — no AVG anywhere in the new learner', () => {
    expect(SQL).not.toMatch(/\bavg\s*\(/i);
    expect(fnBody('bp_duration_stats')).toMatch(/percentile_cont\(0\.5\)[^;]*::numeric\)/);
  });

  it('★★★ bp_learn_days reads the ladder, which reads bp_duration_stats — policy is no longer first', () => {
    expect(fnBody('bp_learn_days')).toMatch(/bp_learn_days_explain\(/);
    const explain = fnBody('bp_learn_days_explain');
    const statsAt = explain.indexOf('bp_duration_stats(');
    const policyReturnAt = explain.search(/RETURN QUERY SELECT v_policy, 'policy'/);
    expect(statsAt).toBeGreaterThan(0);
    expect(policyReturnAt).toBeGreaterThan(statsAt);
  });

  it('★★ the 4-arg bp_learn_days is dropped, not overloaded (fix-438)', () => {
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.bp_learn_days\(text, text, text, uuid\);/);
    expect(fnBody('bp_learn_days')).toMatch(/p_cycle\s+integer DEFAULT NULL/);
    expect(fnBody('bp_learn_days')).toMatch(/p_tenant\s+uuid\s+DEFAULT NULL/);
  });

  it('★★ never anon (fix-157)', () => {
    for (const sig of [
      'bp_duration_stats(uuid, text, text)',
      'bp_learn_days_explain(text, text, text, uuid, integer)',
      'bp_learn_days(text, text, text, uuid, integer)',
      'bp_learned_durations()',
    ]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${sig}`);
    }
    expect(SQL).not.toMatch(/GRANT[^;]*\banon\b/i);
  });

  it('★★★ policy VALUES are not edited (brief §6)', () => {
    expect(SQL).not.toMatch(/\b(update|insert\s+into|delete\s+from)\s+(public\.)?permit_type_defaults\b/i);
  });

  it('★★★ no target is written by the migration — only the engine writes, on the next recompute', () => {
    expect(SQL).not.toMatch(/\bupdate\s+(public\.)?permits\b/i);
    expect(SQL).not.toMatch(/\b(perform|select)\s+(public\.)?bp_recompute_target_submits\s*\(/i);
  });

  it('★★★ recompute: done is done — the patch skips approved/issued, AFTER the manual guard (which is kept)', () => {
    // The anchor contains the manual CONTINUE verbatim, and the replacement
    // re-emits it FIRST: a target_submit_is_manual row is still skipped before
    // anything else runs.
    const a2 = MIGRATION.match(/a2 constant text :=\s*\n\s*E'([^']*)'/)![1]!;
    expect(a2).toContain('IF COALESCE(v_permit.target_submit_is_manual, false) THEN CONTINUE; END IF;');
    const r2 = MIGRATION.slice(MIGRATION.indexOf('r2 constant text'), MIGRATION.indexOf('BEGIN', MIGRATION.indexOf('r2 constant text')));
    const manualAt = r2.indexOf('target_submit_is_manual');
    const doneAt = r2.indexOf('v_permit.approval_date IS NOT NULL OR v_permit.actual_issue IS NOT NULL');
    expect(manualAt).toBeGreaterThan(0);
    expect(doneAt).toBeGreaterThan(manualAt);
    // Anchors must match exactly once or the migration aborts.
    expect(MIGRATION).toContain("anchor a1 not found exactly once");
    expect(MIGRATION).toContain("anchor a2 not found exactly once");
  });

  it('★★ it asserts its own change landed (fix-540)', () => {
    expect(MIGRATION).toContain('bp_learn_days must have exactly one overload');
    expect(MIGRATION).toContain('recompute guard did not land');
  });
});
