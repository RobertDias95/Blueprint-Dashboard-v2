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

// ===========================================================================
// ★★★ fix-579 (P-283) — THE REFUSAL CARRIES BOTH SIDES OF THE COMPARISON
// ===========================================================================
//
// ⚠️ **THIS DOES NOT FIX THE BUG.** *"Time block changed since you loaded it"*
//    has refused edits from five people across four weeks, and FOUR proposed
//    mechanisms were each killed by measurement:
//
//      ❌ a sibling rewrite bumps the token — the RPC touches exactly one row
//      ❌ an insert retry reports a duplicate id — every observed row is an
//         UPDATE to a row created 2025-08-20
//      ❌ the popup holds a stale snapshot — it closes on every save
//      ❌ `resetQueries` discards the cache — one caller, and fix-511 §B argues
//         the verb deliberately
//
// ★★★ SO THIS MAKES THE **NEXT** OCCURRENCE ANSWER THE QUESTION. The client
//     knows what it sent; the function knows what was there. **Nobody recorded
//     both together, which is the whole reason this is unsolved.**
//
// ★★ THE SERVER'S SIDE WAS ALREADY ON THE WIRE AND WAS BEING DISCARDED. Every
//    one of the three conflict paths re-reads the row and returns its real
//    stamp — verified in `pg_get_functiondef`, not assumed:
//
//      SELECT b.updated_at INTO v_actual FROM da_time_blocks b WHERE b.id = p_id;
//      out_id := p_id; updated_at := v_actual; conflict := true;
//
// ★★★ AND `v_actual` IS **NULL WHEN THE ROW IS GONE**, which is a second fact
//     nobody could see: `conflict = true` with no actual stamp means the row was
//     DELETED, not that it changed. Those are different incidents wearing one
//     message, and until now they were indistinguishable from outside.

/** What the two sides of a refused OCC comparison actually were.
 *
 *  ⚠️ TIMESTAMPS AND AN ID ONLY. `mutationErrorContext` is a whitelist on
 *     purpose — column names and captions, never values — and this keeps to
 *     that rule: an ISO stamp and a row identifier say WHICH row and WHEN, and
 *     carry no address, name or number into a table 29 people can read. */
export interface OCCConflictDetail {
  /** The row the write was aimed at. */
  rowId?: string | number;
  /** The token the client POSTED as `p_expected_updated_at`. */
  expected?: string | null;
  /** The row's REAL `updated_at` at the moment of refusal.
   *  ★ `null` means the row no longer exists — see the header. */
  actual?: string | null;
}

export class OCCConflictError extends Error {
  readonly permitId: number;
  readonly field?: string;
  /** ★ fix-579: absent on the paths that do not know it yet, so an older
   *  caller compiles and reports exactly the row it reports today. */
  readonly detail?: OCCConflictDetail;
  constructor(permitId: number, field?: string, detail?: OCCConflictDetail) {
    super(
      field
        ? `${field} changed since you loaded it — your edit was reverted. Refresh and try again.`
        : `Permit ${permitId} changed since you loaded it — your edit was reverted. Refresh and try again.`,
    );
    this.name = 'OCCConflictError';
    this.permitId = permitId;
    this.field = field;
    this.detail = detail;
  }
}

export function isOCCConflict(error: unknown): error is OCCConflictError {
  return error instanceof OCCConflictError;
}
