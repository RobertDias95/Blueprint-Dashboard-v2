import type { PermitWithCycles } from './database.types';

// fix-23c B / fix-24c: permit-level milestone helpers. The status-bar
// highlight rule lives here as a pure function so PermitDetailV2 (and any
// future surface — Reports detail row, etc.) can render exactly ONE
// highlighted cell driven by the same logic.
//
// Rule (Bobby's spec, locked in 2026-05-14 — fix-24c rev):
//   Highlight the LATEST POPULATED date BY ABSOLUTE DATE, not by chain
//   position. This better reflects "where the permit actually is" when
//   data comes back out of strict chain order — e.g. 621 Daley permit
//   202 has cycle 1 submitted=2026-03-13, intake_accepted=2026-03-13,
//   corr_issued=2026-04-16. The corrections came AFTER intake, so the
//   highlight should land on corr_issued — even though the chain-walk
//   priority would put intake_accepted first.
//
// Candidate set (any of these with a non-null date):
//   - permits.actual_issue   (kind:'permit')
//   - permits.approval_date  (kind:'permit')
//   - per cycle: submitted / city_target / corr_issued / resubmitted /
//                intake_accepted
//
// Sort: by date DESC. Tiebreaker when two candidates share a date:
//   1. higher cycle_index wins (permit-level treated as +Inf)
//   2. then chain priority (actual_issue > approval_date > intake_accepted
//      > resubmitted > corr_issued > city_target > submitted)
//
// Empty: when no candidates exist anywhere, fall back to target_submit
// (the "anticipated" anchor so the Design strip's leftmost cell still
// glows for a brand-new permit).

export type HighlightKey =
  | 'target_submit'
  | 'approval_date'
  | 'actual_issue'
  | 'submitted'
  | 'city_target'
  | 'corr_issued'
  | 'resubmitted'
  | 'intake_accepted';

export type HighlightTarget =
  | {
      kind: 'permit';
      key: 'target_submit' | 'approval_date' | 'actual_issue';
    }
  | {
      kind: 'cycle';
      cycleIndex: number;
      key:
        | 'submitted'
        | 'city_target'
        | 'corr_issued'
        | 'resubmitted'
        | 'intake_accepted';
    };

const CHAIN_PRIORITY: Record<HighlightKey, number> = {
  actual_issue: 9,
  approval_date: 8,
  intake_accepted: 7,
  resubmitted: 6,
  corr_issued: 5,
  city_target: 4,
  submitted: 3,
  target_submit: 2,
};

export function getHighlightedMilestone(
  permit: PermitWithCycles,
): HighlightTarget {
  const candidates: Array<{ target: HighlightTarget; date: string }> = [];
  if (permit.actual_issue) {
    candidates.push({
      target: { kind: 'permit', key: 'actual_issue' },
      date: permit.actual_issue,
    });
  }
  if (permit.approval_date) {
    candidates.push({
      target: { kind: 'permit', key: 'approval_date' },
      date: permit.approval_date,
    });
  }
  for (const c of permit.permit_cycles ?? []) {
    if (c.submitted) {
      candidates.push({
        target: { kind: 'cycle', cycleIndex: c.cycle_index, key: 'submitted' },
        date: c.submitted,
      });
    }
    if (c.city_target) {
      candidates.push({
        target: {
          kind: 'cycle',
          cycleIndex: c.cycle_index,
          key: 'city_target',
        },
        date: c.city_target,
      });
    }
    if (c.corr_issued) {
      candidates.push({
        target: {
          kind: 'cycle',
          cycleIndex: c.cycle_index,
          key: 'corr_issued',
        },
        date: c.corr_issued,
      });
    }
    if (c.resubmitted) {
      candidates.push({
        target: {
          kind: 'cycle',
          cycleIndex: c.cycle_index,
          key: 'resubmitted',
        },
        date: c.resubmitted,
      });
    }
    if (c.intake_accepted) {
      candidates.push({
        target: {
          kind: 'cycle',
          cycleIndex: c.cycle_index,
          key: 'intake_accepted',
        },
        date: c.intake_accepted,
      });
    }
  }
  if (candidates.length === 0) {
    return { kind: 'permit', key: 'target_submit' };
  }
  candidates.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const aCycle = a.target.kind === 'cycle' ? a.target.cycleIndex : 999;
    const bCycle = b.target.kind === 'cycle' ? b.target.cycleIndex : 999;
    if (aCycle !== bCycle) return bCycle - aCycle;
    return CHAIN_PRIORITY[b.target.key] - CHAIN_PRIORITY[a.target.key];
  });
  return candidates[0].target;
}

/** Equality helper for component-level "is this cell highlighted?" checks.
 *  Component code passes the kind + identity of the cell it's rendering;
 *  this returns true iff the highlight target matches. */
export function isMilestoneHighlighted(
  target: HighlightTarget,
  candidate: HighlightTarget,
): boolean {
  if (target.kind !== candidate.kind) return false;
  if (target.kind === 'permit' && candidate.kind === 'permit') {
    return target.key === candidate.key;
  }
  if (target.kind === 'cycle' && candidate.kind === 'cycle') {
    return (
      target.cycleIndex === candidate.cycleIndex && target.key === candidate.key
    );
  }
  return false;
}
