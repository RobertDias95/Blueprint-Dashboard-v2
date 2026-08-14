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
import { isSubPermit } from './subPermit';
import { isTaskLive } from './taskStatus';
import { isCancelledProject } from './projectViewHelpers';

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

/** ★ Derived from `da IS NULL`, never from the permit type.
 *
 *  A Demolition WITH a DA (Cam holds 41 active permits) genuinely has a design
 *  leg; a non-Demolition without a DA genuinely has none. Hardcoding the type
 *  would get both wrong. */
export type LegShape = 'two-leg' | 'one-leg';

export function legShape(permit: Pick<Permit, 'da'>): LegShape {
  const da = (permit.da ?? '').trim();
  return da === '' ? 'one-leg' : 'two-leg';
}

/** ★ The handoff trap, as a type.
 *
 *  Of the 32 permits in corrections, 4 have NO TASKS AT ALL — so "all tasks
 *  complete" is VACUOUSLY TRUE for them, and an automatic rule would announce
 *  them ready to file on day one before anyone touched them, in front of the
 *  whole team. 'no-tasks' therefore exists as a state distinct from 'complete'
 *  and must never be treated as complete. */
export type DesignLegStatus = 'no-tasks' | 'in-progress' | 'complete';

/** Design tasks are the ones on the design side of the board — fix-244 made
 *  `discipline` follow the task's team, so 'arch' IS the design column. */
export function isDesignTask(t: Pick<BoardTask, 'discipline'>): boolean {
  return t.discipline === 'arch';
}

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
  if (legShape(permit) === 'one-leg') return 'none';
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
  draw: { design: 'Close the draw window', ent: '' },
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

/** Every milestone this permit is currently at. A permit can carry more than
 *  one (fees due AND a reviewer gone quiet), and each is prompted separately. */
export function permitMilestones(
  permit: PermitWithCycles,
  today: string,
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
  acks: ReadonlyArray<PermitMilestoneAck> = [],
): MilestoneOccurrence[] {
  const out: MilestoneOccurrence[] = [];
  const cycles = permit.permit_cycles ?? [];
  const cyc = latestCycle(cycles);

  // Corrections — a STATE, no inherent date. Never on the forecast unless the
  // permit also carries a target date (below), which is a different prompt.
  if (isPermitInCorrections(permit, cycles)) {
    out.push({
      kind: 'corrections',
      date: null,
      why: cyc
        ? `Cycle ${cyc.cycle_index}. The city is waiting on the corrected set.`
        : 'The city is waiting on the corrected set.',
      daysLate: null,
    });
  }

  // Approved but not issued — fees. Dated from the approval.
  if (permit.approval_date && !permit.actual_issue) {
    const late = daysBetween(permit.approval_date, today);
    if (late >= thresholds.approvedNotIssuedDays) {
      out.push({
        kind: 'fees',
        date: permit.approval_date,
        why: `Approved ${late} days ago. Past the ${thresholds.approvedNotIssuedDays}-day threshold.`,
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
  if (cyc?.submitted && !cyc.corr_issued && !permit.approval_date) {
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
        why: `No movement in ${quiet} days.`,
        daysLate: quiet,
      });
    }
  }

  // Target submit — a DATE. Only while the set has not gone in.
  if (permit.target_submit && !cyc?.submitted) {
    const late = daysBetween(permit.target_submit, today);
    out.push({
      kind: 'target_submit',
      date: permit.target_submit,
      why:
        late > 0
          ? `Target submit was ${late} days ago.`
          : 'Target submit date.',
      daysLate: late,
    });
  }

  // Draw window close — a DATE, design side only.
  if (permit.dd_end && !cyc?.submitted) {
    const late = daysBetween(permit.dd_end, today);
    out.push({
      kind: 'draw',
      date: permit.dd_end,
      why: 'The set must be complete for the lead to submit.',
      daysLate: late,
    });
  }

  // Intake — a DATE, entitlement only.
  if (permit.intake_date && !cyc?.intake_accepted) {
    out.push({
      kind: 'intake',
      date: permit.intake_date,
      why: 'Booked. The set must be uploaded first.',
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

// ---------------------------------------------------------------------------
// Forecast — the LEFT panel. Only ever things with a DATE.
// ---------------------------------------------------------------------------
export type ForecastBucket =
  | 'past_due'
  | 'today'
  | 'tomorrow'
  | 'this_week'
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
  /** For 'ack' — which milestone, and the anchor to store with it. */
  milestoneKind: MilestoneKind | null;
  anchor: string | null;
  /** For 'resolve-task' — the row's task, so the mutation has its fields. */
  task: BoardTask | null;
  /** For 'handoff' — the cycle to anchor on and who receives the submittal. */
  cycleIndex: number | null;
  entLead: string | null;
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

function section<T>(all: T[], cap: number): BoardSection<T> {
  const items = cap === Infinity ? all : all.slice(0, cap);
  return { total: all.length, items, capped: all.length > items.length, all };
}

export interface Forecast {
  past_due: BoardSection<ForecastItem>;
  today: BoardSection<ForecastItem>;
  tomorrow: BoardSection<ForecastItem>;
  this_week: BoardSection<ForecastItem>;
}

function bucketFor(daysLate: number): ForecastBucket {
  if (daysLate > 0) return 'past_due';
  if (daysLate === 0) return 'today';
  if (daysLate === -1) return 'tomorrow';
  if (daysLate >= -7) return 'this_week';
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
  /** fix-298 Phase 2: milestone actions already taken. */
  acks?: ReadonlyArray<PermitMilestoneAck>;
}

interface Prepared {
  permit: PermitWithCycles;
  project: Project | undefined;
  shape: LegShape;
  design: DesignLegStatus;
  legs: BoardLeg[];
  where: string;
}

/** The permits this viewer is on, with their relay inputs resolved once. */
function prepare(input: BoardInput): Prepared[] {
  const { viewer, permits, projects, tasks, cancelledIds } = input;
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const tasksByPermit = new Map<number, BoardTask[]>();
  for (const t of tasks) {
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

    const isDa = (permit.da ?? '').trim().toLowerCase() === me && me !== '';
    const isEnt = (permit.ent_lead ?? '').trim().toLowerCase() === me && me !== '';
    const legs: BoardLeg[] = [];
    if (isDa) legs.push('design');
    if (isEnt) legs.push('entitlement');
    // Oversight ADDS the wide view: everything, on top of their own scope.
    if (legs.length === 0 && !viewer.isOversight) continue;

    const project = byProject.get(permit.project_id);
    out.push({
      permit,
      project,
      shape: legShape(permit),
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

/** ★ The forecast only ever shows things with a DATE. "Ping the reviewer, 21
 *  days quiet" has no date and is never here — it lives on the queue. */
export function buildForecast(input: BoardInput): Forecast {
  const today = input.today;
  const thresholds = input.thresholds ?? DEFAULT_BOARD_THRESHOLDS;
  const items: ForecastItem[] = [];

  for (const p of prepare(input)) {
    for (const m of permitMilestones(p.permit, today, thresholds, input.acks ?? [])) {
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
        items.push({
          key: `m-${p.permit.id}-${m.kind}-${leg}`,
          source: 'milestone',
          verb,
          why:
            state === 'waiting'
              ? `${m.why} Sitting with the entitlement lead.`
              : m.why,
          where: p.where,
          date: m.date,
          daysLate,
          bucket: bucketFor(daysLate),
          actionable: state === 'mine',
          permitId: p.permit.id,
          taskId: null,
          action: isHandoff ? 'handoff' : 'ack',
          milestoneKind: m.kind,
          anchor: milestoneAnchor(m.kind, p.permit),
          task: null,
          cycleIndex: cyc?.cycle_index ?? null,
          entLead: p.permit.ent_lead ?? null,
        });
      }
    }
  }

  // Named tasks — individual, never duplicated to the other half. A task with
  // no due date is not a forecast item; today that is EVERY live task (0 of
  // 487 carry one), so this path is correct and currently silent. It lights up
  // the moment anyone sets a due date.
  const me = (input.viewer.name ?? '').trim().toLowerCase();
  for (const t of input.tasks) {
    if (!t.due_date) continue;
    if (!isTaskLive(t.status)) continue;
    if ((t.assigned_to ?? '').trim().toLowerCase() !== me || me === '') continue;
    const daysLate = daysBetween(t.due_date, today);
    items.push({
      key: `t-${t.id}`,
      source: 'task',
      verb: t.text,
      why: 'Assigned to you by name.',
      where: '',
      date: t.due_date,
      daysLate,
      bucket: bucketFor(daysLate),
      actionable: true,
      permitId: t.permit_id,
      taskId: t.id,
      action: 'resolve-task',
      milestoneKind: null,
      anchor: null,
      task: t,
      cycleIndex: null,
      entLead: null,
    });
  }

  // ★ RANK, DO NOT FILTER. Miles carries 139 past-due dated items. Listing
  // them all teaches people to scroll past red, so past due is a SORT KEY:
  // lateness first, capped, with the true total always in the header.
  const inBucket = (b: ForecastBucket) =>
    items
      .filter((i) => i.bucket === b)
      .sort((a, z) => z.daysLate - a.daysLate || a.where.localeCompare(z.where));

  return {
    past_due: section(inBucket('past_due'), BOARD_SECTION_CAPS.past_due),
    today: section(inBucket('today'), BOARD_SECTION_CAPS.today),
    tomorrow: section(inBucket('tomorrow'), BOARD_SECTION_CAPS.tomorrow),
    this_week: section(
      inBucket('this_week').sort((a, z) => a.date.localeCompare(z.date)),
      BOARD_SECTION_CAPS.this_week,
    ),
  };
}

// ---------------------------------------------------------------------------
// Project queue — the RIGHT panel. Only ever things with a STATE.
// ---------------------------------------------------------------------------
export type QueueGroup =
  | 'blocked_on_you'
  | 'waiting_on_design'
  | 'waiting_on_city';

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

export interface QueueProject {
  key: string;
  projectId: string;
  address: string;
  group: QueueGroup;
  permitCount: number;
  /** "ULS corrections with Fisk · gates the BP behind it" */
  status: string;
  /** "Next — Fisk finishes redlines, then you resubmit" */
  next: string;
  /** Worst lateness across the project's permits, the group's sort key. */
  daysLate: number;
  /** fix-303: the permits behind this row, with the detail that turns a label
   *  into information. */
  permits: QueuePermitDetail[];
}

export interface ProjectQueue {
  blocked_on_you: BoardSection<QueueProject>;
  waiting_on_design: BoardSection<QueueProject>;
  waiting_on_city: BoardSection<QueueProject>;
  /** Distinct projects across all three groups — the panel's sub-heading. */
  projectCount: number;
}

/** ★ The queue only ever shows things with a STATE. "Intake Monday" has no
 *  interesting state and is never here — it lives on the forecast. */
/** fix-303: turn a permit into the row detail — which permit, when it went in,
 *  what the city promised, how long it has sat. */
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

export function buildQueue(input: BoardInput): ProjectQueue {
  const thresholds = input.thresholds ?? DEFAULT_BOARD_THRESHOLDS;
  const prepared = prepare(input);

  interface Acc {
    projectId: string;
    address: string;
    permitCount: number;
    group: QueueGroup | null;
    daysLate: number;
    designers: Set<string>;
    detail: string;
    next: string;
    permits: QueuePermitDetail[];
  }
  const byProject = new Map<string, Acc>();

  for (const p of prepared) {
    const milestones = permitMilestones(
      p.permit,
      input.today,
      thresholds,
      input.acks ?? [],
    );
    // Stateful milestones only — the ones with no date.
    const stateful = milestones.filter((m) => m.date === null);

    let group: QueueGroup | null = null;
    let detail = '';
    let next = '';
    let daysLate = 0;

    for (const m of stateful) {
      for (const leg of p.legs) {
        const state = relayStateFor(m.kind, leg, p.shape, p.design);
        if (state === 'absent') continue;
        const late = m.daysLate ?? 0;
        if (state === 'mine') {
          group = 'blocked_on_you';
          detail = m.why;
          next = `Next — ${milestoneVerb(m.kind, leg).toLowerCase()}`;
          daysLate = Math.max(daysLate, late);
        } else if (state === 'waiting' && group !== 'blocked_on_you') {
          group = 'waiting_on_design';
          const da = (p.permit.da ?? '').trim();
          detail = `${p.permit.type ?? 'Permit'} corrections${da ? ` with ${da}` : ''}`;
          next = da
            ? `Next — ${da} finishes redlines, then you resubmit`
            : 'Next — the design half finishes, then you resubmit';
          daysLate = Math.max(daysLate, late);
        }
      }
    }

    // Nothing stateful and actionable → it is with the city, which is the
    // "nothing for you to do" group. Only permits actually in review qualify;
    // a permit sitting in pre-submittal has no state worth a row.
    if (group === null) {
      const cyc = [...(p.permit.permit_cycles ?? [])].sort(
        (a, b) => b.cycle_index - a.cycle_index,
      )[0];
      if (!cyc?.submitted || p.permit.approval_date) continue;
      group = 'waiting_on_city';
      detail = 'In review, reviewers moving normally';
      next = 'Next — await review';
    }

    const prev = byProject.get(p.permit.project_id);
    const rank: Record<QueueGroup, number> = {
      blocked_on_you: 0,
      waiting_on_design: 1,
      waiting_on_city: 2,
    };
    if (prev && rank[prev.group!] <= rank[group]) {
      prev.permitCount += 1;
      prev.daysLate = Math.max(prev.daysLate, daysLate);
      prev.permits.push(queuePermitDetail(p.permit, input.today));
      if ((p.permit.da ?? '').trim()) prev.designers.add((p.permit.da ?? '').trim());
      continue;
    }
    byProject.set(p.permit.project_id, {
      projectId: p.permit.project_id,
      address: p.project?.address ?? 'Unknown address',
      permitCount: (prev?.permitCount ?? 0) + 1,
      group,
      daysLate: Math.max(prev?.daysLate ?? 0, daysLate),
      designers: new Set(
        [...(prev?.designers ?? []), (p.permit.da ?? '').trim()].filter(Boolean),
      ),
      detail,
      next,
      permits: [
        ...(prev?.permits ?? []),
        queuePermitDetail(p.permit, input.today),
      ],
    });
  }

  const all: QueueProject[] = [...byProject.values()].map((a) => ({
    key: `q-${a.projectId}`,
    projectId: a.projectId,
    address: a.address,
    group: a.group!,
    permitCount: a.permitCount,
    status: a.detail,
    next: a.next,
    daysLate: a.daysLate,
    permits: a.permits,
  }));

  const inGroup = (g: QueueGroup) =>
    all
      .filter((q) => q.group === g)
      .sort((a, z) => z.daysLate - a.daysLate || a.address.localeCompare(z.address));

  return {
    blocked_on_you: section(inGroup('blocked_on_you'), BOARD_SECTION_CAPS.queueGroup),
    waiting_on_design: section(
      inGroup('waiting_on_design'),
      BOARD_SECTION_CAPS.queueGroup,
    ),
    waiting_on_city: section(inGroup('waiting_on_city'), BOARD_SECTION_CAPS.queueGroup),
    projectCount: new Set(all.map((q) => q.projectId)).size,
  };
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

export function suppressionCounts(
  rows: ReadonlyArray<{ action: string; ent_lead: string | null }>,
  viewer: BoardViewer,
): SuppressionCounts {
  const me = (viewer.name ?? '').trim().toLowerCase();
  let retries = 0;
  let guarded = 0;
  let notYours = 0;
  for (const r of rows) {
    if (RETRY_ACTIONS.has(r.action)) {
      retries += 1;
      continue;
    }
    if (GUARD_ACTIONS.has(r.action)) {
      guarded += 1;
      continue;
    }
    if (me && (r.ent_lead ?? '').trim().toLowerCase() !== me) notYours += 1;
  }
  return { retries, guarded, notYours };
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
