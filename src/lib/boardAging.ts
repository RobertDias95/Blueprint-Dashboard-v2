import type { PermitCycle, PermitWithCycles } from './database.types';
import type { BoardLeg } from './myBoard';

// fix-305 (register #24) — did the thing actually happen?
//
// ★ THE CASE THIS EXISTS TO PREVENT. 4000 SW Concord St, 7138853-CN: submitted
// 12 May, still "Ready for Intake" on 14 August — 94 days — and the tool said
// nothing. Its sibling STFI has been approved with no issue date for 18 days,
// fees unpaid.
//
// ★★ AND "UNTOUCHED FOR 3 DAYS" WOULD NOT HAVE CAUGHT IT. The scraper visited
// that permit 4 days ago and is visiting it happily. THE RECORD IS FRESH; THE
// STATE IS STALE. So the trigger is TIME-IN-STATE, never time-since-update —
// that is the whole ticket. Measured: 3 days of no-update flags 126 of 272
// permits and means nothing, which is why it is superseded rather than added.

/** The states a permit can sit in while somebody owes it something. */
export type TrackedState =
  | 'corrections'
  | 'approved_not_issued'
  | 'ready_for_intake'
  | 'additional_info'
  | 'in_review'
  | 'resubmitted';

/** ★ ONE LADDER FOR EVERY STATE. Simplest to explain, and a person can predict
 *  what the tool will do — which matters more than per-state precision. */
export const AGING_LADDER = {
  /** Quiet row on the board, ranked by age. */
  acknowledge: 3,
  /** A chase task, owned by the leg that owes the work. */
  task: 7,
  /** Sorts above everything, visibly urgent. */
  priority: 21,
} as const;

export type AgingLevel = 'none' | 'acknowledge' | 'task' | 'priority';

export function agingLevel(daysInState: number): AgingLevel {
  if (daysInState >= AGING_LADDER.priority) return 'priority';
  if (daysInState >= AGING_LADDER.task) return 'task';
  if (daysInState >= AGING_LADDER.acknowledge) return 'acknowledge';
  return 'none';
}

/** ★ Day one. 79 permits would hit "priority" the moment this ships (72 by
 *  today's measurement). They all SHOW, ranked by age — Concord appears
 *  immediately, which is the point — but nothing auto-creates a task
 *  retroactively. There are already 212 tasks overdue by an average of 26
 *  days; making that 291 in one morning would get the whole block ignored. */
export const AGING_DEPLOY_EPOCH = '2026-08-14T00:00:00Z';

/** What each state expects to happen next, and who owes it.
 *
 *  Reuses the relay's ownership from fix-298 — this is the same two-leg model
 *  with a clock on it. */
const STATE_MODEL: Record<
  TrackedState,
  { expectation: string; owner: BoardLeg; verb: string }
> = {
  in_review: {
    expectation: 'Reviews should have started',
    owner: 'entitlement',
    verb: 'Check the review has started',
  },
  approved_not_issued: {
    expectation: 'Fees paid, permit collected',
    owner: 'entitlement',
    verb: 'Pay the fees and collect',
  },
  corrections: {
    // The design half owes the redlines first; the relay hands over after.
    expectation: 'Redlines worked, then resubmitted',
    owner: 'design',
    verb: 'Work the redlines',
  },
  ready_for_intake: {
    expectation: 'Intake booked and attended',
    owner: 'entitlement',
    verb: 'Book and attend intake',
  },
  resubmitted: {
    expectation: 'Cycle re-opens, city acknowledges',
    owner: 'entitlement',
    verb: 'Confirm the city re-opened the cycle',
  },
  additional_info: {
    expectation: 'Information supplied',
    owner: 'entitlement',
    verb: 'Supply the information',
  },
};

function latestCycle(cycles: ReadonlyArray<PermitCycle>): PermitCycle | null {
  if (cycles.length === 0) return null;
  return [...cycles].sort((a, b) => b.cycle_index - a.cycle_index)[0]!;
}

export interface PermitStateRead {
  state: TrackedState | null;
  /** The date the CURRENT state began. null = cannot be aged. */
  anchor: string | null;
  expectation: string;
  owner: BoardLeg;
  verb: string;
}

/** ★ The state, read from DATES where the portal gives us one and from the
 *  STATUS where it does not.
 *
 *  Both halves are load-bearing and measured:
 *
 *  * The STFI at Concord reads status "Completed" with no issue date. Deriving
 *    from the status string alone would file it as finished; deriving from
 *    approval_date + a null actual_issue catches it. Dates win where they
 *    exist.
 *
 *  * `permit_cycles.intake_accepted` is populated on ZERO active permits, so
 *    "submitted and not yet accepted" would classify 86 permits as Ready for
 *    Intake when the portal only says so about 11. The status string is the
 *    only honest source for that state.
 */
export function permitState(permit: PermitWithCycles): PermitStateRead {
  const cyc = latestCycle(permit.permit_cycles ?? []);
  const status = (permit.status ?? '').toLowerCase();

  const of = (state: TrackedState, anchor: string | null): PermitStateRead => ({
    state,
    anchor,
    ...STATE_MODEL[state],
  });

  // Physically issued is finished, whatever anything says.
  if (permit.actual_issue) {
    return { state: null, anchor: null, expectation: '', owner: 'entitlement', verb: '' };
  }
  // The city has handed corrections back and we have not answered.
  if (cyc?.corr_issued && !cyc.resubmitted) return of('corrections', cyc.corr_issued);
  // ★ Approved with no issue date — the Concord STFI. Reads "Completed" on the
  // portal, which is exactly why the DATE decides and the status does not.
  if (permit.approval_date) return of('approved_not_issued', permit.approval_date);
  if (status.includes('ready for intake')) {
    return of('ready_for_intake', cyc?.submitted ?? null);
  }
  if (status.includes('additional info') || status.includes('awaiting information')) {
    return of('additional_info', cyc?.submitted ?? null);
  }
  if (cyc?.intake_accepted) return of('in_review', cyc.intake_accepted);
  if (cyc?.resubmitted) return of('resubmitted', cyc.resubmitted);
  return { state: null, anchor: null, expectation: '', owner: 'entitlement', verb: '' };
}

// ---------------------------------------------------------------------------
// The city's review target
// ---------------------------------------------------------------------------

/** Is this a weekend? 0 = Sunday, 6 = Saturday. */
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** The next business day strictly after `iso`. */
export function nextBusinessDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (isWeekend(d));
  return d.toISOString().slice(0, 10);
}

/** The business day `n` days STRICTLY BEFORE `iso`.
 *
 *  ★ fix-474: the mirror of `nextBusinessDay`, and it lives here for the same
 *  reason that one does — business-day arithmetic is one concept and this file
 *  owns it. `isWeekend` above is the single definition of "not a working day";
 *  a second loop somewhere else would be the fix-309 divergence again, where
 *  two literals for one lead drifted apart.
 *
 *  ★ Holidays are NOT modelled, exactly as `nextBusinessDay` does not model
 *  them. That is a known, deliberate simplification: the app has no holiday
 *  calendar, and inventing one here would make this function disagree with the
 *  chase rule that has been live since fix-305. */
export function minusBusinessDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  let left = Math.max(0, Math.trunc(n));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** ★ ONE BUSINESS DAY OF GRACE, and business is not calendar.
 *
 *  "They technically have the entire day that it's due, and then the next day
 *  is when things should be coming out." So a Friday target is NOT chaseable
 *  on Saturday or Sunday — it becomes chaseable on Monday. Using calendar days
 *  would raise a false alarm every single weekend, which would poison the
 *  feature inside a month. */
export function cityTargetChaseable(cityTarget: string, today: string): boolean {
  return today >= nextBusinessDay(cityTarget);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The ladder applied to a city target, after the business-day grace. */
export function cityTargetLevel(
  cityTarget: string | null,
  today: string,
): AgingLevel {
  if (!cityTarget) return 'none';
  if (!cityTargetChaseable(cityTarget, today)) return 'none';
  return agingLevel(daysBetween(cityTarget, today));
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface AgedRow {
  key: string;
  permitId: number;
  projectId: string;
  address: string;
  permitLabel: string;
  state: TrackedState;
  expectation: string;
  owner: BoardLeg;
  verb: string;
  anchor: string;
  daysInState: number;
  level: Exclude<AgingLevel, 'none'>;
  /** ★ False for anything whose clock started before the deploy — those show,
   *  ranked, but never auto-prompt a task. */
  mayCreateTask: boolean;
  /** The city's own target, when it has one and the grace has passed. */
  cityTarget: string | null;
  cityTargetLevel: AgingLevel;
}

/** ★ A permit in a tracked state with NOTHING to measure from.
 *
 *  35 of the 37 "additional info requested" permits have no approval date and
 *  no submitted date on any cycle. Silently omitting them is the
 *  missing-vs-absent failure this codebase keeps hitting — and it is how
 *  Concord happened. They get their own group and are never given a fake age:
 *  ageing from created_at would be precise-looking and meaningless, because
 *  that is when we added the row, not when anything happened. */
export interface DataGapRow {
  key: string;
  permitId: number;
  projectId: string;
  address: string;
  permitLabel: string;
  state: TrackedState;
  /** Which date would have to exist for this to be trackable. */
  missing: string;
}

export interface AgingInput {
  permits: ReadonlyArray<PermitWithCycles>;
  projectAddress: (projectId: string) => string;
  today: string;
  /** Only permits this viewer owns a leg of; omit to include everything. */
  viewerName?: string | null;
  isOversight?: boolean;
  cancelledIds?: ReadonlySet<string>;
}

export interface AgingResult {
  aged: AgedRow[];
  dataGaps: DataGapRow[];
}

function permitLabelOf(p: PermitWithCycles): string {
  const num = (p.num ?? '').trim();
  const type = (p.type ?? 'Permit').trim();
  return num ? `${num} · ${type}` : type;
}

export function buildAging(input: AgingInput): AgingResult {
  const aged: AgedRow[] = [];
  const dataGaps: DataGapRow[] = [];
  const me = (input.viewerName ?? '').trim().toLowerCase();

  for (const p of input.permits) {
    if (p.parent_permit_id != null) continue;
    if (input.cancelledIds?.has(p.project_id)) continue;

    const read = permitState(p);
    if (!read.state) continue;

    // Scope: the viewer must own a leg, unless they hold oversight.
    if (me && !input.isOversight) {
      const mine =
        (p.da ?? '').trim().toLowerCase() === me ||
        (p.ent_lead ?? '').trim().toLowerCase() === me;
      if (!mine) continue;
    }

    const address = input.projectAddress(p.project_id);
    const label = permitLabelOf(p);

    if (!read.anchor) {
      dataGaps.push({
        key: `gap-${p.id}`,
        permitId: p.id,
        projectId: p.project_id,
        address,
        permitLabel: label,
        state: read.state,
        missing:
          read.state === 'approved_not_issued' ? 'approval date' : 'submitted date',
      });
      continue;
    }

    const days = daysBetween(read.anchor, input.today);
    const level = agingLevel(days);
    if (level === 'none') continue;

    const cyc = latestCycle(p.permit_cycles ?? []);
    aged.push({
      key: `age-${p.id}`,
      permitId: p.id,
      projectId: p.project_id,
      address,
      permitLabel: label,
      state: read.state,
      expectation: read.expectation,
      owner: read.owner,
      verb: read.verb,
      anchor: read.anchor,
      daysInState: days,
      level,
      // ★ The day-one rule, as data rather than a special case at the call site.
      mayCreateTask:
        Date.parse(`${read.anchor}T12:00:00Z`) > Date.parse(AGING_DEPLOY_EPOCH),
      cityTarget: cyc?.city_target ?? null,
      cityTargetLevel: cityTargetLevel(cyc?.city_target ?? null, input.today),
    });
  }

  // ★ Ranked by age, worst first — 227 days should not be below 22.
  aged.sort((a, z) => z.daysInState - a.daysInState);
  dataGaps.sort((a, z) => a.address.localeCompare(z.address));
  return { aged, dataGaps };
}

export const AGING_LEVEL_LABEL: Record<Exclude<AgingLevel, 'none'>, string> = {
  acknowledge: 'Ageing',
  task: 'Needs chasing',
  priority: 'Urgent',
};
