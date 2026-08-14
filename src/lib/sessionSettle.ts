import type { Session } from '@supabase/supabase-js';

// fix-314: the settle window — "is this session really gone, or is it just
// mid-refresh?"
//
// ★ THE MECHANISM, AND WHY IT TERMINATES. The brief is explicit that this must
// not be papered over with a long arbitrary timeout, so:
//
//   * The PRIMARY mechanism is ONE call to supabase.auth.getSession(). It is
//     not a poll and not a retry loop. supabase-js holds an internal lock
//     across a token refresh, so this call resolves once the in-flight refresh
//     finishes — which is precisely the question being asked. One call, one
//     answer, no repetition.
//
//   * The timeout is a BACKSTOP THAT FAILS CLOSED. On expiry it resolves to
//     null, i.e. "treat the session as gone", which sends the user to the login
//     screen. It can therefore only ever make the redirect happen SOONER, never
//     later. That is what makes it safe: it cannot strand anyone on a
//     "Loading…" screen, which the brief rules out, and a user who really has
//     signed out still reaches /login within it.
//
//   * 4 seconds because a refresh round-trip is sub-second on any working
//     connection. It is not tuned to hide the bug; it is the point past which
//     "we cannot reach the auth server" is the honest answer.
//
// Termination is asserted in the tests both ways: a getSession() that never
// resolves still produces an answer, and it produces the FAIL-CLOSED one.

export const SETTLE_TIMEOUT_MS = 4000;

export interface SettleResult {
  session: Session | null;
  /** True when the backstop fired rather than getSession() answering. Carried
   *  into the error log so a hung auth server is distinguishable from a real
   *  sign-out — they look identical from the user's side and must not look
   *  identical to us. */
  timedOut: boolean;
  /** Whatever getSession() reported, if anything. */
  error: unknown;
}

type GetSession = () => Promise<{
  data: { session: Session | null };
  error: unknown;
}>;

/**
 * Ask once whether the session is genuinely gone.
 *
 * Never rejects: a thrown getSession is an answer too ("we could not confirm"),
 * and the caller's job is to redirect or not, not to handle an exception.
 */
export async function confirmSession(
  getSession: GetSession,
  timeoutMs: number = SETTLE_TIMEOUT_MS,
): Promise<SettleResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const backstop = new Promise<SettleResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ session: null, timedOut: true, error: null }),
      timeoutMs,
    );
  });

  const ask = (async (): Promise<SettleResult> => {
    try {
      const { data, error } = await getSession();
      return { session: data?.session ?? null, timedOut: false, error };
    } catch (err: unknown) {
      return { session: null, timedOut: false, error: err };
    }
  })();

  try {
    return await Promise.race([ask, backstop]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
