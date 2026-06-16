import type { ProjectHold } from './database.types';

// fix-170 (On-Hold Phase 2): the canonical hold-overlap math.
//
// Bobby's principle: "whatever our time is without the hold is the time we're
// accountable for." For any measured turnaround interval [start, end] on a
// permit, the ACCOUNTABLE duration is:
//
//   (end − start) − (calendar days within [start, end] that fall inside any of
//                    the project's hold windows)
//
// A hold window is [hold_start, hold_end]; an ACTIVE (open) hold uses
// hold_end = today. Holds are whole-project (Phase 1), so a permit reads all of
// its project's holds. This generalizes "restart at hold-lift" (a hold at the
// end of the interval → subtracting the overlap == restarting the clock at lift)
// and also handles a hold in the middle or multiple holds (overlaps are
// UNIONed, never double-counted).
//
// Day counting matches the rest of the codebase: each ISO 'YYYY-MM-DD' date is
// anchored to UTC-noon and converted to an integer day index, so overlaps are
// computed exactly (no float drift) and lengths match daysBetween().

const DAY_MS = 24 * 60 * 60 * 1000;

/** A hold window. `end === null` means an active (open) hold → resolved to
 *  today when computing overlap. */
export interface HoldWindow {
  start: string;
  end: string | null;
}

/** Integer day index for an ISO date at UTC-noon, or null when unparseable. */
function dayIndex(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / DAY_MS);
}

/** Day index for "today" (UTC-noon of the local calendar day). Accepts a Date
 *  or ISO override for deterministic tests. */
function todayIndex(today?: Date | string): number {
  if (typeof today === 'string') {
    const idx = dayIndex(today);
    if (idx !== null) return idx;
  }
  const d = today instanceof Date ? today : new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return dayIndex(iso) as number;
}

/** Normalize ProjectHold[] (or already-built HoldWindow[]) to HoldWindow[]. */
export function holdWindows(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
): HoldWindow[] {
  if (!holds) return [];
  return holds.map((h) =>
    'hold_start' in h
      ? { start: h.hold_start, end: h.hold_end }
      : { start: h.start, end: h.end },
  );
}

/** True when any hold is active (open). Drives overdue suppression (effect D). */
export function hasActiveHold(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
): boolean {
  if (!holds) return false;
  return holds.some((h) =>
    'hold_end' in h ? h.hold_end === null : h.end === null,
  );
}

/**
 * Calendar days within [start, end] that fall inside any hold window. Overlaps
 * across multiple holds are UNIONed (a day held by two holds counts once).
 * Active holds resolve their end to `today`. Returns 0 when the interval is
 * invalid (missing/unparseable dates) or there is no overlap.
 */
export function heldOverlapDays(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  today?: Date | string,
): number {
  const s = dayIndex(start);
  const e = dayIndex(end);
  if (s === null || e === null || e <= s) return 0;

  const tIdx = todayIndex(today);
  const windows = holdWindows(holds);

  // Clip each hold window to [s, e]; collect the non-empty clipped intervals.
  const clipped: Array<[number, number]> = [];
  for (const w of windows) {
    const hs = dayIndex(w.start);
    if (hs === null) continue;
    const heRaw = w.end === null ? tIdx : dayIndex(w.end);
    if (heRaw === null) continue;
    if (heRaw < hs) continue; // malformed window
    const lo = Math.max(s, hs);
    const hi = Math.min(e, heRaw);
    if (hi > lo) clipped.push([lo, hi]);
  }
  if (clipped.length === 0) return 0;

  // Union the clipped intervals (sort by start, merge overlaps) and sum lengths.
  clipped.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curLo, curHi] = clipped[0];
  for (let i = 1; i < clipped.length; i++) {
    const [lo, hi] = clipped[i];
    if (lo <= curHi) {
      if (hi > curHi) curHi = hi;
    } else {
      total += curHi - curLo;
      [curLo, curHi] = [lo, hi];
    }
  }
  total += curHi - curLo;
  return total;
}

/**
 * Accountable duration of [start, end] with held days subtracted. Returns null
 * when the interval is invalid (mirrors daysBetween's null contract), so a
 * caller can treat "can't measure" the same as before. Never negative.
 */
export function accountableDays(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  today?: Date | string,
): number | null {
  const s = dayIndex(start);
  const e = dayIndex(end);
  if (s === null || e === null) return null;
  const raw = e - s;
  if (raw <= 0) return raw; // preserve zero / negative intervals as-is
  const overlap = heldOverlapDays(holds, start, end, today);
  return Math.max(0, raw - overlap);
}

/**
 * Days a project has been parked under its CURRENT active (open) hold — i.e.
 * (today − hold_start) for the active hold, clamped ≥ 0; 0 when none is active.
 * Drives projection shifting (effect C): a future projected date is pushed out
 * by this much so it stays realistic while the project is paused. A CLOSED hold
 * does NOT shift a future projection (its time already elapsed and is credited
 * on the measured side via accountableDays — avoids double-counting).
 */
export function activeHoldElapsedDays(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
  today?: Date | string,
): number {
  const windows = holdWindows(holds);
  const tIdx = todayIndex(today);
  let max = 0;
  for (const w of windows) {
    if (w.end !== null) continue; // only the active hold
    const hs = dayIndex(w.start);
    if (hs === null) continue;
    const d = tIdx - hs;
    if (d > max) max = d;
  }
  return max;
}

/**
 * True when [start, end] overlaps ANY hold window (active or closed). Drives
 * estimator-learning sample exclusion (effect E) — a sample whose measured
 * interval touched a hold is dropped so a parked permit never skews the model.
 */
export function intervalOverlapsHold(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
  today?: Date | string,
): boolean {
  return heldOverlapDays(holds, start, end, today) > 0;
}
