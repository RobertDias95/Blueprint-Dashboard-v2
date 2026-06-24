import type { IntakeRecord, PermitWithCycles } from './database.types';
import { multiMatchAddress } from './drawScheduleHelpers';

// Q6.3.b: pure helpers for the Seattle Intakes tracker. Mirrors v1's
// renderIntakeTracker (index.html lines 9080-9241): past/future split with
// a 10-business-day past window, week-of-Monday grouping, urgency
// detection within a 7-day forward window, and a 4-state status badge
// derived from the linked permit's cycles.

/** Return an ISO date (YYYY-MM-DD) for N business days before `from`.
 * Walks the calendar one day at a time and skips Sat/Sun. v1 uses a
 * fixed 10-business-day past window for the "Recent Submissions"
 * collapsible. */
export function subtractBusinessDays(from: Date, n: number): string {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `dateStr`, as 'YYYY-MM-DD'. */
export function getWeekMondayKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const dow = d.getDay();
  // Sunday=0 → -6 (back to previous Monday); else -(dow-1).
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Week of May 11 – 15" / "Week of Jun 29 – Jul 3" (month boundary). */
export function getWeekLabel(mondayKey: string): string {
  const mon = new Date(`${mondayKey}T12:00:00`);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const monStr = `${MONTH_SHORT[mon.getMonth()]} ${mon.getDate()}`;
  const friStr =
    mon.getMonth() !== fri.getMonth()
      ? `${MONTH_SHORT[fri.getMonth()]} ${fri.getDate()}`
      : String(fri.getDate());
  return `Week of ${monStr} – ${friStr}`;
}

/** Split intakes around `today` into past (last N business days, sorted
 * most-recent-first) + future (today onward + undated, sorted earliest
 * first). v1 puts undated records in the future bucket. */
export interface PartitionedIntakes {
  past: IntakeRecord[];
  future: IntakeRecord[];
}
export function partitionIntakes(
  records: IntakeRecord[],
  today: Date = new Date(),
  pastBusinessDays = 10,
): PartitionedIntakes {
  const todayStr = (() => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  })();
  const pastCutoff = subtractBusinessDays(today, pastBusinessDays);

  const past = records
    .filter(
      (r) =>
        r.intake_date != null &&
        r.intake_date < todayStr &&
        r.intake_date >= pastCutoff,
    )
    .sort((a, b) =>
      (b.intake_date ?? '').localeCompare(a.intake_date ?? ''),
    );

  const future = records
    .filter(
      (r) => r.intake_date == null || r.intake_date >= todayStr,
    )
    .sort((a, b) =>
      (a.intake_date ?? '9999').localeCompare(b.intake_date ?? '9999'),
    );

  return { past, future };
}

/** Group `records` by week-of-Monday. Records with no intake_date go into
 * a synthetic 'unscheduled' bucket (matching v1 line 9094). Returned in
 * earliest-week-first order; unscheduled always last if present. */
export interface IntakeWeekGroup {
  key: string;
  label: string;
  records: IntakeRecord[];
}
export function groupByWeek(records: IntakeRecord[]): IntakeWeekGroup[] {
  const map = new Map<string, IntakeWeekGroup>();
  for (const r of records) {
    const key = r.intake_date ? getWeekMondayKey(r.intake_date) : 'unscheduled';
    const label = key === 'unscheduled' ? 'Unscheduled' : getWeekLabel(key);
    const group = map.get(key) ?? { key, label, records: [] };
    group.records.push(r);
    map.set(key, group);
  }
  const sorted = Array.from(map.values()).sort((a, b) => {
    if (a.key === 'unscheduled') return 1;
    if (b.key === 'unscheduled') return -1;
    return a.key.localeCompare(b.key);
  });
  return sorted;
}

/** True if the intake_date is within `urgencyDays` of today (inclusive on
 * both ends) AND the linked permit hasn't been submitted. Used to drive
 * the red "Reschedule" badge + "Action needed" week header. */
export function isUrgent(
  intakeDate: string | null,
  isSubmitted: boolean,
  today: Date = new Date(),
  urgencyDays = 7,
): boolean {
  if (!intakeDate || isSubmitted) return false;
  const todayStr = (() => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  })();
  const cutoff = new Date(today);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + urgencyDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return intakeDate >= todayStr && intakeDate <= cutoffStr;
}

/** True if the linked permit has a submitted date on either cycle 0 or
 * cycle 1 — v1's check at line 9129. Returns false for unlinked or
 * missing permits (defensive). */
export function isPermitSubmitted(permit: PermitWithCycles | null | undefined): boolean {
  if (!permit) return false;
  const cycles = permit.permit_cycles ?? [];
  // Look up cycles by cycle_index (not array order) — v1 walks indexed.
  const c0 = cycles.find((c) => c.cycle_index === 1) ?? cycles[0];
  const c1 = cycles.find((c) => c.cycle_index === 2) ?? cycles[1];
  return Boolean(c0?.submitted) || Boolean(c1?.submitted);
}

export type IntakeStatus = 'submitted' | 'reschedule' | 'placeholder' | 'real';

/** Status badge state. Order of precedence:
 *   1. submitted (linked permit has a cycle submitted)
 *   2. reschedule (within urgency window AND not submitted)
 *   3. placeholder (record.is_placeholder=true)
 *   4. real (default)
 */
export function intakeStatus(
  record: IntakeRecord,
  permit: PermitWithCycles | null | undefined,
  today: Date = new Date(),
): IntakeStatus {
  const submitted = isPermitSubmitted(permit);
  if (submitted) return 'submitted';
  if (isUrgent(record.intake_date, false, today)) return 'reschedule';
  if (record.is_placeholder) return 'placeholder';
  return 'real';
}

// fix-199: target_submit vs Seattle intake date — discrepancy spotting. The
// intake slot is when the team submits to Seattle; target_submit is the planned
// submission. A large gap means the slot is scheduled too early/late for where
// the project actually is. Surfaced on the Project Overview Seattle Intake row +
// the Intake Tracker row.

/** Days from a permit's `target_submit` to its `intake_date` — positive when the
 *  intake is AFTER the target submit. Null when either date is missing. UTC-noon
 *  anchor dodges DST / TZ drift. */
export function intakeTargetGapDays(
  intakeDate: string | null | undefined,
  targetSubmit: string | null | undefined,
): number | null {
  if (!intakeDate || !targetSubmit) return null;
  const t = new Date(`${targetSubmit}T12:00:00Z`).getTime();
  const i = new Date(`${intakeDate}T12:00:00Z`).getTime();
  return Math.round((i - t) / 86400000);
}

/** The |gap| (days) beyond which the intake-vs-target-submit discrepancy is
 *  visually flagged. */
export const INTAKE_TARGET_GAP_FLAG_DAYS = 14;

/** True when the intake-vs-target gap is wide enough to flag. */
export function isIntakeTargetGapFlagged(gapDays: number | null): boolean {
  return gapDays !== null && Math.abs(gapDays) > INTAKE_TARGET_GAP_FLAG_DAYS;
}

/** Load coloring for the 8-week count strip. v1 uses green for high
 * counts, amber for low-but-nonzero, dim for zero. */
export type WeekCountTone = 'empty' | 'light' | 'normal' | 'heavy';
export function weekCountTone(n: number): WeekCountTone {
  if (n === 0) return 'empty';
  if (n < 2) return 'light';
  if (n < 4) return 'normal';
  return 'heavy';
}

/** Apply the v2 address search across all intake records. Multi-token
 * (matches both space and comma separators). Returns input unchanged when
 * query is blank. Defensive against null addresses. */
export function searchIntakes(
  records: IntakeRecord[],
  query: string,
): IntakeRecord[] {
  if (!query.trim()) return records;
  return records.filter((r) => {
    if (!r.address) return false;
    return multiMatchAddress(query, r.address);
  });
}
