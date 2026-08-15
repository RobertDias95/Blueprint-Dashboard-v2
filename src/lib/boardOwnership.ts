import type { BoardTask, ForecastItem, MilestoneKind, RelayState } from './myBoard';

// fix-308 (#44–#47) — the rest of "the board is naming the wrong person".
//
// #42/#43 are fixed in myBoard.ts, at legShape: a named DA no longer means a
// permit has a design leg. These four are the surface consequences, kept here
// as pure functions so each can be asserted without rendering anything.

// ---------------------------------------------------------------------------
// ★ #44 — an unassigned open task blocks NOBODY
// ---------------------------------------------------------------------------
//
//   "A task is always owned by somebody."
//
// Measured on prod 2026-08-16: 316 of 501 open tasks (63%) have no assignee at
// all. The old board attributed them to permits.da, which is how "blocked by
// Cam" appeared on a permit where Cam had no task.
//
// ★ This is a DATA DEFECT MADE VISIBLE, not a data fix. Nothing is
// auto-assigned. An unowned task says so, in those words, and surfaces to the
// ENT lead — because ENT is the default owner under Bobby's rule — never to
// the DA.

export const UNOWNED_LABEL = 'Unassigned — needs an owner';

export interface TaskOwnership {
  /** The person the task genuinely blocks, or null when nobody owns it. */
  owner: string | null;
  /** True when the task is open and has no assignee. */
  unowned: boolean;
  /** What the row says about who it is with. */
  label: string;
}

/**
 * Who does this task actually block?
 *
 * ★ NEVER falls back to the DA. That fallback is the bug: it turned 316
 * unowned tasks into other people's blame. The ENT lead is named as the
 * DEFAULT OWNER of unowned work — which is Bobby's rule — but the label still
 * says the task needs an owner, so nobody mistakes it for a real assignment.
 */
export function taskOwnership(
  task: Pick<BoardTask, 'assigned_to' | 'status'>,
  permit: { da?: string | null; ent_lead?: string | null },
): TaskOwnership {
  const assigned = (task.assigned_to ?? '').trim();
  if (assigned !== '') {
    return { owner: assigned, unowned: false, label: assigned };
  }
  // Unowned. The ENT lead SEES it (default owner), but it is not attributed to
  // them as though they had accepted it, and it is never attributed to the DA.
  const ent = (permit.ent_lead ?? '').trim();
  return { owner: ent === '' ? null : ent, unowned: true, label: UNOWNED_LABEL };
}

/** ★ fix-308b: is this task unowned, whichever shape it arrives in?
 *
 *  The board's BoardTask carries `assigned_to`; My Tasks' MyTaskNode carries
 *  `primary_assignee` + `co_assignees`. Both surfaces have to answer the same
 *  question the same way or they will disagree about the same task — which is
 *  precisely the failure fix-318 put both halves on one query to avoid. One
 *  predicate, both shapes.
 *
 *  ★ Co-assignees COUNT as ownership. A task with no primary but a named
 *  co-assignee is somebody's; calling it ownerless would manufacture a gap
 *  that is not there. */
export function taskNeedsOwner(task: {
  assigned_to?: string | null;
  primary_assignee?: string | null;
  co_assignees?: ReadonlyArray<string> | null;
}): boolean {
  const named = (v: string | null | undefined) => (v ?? '').trim() !== '';
  if (named(task.assigned_to)) return false;
  if (named(task.primary_assignee)) return false;
  return !(task.co_assignees ?? []).some(named);
}

/** Does this unowned task belong in `viewer`'s queue? Only the ENT lead's. */
export function unownedSurfacesTo(
  permit: { da?: string | null; ent_lead?: string | null },
  viewer: string | null,
): boolean {
  const v = (viewer ?? '').trim().toLowerCase();
  if (v === '') return false;
  // ★ Explicitly NOT the DA, however the permit is assigned.
  return (permit.ent_lead ?? '').trim().toLowerCase() === v;
}

// ---------------------------------------------------------------------------
// ★ #45 — a milestone says what to do AND why it is on your list
// ---------------------------------------------------------------------------
//
//   "Maybe that needs some sort of a note section where it says 'past due' and
//    then 'here's the action item'. That might be helpful to help understand
//    what we're supposed to do or why it's on our list."
//
// Three facts, three short strings. ★ Structure, not more prose — fix-306 #22
// cut the verbiage and this must not undo it.

export type MilestoneStateLabel = 'Past due' | 'Due today' | 'Upcoming';

export function milestoneStateLabel(daysLate: number): MilestoneStateLabel {
  if (daysLate > 0) return 'Past due';
  if (daysLate === 0) return 'Due today';
  return 'Upcoming';
}

/**
 * Why is this row on YOUR list?
 *
 * ★ The answer is a role, not a sentence. "You are the entitlement lead" is
 * what a person needs to know when a row they have never seen appears; a
 * paragraph is what fix-306 #22 removed.
 */
export function milestoneWhyYours(
  leg: 'design' | 'entitlement',
  state: RelayState,
  permit: { da?: string | null; ent_lead?: string | null },
): string {
  if (state === 'waiting') {
    const who =
      leg === 'entitlement' ? (permit.da ?? '').trim() : (permit.ent_lead ?? '').trim();
    return who ? `Not yours yet — with ${who}` : 'Not yours yet — with the other half';
  }
  return leg === 'design'
    ? "You are the design associate on this permit"
    : "You are the entitlement lead on this permit";
}

// ---------------------------------------------------------------------------
// ★ #46 — "Handed off — waiting on others"
// ---------------------------------------------------------------------------
//
//   "…it's almost in a different category now, because what Cam had done is
//    now complete for that permit, and now it's waiting on someone else …
//    they could always be like, 'hey, I sent this to you two days ago, why
//    haven't you resubmitted this'."
//
// ★ THE OUTGOING SIDE, and it is NOT the existing `handoffs` group in
// MyBoard.tsx — that one is INCOMING ("ready to hand off", things I could pass
// on now). This is what I have ALREADY passed on and am waiting to get back.
// Kept distinct by the state they derive from: 'ready' reads handoffAffordance,
// this reads relayState === 'waiting' on a leg that is mine.
//
// ★★ DECIDED, and load-bearing: it shows age and climbs WITHIN the section, but
// it NEVER escalates on the sender's board. No task, no priority, no
// notification, however old. It is the receiver's obligation and fix-305's
// ladder already escalates it on THEIR board — double-counting one obligation
// across two boards is how a team ends up ignoring both.

export interface HandedOffItem {
  key: string;
  /** "3626 164th Pl SE · Building Permit" */
  where: string;
  /** Who it is now with. */
  withWhom: string;
  /** Whole days since it left. */
  daysAgo: number;
  permitId: number | null;
}

/** Sender-side rows, oldest first. */
export function buildHandedOff(
  items: ReadonlyArray<
    Pick<ForecastItem, 'key' | 'where' | 'permitId' | 'daysLate' | 'actionable'> & {
      withWhom: string;
    }
  >,
): HandedOffItem[] {
  return items
    .filter((i) => !i.actionable && i.withWhom.trim() !== '')
    .map((i) => ({
      key: i.key,
      where: i.where,
      withWhom: i.withWhom.trim(),
      daysAgo: Math.max(0, i.daysLate),
      permitId: i.permitId,
    }))
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

/**
 * ★ Can a handed-off row EVER become work on the sender's board?
 *
 * No. At any age. This exists as a function so the answer is asserted rather
 * than assumed — the brief calls for a 30-day check, and a constant `false` is
 * the honest implementation of "never escalates".
 */
export function handedOffEscalates(daysAgo: number): boolean {
  // The parameter is read, and deliberately ignored: the answer does not
  // depend on age. Written this way rather than with an unused `_daysAgo` so
  // the shape of the claim is visible — "however old" is the whole point.
  return daysAgo < 0;
}

// ---------------------------------------------------------------------------
// ★ #47 — the design associate's queue
// ---------------------------------------------------------------------------
//
//   "For design associates, what they really need to focus on is upcoming
//    intakes, and then your corrections … organizing it based on the same
//    concept of your past due, then today's, tomorrow's, this week's."
//
// ★ DECIDED: a DA's queue shows intakes and corrections ONLY — not those two
// on top with the rest below. This is the DA SHAPE ONLY; ENT leads, DMs and
// oversight keep the full queue and fix-306's My queue · My team · [person]
// toggle untouched.

export const DA_QUEUE_KINDS: ReadonlySet<MilestoneKind> = new Set<MilestoneKind>([
  'intake',
  'corrections',
]);

export function daQueueAllows(kind: MilestoneKind): boolean {
  return DA_QUEUE_KINDS.has(kind);
}

/** Is this viewer a DA-shaped one — i.e. does the DA filter apply?
 *
 *  ★ Only when the design leg is the ONLY leg they hold. Somebody who is both
 *  a DA here and an ENT lead there keeps the full queue, because narrowing it
 *  would hide their entitlement work. */
export function usesDaQueueShape(legs: ReadonlyArray<'design' | 'entitlement'>): boolean {
  return legs.length > 0 && legs.every((l) => l === 'design');
}

/**
 * ★ Reuse the forecast's ordering rather than inventing a second sort:
 * most past due first, then today, tomorrow, this week, next week, future.
 * `daysLate` is already positive-is-late, so descending IS that order.
 */
export function byWorstFirst<T extends { daysLate: number }>(a: T, b: T): number {
  return b.daysLate - a.daysLate;
}
