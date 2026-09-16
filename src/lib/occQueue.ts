import { isOCCConflict } from './occ';

// ===========================================================================
// ★★★ fix-584 §B (P-286) — ONE TOKEN MECHANISM, FOR THE FOURTH INSTANCE
// ===========================================================================
//
// | ticket    | surface                 | who          | when       |
// |-----------|-------------------------|--------------|------------|
// | fix-532 §B| Unit Dimensions editor  | Gena         | 2026-09-11 |
// | fix-580   | team tasks (/board)     | Brittani     | 2026-09-16 |
// | fix-581   | DA time blocks          | Miles, Dave  | 2026-09-16 |
// | fix-584   | Unit Dimensions AGAIN   | **Cam**      | 2026-09-16 |
//
// Prod `error_reports` #736 is the SAME FINGERPRINT as Gena's #717 —
// `ccf423f3`, *"Unit Dimensions changed since you loaded it"*, `projects.update`
// — on the surface fix-532 §B already fixed, five days later.
//
// ---------------------------------------------------------------------------
// ★★★ WHY READING THE CACHE WAS NEVER ENOUGH. THIS IS THE WHOLE TICKET.
// ---------------------------------------------------------------------------
//
// fix-532 §B and fix-581 both fixed this by reading the token from the React
// Query cache at SEND time instead of from a render-captured prop. That is
// strictly better than a snapshot — **and it only works if the previous write
// has RETURNED**, because the cache is updated in `onSuccess`.
//
// ★★★ WITH THREE WRITES IN FLIGHT THE CACHE IS STALE FOR THE SECOND AND THE
//     THIRD. fix-532's own header predicted exactly this and shipped anyway:
//
//       *"Two is survivable… **Three is not** — the third's single retry can
//        carry a token the second has already superseded, and `mutationFn`
//        does not chain a second auto-retry."*
//
//     Cam's 392-row backfill generates bursts of three constantly. The
//     prediction came true five days later, on the same surface, and **no
//     amount of reading harder can fix it** — the value being read has not been
//     written yet.
//
// ---------------------------------------------------------------------------
// ★★★ SO: SERIALIZE PER ROW. DO NOT READ HARDER.
// ---------------------------------------------------------------------------
//
// A write for a row that already has one in flight waits for it and uses **the
// token that write returned**, rather than a cache that has not caught up. The
// queue is keyed by (table, row id), so two different rows never wait on each
// other and a backfill stays as parallel as it was.
//
// ⚠️⚠️ AND IT MUST STILL REFUSE A REAL CONFLICT — chaining your OWN writes is
//    correct, swallowing SOMEBODY ELSE'S is data loss.
//
// ★★★ WHAT MAKES THAT TRUE, AND IT IS THE LOAD-BEARING SENTENCE HERE: **the
//     chain only ever propagates tokens minted by THIS CLIENT'S OWN WRITES.**
//     If a second person writes the row between my #1 and my #2, the token my
//     #1 returned is already superseded, my #2 posts it, and the server refuses
//     it — exactly as it does today. The queue removes a tab's ability to
//     refuse ITSELF and removes nothing else. Asserted in both directions, with
//     the second direction driven by a genuine second writer rather than by the
//     same hook called twice.
//
// ★ NO SERVER GUARD MOVES. Every RPC is untouched. fix-73's rule, still true:
//   *"the guard is right about the row and wrong about the cause."*
//
// ---------------------------------------------------------------------------
// ★★ THE ALTERNATIVE THAT LOOKED RIGHT AND IS NOT: React Query's `scope`
// ---------------------------------------------------------------------------
//
// @tanstack/react-query 5.100 supports `useMutation({ scope: { id } })`, and
// mutations sharing a scope id run serially — which is this, for free.
// **It cannot be used here**: `scope` is a HOOK-level option, read when the
// component renders, while the row id is a property of each `mutate()` call.
// Scoping by TABLE instead would serialize a 392-row backfill into one queue
// and make Cam's afternoon four hundred round trips long. Rejected on that,
// not on taste.

/** A token as it goes on the wire: an ISO stamp, or `null` for "no prior row". */
export type OccToken = string | null;

/** What a serialized write hands back: its own result, plus the token the
 *  server minted, which the NEXT write on that row will post.
 *
 *  ★★★ `token: undefined` MEANS "I DID NOT LEARN THE NEW STAMP", AND IT IS NOT
 *  THE SAME AS `null`. `null` is a real token meaning "no prior row" (the row
 *  was deleted); `undefined` is the honest answer for an RPC that returns counts
 *  rather than a row. A follower told `undefined` falls back to its OWN seed —
 *  usually a fresh cache read — which is exactly today's behaviour, so a hook
 *  that cannot report a token is no worse off for being queued.
 *
 *  ⚠️ Publishing `null` when you simply do not know would be worse than not
 *     queueing at all: the follower would post `null` and be refused. */
export interface OccWriteResult<T> {
  value: T;
  token?: OccToken | undefined;
}

/**
 * The serialization key. ★ (table, row) and nothing else — a queue per row, so
 * unrelated rows never block each other.
 *
 * ★★ `table` is the app's own name for the thing being written, not
 *    necessarily a Postgres table (`projects.update` writes the table directly;
 *    `bp_upsert_team_task` writes `team_tasks`). What matters is that every
 *    writer of one ROW agrees on one string — the census test is what keeps
 *    them agreeing.
 */
export function occRowKey(
  table: string,
  id: string | number | null | undefined,
): string {
  // ⚠️ A PRINTABLE SEPARATOR, AND THAT IS NOT COSMETIC. This was a NUL byte —
  //    unambiguous, and it made git classify this whole module as BINARY
  //    (`Bin 0 -> 10840 bytes`), so the diff could not be reviewed at all.
  //    `::` cannot appear in a table name or a uuid, and the key never leaves
  //    this session.
  return `${table}::${id ?? ''}`;
}

let insertSeq = 0;

/**
 * A key for a write that is CREATING a row.
 *
 * ★★★ AN INSERT HAS NOTHING TO WAIT FOR AND MUST NOT WAIT. It has no prior
 *     row, so no token can be stale — and keying every insert on
 *     `occRowKey(table, null)` would put them all in ONE queue and turn a bulk
 *     add into a single file. Each insert gets its own key, which is the same
 *     as not being queued while still going through the one mechanism the
 *     census checks for.
 *
 * ★ The id it creates becomes the `occRowKey` for every write after it.
 */
export function occInsertKey(table: string): string {
  insertSeq += 1;
  return `${table}::insert:${insertSeq}`;
}

/** Row key → the in-flight write's promise, resolving to the token it ends on
 *  (or `undefined` when that write could not learn one). */
const inFlight = new Map<string, Promise<OccToken | undefined>>();

/** ★ The row's REAL stamp, when a refusal carried it.
 *
 *  fix-579 put both sides of a refused comparison on the error; this is the
 *  one place that USES the server's side. A follower that would have posted the
 *  same doomed token posts the real one instead, so one person's burst recovers
 *  by itself rather than refusing all the way down.
 *
 *  ★★ `null` actual means the row is GONE (fix-579), and no token helps — the
 *     follower keeps what it had and gets its own honest refusal. */
function actualFromRefusal(e: unknown): OccToken | undefined {
  if (!isOCCConflict(e)) return undefined;
  return e.detail?.actual ?? undefined;
}

/**
 * Run an OCC write with at most one in flight per row.
 *
 * @param key   `occRowKey(table, id)`
 * @param seed  the token the caller would have posted — used when nothing is in
 *              flight, and as the fallback when a predecessor cannot say.
 * @param run   performs the write with the token it is given, and returns the
 *              server's new token alongside its own result.
 *
 * ★ Insert-shaped writes (`seed === null`, no row yet) pass through this too:
 *   they simply have nothing to wait for the first time, and the id they create
 *   becomes the key for everything after.
 */
export async function occSerialize<T>(
  key: string,
  seed: OccToken,
  run: (expected: OccToken) => Promise<OccWriteResult<T>>,
): Promise<T> {
  const prior = inFlight.get(key);

  // ★★ REGISTERED BEFORE THE FIRST `await`. A third write composed in the same
  //    tick as the second must find the SECOND in the map, not the first —
  //    otherwise two of the three chain off one predecessor and both post the
  //    same token, which is the bug with an extra step.
  let publish!: (t: OccToken | undefined) => void;
  const mine = new Promise<OccToken | undefined>((resolve) => {
    publish = resolve;
  });
  inFlight.set(key, mine);

  // ★ `mine` never rejects — a predecessor's failure must not reject its
  //   followers, only inform them. So this await needs no catch, and the
  //   absence of one is deliberate rather than forgotten.
  // ★ A predecessor that knew the new stamp overrides the seed; one that did
  //   not (`undefined`) leaves the caller's own seed standing.
  const priorToken = prior ? await prior : undefined;
  const expected = priorToken !== undefined ? priorToken : seed;

  try {
    const { value, token } = await run(expected);
    publish(token);
    return value;
  } catch (e) {
    publish(actualFromRefusal(e) ?? expected);
    throw e;
  } finally {
    // ★ Only clear the slot if it is still MINE. A successor that registered
    //   while this was in flight owns the key now, and deleting it would let a
    //   fourth write skip the queue entirely.
    if (inFlight.get(key) === mine) inFlight.delete(key);
  }
}

/**
 * The thin form: serialize ONE call that is the whole write.
 *
 * ★ For a hook whose `mutationFn` is a single `supabase.rpc(…)` plus a couple
 *   of checks, wrapping the call is smaller and clearer than restructuring the
 *   body — and it is the same queue, so the census counts it.
 *
 * ★★ `tokenOf` is optional: omit it and the write publishes `undefined`
 *    ("I did not learn the new stamp"), which leaves the next write on its own
 *    seed. See {@link OccWriteResult}.
 */
export async function occCall<T>(
  key: string,
  seed: OccToken,
  call: (expected: OccToken) => Promise<T>,
  tokenOf?: (result: T) => OccToken | undefined,
): Promise<T> {
  return occSerialize(key, seed, async (expected) => {
    const value = await call(expected);
    return { value, token: tokenOf ? tokenOf(value) : undefined };
  });
}

/** How many rows currently have a write in flight. ★ For tests and for a
 *  future "saving…" indicator; never branched on by the queue itself. */
export function occPendingRows(): number {
  return inFlight.size;
}

/** ★ Test-only reset. The map is module state, so a suite that leaves a write
 *  pending would otherwise leak a queue into the next test. */
export function __resetOccQueue(): void {
  inFlight.clear();
}
