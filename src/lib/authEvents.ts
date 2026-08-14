import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

// fix-314: how the app reacts to a Supabase auth event.
//
// Miles: "It pops up an error for me saying authentication error … like every
// couple times I click through things … and I refresh and it fixes but takes me
// back to the home page."
//
// Every clause mapped to a line. The chain, verified against the code rather
// than taken on trust:
//
//   1. App.tsx discarded the `event` argument and did `setSession(session ?? null)`
//      on EVERY event, so a null session arriving on a TOKEN_REFRESHED was
//      indistinguishable from a real SIGNED_OUT.
//   2. AuthGuard redirected on the falsy session with no settle window — a
//      session that is MOMENTARILY absent looked exactly like one that is gone.
//   3. AuthGuard recorded `state={{ from: location }}` and Login.tsx never read
//      it, so recovery landed on the index route -> /dashboard. That is
//      "takes me back to the home page", exactly.
//
// ★ AND ONE THING THE BRIEF HAS WRONG, which matters because acting on it
// would have produced no signal at all. The brief blames the missing telemetry
// on App.tsx's `if (k.startsWith('auth/')) return true`. That filter matches
// NOTHING — no query in this codebase uses an `auth/` key prefix (grep it).
// Narrowing it would change nothing. The real reason `error_reports` has zero
// auth rows is that NO auth path calls logError at all: onAuthStateChange
// logged nothing, and the bootstrap failure path called setBootstrapError,
// which paints a splash instead. So fix-314 EMITS auth logs rather than
// unblocking ones that were never sent.
//
// This module is pure so the decisions can be tested without a browser, a
// Supabase client, or a router.

/** The only event that means "this person is deliberately signed out".
 *
 *  supabase-js v2.105 emits: INITIAL_SESSION · PASSWORD_RECOVERY · SIGNED_IN ·
 *  SIGNED_OUT · TOKEN_REFRESHED · USER_UPDATED · MFA_CHALLENGE_VERIFIED.
 *  Of those, only SIGNED_OUT is an assertion that the session is gone. Every
 *  other one carrying a null session is either a transient state during a
 *  refresh or a startup event that has not read storage yet. */
export const SIGN_OUT_EVENT: AuthChangeEvent = 'SIGNED_OUT';

export type AuthReaction =
  /** Store this session and carry on. */
  | { kind: 'adopt'; session: Session }
  /** Genuinely signed out — clear the store and let the guard redirect. */
  | { kind: 'clear' }
  /** ★ A null session on a non-sign-out event. Do NOT clear and do NOT bounce;
   *  ask the client once whether the session really is gone. */
  | { kind: 'verify' };

/**
 * What to do with an auth event.
 *
 * ★ The whole ticket is the third branch. Before fix-314 the null-session cases
 * collapsed into one, and a token refresh threw the user to /login.
 */
export function reactToAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): AuthReaction {
  if (session) return { kind: 'adopt', session };
  if (event === SIGN_OUT_EVENT) return { kind: 'clear' };
  return { kind: 'verify' };
}

/**
 * Should this auth failure be logged?
 *
 * ★ The brief's rule, and it is the right one: a missing session on the login
 * route is expected user flow; an auth failure for someone who currently HAS a
 * session is the bug we are hunting. Logging the first would bury the second
 * under every anonymous page load.
 */
export function shouldLogAuthFailure(input: {
  hadSession: boolean;
  pathname: string;
}): boolean {
  if (!input.hadSession) return false;
  // Belt and braces: even with a stale session in the store, someone sitting on
  // /login is not the signal we want.
  return !input.pathname.startsWith('/login');
}

/**
 * Plain language for a person, from whatever the auth layer threw.
 *
 * Miles saw a raw string ("Invalid Refresh Token: Refresh Token Not Found" and
 * friends render straight through). The technical text still goes to
 * error_reports via the context — this is only what a human reads.
 */
export function friendlyAuthMessage(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : String(raw ?? '')).toLowerCase();
  if (
    text.includes('refresh token') ||
    text.includes('token expired') ||
    text.includes('jwt expired') ||
    text.includes('session expired') ||
    text.includes('session_not_found')
  ) {
    return 'Your session expired. Please sign in again.';
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('timeout')) {
    return "We couldn't reach the server to confirm your sign-in. Check your connection and try again.";
  }
  return 'You have been signed out. Please sign in again.';
}

/**
 * Where to send someone after a successful sign-in.
 *
 * ★ AuthGuard has always recorded `state={{ from: location }}`; Login never
 * read it. This is the receiving half. Anything that is not a same-site
 * absolute path is ignored — an open-redirect through router state is a real
 * class of bug, and "//evil.com" is a valid-looking pathname to a careless
 * check.
 */
export const DEFAULT_LANDING = '/dashboard';

export function landingAfterSignIn(from: unknown): string {
  const path = readPath(from);
  if (path === null) return DEFAULT_LANDING;
  // Never bounce back to the login screen itself — that is a loop.
  if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login/')) {
    return DEFAULT_LANDING;
  }
  return path;
}

function readPath(from: unknown): string | null {
  if (typeof from === 'string') return sanitize(from);
  if (from && typeof from === 'object') {
    const loc = from as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof loc.pathname !== 'string') return null;
    const search = typeof loc.search === 'string' ? loc.search : '';
    const hash = typeof loc.hash === 'string' ? loc.hash : '';
    return sanitize(`${loc.pathname}${search}${hash}`);
  }
  return null;
}

function sanitize(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return null;
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
  return trimmed;
}
