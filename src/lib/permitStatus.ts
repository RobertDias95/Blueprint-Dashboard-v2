import type { PermitWithCycles } from './database.types';
import {
  getHighlightedMilestone,
  type HighlightTarget,
} from './permitHelpers';

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

export interface PermitStatus {
  label: string;
  date: string | null;
  /** True when derived from cycle state. False when falling back to the
   *  stored permits.status (no cycle progress + no target_submit). */
  derived: boolean;
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

export function derivePermitStatus(permit: PermitWithCycles): PermitStatus {
  const target = getHighlightedMilestone(permit);

  // Pull the date corresponding to the target. Cycle targets read from
  // the matching cycle row; permit targets read from the permit row.
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
