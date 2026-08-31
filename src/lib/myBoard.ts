import type {
  MyTaskNode,
  Permit,
  PermitCycle,
  PermitWithCycles,
  Project,
  TeamMember,
} from './database.types';

// fix-303: the board reads tasks through useAllTasks / bp_list_tasks — the
// SAME source My Tasks uses — rather than the raw permit_tasks row shape it
// used in Phases 1-2. One shape means one editor and one write path, which is
// what makes "edit it here, see it there" true rather than aspirational.
export type BoardTask = MyTaskNode;
import { isPermitInCorrections } from './permitStage';
// ★★ fix-388: both halves of "the city has answered" — the terminal-negative
// set completes permitTerminalStatus.ts rather than rivalling it.
import { isTerminalNegativeStatus } from './permitTerminalStatus';
import { statusImpliesSubmitted } from './statusImpliesSubmitted';
import { isSubPermit } from './subPermit';
import {
  daQueueAllowsRowKind,
  milestoneCounterparty,
  milestoneStateLabel,
  milestoneWhyYours,
  usesDaQueueShape,
} from './boardOwnership';
import { isTaskLive } from './taskStatus';
import { isCancelledProject } from './projectViewHelpers';
import { isPermitHeld } from './permitHoldWindows';
import {
  holdRowFor,
  holdRowIndex,
  type HoldChipRow,
  type HoldChipSource,
  type HoldRowIndex,
} from './heldWork';
// ★ fix-397: the queue's vocabulary, bands and sort. Kept in its own module so
// the date arithmetic is unit-testable without building a whole board.
import {
  assembleQueue,
  bandFor,
  daysPastDueFor,
  dueWordsFor,
  type OwnerQueue,
  type QueueKind,
  type QueueRow,
} from './projectQueue';
// ★ fix-348: the board asks "is this task mine?" the way My Tasks does.
import { taskMatchesSelfResolved } from './selfScope';

// fix-298 Phase 1 — My Board: the read-only planner.
//
// ★ IT IS A PLANNER, NOT AN ALERT FEED. "Today, tomorrow, this week, past due
// — here are the things to focus on." Nothing here writes; Phase 2 owns the
// write path and the handoff, Phase 3 the interaction log.
//
// ★ THE RELAY IS DERIVED FROM THE PERMIT, NEVER FROM TASKS. Measured on prod
// 2026-08-13: Fisk holds 26 active permits and has ZERO tasks assigned to him
// by name; Francesca (22) and Qisheng (16) likewise. 183 of 487 live tasks
// carry an assignee at all. A relay built on permit_tasks.assigned_to would be
// blank for exactly the people it exists for. So every state below comes from
// the permit's own columns; tasks are the individual, named exceptions layered
// on top.
//
// ★ MY TASKS IS STRICTLY MY TASKS. MY BOARD IS WHERE MY WORK SITS. Different
// questions, different screens — this module is deliberately standalone and
// shares no state with MyTasks.

// ---------------------------------------------------------------------------
// Thresholds — company-wide, admin-only (brief section 5). One set of numbers
// applying to everyone: per-person thresholds would make the Phase 3
// interaction log unreadable, because "why didn't you act on this" stops being
// answerable once the threshold differed per person.
// ---------------------------------------------------------------------------
export interface BoardThresholds {
  /** Days after intake before unpaid fees are flagged. */
  intakeFeesDays: number;
  /** Days after approval before "approved but not issued" is flagged. */
  approvedNotIssuedDays: number;
  /** Days without any permit movement before it is flagged. */
  permitUntouchedDays: number;
  /** Days of reviewer silence before a chase is prompted. */
  reviewerSilentDays: number;
}

export const DEFAULT_BOARD_THRESHOLDS: BoardThresholds = {
  intakeFeesDays: 3,
  approvedNotIssuedDays: 3,
  permitUntouchedDays: 3,
  reviewerSilentDays: 14,
};

// ---------------------------------------------------------------------------
// ★ Section caps — the board must not grow with the workload.
//
// Miles has 165 active permits across 62 projects; Bobby has 5 across 3. Both
// get the same-SHAPED screen: volume changes what is IN a section, never how
// TALL the page is. Panels scroll independently inside a fixed height, and the
// page itself never scrolls.
//
// Sized against Miles's REAL load, measured on prod 2026-08-13:
//   past due 139 · today 0 · tomorrow 0 · this week 2 · fees past threshold 18
//   · in corrections 21 · 62 projects
//
// So: Past due is the only forecast section that ever needs capping, and it
// needs it badly — 139 rows is precisely the wall of red the brief warns
// teaches people to scroll past red. Today/Tomorrow are uncapped because the
// observed maximum is 1. This week is capped at 8 against an observed 2, as
// headroom rather than a live constraint.
//
// ★ THE CAP NEVER HIDES THE SCALE. Every section reports its TRUE total in the
// header whether or not it is capped — "Waiting on design — 20" above five
// rows. Hiding the number to keep the page short would be the worse failure.
// ---------------------------------------------------------------------------
export const BOARD_SECTION_CAPS = {
  past_due: 5,
  today: Infinity,
  tomorrow: Infinity,
  this_week: 8,
  next_week: 8,
  later: 0,
  /** Applies to each of the three queue groups independently. */
  queueGroup: 5,
} as const;

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------
export interface BoardViewer {
  /** Roster name matching permit.da / permit.ent_lead. null = unmapped. */
  name: string | null;
  /** ★ Oversight is a FLAG, not a role: it ADDS the company-wide view on top
   *  of the person's own scope. Modelling it as a role would strip Gena's DM
   *  view to give her the wide one. */
  isOversight: boolean;
}

/** Resolve the oversight flag from the roster rows a login matched.
 *
 *  team_members carries one row per (name, role) — Bobby holds both 'ent' and
 *  'ent_lead' — so the flag is ORed across every row for that person. Never
 *  hardcodes names: the roster is the source of truth (brief: "do not hardcode
 *  oversight to names"). */
export function resolveBoardViewer(
  name: string | null,
  members: ReadonlyArray<Pick<TeamMember, 'name' | 'is_oversight'>> | undefined,
): BoardViewer {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return { name: null, isOversight: false };
  const isOversight = (members ?? []).some(
    (m) => (m.name ?? '').trim().toLowerCase() === n && m.is_oversight === true,
  );
  return { name, isOversight };
}

// ---------------------------------------------------------------------------
// The relay
// ---------------------------------------------------------------------------
export type BoardLeg = 'design' | 'entitlement';

/** ★ Three states, and the board asks you to act on exactly one.
 *   - 'mine'    — a checkbox and a verb.
 *   - 'waiting' — visible, greyed, NO CHECKBOX. You see where it sits without
 *                 being asked to do anything. This state earns the design.
 *   - 'absent'  — not yours; not rendered at all. */
export type RelayState = 'mine' | 'waiting' | 'absent';

/** Design tasks are the ones on the design side of the board — fix-244 made
 *  `discipline` follow the task's team, so 'arch' IS the design column. */
export function isDesignTask(t: Pick<BoardTask, 'discipline'>): boolean {
  return t.discipline === 'arch';
}

/** ★ Derived from `da IS NULL`, never from the permit type.
 *
 *  A Demolition WITH a DA (Cam holds 41 active permits) genuinely has a design
 *  leg; a non-Demolition without a DA genuinely has none. Hardcoding the type
 *  would get both wrong. */
export type LegShape = 'two-leg' | 'one-leg';

/** ★★ fix-308 (#42/#43) — THE FIX FOR "THE BOARD IS NAMING THE WRONG PERSON".
 *
 *  Bobby sat with Cam on 3921 43rd Ave S, the Demolition permit. The board told
 *  him two contradictory things at once — "ready to hand off" AND "blocked by
 *  Cam" — and he had no task on the permit at all. Verified on prod: permit 165,
 *  7133443-DM, six tasks, EVERY ONE `discipline='ent'`, not one `arch`. The two
 *  open ones belong to Miles and to nobody.
 *
 *  Both lies came from `da IS NOT NULL` alone meaning "this permit has a design
 *  leg". It does not. It means somebody is named in a column.
 *
 *  Bobby's rule, verbatim: "If no tasks for design, then it falls on ENT. If no
 *  tasks for design or ENT, still falls on ENT, because then that is saying
 *  there is nothing holding this permit from advancing."
 *
 *      design tasks exist   ->  design owns the leg
 *      no design tasks      ->  ENT owns
 *      no tasks at all      ->  ENT owns
 *
 *  ★ So ENT is the DEFAULT owner and design owns only when design work
 *  actually exists. Fixing it HERE rather than at each render site is what
 *  makes both symptoms go at once: with shape='one-leg', relayStateFor returns
 *  'absent' for the design leg (no "ready to hand off" to the DA) and 'mine'
 *  for entitlement (ENT owns it), and handoffAffordance returns 'none'.
 *
 *  ★ Measured on prod 2026-08-16, after fix-312: 161 active permits carry a DA
 *  and 100 of them (62%) have never had a single arch task. This is not an edge
 *  case; it is the dominant case.
 *
 *  ★ NOTHING IS AUTO-CREATED. The 100-permit gap is Bobby's to fix in the data.
 *  This only stops the board asserting a design leg that is not there. */
export function legShape(
  permit: Pick<Permit, 'da'>,
  tasks: ReadonlyArray<Pick<BoardTask, 'discipline'>> = [],
): LegShape {
  const da = (permit.da ?? '').trim();
  if (da === '') return 'one-leg';
  // ★ A named DA is necessary but NOT sufficient. Any design task at all —
  // open or resolved — proves the leg exists; a permit whose design work is
  // finished is still two-leg, which is what keeps the handoff prompt alive
  // for the permits that genuinely earned it.
  return tasks.some(isDesignTask) ? 'two-leg' : 'one-leg';
}

/** ★ The handoff trap, as a type.
 *
 *  Of the 32 permits in corrections, 4 have NO TASKS AT ALL — so "all tasks
 *  complete" is VACUOUSLY TRUE for them, and an automatic rule would announce
 *  them ready to file on day one before anyone touched them, in front of the
 *  whole team. 'no-tasks' therefore exists as a state distinct from 'complete'
 *  and must never be treated as complete. */
export type DesignLegStatus = 'no-tasks' | 'in-progress' | 'complete';

/** fix-298 Phase 2: one row per milestone action taken from the board that has
 *  no task behind it. Append-only; see the migration for why this is not a
 *  retrospective resolved task. */
export interface PermitMilestoneAck {
  id: string;
  permit_id: number;
  milestone: string;
  /** The milestone's driving value when it was ticked. */
  anchor: string | null;
  acked_by_name: string | null;
  acked_at: string;
}

/** ★ The anchor for a milestone: the value whose CHANGE should bring the
 *  prompt back. An ack suppresses its milestone only while this still matches,
 *  so a re-approval re-raises the fees prompt and a new cycle re-raises the
 *  handoff — but tomorrow morning, with nothing changed, it stays quiet.
 *
 *  reviewer_silent has no stable anchor: the entire point of it is that
 *  nothing is changing, so an anchor comparison could never expire. It is
 *  handled instead by treating the ack as a MOVEMENT — see permitMilestones. */
export function milestoneAnchor(
  kind: MilestoneKind,
  permit: PermitWithCycles,
): string | null {
  const cyc = latestCycle(permit.permit_cycles ?? []);
  switch (kind) {
    case 'fees':
    case 'issuance':
      return permit.approval_date ?? null;
    case 'intake':
      return permit.intake_date ?? null;
    case 'target_submit':
      return permit.target_submit ?? null;
    case 'draw':
      return permit.dd_end ?? null;
    case 'corrections':
      return cyc ? String(cyc.cycle_index) : null;
    case 'reviewer_silent':
      return null;
  }
}

/** Is this milestone already acknowledged for this permit, at its current
 *  anchor? NULL is a legitimate anchor, so the comparison is null-safe rather
 *  than an equality test. */
export function isMilestoneAcked(
  kind: MilestoneKind,
  permit: PermitWithCycles,
  acks: ReadonlyArray<PermitMilestoneAck>,
): boolean {
  if (kind === 'reviewer_silent') return false; // handled as a movement instead
  const want = milestoneAnchor(kind, permit);
  return acks.some(
    (a) =>
      a.permit_id === permit.id && a.milestone === kind && (a.anchor ?? null) === want,
  );
}

/** The design-complete ack for a permit's CURRENT cycle, if a person has
 *  confirmed the handoff. Anchored on the cycle so a fresh round of
 *  corrections asks again. */
export function designCompleteAck(
  permit: PermitWithCycles,
  acks: ReadonlyArray<PermitMilestoneAck>,
): PermitMilestoneAck | null {
  const cyc = latestCycle(permit.permit_cycles ?? []);
  const want = cyc ? String(cyc.cycle_index) : null;
  return (
    acks.find(
      (a) =>
        a.permit_id === permit.id &&
        a.milestone === 'design_complete' &&
        (a.anchor ?? null) === want,
    ) ?? null
  );
}

/** ★ THE RULE: at least one design task existed AND all are resolved.
 *  Never "all complete" alone — see DesignLegStatus.
 *
 *  fix-298 Phase 2: a design_complete ACK also completes the leg. That is the
 *  manual "Mark design complete" path, and it is the ONLY way a permit with no
 *  design tasks can ever read as complete — a person has to say so. */
export function designLegStatus(
  tasks: ReadonlyArray<Pick<BoardTask, 'discipline' | 'status'>>,
  acked = false,
): DesignLegStatus {
  if (acked) return 'complete';
  const design = tasks.filter(isDesignTask);
  if (design.length === 0) return 'no-tasks';
  const anyLive = design.some((t) => isTaskLive(t.status));
  return anyLive ? 'in-progress' : 'complete';
}

/** ★ Can the board OFFER a handoff on this permit, and in which form?
 *
 *  'prompt' — at least one design task existed and all are resolved. The
 *             automatic prompt from the mockup.
 *  'manual' — zero design tasks, so "all complete" is VACUOUSLY TRUE and an
 *             automatic prompt would announce the permit ready to file before
 *             anyone touched it. Measured 2026-08-14: 25 of 37 permits in
 *             corrections have no design task at all. A person ticks these.
 *  'none'   — nothing to hand off: already handed off, still in progress, or
 *             a one-leg permit that has no design half to hand off FROM.
 */
export type HandoffAffordance = 'prompt' | 'manual' | 'none';

export function handoffAffordance(
  permit: PermitWithCycles,
  tasks: ReadonlyArray<Pick<BoardTask, 'discipline' | 'status'>>,
  acks: ReadonlyArray<PermitMilestoneAck>,
): HandoffAffordance {
  // ★ A one-leg permit has no design leg. No prompt, no manual button, no
  // "waiting on design" — entitlement owns it end to end. Derived from
  // `da IS NULL`, never from the permit type.
  if (legShape(permit, tasks) === 'one-leg') return 'none';
  if (designCompleteAck(permit, acks)) return 'none'; // already handed off

  // ★ ONLY WHERE A HANDOFF MEANS SOMETHING: the permit is in corrections, so
  // the city is holding a set and the design half is what unblocks it.
  //
  // This gate is measured, not aesthetic. Offering the standing prompt on
  // every two-leg permit with a cycle would put 190 "Mark design complete"
  // buttons on the board; widening it to "in corrections OR pre-submittal with
  // a date" still gives 98, because a permit three months from its target has
  // no design tasks yet and nobody is waiting on a handoff. Corrections-only
  // gives 4 prompts and 25 manual — a list a person can actually read, and the
  // exact case the mockup describes ("hand this to Miles to resubmit").
  //
  // Ticking "finish the set" on a PRE-SUBMITTAL permit still hands it over —
  // that is the forecast row's action, a different question from whether this
  // permit deserves a standing row in the section.
  if (!isPermitInCorrections(permit, permit.permit_cycles ?? [])) return 'none';

  const design = tasks.filter(isDesignTask);
  if (design.length === 0) return 'manual';
  return design.some((t) => isTaskLive(t.status)) ? 'none' : 'prompt';
}

/** Who may confirm the handoff: the permit's DA, its co-DA, or its DM — one
 *  confirmation on the PERMIT, not a sign-off per person. Oversight can too,
 *  since they are the escalation path when a designer is away. */
export function canConfirmHandoff(
  permit: Pick<Permit, 'da' | 'dual_da' | 'dm'>,
  viewer: BoardViewer,
): boolean {
  if (viewer.isOversight) return true;
  const me = (viewer.name ?? '').trim().toLowerCase();
  if (!me) return false;
  return [permit.da, permit.dual_da, permit.dm].some(
    (n) => (n ?? '').trim().toLowerCase() === me,
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
export type MilestoneKind =
  | 'corrections'
  | 'target_submit'
  | 'draw'
  | 'intake'
  | 'reviewer_silent'
  | 'fees'
  | 'issuance';

/** Which legs a milestone has, from the v6 table. A milestone with no design
 *  leg is never shown to a DA at all — that is the 'absent' state. */
const MILESTONE_LEGS: Record<MilestoneKind, { design: boolean; ent: boolean }> = {
  draw: { design: true, ent: false },
  target_submit: { design: true, ent: true },
  corrections: { design: true, ent: true },
  intake: { design: false, ent: true },
  reviewer_silent: { design: false, ent: true },
  fees: { design: false, ent: true },
  issuance: { design: false, ent: true },
};

/** The verb each side sees for the same milestone. Both roles see the same
 *  permit at the same moment with a DIFFERENT VERB — that is the relay. */
const MILESTONE_VERBS: Record<MilestoneKind, { design: string; ent: string }> = {
  draw: { design: 'Close the DD window', ent: '' },
  target_submit: { design: 'Finish the set', ent: 'Submit' },
  corrections: { design: 'Work the redlines', ent: 'Resubmit to the city' },
  intake: { design: '', ent: 'Intake appointment' },
  reviewer_silent: { design: '', ent: 'Ping the reviewer' },
  fees: { design: '', ent: 'Pay issuance fees' },
  issuance: { design: '', ent: 'Collect the permit' },
};

export interface MilestoneOccurrence {
  kind: MilestoneKind;
  /** ISO date, or null when the milestone has no date (queue-only). */
  date: string | null;
  /** Human explanation shown under the verb. */
  why: string;
  /** Days late (positive) / days out (negative) where a date exists. */
  daysLate: number | null;
}

/** Today in the user's LOCAL timezone as YYYY-MM-DD. The board's buckets are
 *  calendar-relative, so a UTC-derived "today" would put an evening user's work
 *  in tomorrow. Callers inject this so tests never depend on the clock. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function latestCycle(cycles: ReadonlyArray<PermitCycle>): PermitCycle | null {
  if (cycles.length === 0) return null;
  return [...cycles].sort((a, b) => b.cycle_index - a.cycle_index)[0]!;
}

// ===========================================================================
// ★★★ fix-337 — A MILESTONE IS ONLY LIVE IF IT STILL APPLIES
// ===========================================================================
//
// Bobby: *"if it doesn't currently apply — meaning the project's been issued or
// approved, or did you send out first round corrections and we're already on
// cycle two or three — let's make sure that whatever we are currently
// displaying is currently visible."*
//
// ★★ "ISSUED" IS ONE CASE OF THAT RULE, NOT THE RULE. I proposed an
// issued-permit guard and Bobby corrected me; measuring it his way is far
// worse. On prod, 2026-08-19, the intake prompt alone:
//
//     latest cycle │ permits │ raising a stale intake prompt
//     ─────────────┼─────────┼──────────────────────────────
//              0   │   108   │    2   ( 2%)   ← the only real ones
//              1   │   189   │  131   (69%)
//              2   │   110   │  101   (92%)
//              3   │    88   │   74   (84%)
//              4   │    20   │   20   (100%) ★
//              5   │     6   │    6   (100%) ★
//              6   │     3   │    3   (100%) ★
//                            │  337 of 524
//
// ★★★ AND IT IS A CYCLE BUG, NOT AN ISSUANCE BUG. `intake_accepted` is only
// ever written on the cycle intake belongs to, and this function read the
// LATEST cycle — so the further a permit advances the more certainly its newest
// cycle has a null `intake_accepted`, and past cycle 3 it fires on every single
// permit. An issued-only guard would have fixed the finished ones and left the
// 90-odd LIVE permits wrong: exactly the ones people are working on.
//
// ★ THE FIX IS THE DERIVATION, NOT AN ACK. fix-298's acks are anchored SNOOZES
// ("an ack suppresses its milestone only while this still matches"), so
// inserting 300 of them would have expired the moment an anchor moved. Nothing
// in this ticket writes an ack.
//
// ★ AND IT IS PER KIND, so each prompt states its own condition rather than
// inheriting a blanket. An issued permit raising nothing at all is then a
// CONSEQUENCE of the six rules below, not a seventh rule bolted on top.
//
// ★★ WRITTEN SO A NOTIFICATION CAN HANG OFF IT LATER (§3, deliberately not
// built here): `milestoneApplies` is a pure, exported (kind, permit, cycles) →
// boolean. A future scraper-driven notifier asks it the same question this
// board does, and the transition true → false is precisely "the permit moved
// on, tell the ent lead" — no rework needed, just a caller.

/** Has anything ever been submitted on this permit? */
function everSubmitted(cycles: ReadonlyArray<PermitCycle>): boolean {
  return cycles.some((c) => !!c.submitted);
}

/** Has intake ever been accepted, on ANY cycle?
 *
 *  ★ Deliberately "any", not "cycle 0". Intake acceptance is a one-time event
 *  in a permit's life, and where it is recorded has moved: fix-26 put design
 *  fields on cycle 0, and pre-fix-26 permits still carry them on cycle 1. The
 *  question "has this happened yet" is answerable across both shapes; "is it on
 *  the cycle I think it should be on" is not. */
function everIntakeAccepted(cycles: ReadonlyArray<PermitCycle>): boolean {
  return cycles.some((c) => !!c.intake_accepted);
}

// ===========================================================================
// ★★★ fix-378 — A DATE ALREADY PAST WHEN THE RECORD WAS BORN IS HISTORY
// ===========================================================================
//
// Bobby: *"as we're backfilling projects, it's not very helpful … he has to go
// click through 200 milestones, which doesn't really seem like a good use of
// time if 95% of them aren't accurate."*
//
// Measured on prod 2026-08-21: of 312 active permits, 224 carry a
// target_submit more than 30 days past — and for 180 of those the date was
// ALREADY past when the permit row was CREATED. That is what backfilling does:
// load a project with its real historical dates and every date-anchored
// milestone fires at once, as though the team missed 180 deadlines the moment
// the data arrived.
//
// ★★★ THE DISCRIMINATOR: a date already in the past when the row was created
// is HISTORY — the prompt never applied, because nobody could have acted on it
// through this system. A date that passed while the record was LIVE is a
// MISSED DEADLINE and must keep raising: the 44 real ones are the entire
// reason the milestone exists.
//
// ★★★ SUPPRESSED IN THE DERIVER, NEVER BY WRITING AN ACK. An auto-ack would be
// the machine putting words in a person's mouth — `acked_by` naming somebody
// who never looked (fix-363: provenance answers WHO did this). Nothing in this
// ticket writes or deletes a permit_milestone_acks row; the ledger stays
// human-only, and the ack contract (release when the anchor moves) is
// untouched.
//
// ★ ONLY THE PLAN-DATE KINDS. Each of the seven was checked against "could
// this fire purely because the data is historic?":
//   target_submit / draw / intake — YES: each fires off a stored plan date
//     (target_submit, dd_end, intake_date) that backfill loads already-past.
//   fees          — NO: it fires off approved-and-not-ISSUED, a current portal
//     state. Old approval date or not, the fees are genuinely unpaid today.
//   corrections   — NO: a state (current cycle has corr_issued, no resubmit),
//     read from the portal's present, not a plan date.
//   reviewer_silent — NO, and on a different path anyway: measured from
//     updated_at (last movement), which is fresh on a backfilled row.
//   issuance      — nothing to change: permitMilestones never derives it
//     (it exists only as relay vocabulary; see milestoneApplies' default arm).
const HISTORIC_SUPPRESSIBLE_KINDS = ['target_submit', 'draw', 'intake'] as const;

/** ★★★ Was this milestone's driving date already past when the permit row was
 *  created? True = the prompt is backfilled history and never applied.
 *
 *  ★ FAIL OPEN: a permit with no created_at (or no driving date) returns
 *  false — we cannot prove the date predates the record, so the milestone
 *  raises exactly as it always has. Suppression requires evidence.
 *
 *  ★ Strictly BEFORE: a date equal to the creation day is live — the row was
 *  born with today's deadline, not with history. */
export function milestonePredatesRecord(
  kind: MilestoneKind,
  permit: PermitWithCycles,
): boolean {
  const created = (permit.created_at ?? '').slice(0, 10);
  if (!created) return false;
  let date: string | null;
  switch (kind) {
    case 'target_submit':
      date = permit.target_submit ?? null;
      break;
    case 'draw':
      date = permit.dd_end ?? null;
      break;
    case 'intake':
      date = permit.intake_date ?? null;
      break;
    default:
      return false;
  }
  if (!date) return false;
  return date.slice(0, 10) < created;
}

/**
 * ★★★ fix-386 — THE RECORDED ANSWER BEATS THE INFERENCE, IN ONE DIRECTION.
 *
 * fix-378 had to INFER "this is backfilled history" by comparing the driving
 * date against the row's `created_at`, because the wizard's **Backfill?**
 * checkbox threw its answer away. fix-386 keeps that answer in
 * `projects.is_backfill`, and this is where it lands.
 *
 * ★★★ THE ASYMMETRY, AND WHY IT IS NOT AN OVERSIGHT:
 *
 *   true  → history, whatever the dates say. The person entering the project
 *           told us. This ADDS suppression the inference would have missed —
 *           a backfilled project whose dates happen to look current.
 *
 *   false → ★★★ THE INFERENCE STILL RUNS. An explicit "not a backfill" must
 *           NEVER un-suppress fix-378's date rule. Two reasons, both real: a
 *           genuinely new project can still be handed an already-past target
 *           by hand, and fix-378's measured population (224 of 312 active
 *           permits) mostly predates this flag anyway. The flag ADDS
 *           suppression on true; it never REMOVES it on false.
 *
 *   null  → exactly the pre-fix-386 behaviour. This is every existing project,
 *           and "not recorded" is not "no" (fix-363).
 *
 * ★★ ONLY THE PLAN-DATE KINDS, same as fix-378. A `true` flag does not silence
 * `fees`, `corrections` or `reviewer_silent`: those read the portal's PRESENT,
 * not a loaded plan date. A backfilled project's unpaid fees are still
 * genuinely unpaid today, and saying "this project is history" must not be
 * heard as "stop telling me about its current state".
 */
export function milestoneIsHistory(
  kind: MilestoneKind,
  permit: PermitWithCycles,
  isBackfill: boolean | null | undefined = null,
): boolean {
  if (
    isBackfill === true &&
    (HISTORIC_SUPPRESSIBLE_KINDS as readonly string[]).includes(kind)
  ) {
    return true;
  }
  return milestonePredatesRecord(kind, permit);
}

/** The kinds this permit would raise TODAY but for the historic rule — what
 *  feeds the suppressed count. fix-298's principle, restated at the
 *  suppression note below: showing the suppressed count is how a quiet day
 *  and a broken notifier stop looking the same. Silently dropping 180 prompts
 *  would be the fix-370 mistake again. */
export function historicSuppressedKinds(
  permit: PermitWithCycles,
  cycles: ReadonlyArray<PermitCycle> = permit.permit_cycles ?? [],
  isBackfill: boolean | null | undefined = null,
): MilestoneKind[] {
  // ★★ fix-390: a HELD permit contributes nothing to this count, deliberately.
  // The count means "would apply but for HISTORY" (fix-378). A chip closed by a
  // hold is closed by STATE — like approval, like fix-388's status — so folding
  // it in here would change what the number means.
  return HISTORIC_SUPPRESSIBLE_KINDS.filter(
    (k) =>
      // ★ fix-386: the SAME gate milestoneApplies uses, so a flag-suppressed
      // milestone is counted by the same number — one gate, one count, no
      // second copy of the rules to keep in step.
      milestoneIsHistory(k, permit, isBackfill) &&
      milestoneAppliesIgnoringHistory(k, permit, cycles),
  );
}

/**
 * ★★★ Does this milestone still apply to the permit's CURRENT state?
 *
 * One rule per kind, each saying what would make it moot:
 *
 *   corrections     handled by isPermitInCorrections, which already answers
 *                   the current-cycle question (fix-214) and already excludes
 *                   issued and approved permits.
 *   fees            approved and not yet issued. The one kind that was already
 *                   right — and the shape the other five now follow.
 *   reviewer_silent nobody is waiting on a reviewer once the permit is
 *                   approved (checked before) or ISSUED (checked now).
 *   target_submit   a target to submit BY is moot the moment anything has been
 *                   submitted — on any cycle, not just the newest. Same for an
 *                   approved or issued permit.
 *   draw            the DD window closing is a pre-submission prompt. Same test.
 *   intake          ★ THE 337. Moot once intake has been accepted ANYWHERE, or
 *                   the permit is approved or issued.
 *
 * ★ Note what is NOT here: no threshold, no date arithmetic, no ack. This
 * answers "does this prompt make sense for this permit today", and the caller
 * still decides whether it is due, how late it is, and whether somebody has
 * already snoozed it.
 *
 * ★ fix-378: split from milestoneApplies so the historic rule composes on top
 * without this function's conditions being written twice — the suppressed
 * count needs "would apply but for history", and a second copy of these rules
 * would drift.
 */
function milestoneAppliesIgnoringHistory(
  kind: MilestoneKind,
  permit: PermitWithCycles,
  cycles: ReadonlyArray<PermitCycle> = permit.permit_cycles ?? [],
  // ★ fix-390: defaults false, so every caller that does not know about holds
  // keeps exactly its pre-fix-390 behaviour.
  isHeld = false,
): boolean {
  const issued = !!permit.actual_issue;
  const approved = !!permit.approval_date;

  // ★★★ fix-390: A HELD PERMIT RAISES NOTHING WHILE IT IS HELD.
  //
  // Somebody said "this is deliberately paused". Nagging about a pause is the
  // fix-388 bug in a new coat — a prompt nobody can act on, for a reason the
  // system already knows.
  //
  // ★★ THIS IS THE FOURTH INDEPENDENT REASON a chip does not raise, alongside
  // fix-378's history gate, fix-386's backfill flag and fix-388's status. They
  // COMPOSE — each is its own early answer, none is threaded through another —
  // which is why this is a plain guard and not a new clause inside one of them.
  //
  // ★ REVERSIBLE BY CONSTRUCTION. Nothing is written and no ack is recorded
  // (fix-337's lesson: the fix is the derivation). Release the hold and every
  // chip returns on the next render, because the hold was the only reason they
  // were quiet.
  //
  // ★★★ `isHeld` IS TRUE AT EITHER SCOPE — by this permit's own hold, or by its
  // PROJECT's. Bobby ruled that on 2026-08-23 (fix-391): "on hold" means quiet
  // whichever way it was placed, and a person who parked a whole project should
  // not still be nagged about the permits inside it.
  //
  // ★★★ DO NOT "FIX" THE PROJECT HALF AWAY. fix-390 introduced the union while
  // its own report said it had only added permit-scope silence — the behaviour
  // was right and the description was wrong. It is deliberate now, and this
  // comment exists so the next reader does not read the project half as an
  // accident and remove it.
  //
  // ★★ CANCEL IS NOT HOLD. `prepare()` builds the held-project set filtered to
  // kind === 'hold', so a CANCELLED project never arrives here — its treatment
  // is fix-262's (dropped from the board entirely, via isCancelledProject) and
  // is untouched. Two kinds, two mechanisms, on purpose.
  //
  // ★ It never flows upward: a held permit does not make its project held.
  if (isHeld) return false;

  // ★★★ fix-388 §2: A WITHDRAWN PERMIT RAISES NOTHING, OF ANY KIND.
  // Not fees, not corrections, not reviewer_silent. It is not late; it is
  // dead — nothing is expected of anybody, so nothing should be prompted.
  // Checked before the switch because it is the one answer that does not vary
  // by kind. See permitTerminalStatus.ts for why 'Closed' is NOT here: closed
  // is finished, not abandoned, and lives in the terminal-POSITIVE set.
  if (isTerminalNegativeStatus(permit.status)) return false;

  // ★★★ fix-388 §1: THE CITY'S OWN ANSWER TO "HAS THE SET GONE IN?".
  //
  // everSubmitted() reads permit_cycles.submitted, which the scraper fills for
  // building permits and NEVER fills for land use — so on a ULS it is false
  // forever and the two pre-submission chips fire until approval. The answer
  // was already written, into permits.status; this reads it.
  //
  // ★★ It only ever ADDS a reason to stop asking. A status not in the set
  // leaves everSubmitted as the whole answer, which is why the 29 live
  // "Pre-Submittal — GO" chips are untouched by this.
  const submitted = everSubmitted(cycles) || statusImpliesSubmitted(permit.status);

  switch (kind) {
    case 'corrections':
      return isPermitInCorrections(permit, [...cycles]);
    case 'fees':
      return approved && !issued;
    case 'reviewer_silent':
      return !approved && !issued;
    case 'target_submit':
      return !!permit.target_submit && !submitted && !approved && !issued;
    case 'draw':
      return !!permit.dd_end && !submitted && !approved && !issued;
    // ★★ fix-388: intake deliberately keeps `everIntakeAccepted` and is NOT
    // wired to status. Its question is "has the city ACCEPTED intake", which is
    // a specific event; nothing in the prod status vocabulary proves it.
    // 'Ready for Intake' is the state BEFORE it, and every status that comes
    // after intake also comes after a dozen other things — inferring a precise
    // event from a coarse one is how a true prompt gets killed silently.
    case 'intake':
      return (
        !!permit.intake_date && !everIntakeAccepted(cycles) && !approved && !issued
      );
    // Milestones with no derivation of their own — handoff/issuance are raised
    // elsewhere and are not part of this function's contract.
    default:
      return true;
  }
}

/** ★★★ The full gate: current-state rules (fix-337) AND the historic rule
 *  (fix-378). Exported unchanged in shape so the future notifier fix-337
 *  planned for asks one question and never pings about backfilled history. */
export function milestoneApplies(
  kind: MilestoneKind,
  permit: PermitWithCycles,
  cycles: ReadonlyArray<PermitCycle> = permit.permit_cycles ?? [],
  isBackfill: boolean | null | undefined = null,
  // ★ fix-390: the fourth reason. Additive and optional, like isBackfill before
  // it — fix-337's promise that a future notifier can hang off this shape.
  isHeld = false,
): boolean {
  return (
    milestoneAppliesIgnoringHistory(kind, permit, cycles, isHeld) &&
    // ★ fix-386: defaults to null, so every caller that does not know the
    // project's flag gets exactly the pre-fix-386 behaviour.
    !milestoneIsHistory(kind, permit, isBackfill)
  );
}

/** Every milestone this permit is currently at. A permit can carry more than
 *  one (fees due AND a reviewer gone quiet), and each is prompted separately. */
export function permitMilestones(
  permit: PermitWithCycles,
  today: string,
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
  acks: ReadonlyArray<PermitMilestoneAck> = [],
  // ★ fix-386: the project's recorded "Backfill?" answer, threaded to the one
  // gate below. Defaults to null so every existing caller keeps the
  // pre-fix-386 behaviour without knowing this parameter exists.
  isBackfill: boolean | null | undefined = null,
  // ★★ fix-390: a held permit yields NO occurrences at all — every kind's gate
  // answers false, so this returns []. That is the "silenced row" the ticket
  // asks for, and it needs no special case here.
  isHeld = false,
): MilestoneOccurrence[] {
  const out: MilestoneOccurrence[] = [];
  const cycles = permit.permit_cycles ?? [];
  const cyc = latestCycle(cycles);

  // Corrections — a STATE, no inherent date. Never on the forecast unless the
  // permit also carries a target date (below), which is a different prompt.
  // ★ fix-337: routed through milestoneApplies like the other five, so every
  // kind answers the same question in the same place. The rule is unchanged —
  // isPermitInCorrections has been current-cycle-aware since fix-214.
  if (milestoneApplies('corrections', permit, cycles, isBackfill, isHeld)) {
    out.push({
      kind: 'corrections',
      date: null,
      why: cyc ? `Cycle ${cyc.cycle_index}` : '',
      daysLate: null,
    });
  }

  // Approved but not issued — fees. Dated from the approval.
  // ★ fix-337: this is the kind that was ALREADY right (myBoard.ts:456 was the
  // only issuance check in the whole function), and the shape the other five
  // now follow.
  if (milestoneApplies('fees', permit, cycles, isBackfill, isHeld) && permit.approval_date) {
    const late = daysBetween(permit.approval_date, today);
    if (late >= thresholds.approvedNotIssuedDays) {
      out.push({
        kind: 'fees',
        date: permit.approval_date,
        why: `Approved ${late}d ago`,
        daysLate: late,
      });
    }
  }

  // Reviewer silence — a STATE with no date.
  //
  // ★ SILENCE IS MEASURED FROM THE LAST MOVEMENT, NOT FROM SUBMISSION. This is
  // the one rule I got wrong first and corrected against prod. Counting "days
  // since submitted/intake" flags 45 of Miles's 57 in-review permits — that is
  // not silence, that is how long city review normally takes, and it would put
  // 45 rows in "blocked on you, go chase": precisely the wall of red the brief
  // says teaches people to scroll past red. Measuring from permits.updated_at,
  // which the scraper bumps whenever the portal shows ANY change, flags 6.
  // Six is a chase list; forty-five is noise.
  //
  // This also matches how the brief itself frames the sibling threshold —
  // "permit untouched", not "permit submitted a while ago".
  // ★ fix-337: …and not once the permit is ISSUED. Three permits were still
  // asking someone to chase a reviewer on a permit the city had already issued.
  //
  // ★★★ fix-397 — THIS OCCURRENCE NO LONGER REACHES A SCREEN, AND THAT IS
  // DELIBERATE. `reviewer_silent` carries `date: null`, buildForecast skips
  // every date-null milestone ("the rule, enforced in one place"), and the only
  // other consumer was the queue's "Blocked on you" — which Bobby removed on
  // 2026-08-24. So nothing renders it today.
  //
  // ★★ IT IS NOT DELETED, because the thing it measured is now measured better
  // elsewhere: fix-395 turned exactly this prompt into a real task with a real
  // owner (`city_target_chase`, minted when the city is 7+ days past its own
  // target). A prompt nobody owns is what fix-395 exists to replace, and
  // "Blocked on you" was where this one lived. The rule, its ack behaviour and
  // its measured-from-last-MOVEMENT correction are kept intact here so that a
  // richer "blocked on you" — which Bobby explicitly left the door open for —
  // has something correct to be rebuilt on.
  if (
    cyc?.submitted &&
    !cyc.corr_issued &&
    milestoneApplies('reviewer_silent', permit, cycles, isBackfill, isHeld)
  ) {
    // fix-298 Phase 2: a chase IS a movement. reviewer_silent has no anchor
    // that could ever change (the whole point is that nothing is changing), so
    // instead of suppressing it forever we re-measure silence from the most
    // recent of "the portal moved" and "somebody pinged them". Ticking it buys
    // another full threshold window, then it asks again.
    const lastAck = acks
      .filter((a) => a.permit_id === permit.id && a.milestone === 'reviewer_silent')
      .map((a) => (a.acked_at ?? '').slice(0, 10))
      .sort()
      .pop();
    const touched = (permit.updated_at ?? '').slice(0, 10);
    const lastMovement = [touched, lastAck ?? ''].filter(Boolean).sort().pop() ?? '';
    const quiet = lastMovement ? daysBetween(lastMovement, today) : 0;
    if (quiet >= thresholds.reviewerSilentDays) {
      out.push({
        kind: 'reviewer_silent',
        date: null,
        why: `${quiet}d without movement`,
        daysLate: quiet,
      });
    }
  }

  // Target submit — a DATE. Only while the set has not gone in.
  // ★ fix-337: "has not gone in" now means NO cycle has been submitted, not
  // "the newest cycle has not" — a permit on cycle 3 has plainly submitted.
  if (milestoneApplies('target_submit', permit, cycles, isBackfill, isHeld) && permit.target_submit) {
    const late = daysBetween(permit.target_submit, today);
    out.push({
      kind: 'target_submit',
      date: permit.target_submit,
      // Facts only: how late, or nothing. "Target submit date." restates the
      // row's own date back at the reader.
      why: late > 0 ? `${late}d past target` : '',
      daysLate: late,
    });
  }

  // DD window close — a DATE, design side only.
  // ★ fix-337: same correction as target_submit — the DD window is a
  // pre-submission prompt, and any submission at all closes the question.
  if (milestoneApplies('draw', permit, cycles, isBackfill, isHeld) && permit.dd_end) {
    const late = daysBetween(permit.dd_end, today);
    out.push({
      kind: 'draw',
      date: permit.dd_end,
      // fix-304 §22: the DD window's date IS the message.
      why: '',
      daysLate: late,
    });
  }

  // Intake — a DATE, entitlement only.
  //
  // ★★★ fix-337: THE 337. This read `!cyc?.intake_accepted` — the LATEST
  // cycle's — so every permit past cycle 3 raised it forever, whatever its
  // state. It asks the right question now: has intake been accepted at all?
  if (milestoneApplies('intake', permit, cycles, isBackfill, isHeld) && permit.intake_date) {
    out.push({
      kind: 'intake',
      date: permit.intake_date,
      // ★ fix-304 §22 (register #22): was "Booked. The set must be uploaded
      // first." — repeated verbatim on five consecutive rows, which is noise
      // pretending to be help. A row is a headline, a location and a date; the
      // explanatory sentence only survives if it carries something those three
      // do not, and this one carried nothing.
      why: '',
      daysLate: daysBetween(permit.intake_date, today),
    });
  }

  // ★ Drop anything a person has already actioned at its current anchor. This
  // is what stops the board re-raising "pay the fees" every morning, while
  // still bringing it back if the permit is re-approved.
  return out.filter((m) => !isMilestoneAcked(m.kind, permit, acks));
}

/** The viewer's state on one leg of one milestone.
 *
 *  ★ Only one side can act at a time, and the order is design → entitlement.
 *  On a two-leg milestone the entitlement half is 'waiting' until the design
 *  half is demonstrably complete — and 'no-tasks' is NOT complete. */
export function relayStateFor(
  kind: MilestoneKind,
  leg: BoardLeg,
  shape: LegShape,
  design: DesignLegStatus,
): RelayState {
  const legs = MILESTONE_LEGS[kind];

  if (leg === 'design') {
    // A one-leg permit has no design half at all — not even a waiting row.
    if (shape === 'one-leg') return 'absent';
    if (!legs.design) return 'absent';
    // Design has finished its half: it now sits with the lead.
    if (legs.ent && design === 'complete') return 'waiting';
    return 'mine';
  }

  if (!legs.ent) return 'absent';
  // Entitlement-only milestones (fees, intake, chasing, issuance) are always
  // the lead's to act on — there is no design half to wait for.
  if (!legs.design) return 'mine';
  // One-leg: entitlement owns it end to end, so it never waits on design.
  if (shape === 'one-leg') return 'mine';
  return design === 'complete' ? 'mine' : 'waiting';
}

export function milestoneVerb(kind: MilestoneKind, leg: BoardLeg): string {
  return MILESTONE_VERBS[kind][leg === 'design' ? 'design' : 'ent'];
}

/** ★ fix-306 #29: what to DO, not what it is.
 *
 *  "What am I supposed to do with intake appointment? Is it ready to submit? I
 *  don't know what this really means." A label names a thing; an action tells
 *  somebody who has never seen the row what happens next.
 *
 *  ONE LINE, and facts only — #22 cut the verbiage and this must not undo it.
 *  Where the row is the other half's, the action says who it is with, because
 *  "nothing, it is with Fisk" is also an answer to "what do I do". */
export function milestoneAction(
  kind: MilestoneKind,
  leg: BoardLeg,
  state: RelayState,
  permit: Pick<Permit, 'da' | 'ent_lead'>,
  m: Pick<MilestoneOccurrence, 'date' | 'daysLate'>,
): string {
  if (state === 'waiting') {
    // ★ fix-348: was its own copy of the leg→person rule. One definition now.
    return `Wait — with ${milestoneCounterparty(leg, permit).label}`;
  }
  const late = m.daysLate ?? 0;
  switch (kind) {
    case 'intake':
      return `Upload the set, then attend — ${
        late > 0 ? `appointment was ${late}d ago` : `appointment ${m.date ?? 'booked'}`
      }`;
    case 'target_submit':
      return leg === 'design'
        ? `Finish the set — ${late > 0 ? `${late}d past target` : 'target ahead'}`
        : `File it — ${late > 0 ? `${late}d past target` : 'target ahead'}`;
    case 'corrections':
      return leg === 'design' ? 'Work the redlines' : 'Resubmit to the city';
    case 'fees':
      return `Pay issuance fees — approved ${late}d ago`;
    case 'reviewer_silent':
      return `Chase the reviewer — ${late}d without movement`;
    case 'draw':
      return `Close the DD window — ends ${m.date ?? 'soon'}`;
    case 'issuance':
      return 'Collect the permit';
  }
}

// ---------------------------------------------------------------------------
// Forecast — the LEFT panel. Only ever things with a DATE.
// ---------------------------------------------------------------------------
export type ForecastBucket =
  | 'past_due'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  // fix-304 §23 (register #23): "maybe even like a next week column".
  | 'next_week'
  | 'later';

export interface ForecastItem {
  key: string;
  source: 'task' | 'milestone';
  verb: string;
  why: string;
  /** "3626 164th Pl SE · Building Permit" */
  where: string;
  /** ISO. Never null — an item without a date is not a forecast item. */
  date: string;
  /** Positive = late. */
  daysLate: number;
  bucket: ForecastBucket;
  /** ★ false → rendered greyed with NO CHECKBOX. */
  actionable: boolean;
  permitId: number | null;
  taskId: string | null;
  /** fix-298 Phase 2 — what ticking this row should DO.
   *
   *  'resolve-task'  the row IS a named task: resolve it, through the same
   *                  hook My Tasks uses.
   *  'handoff'       the design side finishing its half of a two-leg
   *                  milestone. Ticking it hands the permit over — the
   *                  design-complete ack plus the submittal task for the lead.
   *  'ack'           a milestone with nothing behind it ("pay the fees",
   *                  "ping the reviewer"): record that it was done.
   *
   *  ★ The brief's table has a third row, "a milestone with a task behind
   *  it → resolves the task". In this model that case does not arise: tasks
   *  surface as their own rows, and the one milestone that has tasks behind
   *  it — corrections on the design leg — has MANY (12 redline items is
   *  normal). Bulk-resolving twelve tasks off one tick would be destructive
   *  and would erase the record of what was actually done, so that case is
   *  'handoff' instead: it says "the design half is finished", which is the
   *  true statement, and leaves the individual tasks alone. */
  action: 'resolve-task' | 'handoff' | 'ack';
  /**
   * ★★ fix-446: WHICH RELAY LEG this row is. Already encoded in `key`
   * (`m-<permit>-<kind>-<leg>`); carried as a field so My Tasks can pick the
   * lane — design → D&E, entitlement → Permitting — without string-matching a
   * key, and so `target_submit` and `corrections`, which raise a row on BOTH
   * legs with different verbs, land in the right column each time.
   *
   * ★ Null on task rows: a task's column comes from its team (fix-244), not
   * from the relay.
   */
  leg: BoardLeg | null;
  /** For 'ack' — which milestone, and the anchor to store with it. */
  milestoneKind: MilestoneKind | null;
  anchor: string | null;
  /** For 'resolve-task' — the row's task, so the mutation has its fields. */
  task: BoardTask | null;
  /** For 'handoff' — the cycle to anchor on and who receives the submittal. */
  cycleIndex: number | null;
  entLead: string | null;
  /** ★★ fix-446: the permit's DA. With `entLead` above it, this is the whole
   *  set of people a milestone belongs to — what My Tasks resolves ownership
   *  and the people-filters against, without a second lookup into the permits
   *  cache that could answer differently. */
  permitDa: string | null;
  /** ★ fix-308b #45: "Past due" / "Due today" / "Upcoming". The row's STATE,
   *  said in words rather than left to be inferred from a red number. */
  stateLabel: string;
  /** ★ fix-308b #45: why this row is on YOUR list — a role, not a paragraph.
   *  Empty on task rows, which are on your list because they carry your name
   *  and say so already. */
  whyYours: string;
  /** ★ fix-306 #29: one line saying what to DO. Rendered in the right-hand
   *  space the forecast was wasting. */
  actionLine: string;
  /**
   * ★★ fix-409: is this row's work PAUSED? Only ever true when the viewer has
   * switched held work on — a held row is absent otherwise — so the page can
   * render the chip off this without asking again about the preference.
   *
   * ★ It is on the ITEM rather than recomputed in the row component because
   * `prepare()` already resolved it, and a second answer computed at render
   * time is how two halves of one screen start disagreeing (fix-329's shape).
   */
  isHeld: boolean;
  /** ★ fix-409: the hold that explains `isHeld`, ready for <HoldBadge>. Null on
   *  every unheld row. */
  hold: HoldChipRow | null;
  /** fix-304 §20: the pieces the row needs to LINK rather than just describe. */
  projectId: string | null;
  address: string | null;
  /** "BLD2026-0319 · ULS", or just the type when there is no number yet. */
  permitLabel: string | null;
  /** ★ fix-348: who the row is with while it is not yours, from the ONE
   *  definition (milestoneCounterparty). Null on an actionable row and on a
   *  task — those are yours, and "with" has no meaning. */
  withWhom: string | null;
  /** ★ fix-348: the OUTGOING half of the relay — design finished and passed
   *  this to the entitlement lead (fix-308 #46). These rows leave the dated
   *  buckets and appear once, under "Handed off — waiting on others".
   *
   *  ★ An INCOMING wait ("not yours yet — with Cam") is NOT this. It stays in
   *  its dated bucket, because a target the ent lead owns is still late whether
   *  or not they can act on it today. */
  handedOff: boolean;
}

export interface BoardSection<T> {
  /** ★ The TRUE total, always — even when `items` is capped. */
  total: number;
  /** At most the section's cap. */
  items: T[];
  /** True when total > items.length, so the UI can offer "Show all (N) →". */
  capped: boolean;
  /** fix-303: EVERY row, for when the user expands the section.
   *
   *  Phase 1 shipped "Show all (N) →" with no onClick — it looked interactive
   *  and did nothing for two releases. The section could not expand because it
   *  had already thrown the rest away. It keeps them now; the panel's fixed
   *  height and internal scroll mean a long expansion scrolls rather than
   *  growing the page. */
  all: T[];
}

/** ★ fix-397: the generic section builder lost its last caller when the queue
 *  stopped being three capped groups. `forecastSection` below is the forecast's
 *  own, and the queue's bands are uncapped by design — a band is a sort, not a
 *  "top five", and capping "Past due" is how the 554 N 75th row got lost in the
 *  first place. Kept, unexported, because BoardSection<T> is still the
 *  forecast's shape and a future capped list should reuse this rather than
 *  write a third one. */
export function section<T>(all: T[], cap: number): BoardSection<T> {
  const items = cap === Infinity ? all : all.slice(0, cap);
  return { total: all.length, items, capped: all.length > items.length, all };
}

/** ★★ fix-348 — THE CAP MUST NOT SWALLOW ONE OF THE TWO KINDS.
 *
 *  Bobby: *"I don't really see any my tasks in the My Board … your forecast is
 *  not only your milestones, but it's also your tasks."* Blending them into one
 *  date order is the ticket — but Past due is capped at five, and measured on
 *  prod for Miles the blended bucket is **57 milestones + 145 tasks = 202**. A
 *  pure lateness sort over that can easily show five rows of one kind, which
 *  would answer his complaint by re-creating it inside a section.
 *
 *  So the CAPPED VIEW takes the worst of each kind in turn. The ordering inside
 *  what is shown is still lateness; `all` — what "Show all" expands to — is
 *  untouched and strictly lateness-ordered. Nothing is hidden either way: the
 *  header carries the true total AND the split.
 *
 *  ★ A no-op when the section holds only one kind, or is under its cap. */
function interleaveBySource(all: ForecastItem[], cap: number): ForecastItem[] {
  if (cap === Infinity) return all;
  if (all.length <= cap) return all;
  const milestones = all.filter((i) => i.source === 'milestone');
  const tasks = all.filter((i) => i.source === 'task');
  if (milestones.length === 0 || tasks.length === 0) return all.slice(0, cap);
  const picked: ForecastItem[] = [];
  let mi = 0;
  let ti = 0;
  while (picked.length < cap && (mi < milestones.length || ti < tasks.length)) {
    if (mi < milestones.length) picked.push(milestones[mi++]!);
    if (picked.length < cap && ti < tasks.length) picked.push(tasks[ti++]!);
  }
  // Re-order what was picked so the shown rows still read worst-first.
  const order = new Map(all.map((i, idx) => [i.key, idx]));
  return picked.sort((a, z) => (order.get(a.key) ?? 0) - (order.get(z.key) ?? 0));
}

/** ★ fix-348: a capped forecast section, built so both kinds survive the cap. */
function forecastSection(all: ForecastItem[], cap: number): BoardSection<ForecastItem> {
  const items = interleaveBySource(all, cap);
  return { total: all.length, items, capped: all.length > items.length, all };
}

/** ★ fix-348: how many of each kind a section holds. The header prints it, so
 *  "5 shown of 202" never has to be taken on trust about WHAT the 202 are. */
export interface SourceSplit {
  milestones: number;
  tasks: number;
}

export function sourceSplit(items: ReadonlyArray<ForecastItem>): SourceSplit {
  return {
    milestones: items.filter((i) => i.source === 'milestone').length,
    tasks: items.filter((i) => i.source === 'task').length,
  };
}

export interface Forecast {
  past_due: BoardSection<ForecastItem>;
  today: BoardSection<ForecastItem>;
  tomorrow: BoardSection<ForecastItem>;
  this_week: BoardSection<ForecastItem>;
  next_week: BoardSection<ForecastItem>;
  /** ★★ fix-446: beyond 14 days. Always CAPPED AT 0, so `items` is empty and no
   *  existing renderer shows anything new — the uncapped truth is in `.all`,
   *  which is what My Tasks reads to be "the complete list". These items were
   *  always built and then silently discarded; see the builder. */
  later: BoardSection<ForecastItem>;
  /** ★ fix-348: the OUTGOING relay rows, removed from the dated buckets above.
   *  Derived HERE rather than by re-filtering the buckets in the page, which is
   *  what let one permit appear in two sections at once. */
  handed_off: ForecastItem[];
  /** ★★ fix-378: milestones this board did NOT raise because their driving
   *  date was already past when the permit row was created — backfilled
   *  history, not missed deadlines. Counted per (permit, kind) over the same
   *  permits the buckets were built from, so the header can say "N not shown"
   *  instead of silently dropping them (fix-298's suppressed-count principle;
   *  fix-370 is what silent dropping looks like). */
  suppressedHistoric: number;
}

function bucketFor(daysLate: number): ForecastBucket {
  if (daysLate > 0) return 'past_due';
  if (daysLate === 0) return 'today';
  if (daysLate === -1) return 'tomorrow';
  if (daysLate >= -7) return 'this_week';
  // fix-304 §23: the second week out, so "what is coming" reaches past Friday.
  if (daysLate >= -14) return 'next_week';
  return 'later';
}

export interface BoardInput {
  viewer: BoardViewer;
  permits: ReadonlyArray<PermitWithCycles>;
  projects: ReadonlyArray<Project>;
  tasks: ReadonlyArray<BoardTask>;
  /** ISO date treated as "today". Injected so tests never depend on the clock. */
  today: string;
  thresholds?: BoardThresholds;
  /** Project ids with an open cancel row (fix-262). */
  cancelledIds?: ReadonlySet<string>;
  /**
   * ★★ fix-390: which PROJECTS and which PERMITS are on an open hold.
   *
   * Two sets rather than one resolved boolean because the board asks the
   * question per permit, hundreds of times, and a set lookup is the cheap way
   * to answer it. `isPermitHeld` reads DOWNWARD only — project holds cover
   * their permits; a permit hold covers nothing above it.
   *
   * ★ Optional, so every existing caller and fixture behaves exactly as it did
   * before this ticket.
   */
  heldProjectIds?: ReadonlySet<string>;
  heldPermitIds?: ReadonlySet<number>;
  /**
   * ★ Raw hold rows, as an alternative to the two sets above.
   *
   * ★★ WHY BOTH SHAPES EXIST: the sets are what `prepare()` wants, but making
   * MyBoard/BoardBell build them meant importing a set-helper from
   * `useProjectHolds` — a module ~40 test files mock PARTIALLY, so every one of
   * them broke on a missing export. Accepting the arrays the callers already
   * hold keeps this input additive for those fixtures: a suite that never heard
   * of holds passes neither field and behaves exactly as before.
   */
  holdRows?: ReadonlyArray<
    { project_id: string } & HoldChipSource
  >;
  permitHoldRows?: ReadonlyArray<{ permit_id: number } & HoldChipSource>;
  /**
   * ★★★ fix-409 — THE SWITCH, AND WHAT IT ACTUALLY DOES HERE.
   *
   * Bobby (register P-039): *"the default is you show all active
   * projects/permits. anything with a hold gets auto turned off, but you can
   * switch that on/off in the my tasks/my boards."*
   *
   * ★★★ THE MILESTONE HALF WAS ALREADY BUILT — BY fix-390, AS AN ABSOLUTE.
   * `milestoneAppliesIgnoringHistory` has said `if (isHeld) return false` since
   * fix-390, and the queue's city-review branch says `!p.isHeld`. So a held
   * permit has raised nothing on this board for two tickets. What fix-409 adds
   * is not a new gate but a WAY BACK IN: those gates now read `quiet`
   * (= held AND not showing held work) instead of `isHeld`.
   *
   * ★★ DEFAULT `false` ⇒ `quiet === isHeld` ⇒ BYTE-IDENTICAL to fix-390's
   * behaviour. Every existing caller and all ~40 board fixtures pass nothing
   * and get exactly what they got yesterday; the only new behaviour is the one
   * a person has to switch on.
   *
   * ★★★ AND THE TASK HALF WAS NEVER BUILT AT ALL — which is the bug. The task
   * loop in `buildForecast` applied fix-264's cancelled rule and fix-194's
   * sub-permit rule and NOT the hold rule, so a held project's tasks sat in
   * "past due" going redder while the milestones beside them stayed politely
   * quiet.
   *
   * ★ Re-measured on prod 2026-08-26 (read-only), because the fix-409 brief's
   * figures were a day old and had already moved: **8** open tasks under **3**
   * live project holds (the brief said 4 under 2 — a third hold, 5623 44th Ave
   * SW, was placed on 2026-08-25 and carries 4 of the 8). Still 0 live permit
   * holds, and still 0 open tasks under the 4 cancelled projects.
   */
  showHeldWork?: boolean;
  /** fix-298 Phase 2: milestone actions already taken. */
  acks?: ReadonlyArray<PermitMilestoneAck>;
  /** fix-306 #35: when set, the QUEUE is scoped to these people's work instead
   *  of the viewer's own. Never set for the forecast — a manager's day is
   *  their own. */
  scopeNames?: ReadonlyArray<string>;
  /** ★★★ fix-348 — DOES THIS TASK BELONG TO THIS PERSON?
   *
   *  The board used to answer with `assigned_to === name`, a raw string
   *  compare, while My Tasks answered with fix-238's resolver. Two screens, two
   *  definitions of ownership — and the board's could not see a task assigned to
   *  a ROLE ("Design Manager", "Entitlements") or a task with no assignee at
   *  all: 344 of 558 open tasks on prod.
   *
   *  MyBoard injects `useTaskOwnership().matches` here, so the blended forecast
   *  and the My Tasks bar under it route a task to the same person. The default
   *  is the same resolver over the permits/projects already in this input; the
   *  injected one additionally reads dm_da_groups for the DM. */
  taskOwns?: (task: BoardTask, name: string | null) => boolean;
  /**
   * ★★★ fix-446 — WHO IS ON WHICH LEG, MADE INJECTABLE.
   *
   * The default (and every existing caller, which passes nothing) is the rule
   * this file has always used: a LITERAL match on `permit.da` for the design
   * leg and `permit.ent_lead` for the entitlement leg. My Board, BoardBell and
   * /notifications keep exactly that, pinned by their suites.
   *
   * ★★ MY TASKS PASSES A WIDER ONE, on Bobby's ruling of 2026-08-29: *"on My
   * Tasks a design-leg milestone reaches the DA and the DM (DM derived from
   * the DA via dm_da_groups, exactly as tasks do). NOT the schematic
   * designer. The Board's own reach is unchanged in this PR."*
   *
   * ★★★ WHY IT HAD TO BE INJECTABLE RATHER THAN COPIED. Measured on prod
   * 2026-08-29, un-acked milestone rows under the Board's literal rule: Bobby
   * 36, Miles 14, Trevor 1, and ZERO for Brittani, Derry, Lindsay and Cam.
   * Three of those four are design managers — the people the ruling is about.
   * Re-deriving the milestone loop in My Tasks to reach them would have been a
   * second implementation of `relayStateFor`/`milestoneVerb`, which is the one
   * thing this file exists to prevent. One resolver, one emission path, two
   * reaches.
   *
   * ★ Returning `[]` means "not this viewer's permit at all" and skips it,
   * exactly as an empty leg list does today.
   */
  legsFor?: (permit: PermitWithCycles) => BoardLeg[];
}

interface Prepared {
  permit: PermitWithCycles;
  project: Project | undefined;
  /** ★ fix-390: resolved ONCE here rather than at each of the three milestone
   *  call sites, so they cannot disagree about whether a permit is paused. */
  isHeld: boolean;
  /** ★ fix-409: the OPEN hold row that explains `isHeld` — the permit's own
   *  first, else its project's. Null when nothing is parked. */
  hold: HoldChipRow | null;
  /**
   * ★★★ fix-409 — THE FACT AND THE CONSEQUENCE, SPLIT.
   *
   * `isHeld` is what is TRUE about the permit; `quiet` is what the board should
   * DO about it. They were one thing until this ticket because there was only
   * one possible response — silence. Now that a person can ask to see held
   * work, the two have to be separable: a shown row still needs `isHeld` to
   * render its chip, and would lose it if the suppression flag were the only
   * one carried.
   *
   * ★ `quiet = isHeld && !showHeldWork`. Every gate that used to read `isHeld`
   * reads this instead; nothing else changed.
   */
  quiet: boolean;
  shape: LegShape;
  design: DesignLegStatus;
  legs: BoardLeg[];
  where: string;
}

/**
 * ★★ fix-409: the held SETS, hoisted out of `prepare()` so the task loop in
 * `buildForecast` can ask the same question of the same rows. It used to be
 * inline there, which is a large part of why tasks never got asked.
 */
function heldSets(input: BoardInput): {
  heldProjects: ReadonlySet<string>;
  heldPermits: ReadonlySet<number>;
} {
  const heldProjects =
    input.heldProjectIds ??
    new Set(
      (input.holdRows ?? [])
        .filter((h) => h.hold_end === null && (h.kind ?? 'hold') === 'hold')
        .map((h) => h.project_id),
    );
  const heldPermits =
    input.heldPermitIds ??
    new Set(
      (input.permitHoldRows ?? [])
        .filter((h) => h.hold_end === null)
        .map((h) => h.permit_id),
    );
  return { heldProjects, heldPermits };
}

/** ★ fix-409: the OPEN hold rows the chip reads its reason from. Built from
 *  the same two arrays as {@link heldSets}, so a row can never be held by one
 *  and unexplained by the other. Empty when the caller passed only the resolved
 *  ID sets (fixtures do) — the row still knows it is held, it just has no
 *  reason to print, and HoldBadge renders the word without one. */
function holdChipIndex(input: BoardInput): HoldRowIndex {
  return holdRowIndex(input.holdRows, input.permitHoldRows);
}

/** The permits this viewer is on, with their relay inputs resolved once. */
function prepare(input: BoardInput): Prepared[] {
  const { viewer, permits, projects, tasks, cancelledIds } = input;
  // ★ fix-390: accept either shape — the resolved sets, or the raw rows the
  // page already has. Derived once here rather than per permit.
  const { heldProjects, heldPermits } = heldSets(input);
  const chips = holdChipIndex(input);
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const tasksByPermit = new Map<number, BoardTask[]>();
  for (const t of tasks) {
    // ★ fix-460: a TEAM TASK belongs to no permit, so it belongs in no
    //   permit's group. This map feeds permit-shaped rollups only.
    if (t.permit_id === null) continue;
    const list = tasksByPermit.get(t.permit_id) ?? [];
    list.push(t);
    tasksByPermit.set(t.permit_id, list);
  }
  const me = (viewer.name ?? '').trim().toLowerCase();

  const out: Prepared[] = [];
  for (const permit of permits) {
    // Sub-permits are placeholders reviewed under a parent (fix-194) — they
    // carry no independent assignment and must never appear as work.
    if (isSubPermit(permit)) continue;
    if (isCancelledProject(permit.project_id, cancelledIds)) continue;

    // fix-306 #35: a team-scoped queue asks "whose work is this" of the SCOPE,
    // not of the viewer. The relay legs still resolve from the permit, so a
    // manager looking at Fisk's queue sees it the way Fisk does.
    const scope = input.scopeNames;
    if (scope && scope.length > 0) {
      const inScope = scope.some((n) => {
        const t = n.trim().toLowerCase();
        return (
          t !== '' &&
          ((permit.da ?? '').trim().toLowerCase() === t ||
            (permit.ent_lead ?? '').trim().toLowerCase() === t)
        );
      });
      if (!inScope) continue;
    }

    // ★★ fix-446: the injected resolver when a caller supplied one, else the
    //    literal rule this file has always used. Same shape, same order.
    let legs: BoardLeg[];
    if (input.legsFor) {
      legs = input.legsFor(permit);
    } else {
      const isDa = (permit.da ?? '').trim().toLowerCase() === me && me !== '';
      const isEnt =
        (permit.ent_lead ?? '').trim().toLowerCase() === me && me !== '';
      legs = [];
      if (isDa) legs.push('design');
      if (isEnt) legs.push('entitlement');
    }
    // Oversight ADDS the wide view: everything, on top of their own scope.
    if (legs.length === 0 && !viewer.isOversight && !(scope && scope.length > 0)) continue;

    const project = byProject.get(permit.project_id);
    const isHeld = isPermitHeld(permit, heldProjects, heldPermits);
    out.push({
      permit,
      project,
      // ★ fix-390: resolved once, here, so the three milestone call sites below
      // cannot disagree about whether this permit is paused.
      isHeld,
      hold: isHeld
        ? holdRowFor(
            { permit_id: permit.id, project_id: permit.project_id },
            chips,
          )
        : null,
      // ★ fix-409: the fact above, the consequence here. See Prepared.quiet.
      quiet: isHeld && !input.showHeldWork,
      shape: legShape(permit, tasksByPermit.get(permit.id) ?? []),
      design: designLegStatus(
        tasksByPermit.get(permit.id) ?? [],
        !!designCompleteAck(permit, input.acks ?? []),
      ),
      // An oversight viewer with no direct leg watches the entitlement side,
      // which is the one that carries the outright-owned milestones.
      legs: legs.length > 0 ? legs : ['entitlement'],
      where: `${project?.address ?? 'Unknown address'} · ${permit.type ?? 'Permit'}`,
    });
  }
  return out;
}

/** ★★ fix-348: the fallback for {@link BoardInput.taskOwns}.
 *
 *  The SAME resolver My Tasks uses (fix-238's `taskMatchesSelfResolved`), with
 *  its context built from the permits and projects already in this input. The
 *  one thing it cannot see is `dm_da_groups`, so a task assigned to the "Design
 *  Manager" role falls back to project.design_manager / permit.dm — which is
 *  what useTaskOwnership does anyway when the group table has no row. MyBoard
 *  injects the hook's version, which consults the table first.
 *
 *  ★ A default rather than a required field so the 31 existing test call sites
 *  keep working AND keep testing the real rule — a stub default would have made
 *  every one of them assert nothing. */
function defaultTaskOwns(
  input: Pick<BoardInput, 'permits' | 'projects'>,
): (task: BoardTask, name: string | null) => boolean {
  const permitById = new Map(input.permits.map((p) => [p.id, p]));
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  return (task, name) => {
    // ★ fix-460: both miss for a team task, leaving an empty role context —
    //   which is the correct answer, not a gap.
    const permit =
      task.permit_id !== null ? permitById.get(task.permit_id) : undefined;
    const project =
      task.project_id !== null ? projectById.get(task.project_id) : undefined;
    return taskMatchesSelfResolved(task, name, {
      da: task.permit_da ?? permit?.da ?? null,
      dm: project?.design_manager ?? permit?.dm ?? null,
      entLead: permit?.ent_lead ?? project?.entitlement_lead ?? null,
      schematicDesigners: project?.schematic_designer ?? [],
    });
  };
}

/** ★ The forecast only ever shows things with a DATE. "Ping the reviewer, 21
 *  days quiet" has no date and is never here — it lives on the queue. */
export function buildForecast(input: BoardInput): Forecast {
  const today = input.today;
  const thresholds = input.thresholds ?? DEFAULT_BOARD_THRESHOLDS;
  const items: ForecastItem[] = [];
  // fix-194 / fix-348: sub-permits are placeholders reviewed under a parent and
  // never carry work of their own. prepare() drops them for milestones; the
  // task loop needs the same set.
  const subPermitIds = new Set(
    input.permits.filter((p) => isSubPermit(p)).map((p) => p.id),
  );

  // ★★ fix-378: what the historic rule kept off THIS board. Counted with the
  // same gates the emit loop applies — not acked, and at least one of the
  // viewer's legs would have rendered it — so the number is "rows you would
  // otherwise be looking at", not a book-wide abstraction.
  let suppressedHistoric = 0;

  for (const p of prepare(input)) {
    // ★ fix-390: a held permit is silent, so it contributes nothing to the
    // HISTORY-suppressed count either — that number means "would apply but for
    // history", and a hold is state, not history.
    // ★ fix-409: `quiet`, not `isHeld` — a permit whose work the viewer has
    //   asked to SEE is not silent, so its history-suppressed rows count again.
    if (p.quiet) continue;
    for (const kind of historicSuppressedKinds(
      p.permit,
      p.permit.permit_cycles ?? [],
      // ★ fix-386: prepare() already resolved the project, so the recorded
      // answer reaches the gate with no new plumbing.
      p.project?.is_backfill ?? null,
    )) {
      if (isMilestoneAcked(kind, p.permit, input.acks ?? [])) continue;
      const visible = p.legs.some(
        (leg) =>
          relayStateFor(kind, leg, p.shape, p.design) !== 'absent' &&
          milestoneVerb(kind, leg) !== '',
      );
      if (visible) suppressedHistoric += 1;
    }
    for (const m of permitMilestones(
      p.permit,
      today,
      thresholds,
      input.acks ?? [],
      p.project?.is_backfill ?? null,
      // ★ fix-409: the hold silences the chip only while held work is hidden.
      p.quiet,
    )) {
      if (m.date === null) continue; // ← the rule, enforced in one place
      for (const leg of p.legs) {
        const state = relayStateFor(m.kind, leg, p.shape, p.design);
        if (state === 'absent') continue;
        const verb = milestoneVerb(m.kind, leg);
        if (!verb) continue;
        const daysLate = daysBetween(m.date, today);
        // The design half finishing a two-leg milestone IS the handoff.
        const isHandoff =
          leg === 'design' &&
          p.shape === 'two-leg' &&
          MILESTONE_LEGS[m.kind].design &&
          MILESTONE_LEGS[m.kind].ent;
        const cyc = latestCycle(p.permit.permit_cycles ?? []);
        const other = milestoneCounterparty(leg, p.permit);
        items.push({
          key: `m-${p.permit.id}-${m.kind}-${leg}`,
          source: 'milestone',
          verb,
          // ★★ fix-348 — THE IN-ROW CONTRADICTION, DELETED RATHER THAN PATCHED.
          //
          // This appended "Sitting with the entitlement lead." to EVERY waiting
          // row, whichever leg it was on — so an entitlement-leg row waiting on
          // the DA said "sitting with the entitlement lead" one line above
          // "Wait — with Cam", and on 4137 54th Ave SW it told Bobby his own
          // row was sitting with himself.
          //
          // ★ The right fix is not a third leg-aware copy of the same sentence.
          // The row ALREADY names the counterparty twice — in `actionLine`
          // ("Wait — with Cam") and in `whyYours` ("Not yours yet — with Cam"),
          // both of which fix-308 #45 put there deliberately and both of which
          // were correct. A third restatement is exactly the verbiage fix-306
          // #22 cut. So the sentence goes, `why` keeps the milestone's own
          // facts, and the two survivors read from milestoneCounterparty —
          // now the only place the question is answered.
          why: m.why,
          where: p.where,
          date: m.date,
          daysLate,
          bucket: bucketFor(daysLate),
          actionable: state === 'mine',
          isHeld: p.isHeld,
          hold: p.hold,
          permitId: p.permit.id,
          taskId: null,
          action: isHandoff ? 'handoff' : 'ack',
          actionLine: milestoneAction(m.kind, leg, state, p.permit, m),
          projectId: p.permit.project_id,
          address: p.project?.address ?? null,
          permitLabel: permitLabelOf(p.permit),
          leg,
          milestoneKind: m.kind,
          anchor: milestoneAnchor(m.kind, p.permit),
          task: null,
          cycleIndex: cyc?.cycle_index ?? null,
          entLead: p.permit.ent_lead ?? null,
          permitDa: p.permit.da ?? null,
          stateLabel: milestoneStateLabel(daysLate),
          whyYours: milestoneWhyYours(leg, state, p.permit),
          withWhom: state === 'waiting' ? other.label : null,
          // ★ OUTGOING only. `isHandoff` is already "the design half finishing
          // a two-leg milestone"; with 'waiting' that is precisely "design is
          // done and the lead now holds it".
          handedOff: isHandoff && state === 'waiting',
        });
      }
    }
  }

  // ========================================================================
  // ★★★ fix-348 — TASKS AND MILESTONES IN ONE DATED FORECAST
  // ========================================================================
  //
  // Bobby: *"I don't really see any my tasks in the My Board. We want that to
  // merge and holistically work together. Your forecast is not only your
  // milestones, but it's also your tasks that are past due or today or tomorrow
  // or this week or next week."*
  //
  // ★★★ THE BLEND WAS ALREADY WRITTEN. This loop has existed since fix-303 and
  // has never emitted a single row, for TWO independent reasons, both measured
  // on prod 2026-08-19:
  //
  //   1. IT READ A COLUMN NOTHING WRITES. `due_date`: 0 of 558 open tasks carry
  //      one, and the live task editor (TaskDetailEditor) offers Start Date and
  //      Target Date and no third field — there is no control in the app that
  //      can set it. `target_date` carries 278. The My Tasks bar directly below
  //      this panel has always counted overdue off `target_date`
  //      (isTaskOverdue), so the bar said "4 overdue" while the forecast above
  //      it said nothing: two numbers about the same tasks, from two columns.
  //
  //   2. IT COMPARED `assigned_to` AS A RAW STRING. permit_tasks.assigned_to
  //      holds a ROLE token ("Design Manager", "Entitlements", …) or nothing at
  //      all as often as it holds a name — 344 of 558 open tasks are unassigned
  //      — and fix-238 exists precisely because a raw compare routes those to
  //      nobody. My Tasks resolves; the board did not.
  //
  // ★ So the blend is: the date the team actually sets, and the ownership rule
  // the other half of the same screen already uses. Both are shared code, not a
  // third opinion.
  //
  // ★ A TASK STAYS A TASK. fix-304 §21's row vocabulary is untouched — ✓ amber
  // for a task, ◆ blue for a milestone, and `data-kind` on the row — so they are
  // blended by DATE and never disguised as each other.
  const me = (input.viewer.name ?? '').trim().toLowerCase();
  const owns = input.taskOwns ?? defaultTaskOwns(input);
  // ★★★ fix-409: the SAME sets prepare() resolves for milestones, so a task and
  // the milestone beside it cannot disagree about whether their permit is
  // paused. Hoisted out of prepare() for exactly this.
  const { heldProjects: taskHeldProjects, heldPermits: taskHeldPermits } =
    heldSets(input);
  const taskChips = holdChipIndex(input);
  for (const t of input.tasks) {
    // ★ target_date, then due_date. Not the other way round: target_date is what
    // the team sets and what every other overdue count on this screen reads.
    // due_date is kept as a fallback only because the column exists.
    const date = t.target_date ?? t.due_date;
    if (!date) continue;
    if (!isTaskLive(t.status)) continue;
    if (me === '' || !owns(t, input.viewer.name)) continue;
    // ★ The same two exclusions prepare() applies to milestones, which the old
    // loop bypassed entirely: work on a CANCELLED project is not work (fix-264),
    // and a SUB-PERMIT is a placeholder reviewed under its parent (fix-194).
    // Silent while nothing was dated; live the moment this loop emits a row.
    if (isCancelledProject(t.project_id, input.cancelledIds)) continue;
    // ★ fix-460: a team task has no permit, so it is not a sub-permit.
    if (t.permit_id !== null && subPermitIds.has(t.permit_id)) continue;
    // ★★★ fix-409 — THE THIRD EXCLUSION, AND THE ONE THIS TICKET IS ABOUT.
    //
    // The two lines above are fix-264's and fix-194's; this is the hold rule
    // they were missing. Without it a held project's tasks kept ageing in the
    // red buckets while every milestone on the same permit stayed quiet — one
    // screen giving two answers about one pause.
    //
    // ★ `isPermitHeld` reads DOWNWARD, so a task under a held PROJECT is held
    //   even when its permit has no hold of its own. That is the whole of the
    //   prod population: 4 tasks, all under the 2 held projects.
    const taskHeld = isPermitHeld(
      { id: t.permit_id, project_id: t.project_id },
      taskHeldProjects,
      taskHeldPermits,
    );
    if (taskHeld && !input.showHeldWork) continue;
    const taskHold = taskHeld
      ? holdRowFor({ permit_id: t.permit_id, project_id: t.project_id }, taskChips)
      : null;
    const daysLate = daysBetween(date, today);
    items.push({
      key: `t-${t.id}`,
      source: 'task',
      isHeld: taskHeld,
      hold: taskHold,
      verb: t.text,
      // fix-304 §22: the ✓ task badge already says this.
      why: '',
      // ★ Was ''. The blended sort tie-breaks on `where`, and an empty one put
      // every task ahead of every milestone due the same day.
      where: `${t.project_address ?? 'Unknown address'} · ${t.permit_type ?? 'Permit'}`,
      date,
      daysLate,
      bucket: bucketFor(daysLate),
      actionable: true,
      permitId: t.permit_id,
      taskId: t.id,
      action: 'resolve-task',
      // A named task already says what to do — its own text is the action.
      actionLine: '',
      projectId: t.project_id ?? null,
      address: t.project_address ?? null,
      permitLabel: t.permit_type ?? null,
      // ★ fix-446: a task's column comes from its TEAM (fix-244), never from
      //   the relay — so it has no leg.
      leg: null,
      milestoneKind: null,
      anchor: null,
      task: t,
      cycleIndex: null,
      entLead: null,
      permitDa: t.permit_da ?? null,
      stateLabel: milestoneStateLabel(daysLate),
      // A named task is on your list because your name is on it. Saying so
      // would be the verbiage #22 cut.
      whyYours: '',
      withWhom: null,
      handedOff: false,
    });
  }

  // ★★ fix-348 — THE OUTGOING ROWS LEAVE THE DATED BUCKETS.
  //
  // fix-308 #46's comment in MyBoard.tsx says it outright: *"When the design
  // half is done the row LEAVES the dated buckets — it is no longer past due
  // FOR THE SENDER — and lands here."* It never did. The page DERIVED the
  // handed-off list from the forecast's own buckets and rendered both, so one
  // permit appeared twice on one screen — which is exactly what Bobby saw.
  //
  // Splitting here, in the builder, makes "an item appears in at most one
  // bucket" structural rather than something two call sites have to agree on.
  const handedOffItems = items.filter((i) => i.handedOff);
  const dated = items.filter((i) => !i.handedOff);

  // ★ RANK, DO NOT FILTER. Blended, Miles's past due is 57 milestones + 145
  // tasks. Listing them all teaches people to scroll past red, so past due is a
  // SORT KEY: lateness first, capped, with the true total AND the split always
  // in the header — and the cap takes the worst of each kind, so 145 late tasks
  // cannot bury every late milestone or the other way round.
  const inBucket = (b: ForecastBucket) =>
    dated
      .filter((i) => i.bucket === b)
      .sort((a, z) => z.daysLate - a.daysLate || a.where.localeCompare(z.where));

  return {
    past_due: forecastSection(inBucket('past_due'), BOARD_SECTION_CAPS.past_due),
    today: forecastSection(inBucket('today'), BOARD_SECTION_CAPS.today),
    tomorrow: forecastSection(inBucket('tomorrow'), BOARD_SECTION_CAPS.tomorrow),
    this_week: forecastSection(
      inBucket('this_week').sort((a, z) => a.date.localeCompare(z.date)),
      BOARD_SECTION_CAPS.this_week,
    ),
    next_week: forecastSection(
      inBucket('next_week').sort((a, z) => a.date.localeCompare(z.date)),
      BOARD_SECTION_CAPS.next_week,
    ),
    // ★★★ fix-446 — `later` IS RETURNED NOW, AND THE BOARD STILL NEVER SEES IT.
    //
    // These items were always BUILT and then silently dropped: `bucketFor`
    // files anything beyond 14 days as 'later' and the return simply had no
    // such key. Harmless while the only reader was a board that deliberately
    // stops at seven days (fix-444 §B) — but My Tasks is "the COMPLETE list of
    // everything you own" (fix-444 ruling 1), and a milestone three weeks out
    // is exactly the row that belongs there and nowhere else.
    //
    // ★★ ADDITIVE AND CAPPED AT ZERO. BOARD_SECTION_CAPS.later is 0, so
    // `items` is empty and any renderer that walked this would draw nothing;
    // the uncapped truth is in `.all`. No existing key and no cap changes.
    later: forecastSection(
      inBucket('later').sort((a, z) => a.date.localeCompare(z.date)),
      BOARD_SECTION_CAPS.later,
    ),
    handed_off: handedOffItems.sort((a, z) => z.daysLate - a.daysLate),
    suppressedHistoric,
  };
}

// ---------------------------------------------------------------------------
// ★★★ fix-397 — Project queue: the RIGHT panel, the OWNER'S PRIORITY LIST
// ---------------------------------------------------------------------------
//
// It used to be "only ever things with a STATE", grouped into three sections
// and sorted by group. Bobby ruled otherwise on 2026-08-24 after his own board
// put 554 N 75th's SDOT Tree — three days past its city target — at the BOTTOM,
// below two permits due a week later. See src/lib/projectQueue.ts for the two
// rulings and the quotes; the vocabulary and the sort live there.
//
// ★★★ WHAT WAS REMOVED, AND THAT IT WAS A RULING:
//
//   "i am not sure how well 'Blocked on you' and 'Waiting on design' is built
//    out and if it is serving a function. i think we remove those for the time
//    being until that gets built out in depth better. but this will serve a
//    better purpose i think."   — Bobby, 2026-08-24
//
// ★★ THE RELAY MACHINERY BELOW IS DELIBERATELY LEFT STANDING. relayStateFor,
// MILESTONE_VERBS, MILESTONE_LEGS and milestoneCounterparty still drive the
// FORECAST (the left column), which this ticket does not touch — and the two
// removed sections may return "in depth better". Nothing here is orphaned.

/** fix-303: what a queue row has to answer WITHOUT being clicked — which
 *  permit, when it went in, what the city said, and how long it has sat.
 *
 *  ★ Every date here is `string | null`, and null is rendered as words ("No
 *  target date"), never as a blank. A blank looks like zero, and that is the
 *  failure mode this codebase keeps hitting. */
export interface QueuePermitDetail {
  permitId: number;
  /** "BLD2026-0319" — null when the permit has no number yet. */
  num: string | null;
  type: string;
  /** c0.submitted — when it went to the city. */
  submitted: string | null;
  /** c0.intake_accepted — when the city took it in. */
  intakeAccepted: string | null;
  /** The city's own target date for this cycle. */
  cityTarget: string | null;
  /** True when cityTarget is set AND in the past. Null cityTarget is NOT
   *  overdue — "unknown" and "late" are different facts. */
  cityTargetPassed: boolean;
  /** Days since the state below began. */
  daysInState: number;
  /** Plain words for the state the days are counted from. */
  stateLabel: string;
  cycleIndex: number | null;
}

/** ★ fix-397: the queue's own shape now lives in projectQueue.ts, re-exported
 *  here so every existing importer of `myBoard` keeps one import site. */
export type ProjectQueue = OwnerQueue;

/** fix-303: turn a permit into the row detail — which permit, when it went in,
 *  what the city promised, how long it has sat. ★ fix-397 keeps this: its
 *  `daysInState` + `stateLabel` are exactly the one-line state the new rows
 *  carry ("6d submitted, awaiting intake"), so the sentence survived the
 *  reshape rather than being rewritten. */
/** fix-304 §20: how a permit names itself on a row — number and type when it
 *  has a number, type alone when it does not. Never blank. */
export function permitLabelOf(
  permit: Pick<Permit, 'num' | 'type'>,
): string {
  const num = (permit.num ?? '').trim();
  const type = (permit.type ?? 'Permit').trim();
  return num ? `${num} · ${type}` : type;
}

export function queuePermitDetail(
  permit: PermitWithCycles,
  today: string,
): QueuePermitDetail {
  const cyc = latestCycle(permit.permit_cycles ?? []);
  const cityTarget = cyc?.city_target ?? null;

  // The clock is counted from the most recent thing that actually happened,
  // so "how long has it been like this" is answered rather than implied.
  let since: string | null = null;
  let stateLabel = 'tracked';
  if (cyc?.corr_issued && !cyc.resubmitted) {
    since = cyc.corr_issued;
    stateLabel = 'in corrections';
  } else if (permit.approval_date && !permit.actual_issue) {
    since = permit.approval_date;
    stateLabel = 'approved, not issued';
  } else if (cyc?.intake_accepted) {
    since = cyc.intake_accepted;
    stateLabel = 'in review';
  } else if (cyc?.submitted) {
    since = cyc.submitted;
    stateLabel = 'submitted, awaiting intake';
  } else if (permit.target_submit) {
    since = permit.target_submit;
    stateLabel = 'past target submit';
  }

  return {
    permitId: permit.id,
    num: (permit.num ?? '').trim() || null,
    type: permit.type ?? 'Permit',
    submitted: cyc?.submitted ?? null,
    intakeAccepted: cyc?.intake_accepted ?? null,
    cityTarget,
    // ★ A missing target is NOT overdue. "We don't know" and "it's late" are
    // different facts and the row says which.
    cityTargetPassed: !!cityTarget && daysBetween(cityTarget, today) > 0,
    daysInState: since ? daysBetween(since, today) : 0,
    stateLabel,
    cycleIndex: cyc?.cycle_index ?? null,
  };
}

/**
 * ★★★ fix-397 — WHICH KIND IS THIS PERMIT, IF ANY?
 *
 * The three mains Bobby named, each gated by the rule that already exists for
 * it. Returns null when the permit belongs in no band at all.
 *
 * ★★★ EVERY SILENCE GATE COMPOSES HERE, and none of them is re-implemented:
 * `milestoneApplies` already folds in fix-390/391 holds (via `isHeld`, resolved
 * at either scope in `prepare`), fix-388's terminal-negative status, fix-378's
 * history and fix-386's backfill flag. `prepare()` has already dropped
 * sub-permits (fix-194) and cancelled projects (fix-262) before we get here.
 *
 * ★★ `city_review` is the one kind with no milestone of its own, so its gate is
 * spelled out — and it deliberately does NOT take the history/backfill gate.
 * That gate exists for PLAN dates the team set (target_submit, draw); a city
 * target is the CITY's date, and suppressing it because the project was
 * backfilled would hide live city work.
 */
function queueKindFor(
  p: Prepared,
  input: BoardInput,
  thresholds: BoardThresholds,
): { kind: QueueKind; due: string | null } | null {
  const permit = p.permit;
  const cycles = permit.permit_cycles ?? [];
  const isBackfill = p.project?.is_backfill ?? null;
  const acks = input.acks ?? [];
  void thresholds;
  void acks;

  // ★ Corrections first — it outranks city review when both fit
  // (QUEUE_KIND_RANK), because the redlines are the question, not the city's
  // review target.
  if (milestoneApplies('corrections', permit, cycles, isBackfill, p.quiet)) {
    // ★★★ THE DATE IS NULL, AND THAT IS A FINDING RATHER THAN AN OMISSION.
    //
    // The model carries NO resubmit target for the current round. The only
    // date columns in play are permit_cycles.city_target (the CITY's clock —
    // the brief forbids borrowing it, and rightly: it answers "when will they
    // reply", not "when will we"), corr_issued and resubmitted (both records
    // of what already happened), and permits.target_submit (the FIRST
    // submittal, which by definition is behind us once corrections exist).
    //
    // permitMilestones has said so since fix-337 in as many words —
    // "Corrections — a STATE, no inherent date" — and this agrees with it
    // rather than inventing one. A projected resubmit date does exist inside
    // projectedApproval.ts (corr_issued + the learned team turnaround), but
    // that is a FORECAST of when we probably will, not a target anybody
    // committed to; sorting a priority list by it would put a guess where a
    // promise belongs, and it would need the learner data the board does not
    // fetch (fix-318's one-query rule).
    //
    // So corrections rows ride in `No target date`, and their state line says
    // the corrections are in hand.
    return { kind: 'corrections', due: null };
  }

  // ★ City review — submitted, on the city's clock, nothing owed by us yet.
  // This is exactly the population the old `waiting_on_city` group carried,
  // and the date is the same `city_target` those rows already showed.
  if (
    !p.quiet &&
    !isTerminalNegativeStatus(permit.status) &&
    everSubmitted(cycles) &&
    !permit.approval_date &&
    !permit.actual_issue
  ) {
    return { kind: 'city_review', due: latestCycle(cycles)?.city_target ?? null };
  }

  // ★ Submittal — pre-submission, and the date is OURS.
  if (
    milestoneApplies('target_submit', permit, cycles, isBackfill, p.isHeld) &&
    permit.target_submit
  ) {
    return { kind: 'submittal', due: permit.target_submit };
  }

  return null;
}

export function buildQueue(input: BoardInput): ProjectQueue {
  const thresholds = input.thresholds ?? DEFAULT_BOARD_THRESHOLDS;
  // ★★★ THE VIEWER RESOLVER IS `prepare()`, UNCHANGED AND UNDUPLICATED.
  // It is the board's one answer to "whose permits are these": the ENT/DA legs,
  // oversight, and fix-306/365's `scopeNames` for a DM looking at their
  // associates. This ticket adds no second ownership concept — it consumes the
  // existing one, which is why a DM's queue already contains their associates'
  // permits with no new machinery.
  const prepared = prepare(input);

  const rows: QueueRow[] = [];
  for (const p of prepared) {
    const hit = queueKindFor(p, input, thresholds);
    if (!hit) continue;
    // ★★ fix-308b, preserved through the reshape: a viewer whose ONLY leg here
    // is design does not get "quietly with the city" rows. See
    // daQueueAllowsRowKind for why the ruling outlived its vocabulary.
    if (usesDaQueueShape(p.legs) && !daQueueAllowsRowKind(hit.kind)) continue;

    const detail = queuePermitDetail(p.permit, input.today);
    // ★ The existing state sentence, reused verbatim rather than rewritten:
    // "6d submitted, awaiting intake".
    const stateLine = detail.daysInState
      ? `${detail.daysInState}d ${detail.stateLabel}`
      : detail.stateLabel;

    rows.push({
      key: `q-${p.permit.id}-${hit.kind}`,
      permitId: p.permit.id,
      projectId: p.permit.project_id,
      // ★ Ruling 1: the ADDRESS is the row's primary label, and a project with
      // two due permits produces two rows.
      address: p.project?.address ?? 'Unknown address',
      num: detail.num,
      type: detail.type,
      cycleIndex: detail.cycleIndex,
      kind: hit.kind,
      due: hit.due,
      band: bandFor(hit.due, input.today),
      dueWords: dueWordsFor(hit.due, input.today),
      daysPastDue: daysPastDueFor(hit.due, input.today),
      stateLine,
      // ★ fix-365 composes for free: the row carries whose it is, so a DM
      // scoped to their associates can group WITHIN a band by this without any
      // new grouping machinery. The bands stay outermost — urgency first.
      owner:
        (p.permit.ent_lead ?? '').trim() || (p.permit.da ?? '').trim() || null,
      // ★ fix-409: the fact, carried so the row can say so. `quiet` already
      //   decided whether it is here at all.
      isHeld: p.isHeld,
      hold: p.hold,
    });
  }

  return assembleQueue(rows);
}

// ---------------------------------------------------------------------------
// ★ Never notify, but show the count.
//
// scrape_workflow_fetch_recovered runs ~50.8/day and the manual-edit guards
// ~14.5/day — the two largest event categories in the system, both meaning
// "working as intended". They must never reach a person. But showing the
// SUPPRESSED COUNT is how a quiet day and a broken notifier stop looking the
// same: four bugs this year had the shape of a missing thing looking identical
// to an absent one.
// ---------------------------------------------------------------------------
export interface SuppressionCounts {
  /** Scraper retries that recovered on their own. */
  retries: number;
  /** Manual-edit guard skips — the scraper deferring to a human edit. */
  guarded: number;
  /** Real changes, but on permits this viewer is not on. */
  notYours: number;
}

const RETRY_ACTIONS = new Set(['scrape_workflow_fetch_recovered']);
const GUARD_ACTIONS = new Set([
  'scrape_skipped_recent_manual_edit',
  'scrape_cycle_skipped_recent_manual_edit',
  'scrape_reviewer_skipped_recent_manual_edit',
]);

// ---------------------------------------------------------------------------
// fix-298 Phase 2 — system health, for the OVERSIGHT layer only.
//
// Scraper activity is not project work; it is "is the pipeline being
// maintained". That question belongs to Bobby, Gena and Dave, so it folded out
// of its own nav bell and into an oversight-gated section here.
//
// ★ Rendered as COUNTS, not a queue, and at horizons that make each number
// mean something. Measured 2026-08-14: "untouched ≥ 3 days" — the company-wide
// permitUntouched threshold — flags 120 of 259 active permits. That is half
// the book and it is not a work list; it is the same failure as measuring
// reviewer silence from submission. 14 days flags 73, 30 days flags 33, so the
// section shows the SHAPE of the staleness rather than pretending to a
// to-do list.
// ---------------------------------------------------------------------------
export interface SystemHealth {
  /** Portal fetches that failed outright in the feed's window. */
  portalFailures: number;
  /** Active permits untouched for ≥ reviewerSilentDays. */
  staleMedium: number;
  /** Active permits untouched for ≥ 30 days. */
  staleLong: number;
  /** Active permits with nobody on them at all (no DA and no entitlement lead). */
  unowned: number;
}

const STALE_LONG_DAYS = 30;

export function systemHealth(
  permits: ReadonlyArray<PermitWithCycles>,
  activity: ReadonlyArray<{ action: string }>,
  today: string,
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
  cancelledIds?: ReadonlySet<string>,
): SystemHealth {
  let staleMedium = 0;
  let staleLong = 0;
  let unowned = 0;
  for (const p of permits) {
    if (isSubPermit(p)) continue;
    if (isCancelledProject(p.project_id, cancelledIds)) continue;
    const touched = (p.updated_at ?? '').slice(0, 10);
    const age = touched ? daysBetween(touched, today) : 0;
    if (age >= thresholds.reviewerSilentDays) staleMedium += 1;
    if (age >= STALE_LONG_DAYS) staleLong += 1;
    const hasDa = (p.da ?? '').trim() !== '';
    const hasEnt = (p.ent_lead ?? '').trim() !== '';
    if (!hasDa && !hasEnt) unowned += 1;
  }
  return {
    portalFailures: activity.filter((a) => a.action === 'scrape_workflow_fetch_failed')
      .length,
    staleMedium,
    staleLong,
    unowned,
  };
}

/**
 * ★★★ fix-336 — THE SUPPRESSED ROWS THEMSELVES, not just how many there were.
 *
 * The bell has always said it is hiding "28 scraper retries · 14 manual-edit
 * guards · 257 changes on permits that aren't yours". That line was written as
 * an honesty feature — "showing what was suppressed is how a quiet day and a
 * broken notifier stop looking the same" — and for four tickets it has named a
 * destination that did not exist. The notification centre is that destination,
 * and it needs the rows.
 *
 * ★ THE RULES ARE NOT RESTATED HERE. `suppressionCounts` is now the LENGTHS of
 * these three groups rather than a second walk with its own copy of the
 * conditions, so the number on the bell and the list in the centre cannot
 * disagree — the same reason fix-329 put the bell and the board on one model.
 *
 * ★ Generic in the row type: the counts only ever needed `action` + `ent_lead`,
 * and the centre needs the whole ScraperActivityRow to render it. One function
 * serves both without either caller widening the other's contract.
 */
export interface SuppressionGroups<T> {
  retries: T[];
  guarded: T[];
  notYours: T[];
}

export function suppressionGroups<
  T extends { action: string; ent_lead: string | null },
>(rows: ReadonlyArray<T>, viewer: BoardViewer): SuppressionGroups<T> {
  const me = (viewer.name ?? '').trim().toLowerCase();
  const groups: SuppressionGroups<T> = { retries: [], guarded: [], notYours: [] };
  for (const r of rows) {
    if (RETRY_ACTIONS.has(r.action)) {
      groups.retries.push(r);
      continue;
    }
    if (GUARD_ACTIONS.has(r.action)) {
      groups.guarded.push(r);
      continue;
    }
    if (me && (r.ent_lead ?? '').trim().toLowerCase() !== me) groups.notYours.push(r);
  }
  return groups;
}

export function suppressionCounts(
  rows: ReadonlyArray<{ action: string; ent_lead: string | null }>,
  viewer: BoardViewer,
): SuppressionCounts {
  const g = suppressionGroups(rows, viewer);
  return {
    retries: g.retries.length,
    guarded: g.guarded.length,
    notYours: g.notYours.length,
  };
}

// ---------------------------------------------------------------------------
// fix-303 §2 — team queues: seeing the people you are responsible for.
//
// ★ A report's queue is THEIRS, never merged into the viewer's own. Whose
// queue a row belongs to must never be ambiguous, so each report gets its own
// titled section rather than a flag on a shared list.
//
// Two shapes of manager, derived from data rather than named in code:
//
//   Entitlement leader — sees the OTHER entitlement leads' queues. Derived
//     from the distinct ent_lead values on live permits, minus themselves.
//     Gated on the oversight flag so a plain ent_lead does not acquire a team.
//
//   Design manager — ★ DMs are assigned to PROJECTS and TASKS, not permits, so
//     their queue cannot be read off permit.dm. It is derived from their design
//     associates via dm_da_groups: the permits their DAs hold.
// ---------------------------------------------------------------------------

export interface TeamQueue {
  /** The person whose queue this is. */
  owner: string;
  /** Why they are on this board — rendered so the grouping is never ambiguous. */
  relationship: 'entitlement-lead' | 'design-associate';
  queue: ProjectQueue;
}

/** The entitlement leads whose queues an oversight ent-leader should see. */
export function entitlementReportsFor(
  viewer: BoardViewer,
  permits: ReadonlyArray<PermitWithCycles>,
): string[] {
  if (!viewer.isOversight) return [];
  const me = (viewer.name ?? '').trim().toLowerCase();
  const leads = new Set<string>();
  for (const p of permits) {
    const l = (p.ent_lead ?? '').trim();
    if (l && l.toLowerCase() !== me) leads.add(l);
  }
  return [...leads].sort((a, b) => a.localeCompare(b));
}

/** One row of dm_da_groups, as the client reads it. */
export interface DmDaRow {
  dm_name: string;
  da_name: string;
}

/** The design associates reporting to this viewer, from dm_da_groups. */
export function designReportsFor(
  viewer: BoardViewer,
  rows: ReadonlyArray<DmDaRow>,
): string[] {
  const me = (viewer.name ?? '').trim().toLowerCase();
  if (!me) return [];
  const das = new Set<string>();
  for (const r of rows) {
    if ((r.dm_name ?? '').trim().toLowerCase() !== me) continue;
    const da = (r.da_name ?? '').trim();
    if (da) das.add(da);
  }
  return [...das].sort((a, b) => a.localeCompare(b));
}

/** Build one queue per report, each scoped to that person alone. */
export function buildTeamQueues(
  input: BoardInput,
  reports: ReadonlyArray<{ owner: string; relationship: TeamQueue['relationship'] }>,
): TeamQueue[] {
  return reports.map((r) => ({
    owner: r.owner,
    relationship: r.relationship,
    queue: buildQueue({
      ...input,
      // The report's own queue, seen exactly as they would see it — NOT
      // filtered through the manager's scope, and never merged with it.
      viewer: { name: r.owner, isOversight: false },
    }),
  }));
}

// ---------------------------------------------------------------------------
// ★ The dm_da_groups gap — surfaced, never papered over.
//
// Measured on prod 2026-08-14. The mapping is stale in BOTH directions:
//
//   Active roster DAs in NO manager group:
//     Cam (41 active permits), Shire (3), George (0)
//     ★ Cam holds the largest DA load in the company and no design manager
//       would see any of it.
//
//   In a manager group but FORMER staff:
//     Alex, Chad, Nidhi — and they are not dead entries, they still hold 10
//     active permits between them. A DM's queue therefore shows live work
//     attributed to people who have left.
//
// A board that quietly omits Cam is worse than one that says he is unassigned,
// so both lists are rendered and the fix is one click away in Settings.
// ---------------------------------------------------------------------------
export interface TeamMappingGap {
  /** Active roster DAs who belong to no manager, with their live load. */
  unassignedDas: Array<{ name: string; activePermits: number }>;
  /** Names in a manager group who are no longer active staff. */
  formerInGroups: Array<{ name: string; dm: string; activePermits: number }>;
}

export function teamMappingGap(
  members: ReadonlyArray<Pick<TeamMember, 'name' | 'role' | 'active' | 'former'>>,
  rows: ReadonlyArray<DmDaRow>,
  permits: ReadonlyArray<PermitWithCycles>,
  cancelledIds?: ReadonlySet<string>,
): TeamMappingGap {
  const load = new Map<string, number>();
  for (const p of permits) {
    if (isSubPermit(p)) continue;
    if (isCancelledProject(p.project_id, cancelledIds)) continue;
    const da = (p.da ?? '').trim();
    if (!da) continue;
    load.set(da, (load.get(da) ?? 0) + 1);
  }

  const grouped = new Map<string, string>(); // da -> dm
  for (const r of rows) {
    const da = (r.da_name ?? '').trim();
    if (da) grouped.set(da.toLowerCase(), (r.dm_name ?? '').trim());
  }

  const activeDas = members.filter(
    (m) => m.role === 'da' && m.active === true && m.former !== true,
  );
  const unassignedDas = activeDas
    .filter((m) => !grouped.has((m.name ?? '').trim().toLowerCase()))
    .map((m) => ({ name: m.name, activePermits: load.get(m.name) ?? 0 }))
    .sort((a, b) => b.activePermits - a.activePermits || a.name.localeCompare(b.name));

  const activeNames = new Set(
    activeDas.map((m) => (m.name ?? '').trim().toLowerCase()),
  );
  const formerInGroups = [...grouped.entries()]
    .filter(([daLower]) => !activeNames.has(daLower))
    .map(([daLower, dm]) => {
      const original =
        rows.find((r) => (r.da_name ?? '').trim().toLowerCase() === daLower)?.da_name ??
        daLower;
      const name = (original ?? '').trim();
      return { name, dm, activePermits: load.get(name) ?? 0 };
    })
    .sort((a, b) => b.activePermits - a.activePermits || a.name.localeCompare(b.name));

  return { unassignedDas, formerInGroups };
}

// ---------------------------------------------------------------------------
// fix-306 #35 — the team view.
//
// ★ THE RULE, AND IT IS THE ONE MOST LIKELY TO BE GOT WRONG:
//   The FORECAST is always personal. Brittani's forecast is what SHE is
//   assigned to or impacted by — never her design associates' tasks. Her day is
//   not their day, and a manager whose day fills with other people's work has
//   lost the plot of this screen.
//   The QUEUE can be team-wide, with a filter to drill into one person.
//
// So the toggle below scopes the QUEUE ONLY. buildForecast never sees it.
//
// Measured 2026-08-14: Brittani 90 permits (Ahmadi, Fisk, Marc) · Lindsay 69
// (Ainsley, Francesca, Trevor) · Derry 37 (Chad, Nicky, Qisheng) · Jade 13
// (Alex, Erick, Nidhi). Entitlement leads route through da_team_routing
// instead: Miles 9 DAs / 204 permits, Briana 4 DAs / 81.
// ---------------------------------------------------------------------------

export type QueueScopeMode = 'mine' | 'team' | 'person';

export interface QueueScope {
  mode: QueueScopeMode;
  /** Set when mode === 'person'. */
  person?: string | null;
}

/** Default: MY QUEUE. Nobody is handed 90 permits on load. */
export const DEFAULT_QUEUE_SCOPE: QueueScope = { mode: 'mine' };

export interface EntRoutingRow {
  da: string;
  ent_lead?: string | null;
}

/** The people whose work a viewer may scope the queue to.
 *
 *  Design manager  -> their DAs via dm_da_groups
 *  Entitlement lead-> their DAs via da_team_routing
 *  Oversight       -> everyone holding live work
 *  Design associate-> nobody; they get no toggle at all. */
export function teamMembersFor(
  viewer: BoardViewer,
  dmRows: ReadonlyArray<DmDaRow>,
  entRows: ReadonlyArray<EntRoutingRow>,
  everyone: ReadonlyArray<string>,
): string[] {
  const me = (viewer.name ?? '').trim().toLowerCase();
  if (!me) return [];
  if (viewer.isOversight) {
    return [...new Set(everyone.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }
  const names = new Set<string>();
  for (const r of dmRows) {
    if ((r.dm_name ?? '').trim().toLowerCase() === me) {
      const da = (r.da_name ?? '').trim();
      if (da) names.add(da);
    }
  }
  for (const r of entRows) {
    if ((r.ent_lead ?? '').trim().toLowerCase() === me) {
      const da = (r.da ?? '').trim();
      if (da) names.add(da);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Build the queue for a scope. 'mine' is the viewer's own; 'team' is the union
 *  of their people; 'person' is one of them.
 *
 *  ★ Only ever called for the QUEUE. The forecast is built from `input`
 *  untouched, which is what keeps a manager's day their own. */
export function buildQueueForScope(
  input: BoardInput,
  scope: QueueScope,
  team: ReadonlyArray<string>,
): ProjectQueue {
  if (scope.mode === 'mine') return buildQueue(input);
  const names =
    scope.mode === 'person' && scope.person ? [scope.person] : [...team];
  return buildQueue({ ...input, scopeNames: names });
}
