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

// ===========================================================================
// ★★★ fix-580 §A (P-285) — AN EMPTY STRING IS NOT A TIMESTAMP
// ===========================================================================
//
// PROD ROWS 731 AND 732, 2026-09-16 00:53:00 and 00:53:09, brittani@:
//
//   invalid input syntax for type timestamp with time zone: ""
//   { url: "/board", kind: "mutation", fields: [text, discipline, start_date,
//     target_date, assigned_to, completion_status, priority, notes] }
//
// Nine seconds apart — a retry, not two edits — and **zero `team_tasks` rows
// were created or updated after 2026-09-15 17:11 UTC.** Both attempts were
// refused and her work never landed. Data loss by refusal.
//
// ★★★ THE TYPE NAME IS THE DISCRIMINATOR. `''::date` says *"invalid input
//     syntax for type **date**"*. Only `''::timestamptz` says what we got, and
//     every `timestamptz` argument on every one of the 45 `bp_*` functions that
//     take one is an OCC guard — `p_expected_updated_at`, `p_expected_a`,
//     `p_expected_b`, `p_anchor_expected_updated_at`,
//     `p_project_expected_updated_at`. There is no other `timestamptz` input on
//     any write path. So the client posted `""` as the token, and **PostgREST
//     failed the cast before the function body ran**: no guard inside the
//     function can catch this, because the argument never arrives.
//
// ---------------------------------------------------------------------------
// ★★ WHY THIS IS A FUNCTION AND NOT A FIX AT THE ONE CALL SITE
// ---------------------------------------------------------------------------
//
// 45 RPCs take the same guard the same way and 49 call sites post it. A
// per-site fix is a promise to hit this again on the other 44.
//
// ⚠️ AND THERE IS NO `supabase.rpc` WRAPPER TO PUT IT IN — the brief assumed
//    one exists because `write` appears in the error context, but `write` is a
//    `useMutation({ meta })` field (fix-511), not a call wrapper.
//    `mutationErrorContext`'s own header records why the wrapper was refused:
//    ~200 suites mock `lib/supabase`, so a wrapper would be absent in precisely
//    the tests meant to prove it. An explicit call visible in the hook beats an
//    invisible mechanism — so every OCC hook names this function.
//
// ★ IT IS ALSO THE ONLY SHAPE THE TYPES CAN ENFORCE. `occToken` returns
//   `string | null`, so a hook that forgets it and posts a `string` still
//   compiles; what stops the next one is the test that walks every OCC hook in
//   `src/hooks` and asserts the call is there.

/**
 * Normalise an OCC token for the wire: `""` and whitespace-only become `null`,
 * and a real timestamp passes through **unchanged**.
 *
 * ★ `null` is the honest value for "I have no token". PostgREST casts `null`
 *   to `timestamptz` without complaint, and every OCC function already means
 *   "no prior row" by it on an insert.
 *
 * ⚠️ ON AN **UPDATE**, `null` is not a free pass — `updated_at = null` matches
 *    no row, so the write is refused as a conflict rather than accepted
 *    blindly. That is deliberate: this function makes a bad token *legible*,
 *    it does not invent a good one. A caller that genuinely has no token has to
 *    go and get one (see `useUpsertTeamTask`).
 */
export function occToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}
