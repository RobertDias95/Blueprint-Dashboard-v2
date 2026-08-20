// ===========================================================================
// ★★★ fix-365 — a design manager cannot see whose work is whose
// ===========================================================================
//
// Bobby: *"From the design manager perspective, being able to sort all the
// tasks by their design associates might be a very functional and helpful
// feature. That way if they're working with a design associate, or looking at
// their board through the lens of their design associates, they can organize it
// by that versus having it be jumbled."*
//
// ★★ fix-346 ALREADY PUT THE WORK IN FRONT OF THEM. A design manager is
// auto-co-assigned to their associates' tasks, and fix-346's backfill added 48
// more. So a DM's board already CONTAINS their DAs' work — it just arrives as
// one undifferentiated list.
//
// ---------------------------------------------------------------------------
// ★★★ MEASURED FIRST, and the scale shaped the answer
// ---------------------------------------------------------------------------
// Prod, 2026-08-20:
//
//     Brittani   Marc · Ahmadi · Fisk           20 open tasks
//     Lindsay    Francesca · Ainsley · Trevor   12
//     Derry      Nicky · Qisheng                11
//     Jade       Erick                           9
//
// ★★★ NINE TO TWENTY ROWS. This is a "whose is whose" problem, not a
// data-volume one — so there is no grouping engine here, no saved views and no
// second board. Two pure functions and a remembered preference.
//
// ---------------------------------------------------------------------------
// ★★★ WHICH AXIS WINS: URGENCY, AND PERSON IS THE SUB-DIVISION
// ---------------------------------------------------------------------------
//
// fix-348 rebuilt My Board around dated buckets — past due, today, tomorrow,
// this week, next week — plus a relay model where a row LEAVES its bucket when
// its design half completes. Grouping by associate is a SECOND axis laid over a
// structure that already means something, and one of them has to be outermost.
//
// ★★ PERSON GOES *INSIDE* THE TIME BUCKETS. Person outermost would bury an
// overdue item under a name, and the board's whole job is surfacing what is
// late: a manager scanning for trouble would have to open four named sections to
// find it. Inside, "Past due" still reads first and still carries its count,
// and the split is visible one line down.
//
// ★ Which is also why `groupItems` takes ONE BUCKET'S rows at a time. It cannot
// reorder across buckets because it never sees across them — the axis decision
// is enforced by the shape of the function, not by a convention.

import type { ForecastItem } from './myBoard';

/** One associate's slice of a single time bucket. */
export interface AssociateGroup {
  /** The associate's roster name, or null for the manager's own rows. */
  associate: string | null;
  /** The label a heading shows. */
  label: string;
  items: ForecastItem[];
}

/** ★ Rows that belong to the viewer rather than to any of their associates.
 *  They are NOT dropped: a manager's own work does not stop existing because
 *  they asked to see the split. */
export const OWN_WORK_LABEL = 'Your own work';

/**
 * ★★ WHOSE ROW IS THIS?
 *
 * A forecast row reaches a manager's board two ways, and each names its
 * associate somewhere different:
 *
 *   a TASK       — `assigned_to` is the associate; fix-346's trigger adds the
 *                  MANAGER as a co-assignee and leaves the primary alone, so
 *                  the primary is still the person doing the work.
 *   a MILESTONE  — has no assignee at all. The design associate is the
 *                  PERMIT's `da`, which the caller supplies as a lookup because
 *                  a pure function should not go fetching permits.
 *
 * ★ Only names in `associates` count. A permit whose DA is somebody else's
 * associate is not this manager's row to group — it lands in "your own work",
 * which is where a row with no associate of yours belongs.
 */
export function associateOf(
  item: ForecastItem,
  associates: ReadonlyArray<string>,
  daOfPermit: (permitId: number | null) => string | null,
): string | null {
  const known = new Map(associates.map((a) => [a.trim().toLowerCase(), a]));
  const match = (name: string | null | undefined): string | null => {
    const key = (name ?? '').trim().toLowerCase();
    return key ? (known.get(key) ?? null) : null;
  };
  // ★★★ A TASK IS ITS ASSIGNEE'S, FULL STOP — no fallback.
  //
  // Falling through to the permit's DA looked harmless and was not: a task
  // assigned to the MANAGER, sitting on an associate's permit, would have been
  // filed under the associate. It is the manager's own work on somebody else's
  // project, and saying otherwise puts a row in a 1:1 that has no business
  // being there. The assignee is a direct statement about who is doing the
  // work; the permit's DA is an inference, and an inference must not overrule
  // a statement.
  const assignee = (item.task?.assigned_to ?? '').trim();
  if (assignee) return match(assignee);

  // ★ Only a row with NO assignee at all — a milestone — asks the permit.
  return match(daOfPermit(item.permitId));
}

/**
 * ★★ ONE BUCKET'S ROWS, SPLIT BY ASSOCIATE — order preserved.
 *
 * ★ The groups come out in `associates` order (the roster's own `da_order`,
 * which is the order the Draw Schedule already shows them in), with the
 * manager's own rows LAST. A manager reads their team's work first because
 * that is what they came to the board for; their own is the tail.
 *
 * ★★ AN ASSOCIATE WITH NOTHING IN THIS BUCKET GETS NO HEADING. Measured: three
 * of the eleven mapped associates have zero open tasks (Fisk, Francesca,
 * Qisheng), so a fixed heading per associate would print empty sections on
 * every bucket of every board. The COUNT of a person's work belongs to the
 * control above, not to five repeated empty headings.
 */
export function groupItems(
  items: ReadonlyArray<ForecastItem>,
  associates: ReadonlyArray<string>,
  daOfPermit: (permitId: number | null) => string | null,
): AssociateGroup[] {
  const byName = new Map<string, ForecastItem[]>();
  const own: ForecastItem[] = [];

  for (const item of items) {
    const who = associateOf(item, associates, daOfPermit);
    if (!who) {
      own.push(item);
      continue;
    }
    const list = byName.get(who);
    if (list) list.push(item);
    else byName.set(who, [item]);
  }

  const groups: AssociateGroup[] = [];
  for (const a of associates) {
    const items_ = byName.get(a);
    if (items_ && items_.length > 0) {
      groups.push({ associate: a, label: a, items: items_ });
    }
  }
  if (own.length > 0) {
    groups.push({ associate: null, label: OWN_WORK_LABEL, items: own });
  }
  return groups;
}

/** ★ FOCUS — the other half of the same control. Narrow to one associate, for
 *  a manager preparing for a 1:1. Returns every row when nothing is focused,
 *  so "clear it" restores everything by construction rather than by a second
 *  code path. */
export function focusItems(
  items: ReadonlyArray<ForecastItem>,
  focus: string | null,
  associates: ReadonlyArray<string>,
  daOfPermit: (permitId: number | null) => string | null,
): ForecastItem[] {
  if (!focus) return [...items];
  const target = focus.trim().toLowerCase();
  return items.filter(
    (i) =>
      (associateOf(i, associates, daOfPermit) ?? '').trim().toLowerCase() ===
      target,
  );
}

// ---------------------------------------------------------------------------
// ★ THE REMEMBERED CHOICE — per person, never global
// ---------------------------------------------------------------------------
//
// ★★ Keyed on the AUTH USER ID, exactly like fix-176's scope preference
// (`selfScope.<view>.<userId>`). Two managers on one machine — a real thing in
// this office — must not fight over it, and a shared key is how that happens.
//
// ★ localStorage, not a row. The standing rule for this ticket is that nothing
// writes to the database, and a per-person UI preference does not need to
// travel: a manager who groups their board on a laptop is not surprised to find
// it ungrouped on a machine they have never opened it on.

export type BoardLensMode = 'off' | 'group';

export interface BoardLens {
  mode: BoardLensMode;
  /** The one associate being looked at, or null for all of them. */
  focus: string | null;
}

export const DEFAULT_BOARD_LENS: BoardLens = { mode: 'off', focus: null };

function lensStorageKey(userId: string): string {
  return `boardLens.${userId}`;
}

export function loadBoardLens(userId: string | null | undefined): BoardLens {
  if (!userId || typeof window === 'undefined') return DEFAULT_BOARD_LENS;
  try {
    const raw = window.localStorage.getItem(lensStorageKey(userId));
    if (!raw) return DEFAULT_BOARD_LENS;
    const parsed = JSON.parse(raw) as Partial<BoardLens>;
    return {
      mode: parsed.mode === 'group' ? 'group' : 'off',
      focus:
        typeof parsed.focus === 'string' && parsed.focus.trim()
          ? parsed.focus
          : null,
    };
  } catch {
    // ★ A corrupt or unreadable value is not an error worth showing anybody —
    // it is a preference. Fall back to the default board.
    return DEFAULT_BOARD_LENS;
  }
}

export function saveBoardLens(
  userId: string | null | undefined,
  lens: BoardLens,
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lensStorageKey(userId), JSON.stringify(lens));
  } catch {
    // localStorage full / disabled — persistence is best-effort.
  }
}

/**
 * ★★ A remembered focus on somebody who is no longer your associate is not a
 * focus, it is an empty board. Reconciled on read rather than on write, because
 * the roster changes without this screen being open.
 */
export function reconcileLens(
  lens: BoardLens,
  associates: ReadonlyArray<string>,
): BoardLens {
  if (!lens.focus) return lens;
  const still = associates.some(
    (a) => a.trim().toLowerCase() === lens.focus!.trim().toLowerCase(),
  );
  return still ? lens : { ...lens, focus: null };
}
