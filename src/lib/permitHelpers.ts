import type { PermitWithCycles } from './database.types';

// fix-23c B: permit-level milestone helpers. The status-bar highlight
// rule lives here as a pure function so PermitDetailV2 (and any future
// surface — Reports detail row, etc.) can render exactly ONE highlighted
// cell driven by the same logic.
//
// Rule (Bobby's spec, locked in 2026-05-14):
//   Highlight the LATEST POPULATED date in the chain:
//     permits.target_submit
//     cycle 0  → submitted → corr_issued → resubmitted → intake_accepted
//     cycle 1  → submitted → corr_issued → resubmitted → intake_accepted
//     ...
//     permits.approval_date
//     permits.actual_issue
//   Walked in reverse: actual_issue first, then approval_date, then the
//   highest-cycle-index's dates in reverse cycle-order, etc. First
//   non-null wins. If everything is null, fall back to target_submit
//   (the "anticipated" marker).
//
// NOTE: city_target is intentionally NOT in this rule. It tracks a city-
// scheduled review date but doesn't advance the permit's milestone
// position. The Cycle History panel still surfaces it; just not as the
// status-bar anchor.

export type HighlightTarget =
  | {
      kind: 'permit';
      key: 'target_submit' | 'approval_date' | 'actual_issue';
    }
  | {
      kind: 'cycle';
      cycleIndex: number;
      key: 'submitted' | 'corr_issued' | 'resubmitted' | 'intake_accepted';
    };

export function getHighlightedMilestone(
  permit: PermitWithCycles,
): HighlightTarget {
  if (permit.actual_issue) return { kind: 'permit', key: 'actual_issue' };
  if (permit.approval_date) return { kind: 'permit', key: 'approval_date' };

  // Descending cycle_index — walk newest-cycle first so the highlight
  // follows the latest activity. Within a cycle, reverse temporal order:
  // intake_accepted is later than resubmitted, which is later than
  // corr_issued, which is later than submitted.
  const cyclesDesc = [...(permit.permit_cycles ?? [])].sort(
    (a, b) => b.cycle_index - a.cycle_index,
  );
  for (const c of cyclesDesc) {
    if (c.intake_accepted) {
      return {
        kind: 'cycle',
        cycleIndex: c.cycle_index,
        key: 'intake_accepted',
      };
    }
    if (c.resubmitted) {
      return { kind: 'cycle', cycleIndex: c.cycle_index, key: 'resubmitted' };
    }
    if (c.corr_issued) {
      return { kind: 'cycle', cycleIndex: c.cycle_index, key: 'corr_issued' };
    }
    if (c.submitted) {
      return { kind: 'cycle', cycleIndex: c.cycle_index, key: 'submitted' };
    }
  }
  // No populated dates anywhere — highlight target_submit as the
  // anticipated next milestone (rendered even when value is null).
  return { kind: 'permit', key: 'target_submit' };
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
