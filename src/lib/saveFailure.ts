// ===========================================================================
// ★★★ fix-372 §6 — a save that died on the wire told nobody
// ===========================================================================
//
// LOGGED IN PROD, REAL:
//
//   TypeError: Failed to fetch
//   {"kind":"mutation","url":"/project/d6599dd4-43be-4992-b69e-9e64c5a27400"}
//   3 occurrences, 2 users, 14 / 17 / 20 August.
//
// ★★★ THE BUG IS NOT THE CAUSE — IT IS WHAT THE PERSON SEES. A mutation that
// dies at the network layer means their save MAY OR MAY NOT have gone through,
// and they have no way to tell. That is true whichever cause it was, and it is
// fixable without knowing which.
//
// ★ The 20 August instance was ten minutes after fix-370's migration, which is
// also when merging fix-370 would have triggered a Render deploy — and a deploy
// restart drops in-flight requests. But it also fired on the 14th and the 17th.
// A deploy restart, a dropped connection and the TLS interception that hit Jade
// all produce this identically, so the cause is not chased here.
//
// ---------------------------------------------------------------------------
// ★★★ WHY A NETWORK FAILURE IS NOT DETECTED BY ITS MESSAGE
// ---------------------------------------------------------------------------
//
// fix-357's lesson, and it cost that ticket a bug: the message is
// browser-specific. Chrome says "Failed to fetch", Firefox says "NetworkError
// when attempting to fetch resource", Safari says "Load failed". A check for
// the Chrome wording is a check that silently fails for everyone else.
//
// ★★ So the TYPE is the signal. `fetch` rejects with a `TypeError` and nothing
// else does — a Postgres error arrives as a PostgrestError object with a `code`,
// an HTTP error arrives with a `status`. A TypeError from a mutation means the
// request never completed, full stop. The wordings below are a fallback for
// environments that stringify the error before it reaches us, never the
// primary test.

/** What went wrong, in the only two categories that change what to tell them. */
export type SaveFailureKind =
  /** The request never completed. The write may or may not have landed. */
  | 'network'
  /** The server answered and refused. The write definitely did not land. */
  | 'rejected';

export interface SaveFailure {
  kind: SaveFailureKind;
  /** What the person was doing, from the mutation key. */
  what: string;
  message: string;
  at: number;
  /** ★ fix-371 §4's signal, folded in: a new build being live makes a deploy
   *  restart the likely cause, and that is worth saying because it is
   *  recoverable by reloading. */
  newBuildAvailable: boolean;
}

/** ★ A fallback only. The type check below is the real test. */
const NETWORK_WORDINGS = [
  'failed to fetch',          // Chrome, Edge
  'networkerror',             // Firefox
  'load failed',              // Safari
  'network request failed',   // React Native / some polyfills
  'err_network',
  'err_internet_disconnected',
];

/**
 * ★★★ DID THIS REQUEST EVER COMPLETE?
 *
 * A `TypeError` is the whole test: `fetch` rejects with one when the request
 * could not be made or was cut off, and a completed-but-refused request never
 * produces one — PostgREST answers with a body, and supabase-js turns that into
 * an object with `code`/`status`, not a TypeError.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  // ★ A response that arrived is NOT a network failure, whatever it says.
  if (err && typeof err === 'object') {
    const o = err as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof o.code === 'string' && o.code !== '') return false;
    if (typeof o.status === 'number' && o.status > 0) return false;
    if (o.name === 'TypeError') return true;
  }
  const text = String(
    (err as { message?: unknown } | null)?.message ?? err ?? '',
  ).toLowerCase();
  return NETWORK_WORDINGS.some((w) => text.includes(w));
}

/** ★ The mutation key, turned into something a person recognises. Falls back to
 *  a plain sentence rather than printing an array at somebody. */
export function describeMutation(key: unknown): string {
  if (Array.isArray(key) && key.length > 0 && typeof key[0] === 'string') {
    return String(key[0]).replace(/[_-]+/g, ' ');
  }
  if (typeof key === 'string' && key.trim() !== '') return key.replace(/[_-]+/g, ' ');
  return 'your change';
}

/**
 * ★★★ WHAT THE PERSON IS TOLD, and it is deliberately not reassuring.
 *
 * ★★ A network failure CANNOT be reported as "not saved", because it may well
 * have saved — the request left, and the answer is what went missing. Telling
 * somebody their edit was lost when it was not is how they redo work that was
 * already done, which for a date field means overwriting the newer value with
 * the older one.
 *
 * ★ A rejection is different and can be stated plainly: the server answered.
 */
export function failureHeadline(f: SaveFailure): string {
  if (f.kind === 'rejected') return `Your change to ${f.what} was not saved.`;
  return `Your change to ${f.what} may not have been saved.`;
}

export function failureDetail(f: SaveFailure): string {
  if (f.kind === 'rejected') {
    return 'The server refused it. Nothing was written — try again.';
  }
  if (f.newBuildAvailable) {
    // ★ fix-371 §4 already knows this. A deploy restart drops in-flight
    // requests, and it is the one cause here that is both known and
    // recoverable, so it is named rather than left as "something happened".
    return (
      'The connection dropped before the server answered — a new version of the ' +
      'app has just been deployed, which restarts it and cuts requests that were ' +
      'in flight. Reload, check the value, and redo it only if it is missing.'
    );
  }
  return (
    'The connection dropped before the server answered, so it may have gone ' +
    'through. Check the value before redoing it.'
  );
}

/**
 * ★★★ WHY THERE IS NO BLIND RETRY BUTTON.
 *
 * ★★ A retry of a request that may ALREADY have succeeded can double-write, and
 * the mutations in this app are not idempotent — `bp_upsert_permit_cycle_row`
 * keyed on a cycle index is, but adding a note, posting a message and creating
 * a task are not, and a duplicated note is a real and confusing artefact.
 *
 * ★★★ So the honest answer is RE-READ, THEN LET THEM DECIDE. The control
 * refetches so the screen shows what the server actually holds, and the person
 * looks and redoes it only if it is missing. That is one extra glance and it
 * cannot double-write anything.
 *
 * ★ The scope line for this section is the FAILURE PATH, not making mutations
 * reliable. There is no offline queue and no optimistic-write replay here.
 */
export const RETRY_LABEL = 'Check what saved';
export const RETRY_DESCRIPTION =
  'Refetches this screen from the server so you can see what actually landed. ' +
  'It does not re-send anything — a resend could write your change twice.';
