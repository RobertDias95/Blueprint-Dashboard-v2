import { isAuthRetryableFetchError } from '@supabase/supabase-js';

// ===========================================================================
// fix-357 — the front door tells a locked-out person nothing
// ===========================================================================
//
// ★★★ Jade, 2026-08-19, unable to sign in. The screen showed one line:
//
//     Failed to fetch
//
// That is `Login.tsx` doing `setError(authError.message)` — handing the raw
// provider string to a human. ★ The person who most needs a clear instruction
// gets the least readable string in the system, and they cannot report it from
// inside the tool, because they are outside it.
//
// ★★ Verified against prod: her account is fine — confirmed, not banned, with a
// profiles row, a tenant_memberships row and a roster row, and a successful
// sign-in on record. Miles signed in at 17:20 the same afternoon. Nothing was
// wrong with the account or the service; something between her browser and
// Supabase dropped the request, and the screen could not say so.
//
// ---------------------------------------------------------------------------
// ★★★ WHY THIS DOES NOT MATCH ON "Failed to fetch"
// ---------------------------------------------------------------------------
// Because that text is the BROWSER'S, not Supabase's, and every browser words
// it differently:
//
//     Chrome / Edge   "Failed to fetch"
//     Firefox         "NetworkError when attempting to fetch resource."
//     Safari          "Load failed" / "The network connection was lost."
//
// A guard keyed on Chrome's wording is the failure mode this ticket exists to
// fix, reappearing one layer up: it would work on the machine of whoever wrote
// it and be silent on Jade's.
//
// ★★ So the network case is detected by TYPE and STATUS. supabase-js wraps any
// transport failure — whatever the browser called it — in an
// `AuthRetryableFetchError` with `status: 0`, before the message ever reaches
// us. Both signals are checked, and an unrecognised shape falls through to the
// generic case rather than being guessed at.
//
// ★ Note `friendlyAuthMessage` in lib/authEvents does match on strings. That is
// fix-314's helper for a DIFFERENT surface — a session that vanished under
// somebody already signed in — where the input is an arbitrary thrown value and
// there is no typed error to interrogate. It is deliberately left alone.

/** What actually went wrong, as a person would categorise it. */
export type LoginFailureKind =
  | 'network'
  | 'credentials'
  | 'rate_limited'
  | 'email_unconfirmed'
  | 'unknown';

export interface LoginFailure {
  kind: LoginFailureKind;
  /** The one line that says what happened. */
  headline: string;
  /** What to do about it. */
  guidance: string;
  /**
   * ★★ The raw provider text — ONLY for the unrecognised case.
   *
   * A message nobody anticipated is exactly when the underlying string is worth
   * having, and hiding it entirely would have made THIS bug harder to diagnose,
   * not easier. But it is a footnote, never the headline: for the four cases we
   * do recognise it is null, because there we know better than the string does.
   */
  technical: string | null;
}

/** Narrow an unknown throwable to the bits of a Supabase AuthError we use. */
function authShape(err: unknown): { status?: number; code?: string; message: string } {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  return {
    status: typeof e?.status === 'number' ? e.status : undefined,
    code: typeof e?.code === 'string' ? e.code : undefined,
    message: typeof e?.message === 'string' ? e.message : String(err ?? ''),
  };
}

/**
 * ★★★ Is this the transport failing, rather than the server refusing?
 *
 * Three independent signals, none of them the message text:
 *
 *   1. supabase-js's own type guard — the library already made this judgement
 *      when it wrapped the fetch rejection.
 *   2. `status === 0`, which is what "no HTTP response happened at all" looks
 *      like. Kept as a second signal so a future library version that stops
 *      exporting the guard, or an error that crossed a serialisation boundary
 *      and lost its prototype, still classifies correctly.
 *   3. A bare `TypeError` that is not an AuthError — the shape a raw `fetch()`
 *      rejection has if one ever reaches here unwrapped.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (isAuthRetryableFetchError(err)) return true;
  const { status } = authShape(err);
  if (status === 0) return true;
  const isAuthError = !!(err as { __isAuthError?: unknown })?.__isAuthError;
  return err instanceof TypeError && !isAuthError;
}

// ---------------------------------------------------------------------------
// The words. ★ This is the deliverable — what a blocked person actually reads.
// ---------------------------------------------------------------------------

const NETWORK: LoginFailure = {
  kind: 'network',
  headline: "Can't reach the server",
  // ★ Ordered by how likely it is to be the answer AND how cheap it is to try.
  // The incognito step is second because a privacy extension blocking
  // *.supabase.co is the common cause and an incognito window proves it in ten
  // seconds; the phone is last because it is the one that tells you it is the
  // office network rather than your machine.
  guidance:
    'Your sign-in never reached us, so nothing is wrong with your password. ' +
    'Try a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). If that ' +
    'fails, open an incognito window — an ad-blocker or privacy extension ' +
    'blocking supabase.co is the usual cause. If that fails too, try your ' +
    'phone on mobile data: if the phone works, it is the office network or ' +
    'the VPN, and Bobby needs to know that.',
  technical: null,
};

const CREDENTIALS: LoginFailure = {
  kind: 'credentials',
  // ★★ ONE MESSAGE FOR BOTH FIELDS, deliberately. Saying which one was wrong
  // tells anyone typing at this box whether an email is a real account here.
  headline: "That email and password don't match",
  guidance:
    'Check for caps lock or a stray space. There is no self-service password ' +
    'reset yet — if you are sure the password is right, or you have forgotten ' +
    'it, message Bobby.',
  technical: null,
};

const RATE_LIMITED: LoginFailure = {
  kind: 'rate_limited',
  headline: 'Too many sign-in attempts',
  // ★ "A few minutes" rather than an invented number: the window is a Supabase
  // project setting and this screen cannot read it. A precise figure we cannot
  // verify would be worse than an honest approximation.
  guidance:
    'Sign-in has been temporarily blocked after several failed attempts. ' +
    'It lifts by itself — wait a few minutes, then try once more. Nothing is ' +
    'wrong with your account.',
  technical: null,
};

const EMAIL_UNCONFIRMED: LoginFailure = {
  kind: 'email_unconfirmed',
  headline: 'This account is not activated yet',
  guidance:
    'The account exists but its email address was never confirmed, so it ' +
    'cannot sign in. Message Bobby to have it activated — you do not need to ' +
    'do anything else.',
  technical: null,
};

/**
 * ★★★ Turn whatever the auth layer threw into something a person can act on.
 *
 * ★ The order is deliberate: transport first, because a request that never
 * arrived cannot have a meaningful code on it, and every other branch below
 * reads a code the server sent.
 */
export function classifyLoginError(err: unknown): LoginFailure {
  if (isNetworkFailure(err)) return NETWORK;

  const { status, code, message } = authShape(err);

  // ★ CODE FIRST, status second. GoTrue's `code` is the stable identifier;
  // status is the coarser signal and is only consulted where a code is absent.
  if (code === 'invalid_credentials') return CREDENTIALS;
  if (code === 'email_not_confirmed') return EMAIL_UNCONFIRMED;
  if (code === 'over_request_rate_limit' || status === 429) return RATE_LIMITED;

  // ★★ ANYTHING ELSE FALLS THROUGH ON PURPOSE. It would be easy to map status
  // 400 to "wrong password" and be right most of the time — and wrong in
  // exactly the cases nobody has thought about, which is where the raw string
  // earns its place. Guessing here would hide the next Jade.
  return {
    kind: 'unknown',
    headline: 'Something went wrong signing you in',
    guidance:
      'Try again in a moment. If it keeps happening, send Bobby the technical ' +
      'detail below — it is the part that identifies the problem.',
    technical: message.trim() === '' ? 'No further detail was provided.' : message,
  };
}
