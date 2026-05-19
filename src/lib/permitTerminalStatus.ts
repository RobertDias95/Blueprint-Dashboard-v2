// fix-31c: extracted from reviewerRollup.ts so permitStatus.ts +
// permitStage.ts can apply the same terminal-positive override
// without pulling in the reviewer-rollup module (which has its own
// transitive dependencies on PermitCycleReviewer types). One source
// of truth for "what does it mean for a permit to be terminally
// positive at the portal-status level?"
//
// Terminal-positive = the city has finished its part. Per-cycle and
// per-reviewer state observed before this point is known-stale by
// definition: the permit moved past those interim states at the
// workflow / record-status level even when individual event streams
// still end at an earlier interim status.
//
// Motivating example (SDOTTRLA0002310 at 4506 14th Ave SW, 2026-05-19):
//   permits.status        = 'Conceptually Approved'
//   cycle 1.corr_issued   = 2026-05-06   (historical; resolved at parent level)
//   reviewer last event   = "Additional Info Requested"
//   STAGE column          rendered "CORRECTIONS" (wrong) — should be "PERMITTING"
//   PERMIT STATUS         rendered "Corr Required (Cycle 1)" — should mirror permit.status
//
// Callers: derivePermitStatus (permitStatus.ts), effectiveStage
// (permitStage.ts), rollupCounts (reviewerRollup.ts re-exports the
// constant + helper for backwards compat with fix-31b consumers).

export const TERMINAL_POSITIVE_STATUSES: ReadonlySet<string> = new Set([
  'Conceptually Approved',
  'Approved',
  'Issued',
  'Completed',
  'Ready for Issuance',
  'Closed',
]);

/** Returns true when the given permits.status string indicates the
 *  permit has moved past per-cycle / per-reviewer-level concerns.
 *  Whitespace-tolerant — the portal occasionally returns padded
 *  values. */
export function isTerminalPositiveStatus(
  permitStatus: string | null | undefined,
): boolean {
  if (!permitStatus) return false;
  return TERMINAL_POSITIVE_STATUSES.has(permitStatus.trim());
}
