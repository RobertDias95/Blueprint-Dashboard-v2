// fix-272: pure mirror of the bp_audit_permit_task DB trigger (see
// migrations/fix_272_permit_task_audit.sql). CI has no live database, so this
// mirror IS the tested contract — the fix-153 pattern. Keep the two in lockstep.
//
// WHY THE TABLE EXISTS. Bobby wants to measure consultant slippage: "say we put
// a target of 1.15, then 1.20, then 1.25, then 1.30 — 3 changes and 15 days
// delay." user_activity already records WHICH fields changed (so the COUNT is
// answerable), but not their values — so the 15-days-of-delay magnitude is lost
// the moment it happens and cannot be reconstructed afterwards.
//
// NOTHING IN THIS FILE RUNS IN THE APP. It is the specification the trigger is
// tested against; the capture itself is entirely server-side.

/** The four permit_tasks columns this audit watches. */
export const PERMIT_TASK_AUDIT_FIELDS = [
  /** THE ASK: how often the promised-back date moves, and how far. */
  'target_date',
  /** When it actually went out — promised-vs-actual turnaround, not just a
   *  slippage tally. Auto-stamped by fix-268 on the first move to In Progress. */
  'start_date',
  /** When it actually came back (the move to Resolved). */
  'completion_status',
  /** WHICH CONSULTANT. Without it a task that switches discipline is
   *  unattributable, and this has to serve survey and civil too. */
  'waiting_on',
] as const;

export type PermitTaskAuditField = (typeof PERMIT_TASK_AUDIT_FIELDS)[number];

/** The watched slice of a permit_tasks row. */
export type WatchedTaskFields = {
  [K in PermitTaskAuditField]: string | null;
};

export type AuditOp = 'INSERT' | 'UPDATE' | 'DELETE';

/** One audit row's from/to pairs, keyed exactly like the table's columns. */
export type PermitTaskAuditPairs = {
  [K in PermitTaskAuditField as `${K}_from`]: string | null;
} & {
  [K in PermitTaskAuditField as `${K}_to`]: string | null;
};

export interface PermitTaskAuditRow extends PermitTaskAuditPairs {
  op: AuditOp;
}

/** SQL `IS DISTINCT FROM`: NULL-safe inequality. NULL vs NULL is NOT distinct;
 *  NULL vs a value IS. Modelled explicitly because JS `!==` gets the first case
 *  right by accident and the intent is what matters here. */
function isDistinctFrom(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return false;
  return a !== b;
}

/**
 * fix-272: does this change write an audit row?
 *
 * INSERT and DELETE always do — a task's whole life belongs in one place.
 * UPDATE only when one of the four watched fields actually moved; this is the
 * trigger's early-return guard.
 *
 * Measured on prod 2026-08-03 over 20 days: 126 of 762 logged updates (17%)
 * touched none of the four and must write nothing. Note that is far fewer than
 * the ~76% originally assumed — the guard is cheap insurance against unrelated
 * edits, not a filter that removes most traffic.
 *
 * Idempotency falls out of this: re-saving a row with identical values is an
 * UPDATE where nothing is distinct, so it writes nothing.
 */
export function permitTaskAuditShouldWrite(
  op: AuditOp,
  before: WatchedTaskFields | null,
  after: WatchedTaskFields | null,
): boolean {
  if (op !== 'UPDATE') return true;
  if (!before || !after) return true;
  return PERMIT_TASK_AUDIT_FIELDS.some((f) =>
    isDistinctFrom(before[f], after[f]),
  );
}

/**
 * fix-272: the from/to pairs the trigger writes.
 *
 * EVERY watched pair is populated on an UPDATE, including the fields that did
 * not move, so a reader never has to join back for context. Two fields moving
 * together — marking a task started writes completion_status and, via fix-268,
 * start_date — is ONE row, not two.
 *
 * INSERT has null `from`s (nothing preceded it); DELETE has null `to`s.
 */
export function buildPermitTaskAuditRow(
  op: AuditOp,
  before: WatchedTaskFields | null,
  after: WatchedTaskFields | null,
): PermitTaskAuditRow {
  const pick = (
    row: WatchedTaskFields | null,
    f: PermitTaskAuditField,
  ): string | null => (row ? row[f] : null);

  const pairs = {} as PermitTaskAuditPairs;
  for (const f of PERMIT_TASK_AUDIT_FIELDS) {
    (pairs as Record<string, string | null>)[`${f}_from`] =
      op === 'INSERT' ? null : pick(before, f);
    (pairs as Record<string, string | null>)[`${f}_to`] =
      op === 'DELETE' ? null : pick(after, f);
  }
  return { op, ...pairs };
}

/** Convenience for tests and future readers: which of the watched fields
 *  actually moved in this change. Empty on an update that writes nothing. */
export function changedAuditFields(
  before: WatchedTaskFields | null,
  after: WatchedTaskFields | null,
): PermitTaskAuditField[] {
  if (!before || !after) return [...PERMIT_TASK_AUDIT_FIELDS];
  return PERMIT_TASK_AUDIT_FIELDS.filter((f) =>
    isDistinctFrom(before[f], after[f]),
  );
}
