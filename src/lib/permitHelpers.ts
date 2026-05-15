import type { PermitWithCycles } from './database.types';

// fix-24c-2: permit-level milestone helpers. The status-bar highlight rule
// lives here as a pure function so PermitDetailV2 (and any future surface —
// Reports detail row, etc.) can render exactly ONE highlighted cell driven
// by the same logic.
//
// Rule (Bobby's spec, fix-24c-2 — events beat forecasts, walk cycles DESC):
//   1. permits.actual_issue populated → highlight it
//   2. permits.approval_date populated → highlight it
//   3. Walk cycles DESC by cycle_index. For each cycle:
//      a. Gather ACTUAL EVENTS in that cycle:
//         submitted, corr_issued, resubmitted, intake_accepted
//         (city_target is a FORECAST, not an event.)
//      b. If any events exist → pick latest BY DATE → return
//         (tiebreaker on same date: chain priority
//          intake > resubmitted > corr_issued > submitted)
//      c. Else if city_target is set on this cycle → return city_target
//         (current state is "waiting on city" for this cycle)
//      d. Else continue to the prior cycle
//   4. No candidates anywhere → fall back to target_submit
//
// Why "events beat forecasts": city_target is what the city PROMISED, not
// what happened. An actual event (submitted/corr_issued/resubmitted/intake)
// always represents reality and should win over a forecast — even a forecast
// dated later. The 621 Daley case is canonical:
//   cycle 1: submitted=2026-03-13, intake_accepted=2026-03-13,
//            corr_issued=2026-04-16, city_target=2026-04-20
//   → corr_issued wins (latest event), city_target=2026-04-20 is ignored.
//
// The intake→snap pattern lands cleanly: cycle N intake_accepted writes
// auto-fill cycle N+1.submitted (via bp_upsert_permit_cycle_row). Once that
// happens, cycle N+1 has an event → walking DESC finds it first → highlight
// follows the snap. (Backfill 2026-05-15 repaired any pre-existing empty
// placeholder N+1 rows.)

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

type EventKey = 'submitted' | 'corr_issued' | 'resubmitted' | 'intake_accepted';

const EVENT_KEYS: EventKey[] = [
  'submitted',
  'corr_issued',
  'resubmitted',
  'intake_accepted',
];

// Tiebreaker when two events in the SAME cycle share a date.
// Higher number wins.
const EVENT_PRIORITY: Record<EventKey, number> = {
  intake_accepted: 4,
  resubmitted: 3,
  corr_issued: 2,
  submitted: 1,
};

export function getHighlightedMilestone(
  permit: PermitWithCycles,
): HighlightTarget {
  if (permit.actual_issue) {
    return { kind: 'permit', key: 'actual_issue' };
  }
  if (permit.approval_date) {
    return { kind: 'permit', key: 'approval_date' };
  }

  const cyclesDesc = [...(permit.permit_cycles ?? [])].sort(
    (a, b) => b.cycle_index - a.cycle_index,
  );

  for (const c of cyclesDesc) {
    const events: Array<{ key: EventKey; date: string }> = [];
    for (const k of EVENT_KEYS) {
      const v = c[k];
      if (v) events.push({ key: k, date: v });
    }
    if (events.length > 0) {
      events.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return EVENT_PRIORITY[b.key] - EVENT_PRIORITY[a.key];
      });
      return { kind: 'cycle', cycleIndex: c.cycle_index, key: events[0].key };
    }
    if (c.city_target) {
      return {
        kind: 'cycle',
        cycleIndex: c.cycle_index,
        key: 'city_target',
      };
    }
  }

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
