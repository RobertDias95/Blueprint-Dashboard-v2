import type { Permit, PermitCycle, Stage } from './database.types';

// Q9.5.c: per-permit urgency predicate ported verbatim from v1
// (Blueprint-Dashboard-/index.html:2520-2577). The dashboard, my-tasks,
// and reports surfaces all use this to color permits red/yellow when
// they're overdue or near a target.
//
// Predicate table (REBUILD_V1_VISUAL_SPEC.md §4.6.b):
//   de — businessDaysUntil(target_submit):
//        bd < 0 → red ; bd ≤ 5 → yellow ; else ok ; no target → ok
//   pm — businessDaysUntil(latest city_target across cycles):
//        same red/yellow/ok thresholds as de
//   co — businessDaysSince(latest open corrIssued without resubmitted,
//        else latest corrIssued):
//        bdAgo ≥ 10 → red ; bdAgo ≥ 5 → yellow ; else ok
//   ap — businessDaysSince(approval_date):
//        bdAgo ≥ 20 → yellow ; else ok (never red)
//   is — always ok (issued permits don't get urgency colors)

export type UrgencyLevel = 'red' | 'yellow' | 'ok';

/** Business days between today and `target` (target − today). Returns
 * null if `target` is missing/unparseable. Skips Saturdays + Sundays.
 * Negative = target is in the past. Zero = today. */
export function businessDaysUntil(
  target: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!target) return null;
  const targetDate = parseISODate(target);
  if (!targetDate) return null;
  return countBusinessDays(now, targetDate);
}

/** Business days since `date` (today − date). Returns null if missing.
 * Negative = date is in the future. Positive = date was N business days
 * ago. */
export function businessDaysSince(
  date: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!date) return null;
  const startDate = parseISODate(date);
  if (!startDate) return null;
  return countBusinessDays(startDate, now);
}

/** Per-permit urgency for a given stage. `cycles` defaults to the
 * permit's own cycles when not supplied — accepting it as a separate
 * arg makes it cheap to call this from a memoized parent that already
 * has the cycle data in hand. */
export function permitUrgency(
  permit: Permit,
  cycles: PermitCycle[],
  stage: Stage,
  now: Date = new Date(),
): UrgencyLevel {
  if (stage === 'de') {
    const bd = businessDaysUntil(permit.target_submit, now);
    if (bd === null) return 'ok';
    if (bd < 0) return 'red';
    if (bd <= 5) return 'yellow';
    return 'ok';
  }

  if (stage === 'pm') {
    // Latest city_target across all cycles — v1 sorts ascending and
    // takes the last element. Empty/null filtered out.
    const cityTargets = cycles
      .map((c) => c.city_target ?? '')
      .filter(Boolean)
      .sort();
    const latest = cityTargets[cityTargets.length - 1];
    if (!latest) return 'ok';
    const bd = businessDaysUntil(latest, now);
    if (bd === null) return 'ok';
    if (bd < 0) return 'red';
    if (bd <= 5) return 'yellow';
    return 'ok';
  }

  if (stage === 'co') {
    // First preference: most recent corr_issued WITHOUT a resubmitted
    // (the open correction round). Fallback: most recent corr_issued.
    // v1 reverses the cycles array + .find()'s — we sort descending by
    // cycle_index for the same effect, but the predicate is "find the
    // open one, else find the latest any-state."
    const sortedDesc = [...cycles].sort(
      (a, b) => b.cycle_index - a.cycle_index,
    );
    const openCycle = sortedDesc.find(
      (c) => c.corr_issued && !c.resubmitted,
    );
    const anyCorrCycle = sortedDesc.find((c) => c.corr_issued);
    const issued = (openCycle ?? anyCorrCycle)?.corr_issued;
    if (!issued) return 'ok';
    const bdAgo = businessDaysSince(issued, now);
    if (bdAgo === null) return 'ok';
    if (bdAgo >= 10) return 'red';
    if (bdAgo >= 5) return 'yellow';
    return 'ok';
  }

  if (stage === 'ap') {
    const bdAgo = businessDaysSince(permit.approval_date, now);
    if (bdAgo === null) return 'ok';
    if (bdAgo >= 20) return 'yellow';
    return 'ok';
  }

  // stage === 'is' — issued permits are intentionally never urgency-colored.
  return 'ok';
}

/** Worst-of-group urgency. Used by v1's renderDashboard to apply a
 * single border + bg tint at the address-group level even when only
 * one permit at that address is urgent. */
export function cardUrgency(
  permits: Array<{ permit: Permit; cycles: PermitCycle[] }>,
  stage: Stage,
  now: Date = new Date(),
): UrgencyLevel {
  const levels: UrgencyLevel[] = ['red', 'yellow', 'ok'];
  let worst = 2; // index into levels
  for (const { permit, cycles } of permits) {
    const u = permitUrgency(permit, cycles, stage, now);
    const idx = levels.indexOf(u);
    if (idx < worst) worst = idx;
  }
  return levels[worst];
}

// ============================================================
// Internal date utilities
// ============================================================

/** Parse 'YYYY-MM-DD' into a local-noon Date so timezone shifts don't
 * accidentally jump a day. Returns null on unparseable input. */
function parseISODate(s: string): Date | null {
  // Accept the ISO date part only; ignore any time/timezone suffix.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(year, month, day, 12, 0, 0, 0); // local noon
}

/** Count business days from `from` to `to` (skipping Sat/Sun). Returns
 * a signed count: positive when `to` is later, negative when earlier,
 * zero when they're the same calendar date. */
function countBusinessDays(from: Date, to: Date): number {
  // Normalize both to local-noon so DST + intraday differences don't
  // skew the day count.
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 12);
  if (a.getTime() === b.getTime()) return 0;
  const sign = a.getTime() < b.getTime() ? 1 : -1;
  const [earlier, later] = sign === 1 ? [a, b] : [b, a];
  let count = 0;
  const cursor = new Date(earlier);
  while (cursor.getTime() < later.getTime()) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count * sign;
}
