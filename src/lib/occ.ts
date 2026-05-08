// Q3: Optimistic concurrency primitives. The pattern: every UPDATE includes
// `.eq('updated_at', expectedUpdatedAt)` so the row only matches if no
// other client has written since we read. Server returns 0 rows on
// mismatch — we throw OCCConflictError and the caller surfaces it.
//
// First writer wins. No silent clobber. Q3 architectural correction over
// v1's wholesale-replace pattern.

export class OCCConflictError extends Error {
  readonly permitId: number;
  readonly field?: string;
  constructor(permitId: number, field?: string) {
    super(
      field
        ? `${field} was modified by someone else — your edit was reverted`
        : `Permit ${permitId} was modified by someone else — your edit was reverted`,
    );
    this.name = 'OCCConflictError';
    this.permitId = permitId;
    this.field = field;
  }
}

export function isOCCConflict(error: unknown): error is OCCConflictError {
  return error instanceof OCCConflictError;
}
