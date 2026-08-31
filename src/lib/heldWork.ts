import { holdKind, type PermitHold, type ProjectHold } from './database.types';
import { isPermitHeld } from './permitHoldWindows';

// ===========================================================================
// ★★★ fix-409 — HELD WORK KNOWS IT IS HELD
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039):
//
//   "the default is you show all active projects/permits. anything with a hold
//    gets auto turned off, but you can switch that on/off in the my tasks/my
//    boards. and maybe when you turn it on in my tasks or my board, it will
//    turn them on together — that way they live together in display."
//
//   "it primarily lives in the my tasks and my board. the project overview
//    should show everything even if hold since this is the holistic view."
//
//   "an on hold chip/color filter or something to tell the difference. that
//    should be on the project overview too."
//
// ---------------------------------------------------------------------------
// ★★★ THIS FILE ADDS NO SECOND DEFINITION OF "HELD"
// ---------------------------------------------------------------------------
//
// `isPermitHeld` (fix-390/391, permitHoldWindows.ts) already answers "is this
// paused, at either scope", and `myBoard.prepare()` already resolves it once
// per permit. This module is the TASK-shaped adapter over that one answer plus
// the row that EXPLAINS it, so a chip can say which hold it is.
//
// ★★★ "LIVE" IS `hold_end === null`, NOT A DATE COMPARISON — AND THE BRIEF SAID
// OTHERWISE. The fix-409 brief defined live as "hold_end IS NULL OR hold_end >=
// current_date". Every shipped surface in this app — `activeHold`,
// `activeHoldProjectIds`, `activeHoldPermitIds`, `activeHoldByProjectId`, the
// HoldBadge that feeds off them — uses the OPEN ROW, and the DB backs that with
// a partial unique index allowing at most one open row per project/permit.
//
// The two differ on exactly one population and it is the wrong one to get
// wrong: a hold RELEASED TODAY has `hold_end = today`, so the brief's rule
// would keep it "live" for the rest of the day. Somebody who just lifted a hold
// would watch the work stay hidden. The brief itself said "if the existing
// badge uses something else, use that and say so" — it does, so this does, and
// this paragraph is the saying so.
//
// ★★★ CANCEL IS NOT HOLD, AND IS OUT OF SCOPE. fix-262 made cancel a project
// OUTCOME; fix-264 already drops cancelled projects' work from every live-work
// surface, so a cancelled task never reaches the filter below. The only thing
// this ticket does about cancel is refuse to MISLABEL it: `holdRowFor` returns
// the open row whatever its kind, and HoldBadge already renders 'cancelled'
// differently, so a cancelled item that does render (the project overview,
// which filters nothing) reads "Cancelled" rather than "On hold".

/** The two sets every held-work question is asked against. Built once per
 *  render from the bulk hold fetches both pages already make. */
export interface HeldSets {
  heldProjectIds: ReadonlySet<string>;
  heldPermitIds: ReadonlySet<number>;
}

/** A row shaped enough to ask "is this held" — a task, a board item, anything
 *  that hangs off a permit inside a project. */
export interface HeldWorkRef {
  /** ★ fix-460: nullable because a TEAM TASK belongs to no permit and no
   *  project. Every held-work question answers "not held" for such a row — a
   *  hold is a property of a permit or a project, and it has neither. */
  permit_id: number | null;
  project_id: string | null;
}

/** The minimal open-row shapes, so callers can pass the raw arrays their
 *  queries already returned without importing a set helper.
 *
 *  ★★ THE RAW-ARRAY SHAPE IS DELIBERATE AND IS fix-390's OWN LESSON, restated:
 *  `useProjectHolds` is mocked — often WHOLESALE, not partially — by 34 test
 *  files, so a new export there is a new way for a suite that never heard of
 *  this ticket to break. Taking the arrays keeps the dependency one-way: this
 *  module knows nothing about hooks, and the hooks gain nothing new to stub. */
export type ProjectHoldRow = Pick<ProjectHold, 'project_id' | 'hold_end'> & {
  kind?: string | null;
};
export type PermitHoldRow = Pick<PermitHold, 'permit_id' | 'hold_end'>;

/**
 * Resolve the two sets from raw rows.
 *
 * ★ PROJECT ROWS ARE FILTERED TO `kind === 'hold'`; PERMIT ROWS ARE NOT. That
 * asymmetry is not an oversight — `permit_holds` has a DB CHECK admitting
 * 'hold' and nothing else (fix-390: a dead permit is *Withdrawn* at the portal,
 * not cancelled), so there is no second kind to filter out. `prepare()` in
 * myBoard.ts makes exactly the same split; this is the same rule in the one
 * place My Tasks can reach.
 */
export function heldSetsFrom(
  projectHolds: ReadonlyArray<ProjectHoldRow> | null | undefined,
  permitHolds: ReadonlyArray<PermitHoldRow> | null | undefined,
): HeldSets {
  const heldProjectIds = new Set<string>();
  for (const h of projectHolds ?? []) {
    if (h.hold_end === null && holdKind(h as ProjectHold) === 'hold') {
      heldProjectIds.add(h.project_id);
    }
  }
  const heldPermitIds = new Set<number>();
  for (const h of permitHolds ?? []) {
    if (h.hold_end === null) heldPermitIds.add(h.permit_id);
  }
  return { heldProjectIds, heldPermitIds };
}

/** An empty answer, for the frame before the hold queries land. Nothing is
 *  held until we know otherwise — hiding work on a maybe would be worse than
 *  showing it for a frame. */
export const NO_HELD_WORK: HeldSets = {
  heldProjectIds: new Set<string>(),
  heldPermitIds: new Set<number>(),
};

/**
 * ★★★ THE PREDICATE. Is this task/row paused right now?
 *
 * ★ It is `isPermitHeld` with a task-shaped argument, and nothing else. The
 * one-way rule (a project hold covers its permits; a permit hold covers
 * nothing above it) is enforced there and must not be restated here.
 */
export function isHeldWork(
  ref: HeldWorkRef | null | undefined,
  sets: HeldSets = NO_HELD_WORK,
): boolean {
  if (!ref) return false;
  return isPermitHeld(
    { id: ref.permit_id, project_id: ref.project_id },
    sets.heldProjectIds,
    sets.heldPermitIds,
  );
}

/**
 * ★★ THE FILTER, as one function so every list asks it the same way.
 *
 * `show === true` returns the input array UNCHANGED (same reference), which is
 * what keeps the "show held work" path free of a needless copy on every render.
 */
export function excludeHeldWork<T extends HeldWorkRef>(
  rows: ReadonlyArray<T>,
  sets: HeldSets,
  show: boolean,
): ReadonlyArray<T> {
  if (show) return rows;
  if (sets.heldProjectIds.size === 0 && sets.heldPermitIds.size === 0) return rows;
  return rows.filter((r) => !isHeldWork(r, sets));
}

/**
 * ★★ EXACTLY WHAT `HoldBadge` CONSUMES, and nothing more.
 *
 * The chip is carried ON the row (a forecast item, a queue row) rather than
 * looked up by the component that draws it, so the board's single answer about
 * a permit travels with the row instead of being re-derived at render time by
 * a component three levels down — fix-329's rule about two halves of one screen
 * computing the same thing twice.
 */
export type HoldChipRow = Pick<
  ProjectHold,
  'reason' | 'hold_start' | 'note' | 'kind'
>;

/** The loose row shape both hold tables satisfy, so a caller can pass whatever
 *  its query returned. Only `hold_end` is required to decide openness. */
export interface HoldChipSource {
  hold_end: string | null;
  reason?: string | null;
  note?: string | null;
  hold_start?: string | null;
  kind?: string | null;
}

function chipOf(h: HoldChipSource): HoldChipRow {
  return {
    reason: h.reason ?? '',
    hold_start: h.hold_start ?? '',
    note: h.note ?? null,
    kind: h.kind === 'cancelled' ? 'cancelled' : 'hold',
  };
}

/** The open hold rows, indexed, so a chip can name the reason without a
 *  per-row query. Built from the same arrays as {@link heldSetsFrom}. */
export interface HoldRowIndex {
  byProjectId: ReadonlyMap<string, HoldChipRow>;
  byPermitId: ReadonlyMap<number, HoldChipRow>;
}

export const NO_HOLD_ROWS: HoldRowIndex = {
  byProjectId: new Map(),
  byPermitId: new Map(),
};

/**
 * Index the OPEN rows for the chip.
 *
 * ★★ PROJECT ROWS OF **EITHER** KIND ARE INDEXED HERE, unlike
 * {@link heldSetsFrom}. The sets answer "should this be hidden", which cancel
 * must never influence; this answers "what does this row say about itself",
 * and a cancelled project's task must read *Cancelled*, not *On hold*. Two
 * questions, two filters, on purpose — see the header note.
 */
export function holdRowIndex(
  projectHolds:
    | ReadonlyArray<HoldChipSource & { project_id: string }>
    | null
    | undefined,
  permitHolds:
    | ReadonlyArray<HoldChipSource & { permit_id: number }>
    | null
    | undefined,
): HoldRowIndex {
  const byProjectId = new Map<string, HoldChipRow>();
  for (const h of projectHolds ?? []) {
    if (h.hold_end === null) byProjectId.set(h.project_id, chipOf(h));
  }
  const byPermitId = new Map<number, HoldChipRow>();
  for (const h of permitHolds ?? []) {
    // ★ permit_holds admits only kind='hold' (DB CHECK, fix-390), so a permit
    //   chip can never read "Cancelled" — chipOf defaults it correctly anyway.
    if (h.hold_end === null) byPermitId.set(h.permit_id, chipOf(h));
  }
  return { byProjectId, byPermitId };
}

/**
 * ★★★ WHICH HOLD EXPLAINS THIS ROW — the permit's own first, then its
 * project's.
 *
 * ★ THE ORDER IS THE INFORMATION. A permit deliberately paused inside a moving
 * project is the more specific and more surprising fact; if both are true, the
 * permit's own reason is the one that tells you something you could not have
 * guessed from the project header.
 *
 * ★★ IN PRACTICE ONLY THE FALLBACK FIRES TODAY. Re-measured on prod
 * 2026-08-26 (read-only): 3 live project holds, **0 live permit holds**, so
 * every chip anybody will actually see comes from the project branch. The
 * permit branch is first because it is the correct precedence the day somebody
 * uses fix-390's control, not because it is the common case.
 *
 * ★ Returns null for work that is not parked at all. The caller renders
 * nothing; HoldBadge already returns null for a null hold, so a caller that
 * passes this straight through needs no conditional of its own.
 */
export function holdRowFor(
  ref: HeldWorkRef | null | undefined,
  index: HoldRowIndex = NO_HOLD_ROWS,
): HoldChipRow | null {
  if (!ref) return null;
  // ★ fix-460: a team task has neither id, so neither index can hold a row for
  //   it. `?? null` already says "no hold"; the guards just keep a null out of
  //   a Map.get typed for a key.
  return (
    (ref.permit_id !== null ? index.byPermitId.get(ref.permit_id) : undefined) ??
    (ref.project_id !== null ? index.byProjectId.get(ref.project_id) : undefined) ??
    null
  );
}
