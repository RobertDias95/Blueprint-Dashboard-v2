// ===========================================================================
// fix-585 — ONE LEARNER, AND THE CYCLE IT IS IN
// ===========================================================================
//
// ★★★ THIS FILE COMPUTES NO MEDIAN. The learner is `bp_duration_stats` in
//     Postgres (migrations/fix_585_one_learner.sql): one row per cell,
//     (type, juris, cycle_index, clock, scope, window_tier, n, median_days).
//     `bp_learned_durations()` hands those rows to the client.
//
// ★★ What lives here is the READER of those rows — the fallback ladder that
//    `bp_learn_days_explain` walks in SQL, written once more in TS so that
//      (a) CI, which has no live database, can pin the ladder's behaviour, and
//      (b) the client-rewire ticket can point the client at `bp_learned_durations()` and walk
//          the SAME ladder over the SAME rows, instead of scheduleBenchmarks.ts
//          keeping its own.
//    The SQL is the implementation. This is its twin, and
//    `DurationLadderFix585.test.ts` asserts the constants and the tier order
//    match the migration text — the two-writers-of-one-rule guard.
//
// ★★★ DurationLearnerCensusFix585.test.ts fails if anything else in src/
//     computes a duration median/average from cycle dates without reading
//     these rows. That is what stops a third implementation.

/** Brief §3: a tier may only answer with at least this many samples. The
 *  benchmark DISPLAY uses 3 (D-2026-07-28, shown with a ±); a number that
 *  silently moves live targets earns a higher bar. */
export const LEARN_MIN_SAMPLES = 5;

/** Bobby, 2026-09-29: *"if we've only done one project there, we use whatever
 *  data we do have."* The type×juris ALL-TIME window — the last learned rung —
 *  answers with any history at all. Every other window needs LEARN_MIN_SAMPLES. */
export const LAST_RESORT_MIN_SAMPLES = 1;

/** Brief §3: OUR clock at cycle 3–4 is survivorship-biased (a 0-day median
 *  means "trivial correction, resubmitted same day", not capability). */
export const OUR_CLOCK_FLOOR_DAYS = 3;

/** Brief §2: a learned value is clamped to [policy × LOW, policy × HIGH]. */
export const CLAMP_LOW = 0.5;
export const CLAMP_HIGH = 2.0;

/** Same cap as fix-253 and scheduleBenchmarks.OUTLIER_HARD_CAP_DAYS. */
export const OUTLIER_CAP_DAYS = 730;

export type DurationClock =
  | 'city_review'
  | 'our_turnaround'
  | 'intake_to_approval'
  | 'c1_resub_offset';

/** The two clocks measured per review cycle. The other two span the permit. */
export const PER_CYCLE_CLOCKS: ReadonlySet<DurationClock> = new Set([
  'city_review',
  'our_turnaround',
]);

/** ★★★ Both scopes are WITHIN one jurisdiction (Bobby, 2026-09-29, overriding
 *  the brief's type×cycle and type tiers): a city never borrows another city's
 *  history. */
export type LadderScope = 'type_juris_cycle' | 'type_juris';
export type WindowTier = '90d' | '180d' | '365d' | 'all';

/** ★ Most specific first. The order IS the ladder. */
export const SCOPE_ORDER: readonly LadderScope[] = ['type_juris_cycle', 'type_juris'];
export const WINDOW_ORDER: readonly WindowTier[] = ['90d', '180d', '365d', 'all'];

/** One row of `bp_learned_durations()` — exactly the SQL shape. */
export interface DurationStatRow {
  type: string;
  juris: string | null;
  cycle_index: number | null;
  clock: DurationClock;
  scope: LadderScope;
  window_tier: WindowTier;
  n: number;
  median_days: number;
}

export type LadderTier = LadderScope | 'policy' | 'hardcoded' | 'none';

export interface LadderAnswer {
  days: number | null;
  tier: LadderTier;
  windowTier: WindowTier | null;
  n: number;
  /** The raw median before the floor and clamp. Null off the learned tiers. */
  learnedDays: number | null;
  policyDays: number | null;
  clamped: boolean;
}

/** `bp_learn_days`' unchanged hardcoded table (whole-permit clocks only). */
export const HARDCODED_INTAKE_TO_APPROVAL: Readonly<Record<string, number>> = {
  'Building Permit': 210,
  Demolition: 60,
  ULS: 90,
  IPR: 30,
  LBA: 120,
  Condo: 180,
  'Short Plat': 180,
  SIP: 60,
  'SDOT Tree': 45,
  TRAO: 30,
  'PAR/Pre-Sub': 30,
};
const HARDCODED_ELSE = 210;

export interface PolicyRow {
  intake_to_approval_days: number | null;
  c1_resub_offset_days: number | null;
}

/** The guardrail for a clock. c1 falls to intake_to_approval / 3 exactly as
 *  fix-249 did (c1_resub_offset_days is unset for every type). */
export function policyDaysFor(clock: DurationClock, policy: PolicyRow | null): number | null {
  if (!policy) return null;
  if (clock === 'intake_to_approval') return policy.intake_to_approval_days;
  if (clock === 'c1_resub_offset') {
    if (policy.c1_resub_offset_days != null) return policy.c1_resub_offset_days;
    return policy.intake_to_approval_days != null
      ? Math.trunc(policy.intake_to_approval_days / 3)
      : null;
  }
  return null;
}

/** Postgres round(numeric): half away from zero. */
function pgRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function scopeMatches(
  row: DurationStatRow,
  juris: string | null,
  cycle: number | null,
): boolean {
  // ★★★ Never another jurisdiction's row, on any tier.
  if (juris == null || row.juris !== juris) return false;
  if (row.scope === 'type_juris_cycle') return cycle != null && row.cycle_index === cycle;
  return row.scope === 'type_juris';
}

function enoughSamples(row: DurationStatRow): boolean {
  if (row.n >= LEARN_MIN_SAMPLES) return true;
  return row.scope === 'type_juris' && row.window_tier === 'all' && row.n >= LAST_RESORT_MIN_SAMPLES;
}

export interface LadderQuery {
  type: string;
  juris: string | null;
  clock: DurationClock;
  cycle?: number | null;
  policy?: PolicyRow | null;
}

/**
 * ★★★ The ladder, as `bp_learn_days_explain` walks it (Bobby, 2026-09-29):
 *   type×juris×cycle → type×juris → policy → hardcoded
 * each learned tier walking 90d → 180d → 365d → all at n ≥ LEARN_MIN_SAMPLES,
 * except type×juris all-time, which answers at n ≥ LAST_RESORT_MIN_SAMPLES.
 * OUR clock floored; learned values clamped to policy.
 */
export function walkLadder(rows: readonly DurationStatRow[], q: LadderQuery): LadderAnswer {
  const cycle = q.cycle ?? null;
  const policyDays = policyDaysFor(q.clock, q.policy ?? null);

  let best: DurationStatRow | null = null;
  let bestRank = Infinity;
  for (const r of rows) {
    if (r.type !== q.type || r.clock !== q.clock) continue;
    if (!enoughSamples(r)) continue;
    if (!scopeMatches(r, q.juris, cycle)) continue;
    const rank = SCOPE_ORDER.indexOf(r.scope) * 10 + WINDOW_ORDER.indexOf(r.window_tier);
    if (rank < bestRank) {
      best = r;
      bestRank = rank;
    }
  }

  if (best) {
    let floored = best.median_days;
    if (q.clock === 'our_turnaround') floored = Math.max(floored, OUR_CLOCK_FLOOR_DAYS);
    let days = floored;
    if (policyDays != null) {
      days = Math.min(
        Math.max(days, pgRound(policyDays * CLAMP_LOW)),
        pgRound(policyDays * CLAMP_HIGH),
      );
    }
    return {
      days,
      tier: best.scope,
      windowTier: best.window_tier,
      n: best.n,
      learnedDays: best.median_days,
      policyDays,
      clamped: days !== floored,
    };
  }

  if (policyDays != null) {
    return { days: policyDays, tier: 'policy', windowTier: null, n: 0, learnedDays: null, policyDays, clamped: false };
  }

  if (!PER_CYCLE_CLOCKS.has(q.clock)) {
    const base = HARDCODED_INTAKE_TO_APPROVAL[q.type] ?? HARDCODED_ELSE;
    const days = q.clock === 'c1_resub_offset' ? Math.trunc(base / 3) : base;
    return { days, tier: 'hardcoded', windowTier: null, n: 0, learnedDays: null, policyDays: null, clamped: false };
  }

  // ★ A per-cycle clock with no history and no policy has no number.
  return { days: null, tier: 'none', windowTier: null, n: 0, learnedDays: null, policyDays: null, clamped: false };
}
