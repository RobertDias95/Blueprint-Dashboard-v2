import type {
  PermitCycleReviewer,
  PermitWithCycles,
} from './database.types';
import {
  getHighlightedMilestone,
  type HighlightTarget,
} from './permitHelpers';
import { isTerminalPositiveStatus } from './permitTerminalStatus';
import { isPermitInCorrections } from './permitStage';
import {
  currentCycleIndex,
  isReviewerRollupDriven,
  reviewerVerdictForCycle,
} from './reviewerRollup';
import { isSubPermit } from './subPermit';

/** fix-194: canonical placeholder status for a sub/child permit. */
export const SUB_PERMIT_LABEL = 'Sub-permit';

// fix-25e: derive a user-facing status pill ("Corr Required (Cycle 2)" +
// date) from cycle state instead of displaying permits.status raw. The
// stored column is set by the wizard ("Pre-Submittal — GO") and updated
// by the scraper for production permits, but it never reflects the
// progress users have entered into cycle date fields. This helper takes
// the same chain-position rule getHighlightedMilestone uses for the
// status-bar highlight and reformats it as a status label.
//
// When no cycle data + no target_submit + no permit-level outcome dates
// exist, falls back to permits.status (preserving the wizard / scraper
// value). When ANY meaningful date exists, the derived label takes over.
//
// fix-31c (2026-05-19): when permit.status is a terminal-positive value
// (Conceptually Approved / Approved / Issued / Completed / Ready for
// Issuance / Closed) the cycle-derived label is wrong by construction
// — the city already moved past whatever interim state the cycles
// record. Bypass the chain rule entirely and surface permit.status
// with its outcome date.

export interface PermitStatus {
  label: string;
  date: string | null;
  /** True when derived from cycle state. False when falling back to the
   *  stored permits.status (no cycle progress + no target_submit). */
  derived: boolean;
  /** fix-52: secondary status text shown as a sub-label / tooltip. Set only
   *  for the "Approved — Not Issued" state, where it carries the underlying
   *  portal status ("Awaiting Information" held vs "Ready for Issuance"
   *  ready) so the ready-vs-held nuance isn't lost behind the canonical
   *  label. Absent for every other state. */
  detail?: string;
}

// fix-52 (2026-05-24): canonical label for a Building Permit / Demolition the
// city has approved (approval_date set — fix-51 stamps it at Issuance-Prep
// entry) but not yet issued (actual_issue still NULL). One string, used
// everywhere this state renders.
export const APPROVED_NOT_ISSUED_LABEL = 'Approved — Not Issued';

const APPROVED_NOT_ISSUED_TYPES: ReadonlySet<string> = new Set([
  'Building Permit',
  'Demolition',
]);

/** fix-52: true for a Building Permit / Demolition the city has approved
 *  (approval_date set) but not yet issued (actual_issue null). The portal
 *  status is ambiguous for this state — "Awaiting Information" when held on a
 *  builder condition (e.g. salvage assessment), "Ready for Issuance" once the
 *  hold clears — so callers surface the canonical "Approved — Not Issued"
 *  label and keep the portal status as secondary detail. The remaining wait is
 *  the BUILDER's, not the city's. */
export function isApprovedNotIssued(permit: PermitWithCycles): boolean {
  return (
    APPROVED_NOT_ISSUED_TYPES.has((permit.type ?? '').trim()) &&
    !!permit.approval_date &&
    !permit.actual_issue
  );
}

const LABEL_MAP: Record<HighlightTarget['key'], string> = {
  target_submit: 'Target Submit',
  submitted: 'Submitted',
  city_target: 'City Target',
  corr_issued: 'Corr Required',
  resubmitted: 'Resubmitted',
  intake_accepted: 'Intake Accepted',
  approval_date: 'Approved',
  actual_issue: 'Issued',
};

const FALLBACK_LABEL = 'Pre-Submittal — GO';

export function derivePermitStatus(
  permit: PermitWithCycles,
  reviewers?: PermitCycleReviewer[] | null,
): PermitStatus {
  // fix-194: a sub/child permit carries NO independent review status — it's a
  // placeholder reviewed under its parent. Short-circuit to a terminal
  // placeholder WITHOUT reading its own cycles/reviewers. (The sidebar shows the
  // "reviewed under <parent #>" badge; this label backs any other surface.)
  if (isSubPermit(permit)) {
    return { label: SUB_PERMIT_LABEL, date: null, derived: false };
  }
  // fix-52: "Approved — Not Issued" for a Building Permit / Demolition the
  // city has approved (approval_date set) but not yet issued (actual_issue
  // null). Sits BELOW "Issued" in precedence — actual_issue being set excludes
  // this branch, so an issued permit still reads "Issued" — but ABOVE the
  // terminal-positive portal-status passthrough below, so it also takes over a
  // "Ready for Issuance" or "Awaiting Information" portal string. The portal
  // status is preserved as `detail` (the ready-vs-held nuance). The pill date
  // is the approval date; the builder-side wait is surfaced separately in the
  // Permit Detail timing widget.
  if (isApprovedNotIssued(permit)) {
    const detail = permit.status?.trim();
    return {
      label: APPROVED_NOT_ISSUED_LABEL,
      date: permit.approval_date ?? null,
      derived: false,
      ...(detail ? { detail } : {}),
    };
  }

  // fix-31c: terminal-positive permit.status wins over any cycle-
  // derived label. Date prefers actual_issue (city physically issued)
  // then approval_date (city approved) — both can be null when the
  // status is e.g. "Conceptually Approved" without a date yet, in
  // which case the pill renders with no date suffix.
  if (isTerminalPositiveStatus(permit.status)) {
    return {
      label: permit.status!.trim(),
      date: permit.actual_issue ?? permit.approval_date ?? null,
      derived: false,
    };
  }

  // fix-54 (2026-05-26): wholistic reviewer-rollup override for MPB
  // (MyBuildingPermit: Bellevue/Edmonds/Kirkland). The MPB portal carries
  // a coarse "Pending"/"Applied" status with the wholistic truth sitting
  // in per-discipline reviewer rows. The chain rule below would otherwise
  // surface a cycle's corr_issued (stamped by the scraper as soon as ANY
  // one discipline issued corrections) as the permit-level status — even
  // while other disciplines are still reviewing. Apply Bobby's wholistic
  // rule here when reviewers are available; fall through to the chain
  // logic when they aren't.
  if (reviewers && reviewers.length > 0 && isReviewerRollupDriven(permit.status)) {
    // fix-185: scope the verdict + label to the permit's CURRENT (latest)
    // cycle, not the max cycle among reviewer rows. Stale earlier-cycle
    // reviewer rows (e.g. a resubmitted cycle 1 whose corrections rows were
    // never pruned) must not surface a "Corr Required (Cycle 1)" pill while
    // cycle 2 is the live, under-review cycle. When the current cycle has no
    // reviewer rows the verdict is null → fall through to the chain rule, which
    // reads the live cycle's dates (cycle 2 city_target → "City Target (Cycle 2)").
    const latestIdx = currentCycleIndex(permit.permit_cycles ?? [], reviewers);
    const verdict =
      latestIdx === null ? null : reviewerVerdictForCycle(reviewers, latestIdx);
    if (verdict && latestIdx !== null) {
      const cyc = (permit.permit_cycles ?? []).find(
        (c) => c.cycle_index === latestIdx,
      );
      // fix-214: the unified hybrid corrections test takes precedence — a
      // corr_issued on the current cycle (or a reviewer-rollup == corrections)
      // is "Corr Required", EVEN with a lingering in_review reviewer. corr_issued
      // is the cycle-completion authority and waives the dangling reviewer (224
      // 2nd Ave N: a permanently-in_review Trees reviewer must not mask the
      // issued corrections). Shared with effectiveStage + the weekly report.
      // Subsumes the old verdict === 'corrections_required' branch.
      if (isPermitInCorrections(permit, permit.permit_cycles ?? [], reviewers)) {
        return {
          label:
            latestIdx >= 1
              ? `Corr Required (Cycle ${latestIdx})`
              : 'Corr Required',
          date: cyc?.corr_issued ?? null,
          derived: true,
        };
      }
      if (verdict === 'in_review') {
        // Round genuinely in flight (no corr_issued on this cycle — that path
        // returned above) — surface the city_target (or fall back to submitted)
        // of the current cycle.
        if (cyc?.city_target) {
          return {
            label:
              latestIdx >= 1 ? `City Target (Cycle ${latestIdx})` : 'City Target',
            date: cyc.city_target,
            derived: true,
          };
        }
        if (cyc?.submitted) {
          return {
            label:
              latestIdx >= 1
                ? `Submitted (Cycle ${latestIdx})`
                : 'Initial Submit',
            date: cyc.submitted,
            derived: true,
          };
        }
        // No cycle dates yet — fall through to the chain rule.
      } else if (verdict === 'approved') {
        // Round complete with all-approved — the city's round work is
        // done. permit.approval_date won't be set yet (that's the portal
        // event), so the pill rides without a date.
        return {
          label: 'Approved',
          date: permit.approval_date ?? null,
          derived: true,
        };
      }
    }
  }

  const target = getHighlightedMilestone(permit);

  // Pull the date corresponding to the target. Cycle targets read from
  // the matching cycle row; permit targets read from the permit row.
  // The initial `null` is overwritten in both branches below but kept
  // for explicit definite-assignment + readability.
  // eslint-disable-next-line no-useless-assignment
  let date: string | null = null;
  if (target.kind === 'permit') {
    date = (permit[target.key] as string | null | undefined) ?? null;
  } else {
    const c = (permit.permit_cycles ?? []).find(
      (x) => x.cycle_index === target.cycleIndex,
    );
    date = (c ? (c[target.key] as string | null | undefined) : null) ?? null;
  }

  // The chain rule's last fallback is target_submit. Bobby's call
  // (2026-05-17): target_submit is a *planned* date, not a lifecycle
  // milestone — so a permit that hasn't been submitted yet should
  // surface its stored stage/status ("Pre-Submittal — GO") rather
  // than displaying a Target-Submit pill. This matters more post
  // fix-25-feat-i / -j where the cascade engine populates
  // target_submit on nearly every permit, which previously turned
  // every pre-cycle pill into "Target Submit — <date>".
  if (target.kind === 'permit' && target.key === 'target_submit') {
    return {
      label: permit.status?.trim() || FALLBACK_LABEL,
      date: null,
      derived: false,
    };
  }

  // Suffix the cycle index for review cycles (>=1) so users can tell
  // which round they're looking at. Design cycle (cycle 0) labels stay
  // bare — "Initial Submit" / "Intake Accepted" already carry their
  // design-phase meaning.
  let label = LABEL_MAP[target.key];
  if (target.kind === 'cycle' && target.cycleIndex >= 1) {
    label = `${label} (Cycle ${target.cycleIndex})`;
  } else if (target.kind === 'cycle' && target.cycleIndex === 0) {
    if (target.key === 'submitted') label = 'Initial Submit';
  }

  return { label, date, derived: true };
}
