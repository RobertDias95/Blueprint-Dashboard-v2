import type {
  DrawScheduleRow,
  Permit,
  PermitCycle,
  Stage,
} from './database.types';
import { isTerminalPositiveStatus } from './permitTerminalStatus';

// Q2: Pure stage-classification helpers. Ported from v1's
// computeStage/effectiveStage and DE early/late split (see v1 index.html
// lines 2641-2653 + 3064-3081). Pure functions only — no DOM, no globals,
// no Supabase. The matrix renderer composes them.
//
// fix-31c (2026-05-19): effectiveStage gained a terminal-positive
// permit.status override. When the portal's Record Status reaches
// "Conceptually Approved" / "Approved" / "Issued" / "Completed" /
// "Ready for Issuance" / "Closed", per-cycle state is known-stale —
// e.g. a permit at "Conceptually Approved" can still have a cycle 1
// corr_issued from a historical correction round that's since been
// resolved at the parent / record-status level. Pre-fix that
// short-circuited as 'co' (Corrections) on the matrix; now it routes
// to 'is' when actual_issue is set, else 'pm'.

const STAGES: ReadonlySet<Stage> = new Set(['de', 'pm', 'co', 'ap', 'is']);

export function computeStage(p: Permit, cycles: PermitCycle[]): Stage {
  if (p.stage_override && STAGES.has(p.stage_override as Stage)) {
    return p.stage_override as Stage;
  }
  if (p.actual_issue) return 'is';
  // Walk cycles most-recent-first. corr_issued without resubmitted = corrections open.
  // Otherwise the first cycle with a submitted date = under review.
  const sorted = [...cycles].sort((a, b) => b.cycle_index - a.cycle_index);
  for (const c of sorted) {
    if (c.corr_issued && !c.resubmitted) return 'co';
    if (c.submitted) return 'pm';
  }
  return 'de';
}

export function effectiveStage(p: Permit, cycles: PermitCycle[]): Stage {
  if (p.actual_issue) return 'is';
  if (p.approval_date) return 'ap';
  // fix-31c: portal-side terminal-positive status (e.g. "Conceptually
  // Approved") trumps stale cycle data. actual_issue + approval_date
  // already short-circuit above; this branch covers the case where
  // the city has terminally signed off but the dashboard hasn't
  // recorded the formal approval_date yet (Bobby keeps that field
  // for the final ready-to-issue moment, not the conceptual sign-off).
  if (isTerminalPositiveStatus(p.status)) return 'pm';
  return computeStage(p, cycles);
}

const DE_LATE_STATUSES: ReadonlySet<string> = new Set([
  'DD / Permit Set',
  'Pending Consultants',
]);

const DE_EARLY_STATUSES: ReadonlySet<string> = new Set([
  'Scheduled',
  'Schematic',
  '',
]);

/** Split a DE permit into early (Scheduled/Schematic) vs late (DD/Pending Consultants). */
export function classifyDeBucket(
  p: Permit,
  drawStatus: string | null,
): 'early' | 'late' {
  const status = drawStatus ?? '';
  if (DE_LATE_STATUSES.has(status)) return 'late';
  if (p.dd_start && !DE_EARLY_STATUSES.has(status)) return 'late';
  return 'early';
}

export interface BucketedPermits {
  deEarly: Permit[];
  deLate: Permit[];
  pm: Permit[];
  co: Permit[];
  ap: Permit[];
  is: Permit[];
}

export interface BucketInput {
  permit: Permit;
  cycles: PermitCycle[];
}

/**
 * Bucket a list of permits into the dashboard matrix slots. Mirrors v1's
 * renderDashboard logic (lines 2588-2670). Pure — caller provides cycles
 * and per-project draw-schedule status; helper returns the grouped result.
 */
export function bucketPermits(
  inputs: BucketInput[],
  drawByProjectId: Map<string, DrawScheduleRow>,
): BucketedPermits {
  const out: BucketedPermits = {
    deEarly: [],
    deLate: [],
    pm: [],
    co: [],
    ap: [],
    is: [],
  };

  for (const { permit, cycles } of inputs) {
    const stage = effectiveStage(permit, cycles);
    if (stage === 'de') {
      const ds = drawByProjectId.get(permit.project_id);
      const bucket = classifyDeBucket(permit, ds?.status ?? null);
      (bucket === 'late' ? out.deLate : out.deEarly).push(permit);
    } else {
      out[stage].push(permit);
    }
  }

  // Sort each bucket by the date that drives its column header.
  out.deEarly.sort(byTargetSubmit);
  out.deLate.sort(byTargetSubmit);
  out.pm.sort(byMostRecentCityTarget(inputs));
  out.co.sort(byMostRecentCorrIssued(inputs));
  out.ap.sort(byApprovalDate);
  out.is.sort(byActualIssue);

  return out;
}

function byTargetSubmit(a: Permit, b: Permit): number {
  return (a.target_submit ?? '9999') > (b.target_submit ?? '9999') ? 1 : -1;
}

function byApprovalDate(a: Permit, b: Permit): number {
  return (a.approval_date ?? '9999') > (b.approval_date ?? '9999') ? 1 : -1;
}

function byActualIssue(a: Permit, b: Permit): number {
  return (a.actual_issue ?? '9999') > (b.actual_issue ?? '9999') ? 1 : -1;
}

function byMostRecentCityTarget(inputs: BucketInput[]) {
  const cyclesByPermit = new Map(inputs.map((i) => [i.permit.id, i.cycles]));
  return (a: Permit, b: Permit): number => {
    const ka = mostRecent(cyclesByPermit.get(a.id) ?? [], (c) => c.city_target);
    const kb = mostRecent(cyclesByPermit.get(b.id) ?? [], (c) => c.city_target);
    return (ka ?? '9999') > (kb ?? '9999') ? 1 : -1;
  };
}

function byMostRecentCorrIssued(inputs: BucketInput[]) {
  const cyclesByPermit = new Map(inputs.map((i) => [i.permit.id, i.cycles]));
  return (a: Permit, b: Permit): number => {
    const ka = mostRecent(cyclesByPermit.get(a.id) ?? [], (c) => c.corr_issued);
    const kb = mostRecent(cyclesByPermit.get(b.id) ?? [], (c) => c.corr_issued);
    return (ka ?? '9999') > (kb ?? '9999') ? 1 : -1;
  };
}

function mostRecent<T>(rows: T[], pick: (row: T) => string | null): string | null {
  const dates = rows.map(pick).filter((d): d is string => Boolean(d)).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * Hide an issued permit only if every permit at its address is also issued.
 * Mirrors v1's `hasActivePermit` rule (line 2594-2596).
 */
export function hideIssuedAtAddress(
  inputs: BucketInput[],
  projectIdToAddress: Map<string, string>,
): Set<number> {
  const permitsByAddress = new Map<string, BucketInput[]>();
  for (const input of inputs) {
    const addr = projectIdToAddress.get(input.permit.project_id);
    if (!addr) continue;
    const list = permitsByAddress.get(addr) ?? [];
    list.push(input);
    permitsByAddress.set(addr, list);
  }
  const hide = new Set<number>();
  for (const [, list] of permitsByAddress) {
    const allIssued = list.every(
      ({ permit, cycles }) => effectiveStage(permit, cycles) === 'is',
    );
    // v1 rule (index.html line 2602): hide an issued permit only when
    // EVERY permit at that address is also issued — i.e. the project is
    // fully complete. When the address still has any active work, keep
    // the issued cards visible so progress reads at a glance.
    if (!allIssued) continue;
    for (const { permit, cycles } of list) {
      if (effectiveStage(permit, cycles) === 'is') hide.add(permit.id);
    }
  }
  return hide;
}
