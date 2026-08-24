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

// ---------------------------------------------------------------------------
// ★★★ fix-348 — FLAGGED, NOT CHANGED: this rule and fix-238's disagree.
// ---------------------------------------------------------------------------
//
// `taskOwnership` and `unownedSurfacesTo` below have NO non-test callers — a
// grep of src/ finds only this file and BoardOwnershipFix308.test.ts. They were
// written for a queue surface fix-308b never built, and fix-308b's own file
// says so about its siblings.
//
// ★★ THAT MATTERS NOW, because fix-348 made My Board resolve task ownership
// with fix-238's `taskMatchesSelfResolved` — and for an ARCH task the two rules
// give opposite answers:
//
//     this file  (#44)  unowned → the ENT lead, "never the DA, however the
//                       permit is assigned"
//     fix-238    (#3)   unowned arch → the DA (the DA blanket), and an unset
//                       assignee → the discipline's default owner, which for
//                       'arch' IS the DA (fix-230's defaultPrimaryTeamKey)
//
// ★ NO BEHAVIOUR WAS CHANGED HERE. The board never called this, so nothing on
// screen moved; the board simply now uses the SAME rule My Tasks has used since
// fix-238, which is the one the team has actually been working from. But two
// written-down rules that contradict each other is exactly the "confliction"
// this ticket is about, and deleting one of Bobby's stated rules is his call,
// not a side effect of a display fix. Left standing, reported in the PR.
//
// ★ The ENT half of #44 is NOT in conflict and is what the board now does: an
// unassigned 'ent' task reaches the permit's entitlement lead — 274 of the 275
// on prod.

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

// ===========================================================================
// ★★★ fix-348 — ONE DEFINITION OF "WHO IS THE OTHER HALF"
// ===========================================================================
//
// Bobby, on `4137 54th Ave SW · PAR/Pre-Sub`: *"Sitting with the entitlement
// lead"* printed directly above *"Wait — with Cam"*, in the same card. ★ Cam is
// a DA, not an entitlement lead. The sentence and the name disagreed with each
// other inside one row.
//
// ★ REPRODUCED BEFORE DIAGNOSED, as the brief required. Permit 10491 on prod:
// da='Cam', ent_lead='Bobby', target_submit='2026-08-17' (the screenshot's "1d
// past target"), nothing submitted on cycle 0, and exactly one `arch` task,
// open → legShape 'two-leg', designLegStatus 'in-progress' → the ENTITLEMENT
// leg is 'waiting'. Every string on that row is produced here, and the
// counterparty was computed FIVE times in FIVE places:
//
//     milestoneAction        leg-aware  → "Wait — with Cam"                  ✓
//     milestoneWhyYours      leg-aware  → "Not yours yet — with Cam"         ✓
//     buildForecast's `why`  HARDCODED  → "Sitting with the entitlement lead" ✗
//     buildQueue's waiting   HARDCODED  → "With <permit.da>"                  ✗
//     MyBoard's `withWhom`   HARDCODED  → "<permit.ent_lead>"                 ✗
//
// ★★ THE DEFECT IS THE DUPLICATION, NOT THE THREE WRONG BRANCHES. Each copy
// guessed the counterparty from the permit instead of asking the LEG, so each
// was right for exactly one direction of the relay and wrong for the other. One
// function fixes all three at once, and makes "the prose and the name disagree"
// unreachable without deleting it.
//
// ★ THE DIRECTION IS THE WHOLE ANSWER:
//
//     leg = entitlement, waiting  →  design still holds it   →  the DA
//     leg = design,      waiting  →  design finished, ENT holds it → the lead
//
// The second is the OUTGOING handoff (#46 below); the first is INCOMING and is
// not a handoff at all — which is also why the same permit was appearing in
// "Past due" and "Handed off" at once. See buildForecast.

export interface MilestoneCounterparty {
  /** The person's name, or null when the permit has nobody in that seat. */
  name: string | null;
  /** What that seat is called — used when there is no name to print. */
  role: 'design associate' | 'entitlement lead';
  /** ★ "Cam", or "the design associate" when the seat is empty. Never blank,
   *  and a name and a role can never disagree, because it is ONE string. */
  label: string;
}

/** ★ Who holds a WAITING milestone row. The single source for every string on
 *  the board that names the other half. Only meaningful while the relay state
 *  is 'waiting'; a 'mine' row has no counterparty. */
export function milestoneCounterparty(
  leg: 'design' | 'entitlement',
  permit: { da?: string | null; ent_lead?: string | null },
): MilestoneCounterparty {
  const role = leg === 'entitlement' ? 'design associate' : 'entitlement lead';
  const raw = leg === 'entitlement' ? permit.da : permit.ent_lead;
  const name = (raw ?? '').trim() || null;
  return { name, role, label: name ?? `the ${role}` };
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
    // ★ fix-348: this rule was correct and was copied, badly, three times
    // elsewhere. It now lives in milestoneCounterparty and every site — this
    // one, milestoneAction, the forecast's `why`, the queue's waiting detail,
    // and the handed-off row — reads that one answer.
    return `Not yours yet — with ${milestoneCounterparty(leg, permit).label}`;
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
 * ★★★ WHAT A DESIGN ASSOCIATE'S QUEUE HOLDS — THREE DECISIONS, IN ORDER.
 *
 * This set has been ruled on three times. All three are recorded because the
 * shape of the answer changed under it twice, and a reader who sees only the
 * current line would read the middle one as a contradiction rather than as the
 * step it was.
 *
 * ---------------------------------------------------------------------------
 * 1 · fix-308b (register #47) — CORRECTIONS AND INTAKES ONLY
 * ---------------------------------------------------------------------------
 * Bobby: *"For design associates, what they really need to focus on is upcoming
 * intakes, and then your corrections."* `DA_QUEUE_KINDS` above is that ruling
 * in the milestone vocabulary of the time — {intake, corrections} — and its
 * rendered test pinned the exclusion on prod permit 165: DA Cam's queue is
 * EMPTY on a Demolition with target_submit 2026-03-01 and no arch tasks, even
 * though the relay reads that permit's design leg as 'mine'.
 *
 * ---------------------------------------------------------------------------
 * 2 · fix-397 — THE SAME RULING, IN THE NEW VOCABULARY
 * ---------------------------------------------------------------------------
 * fix-397 reshaped the queue from three relay groups into three KINDS
 * (submittal · corrections · city review), leaving `DA_QUEUE_KINDS` with
 * nothing in the queue to filter. It first allowed `submittal`, reasoning that
 * target_submit's design-side verb is "Finish the set" (MILESTONE_VERBS) and
 * that is squarely "what they really need to focus on" — and fix-308b's
 * rendered test caught it. So fix-397 kept the set at {corrections} and said,
 * in as many words, that widening it was *"a product decision for Bobby, not a
 * side effect of a reshape"*.
 *
 * ★ `intake` never mattered either way: it is an entitlement-only milestone
 * (MILESTONE_LEGS), so a DA never held one. Corrections is all that survived
 * the translation.
 *
 * ---------------------------------------------------------------------------
 * 3 · fix-400 — BOBBY MADE THAT DECISION, AND REVERSED THE SUBMITTAL HALF
 * ---------------------------------------------------------------------------
 * Bobby, 2026-08-25:
 *
 *   "DA's project queue should show submittals and corrections. city review is
 *    just an addition to ENT."
 *
 * ★★ So `submittal` is IN, and fix-308b's exclusion of it is SUPERSEDED, NOT
 * MISTAKEN: it was the right call while a DA's dated design work had no home on
 * the queue at all, and fix-397 gave it one.
 *
 * ★★★ `city_review` STAYS OUT, and that half is now twice-ruled. fix-308b's own
 * note records that gating only the stateful loop "let it through the back
 * door" — a permit sitting quietly with the city is neither an intake nor a
 * correction — and Bobby has now said the same thing in his own words. A design
 * associate's list is their WORK, not a status board.
 *
 * ★ Applies ONLY when design is the viewer's every leg (`usesDaQueueShape`),
 * unchanged by this ticket. Somebody who is a DA here and an ENT lead there
 * keeps the full queue, because narrowing it would hide their entitlement work.
 */
export const DA_QUEUE_ROW_KINDS: ReadonlySet<'submittal' | 'corrections' | 'city_review'> =
  new Set(['submittal', 'corrections'] as const);

export function daQueueAllowsRowKind(
  kind: 'submittal' | 'corrections' | 'city_review',
): boolean {
  return DA_QUEUE_ROW_KINDS.has(kind);
}

/**
 * ★ Reuse the forecast's ordering rather than inventing a second sort:
 * most past due first, then today, tomorrow, this week, next week, future.
 * `daysLate` is already positive-is-late, so descending IS that order.
 */
export function byWorstFirst<T extends { daysLate: number }>(a: T, b: T): number {
  return b.daysLate - a.daysLate;
}
