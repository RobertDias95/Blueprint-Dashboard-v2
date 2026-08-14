import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { reactToAuthEvent } from './authEvents';
import { confirmSession } from './sessionSettle';

// fix-314: the onAuthStateChange handler, lifted out of App.tsx so it can be
// tested for real.
//
// ★ THIS EXTRACTION IS THE POINT, not tidiness. The bug was IN THE WIRING —
// App.tsx wrote `onAuthStateChange((_event, session) => setSession(session ?? null))`,
// discarding the event. Testing only the pure decision (reactToAuthEvent) would
// have left the actual defect uncovered: the decision function can be perfect
// while the caller ignores it, which is exactly the state this ticket found.
// Now the handler itself is driven by the tests, with fakes for the store, the
// client and the logger.

export interface AuthHandlerDeps {
  /** supabase.auth.getSession, injected so the settle window is testable. */
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  /** The session currently in the store, read at call time (not captured). */
  currentSession: () => Session | null;
  setSession: (session: Session | null) => void;
  setVerifying: (verifying: boolean) => void;
  setMemberships: (memberships: unknown[]) => void;
  loadMemberships: (userId: string) => Promise<unknown[]>;
  logAuthFailure: (input: {
    event: string;
    hadSession: boolean;
    timedOut: boolean;
    error: unknown;
    stage?: string;
  }) => void;
  /** False once the component unmounts — every write is gated on it. */
  isMounted: () => boolean;
  /** Overridable for tests; production uses the module default. */
  settleTimeoutMs?: number;
}

/**
 * Returns the handler to hand to supabase.auth.onAuthStateChange.
 *
 * Returns a promise so a caller (and a test) can await the settle rather than
 * guessing at timing. Production ignores it — onAuthStateChange does not await
 * its callback, and nothing here needs it to.
 */
export function createAuthEventHandler(deps: AuthHandlerDeps) {
  return function onAuthStateChange(
    event: AuthChangeEvent,
    session: Session | null,
  ): Promise<void> {
    if (!deps.isMounted()) return Promise.resolve();

    const reaction = reactToAuthEvent(event, session);

    if (reaction.kind === 'verify') {
      // ★ Null session, but NOT an explicit sign-out. Leave the store exactly
      // as it is — do not clear, do not bounce — and ask the client ONCE
      // whether the session is genuinely gone. Because the store keeps its
      // session, AuthGuard never sees the transient and the user's page does
      // not flicker.
      const hadSession = deps.currentSession() !== null;
      deps.setVerifying(true);
      return confirmSession(deps.getSession, deps.settleTimeoutMs).then((result) => {
        if (!deps.isMounted()) return;
        deps.setVerifying(false);
        if (result.session) {
          // It was mid-refresh. Nothing happened, so say nothing.
          deps.setSession(result.session);
          return;
        }
        // Confirmed gone. NOW clear, and NOW log — the event name is what
        // separates a failed refresh from a deliberate sign-out once these
        // start landing in error_reports.
        deps.setSession(null);
        deps.setMemberships([]);
        deps.logAuthFailure({
          event,
          hadSession,
          timedOut: result.timedOut,
          error: result.error,
        });
      });
    }

    deps.setVerifying(false);
    deps.setSession(reaction.kind === 'adopt' ? reaction.session : null);

    if (reaction.kind !== 'adopt') {
      deps.setMemberships([]);
      return Promise.resolve();
    }

    // Reload memberships on every auth change.
    return deps
      .loadMemberships(reaction.session.user.id)
      .then((memberships) => {
        if (deps.isMounted()) deps.setMemberships(memberships);
      })
      .catch((err: unknown) => {
        if (!deps.isMounted()) return;
        // ★ This used to call setBootstrapError, which paints a FULL-SCREEN
        // "Auth bootstrap failed" splash carrying the raw Supabase string —
        // mid-session, on a background membership refetch. That is the
        // "authentication error" popup Miles described. A transient fetch
        // failure has no business taking over the screen when we already hold
        // a valid session and a usable membership list. Logged instead: we see
        // it, he does not.
        deps.logAuthFailure({
          event,
          hadSession: true,
          timedOut: false,
          error: err,
          stage: 'membership-refresh',
        });
      });
  };
}
