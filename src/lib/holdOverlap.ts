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

// ===========================================================================
// ★★★ fix-668 (P-024) — "HOLD TIME NEVER COUNTS", ON EVERY CLOCK
// ===========================================================================
//
// Bobby, 2026-10-13: *"Hold time never counts."* The two shapes every clock in
// the app reduces to, both answered here so there is one definition:
//
//   1. A SPAN ("how long did X take", "how long since X") — `accountableDays`
//      above: calendar days minus the held days inside the span.
//   2. A DEADLINE ("is X late", "how late") — `holdAdjustedDue` below: the due
//      date moves out by the held days that fell between the clock's start and
//      today, so a clock paused by a hold RESUMES WHERE IT LEFT OFF.
//
// Both read the SAME windows: the project's holds plus the permit's own
// (`holdsForPermit`), merged and de-duplicated by `heldOverlapDays`' union, an
// open hold running to today. Nothing here writes; every answer is computed at
// read time and the stored dates are never touched.

const holdsByPermitRegistry = new WeakMap<
  ReadonlyMap<string, ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>,
  ReadonlyMap<number, ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>
>();

/**
 * ★★ Attach a permit's own holds to a by-project hold map, so every module that
 * already takes `holdsByProjectId` sees permit holds too WITHOUT a new parameter.
 *
 * ★ Why a side table and not a new argument: ten modules and their tests take
 * the by-project map today. A WeakMap keyed on that very map instance lets the
 * one place that builds it (`holdsByProjectId` in useProjectHolds) add the
 * permit half, and `holdsForPermit` read it, while a plain Map built by a test
 * keeps meaning exactly what it meant before (project holds only).
 */
export function attachPermitHolds<
  M extends ReadonlyMap<string, ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>,
>(
  byProject: M,
  byPermit: ReadonlyMap<number, ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>> | null | undefined,
): M {
  if (byPermit && byPermit.size > 0) holdsByPermitRegistry.set(byProject, byPermit);
  return byProject;
}

/**
 * ★★★ Every hold window that pauses THIS permit's clocks: its project's holds
 * plus its own. Reads DOWNWARD only (fix-390's one-way rule) — a permit hold
 * never pauses a sibling permit or the project.
 *
 * `permit.id` may be null (a team task) — then only the project's holds apply.
 */
export function holdsForPermit(
  byProject:
    | ReadonlyMap<string, ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>
    | null
    | undefined,
  permit: { id: number | null; project_id: string | null },
): Array<Pick<ProjectHold, 'hold_start' | 'hold_end'>> {
  if (!byProject) return [];
  const own =
    permit.id !== null ? holdsByPermitRegistry.get(byProject)?.get(permit.id) : undefined;
  const proj = permit.project_id !== null ? byProject.get(permit.project_id) : undefined;
  if (!own || own.length === 0) return proj ? [...proj] : [];
  return [...(proj ?? []), ...own];
}

/** Inverse of `dayIndex`: the index is round(UTC-noon ms / DAY_MS), i.e. the
 *  noon instant rounded UP by half a day, so step back half a day to land on
 *  that noon again. */
function isoFromIndex(idx: number): string {
  return new Date(idx * DAY_MS - DAY_MS / 2).toISOString().slice(0, 10);
}

/**
 * ★★★ A DEADLINE THAT RESUMES WHERE IT LEFT OFF.
 *
 * The clock starts at `anchor` (when the work was handed out — a task's
 * created_at) and has `due − anchor` days of budget. Days spent under a hold
 * between `anchor` and today are not spent, so the effective due date is
 *
 *     today + (budget − accountableDays(anchor → today))
 *
 * which is the stored `due` pushed out by exactly the held days in that span:
 *   - a hold BEFORE the due date moves it out (the brief's rule);
 *   - a hold AFTER the due date, while the work sat late, stops the lateness
 *     growing for those days;
 *   - an OPEN hold keeps pushing it out day by day, so held work never ages;
 *   - no hold ⇒ the stored date, unchanged.
 *
 * `anchor` missing ⇒ the clock is taken to start at `due` itself, so only held
 * days AFTER the due date count — the conservative reading for a date whose
 * start we don't know (a stored milestone the engine recomputes).
 *
 * Returns `due` unchanged when it is missing or unparseable. DISPLAY ONLY: the
 * stored due date is never rewritten.
 */
export function holdAdjustedDue<T extends string | null | undefined>(
  holds:
    | ReadonlyArray<Pick<ProjectHold, 'hold_start' | 'hold_end'>>
    | ReadonlyArray<HoldWindow>
    | null
    | undefined,
  anchor: string | null | undefined,
  due: T,
  today?: Date | string,
): T | string {
  const d = dayIndex(due);
  if (d === null || !holds || holds.length === 0) return due;
  const a = dayIndex(anchor) ?? d;
  const t = todayIndex(today);
  if (t <= a) return due;
  const todayIso = isoFromIndex(t);
  const anchorIso = isoFromIndex(a);
  const held = heldOverlapDays(holds, anchorIso, todayIso, today);
  if (held <= 0) return due;
  return isoFromIndex(d + held);
}

/**
 * ★★ fix-668: the hold index the NEW clocks read (task overdue, urgency, the
 * board's lateness, awaiting-issuance age) — project holds of kind `hold` plus
 * every permit hold, ready for `holdsForPermit`.
 *
 * ★★★ CANCELLED IS NOT A HOLD. A cancel row stops a project for good and is
 * handled by fix-262/264's own rules (its tasks are swept to Cancelled and its
 * work leaves every live list), so it is filtered out here and none of these
 * clocks changes for a cancelled — or a cancelled-then-restored — project.
 *
 * Pure, and takes the RAW rows: My Tasks, My Board and the dashboard already
 * hold them, and the hook modules are mocked by ~40 suites, so no new export is
 * needed from them (fix-390's partial-mock lesson).
 */
export function pauseHoldIndex(
  projectHolds:
    | ReadonlyArray<{
        project_id: string;
        kind?: string | null;
        hold_start?: string | null;
        hold_end?: string | null;
      }>
    | null
    | undefined,
  permitHolds:
    | ReadonlyArray<{ permit_id: number; hold_start?: string | null; hold_end?: string | null }>
    | null
    | undefined,
): Map<string, Array<Pick<ProjectHold, 'hold_start' | 'hold_end'>>> {
  // ★ A row with no start (a hand-built chip fixture) has no window to count.
  const windowOf = (h: { hold_start?: string | null; hold_end?: string | null }) =>
    h.hold_start ? { hold_start: h.hold_start, hold_end: h.hold_end ?? null } : null;
  const byProject = new Map<string, Array<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>();
  for (const h of projectHolds ?? []) {
    if ((h.kind ?? 'hold') !== 'hold') continue;
    const w = windowOf(h);
    if (!w) continue;
    const list = byProject.get(h.project_id) ?? [];
    list.push(w);
    byProject.set(h.project_id, list);
  }
  const byPermit = new Map<number, Array<Pick<ProjectHold, 'hold_start' | 'hold_end'>>>();
  for (const h of permitHolds ?? []) {
    const w = windowOf(h);
    if (!w) continue;
    const list = byPermit.get(h.permit_id) ?? [];
    list.push(w);
    byPermit.set(h.permit_id, list);
  }
  return attachPermitHolds(byProject, byPermit);
}
