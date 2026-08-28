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
  | 'unknown'
  // ★ fix-426 — the reset flow's own failures. They join fix-357's set rather
  //   than replacing any of it: same type, same three parts, same box.
  | 'code_format'
  | 'code_rejected'
  | 'weak_password';

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
  // ★★★ fix-426 RETIRED THE SECOND HALF OF THIS SENTENCE. It used to read
  //     "There is no self-service password reset yet — … message Bobby", which
  //     was true when fix-357 wrote it and is the exact thing that made two
  //     lockouts in ten days into Bobby's problem. The copy comes out ONLY
  //     because the control it now points at is real (fix-357's rule: no dead
  //     placeholder, ever).
  guidance:
    'Check for caps lock or a stray space. If you have forgotten it, use ' +
    '"Forgot password?" below — we will email you a six-digit code and you ' +
    'can set a new one yourself.',
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

// ===========================================================================
// ★★★ fix-426 — A PERSON LOCKED OUT GETS BACK IN WITHOUT BOBBY
// ===========================================================================
//
// Two lockouts in ten days: Jade 2026-08-19 (fix-357), Brittani 2026-08-28.
// NEITHER ACCOUNT WAS BROKEN — Brittani was typing a trailing `!` her stored
// password does not have. The problem was that the only way back in was Bobby,
// and this file said so out loud. fix-357 §4 measured that and left the call;
// Bobby made it on 2026-08-28.
//
// ---------------------------------------------------------------------------
// ★★★ THE EMAIL CARRIES A CODE, NOT A LINK — AND THAT IS THE WHOLE TICKET
// ---------------------------------------------------------------------------
//
// A reset LINK is single-use, and a mail-security scanner that opens links to
// check them SPENDS IT. Not hypothetical: three sessions exist on Brittani's
// account created from datacenter IPs with a stale `Chrome/118` user-agent, one
// of them 17 seconds after a recovery email was sent, each holding a live
// unused refresh token — and nobody else in the database has a single one. She
// never got a working link; she got a dead page, silently, in the exact case
// this feature exists for.
//
// Supabase names the case itself: `{{ .Token }}` exists so a code "helps
// prevent issues with email clients that prefetch URLs for security scanning."
//
// ★ So there is no deep-link route here, no ConfirmationURL parsing, and
//   nothing in this flow can be consumed by a machine reading the mailbox.

/** ★ Six digits, because that is what `{{ .Token }}` emits. */
export const RESET_CODE_LENGTH = 6;

/**
 * ★★ The minimum, stated to the person BEFORE they type rather than after
 * their choice is rejected.
 *
 * ★ Eight, not Supabase's default six: this is the floor this screen promises,
 * and a floor the server also enforces cannot be undercut here. If the project
 * is later configured stricter than eight the server still refuses, and
 * `classifyResetError` surfaces GoTrue's own explanation of the rule as
 * technical detail — which names the missing requirement rather than guessing.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** The rule, in the words the screen shows above the field. */
export const PASSWORD_RULE = `At least ${PASSWORD_MIN_LENGTH} characters.`;

/**
 * ★★★ THE SAME ANSWER FOR AN ADDRESS WE HAVE AND ONE WE DO NOT.
 *
 * Requesting a code must not tell an anonymous visitor whether an address is an
 * account here — the same discipline as fix-357's refusal to say WHICH of email
 * or password was wrong, applied to a box anybody can type into.
 */
export const RESET_CODE_SENT_NOTICE =
  'If that address has an account, a six-digit code is on its way. It can ' +
  'take a minute, and it may land in spam. Enter it below with the new ' +
  'password you want.';

const CODE_FORMAT: LoginFailure = {
  kind: 'code_format',
  headline: `That doesn't look like a ${RESET_CODE_LENGTH}-digit code`,
  guidance:
    `The code in the email is ${RESET_CODE_LENGTH} digits and nothing else. ` +
    'Check for a stray space or a missing digit and try again — you do not ' +
    'need a new code.',
  technical: null,
};

/**
 * ★★★ ONE SENTENCE FOR WRONG-OR-EXPIRED, BECAUSE GOTRUE DOES NOT SEPARATE THEM.
 *
 * The brief asked for two: "code wrong" and "code expired". GoTrue answers both
 * with the SAME error — code `otp_expired`, message "Token has expired or is
 * invalid" — so a screen that said "your code expired" would be inventing the
 * half it does not know, which is the fix-357 mistake in a new place.
 *
 * ★★ WHAT THE PERSON NEEDS IS BOTH WAYS OUT, and they get both as CONTROLS
 * rather than as prose: the code box stays filled and re-submittable (a
 * mistyped digit needs no new email), and "Send a new code" sits beside it (an
 * expired one does). The sentence names both possibilities honestly; the
 * buttons make the distinction unnecessary.
 *
 * ★ The one case that IS separable is caught before the request ever leaves —
 *   see CODE_FORMAT. A code that is not six digits is definitely mistyped.
 */
const CODE_REJECTED: LoginFailure = {
  kind: 'code_rejected',
  headline: "That code didn't work",
  guidance:
    'It may have a digit wrong, or it may have expired — codes are good for ' +
    'about an hour. Check it against the email and try again, or send ' +
    'yourself a new one.',
  technical: null,
};

/** ★ Checked before anything is sent, so the rule is a gate and not a verdict. */
export function validateNewPassword(password: string): LoginFailure | null {
  if (password.length >= PASSWORD_MIN_LENGTH) return null;
  return {
    kind: 'weak_password',
    headline: 'That password is too short',
    guidance: `${PASSWORD_RULE} Nothing has been changed — pick a longer one and try again.`,
    technical: null,
  };
}

/** ★ Six digits exactly. Whitespace is forgiven because people paste. */
export function normaliseResetCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function isWellFormedResetCode(raw: string): boolean {
  return new RegExp(`^[0-9]{${RESET_CODE_LENGTH}}$`).test(normaliseResetCode(raw));
}

export function codeFormatFailure(): LoginFailure {
  return CODE_FORMAT;
}

/**
 * ★★★ WHETHER A REQUEST-A-CODE FAILURE MAY BE SHOWN AT ALL.
 *
 * Returns null for "say nothing different" — the neutral notice is rendered and
 * the person moves to the code screen exactly as they would for a real account.
 *
 * ★★ A "user not found" answer is DELIBERATELY SWALLOWED. Supabase does not
 * send one today (it returns success for an unknown address, which is the whole
 * point), but a provider change that started returning 404 here would turn this
 * box into an account-existence oracle without a single line of our code
 * changing. Swallowing it costs nothing and closes that door in advance.
 *
 * ★ Transport and rate-limit failures ARE shown: neither reveals anything about
 *   the address, and both are things the person can act on.
 */
export function classifyResetRequestError(err: unknown): LoginFailure | null {
  if (err == null) return null;
  if (isNetworkFailure(err)) return NETWORK;
  const { status, code } = authShape(err);
  if (code === 'user_not_found' || status === 404) return null;
  if (code === 'over_request_rate_limit' || status === 429) return RESET_RATE_LIMITED;
  return classifyLoginError(err);
}

/** ★ Its own wording: the thing being throttled is emails, not sign-ins. */
const RESET_RATE_LIMITED: LoginFailure = {
  kind: 'rate_limited',
  headline: 'Too many code requests',
  guidance:
    'Codes are rate-limited to stop an address being flooded. Wait a few ' +
    'minutes before asking for another — and check spam first, because the ' +
    'one already sent is probably fine.',
  technical: null,
};

/**
 * ★★★ Failures from verifying a code or setting the new password.
 *
 * ★ Order matches `classifyLoginError`: transport first, because a request that
 *   never arrived cannot carry a meaningful code.
 */
export function classifyResetError(err: unknown): LoginFailure {
  if (isNetworkFailure(err)) return NETWORK;

  const { status, code, message } = authShape(err);

  // ★★ GoTrue answers a wrong code and an expired code identically. See
  //    CODE_REJECTED for why this screen does not pretend otherwise.
  if (code === 'otp_expired' || code === 'otp_disabled') return CODE_REJECTED;
  if (code === 'over_request_rate_limit' || status === 429) return RESET_RATE_LIMITED;
  if (code === 'weak_password') {
    return {
      kind: 'weak_password',
      headline: 'That password was refused',
      guidance:
        'The server has its own rules for passwords and this one does not ' +
        'meet them. Nothing has been changed — the detail below says what is ' +
        'missing.',
      // ★ THE ONE PLACE THE PROVIDER STRING EARNS THE SPACE: GoTrue names the
      //   requirement that failed, and we cannot know the project's configured
      //   rule from here. Still a footnote, never the headline.
      technical: message.trim() === '' ? 'No further detail was provided.' : message,
    };
  }
  // ★★ A 403 with no code is what a rejected token looks like on older GoTrue
  //    builds. Mapped here rather than falling through, because "Something went
  //    wrong" on the code screen is materially worse than on the sign-in screen:
  //    the person has an email open in front of them and needs to know whether
  //    to retype or re-request.
  if (status === 403) return CODE_REJECTED;

  return classifyLoginError(err);
}
