import type { PermitWithCycles } from './database.types';

// fix-24c-3: permit-level milestone helpers. The status-bar highlight rule
// lives here as a pure function so PermitDetailV2 (and any future surface)
// can render exactly ONE highlighted cell from one source of truth.
//
// Rule (Bobby's V1 model, locked 2026-05-15):
//   1. permits.actual_issue populated → highlight it
//   2. permits.approval_date populated → highlight it
//   3. Walk cycles DESC by cycle_index. For each cycle:
//      - the cycle with the LOWEST cycle_index is the DESIGN cycle
//        (typically cycle 0, but may be cycle 1 for legacy permits).
//      - walk the chain in REVERSE (most-advanced position first):
//        - design chain: intake_accepted → submitted
//        - review chain: resubmitted → corr_issued → city_target → submitted
//      - first populated cell in the reverse chain wins → return it.
//   4. No populated cells anywhere → fall back to target_submit.
//
// This is a CHAIN-POSITION rule, not a date rule. city_target=2026-04-20
// loses to corr_issued=2026-04-16 because corr_issued is further along the
// review chain — dates are irrelevant for the choice. The intake→snap
// pattern lands cleanly: setting intake_accepted on the design cycle
// auto-fills review cycle 1.submitted; setting resubmitted on a review
// cycle auto-fills the next cycle's submitted (see bp_upsert_permit_cycle_row).

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

const DESIGN_REVERSE = ['intake_accepted', 'submitted'] as const;
const REVIEW_REVERSE = [
  'resubmitted',
  'corr_issued',
  'city_target',
  'submitted',
] as const;

export function getHighlightedMilestone(
  permit: PermitWithCycles,
): HighlightTarget {
  if (permit.actual_issue) {
    return { kind: 'permit', key: 'actual_issue' };
  }
  if (permit.approval_date) {
    return { kind: 'permit', key: 'approval_date' };
  }

  const cyclesAsc = [...(permit.permit_cycles ?? [])].sort(
    (a, b) => a.cycle_index - b.cycle_index,
  );
  if (cyclesAsc.length === 0) {
    return { kind: 'permit', key: 'target_submit' };
  }
  const firstIdx = cyclesAsc[0].cycle_index;
  const cyclesDesc = [...cyclesAsc].reverse();

  for (const c of cyclesDesc) {
    const chain = c.cycle_index === firstIdx ? DESIGN_REVERSE : REVIEW_REVERSE;
    for (const key of chain) {
      if (c[key]) {
        return { kind: 'cycle', cycleIndex: c.cycle_index, key };
      }
    }
  }

  return { kind: 'permit', key: 'target_submit' };
}

/** Equality helper for component-level "is this cell highlighted?" checks. */
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
