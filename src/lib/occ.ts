// Q3: Optimistic concurrency primitives. The pattern: every UPDATE includes
// `.eq('updated_at', expectedUpdatedAt)` so the row only matches if no
// other client has written since we read. Server returns 0 rows on
// mismatch — we throw OCCConflictError and the caller surfaces it.
//
// First writer wins. No silent clobber. Q3 architectural correction over
// v1's wholesale-replace pattern.
//
// ===========================================================================
// ★★ fix-341 §1 — THE MESSAGE STOPPED CLAIMING A SECOND PERSON
// ===========================================================================
//
// It used to read "X was modified by someone else". Four times in three months
// that sentence was false: Shire on 25 W Dravus St (twice, mid-backfill), Miles
// on 2026-07-20, Briana on 2026-07-08 — every one of them alone in the project,
// their own previous save having bumped a sibling row's stamp.
//
// ★ THE GUARD IS RIGHT AND THE SENTENCE WAS WRONG. A stale token means the row
// changed under the copy you are holding; WHO changed it is something this
// layer cannot know — a concurrent editor, a database trigger, or your own
// write from two seconds ago all produce exactly the same mismatch.
//
// ★ SO IT SAYS THE THING THAT IS TRUE IN EVERY CASE: "changed since you loaded
// it". It misleads in none of them, it still tells the user their edit did not
// land, and it still tells them what to do about it. The false-alarm CAUSE is
// fixed in useUpsertPermitCycle (fresh stamps + serialized writes); this is the
// half that stays honest even when the conflict is real.

export class OCCConflictError extends Error {
  readonly permitId: number;
  readonly field?: string;
  constructor(permitId: number, field?: string) {
    super(
      field
        ? `${field} changed since you loaded it — your edit was reverted. Refresh and try again.`
        : `Permit ${permitId} changed since you loaded it — your edit was reverted. Refresh and try again.`,
    );
    this.name = 'OCCConflictError';
    this.permitId = permitId;
    this.field = field;
  }
}

export function isOCCConflict(error: unknown): error is OCCConflictError {
  return error instanceof OCCConflictError;
}
