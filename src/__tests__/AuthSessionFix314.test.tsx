import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useAuthStore } from '../stores/authStore';
import {
  DEFAULT_LANDING,
  friendlyAuthMessage,
  landingAfterSignIn,
  reactToAuthEvent,
  shouldLogAuthFailure,
} from '../lib/authEvents';
import { confirmSession, SETTLE_TIMEOUT_MS } from '../lib/sessionSettle';
import { createAuthEventHandler, type AuthHandlerDeps } from '../lib/authHandler';

// fix-314 — "a token refresh throws people back to the home page".
//
// Miles: "It pops up an error for me saying authentication error … like every
// couple times I click through things … and I refresh and it fixes but takes me
// back to the home page."
//
// ★ VERIFIED THE CHAIN RATHER THAN TAKING IT ON TRUST, and it holds — with one
// correction, recorded in src/lib/authEvents.ts: the brief blames the missing
// telemetry on App.tsx's `k.startsWith('auth/')` filter, and that filter
// matches NOTHING. No query in this codebase uses an `auth/` key. Narrowing it
// would have produced no signal at all. The real cause is that no auth path
// ever called logError, so fix-314 EMITS the logs instead of unblocking ones
// that were never sent.

const signInWithPassword = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword,
      getSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  },
  supabaseUrl: 'http://test.local',
}));

import AuthGuard from '../components/AuthGuard';
import Login from '../pages/Login';

const SESSION = { access_token: 'a', user: { id: 'u1' } } as unknown as Session;

function resetStore(over: Partial<ReturnType<typeof useAuthStore.getState>> = {}) {
  useAuthStore.setState({
    session: null,
    user: null,
    initialized: true,
    verifying: false,
    memberships: [{ tenant_id: 't1', role: 'admin' }],
    activeTenantId: 't1',
    ...over,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ---------------------------------------------------------------------------
// 1. Distinguish "refreshing" from "signed out"
// ---------------------------------------------------------------------------

describe('fix-314 §1: a null session is not automatically a sign-out', () => {
  // ★★ THE ACCEPTANCE TEST FOR THE WHOLE TICKET.
  it('★★ TOKEN_REFRESHED with a null session does NOT clear or redirect', () => {
    expect(reactToAuthEvent('TOKEN_REFRESHED', null)).toEqual({ kind: 'verify' });
  });

  it('an explicit SIGNED_OUT still clears, promptly', () => {
    expect(reactToAuthEvent('SIGNED_OUT', null)).toEqual({ kind: 'clear' });
  });

  it('every other null-session event verifies rather than clearing', () => {
    for (const event of [
      'INITIAL_SESSION',
      'PASSWORD_RECOVERY',
      'SIGNED_IN',
      'USER_UPDATED',
      'MFA_CHALLENGE_VERIFIED',
    ] as const) {
      expect(reactToAuthEvent(event, null), event).toEqual({ kind: 'verify' });
    }
  });

  it('a session that IS present is always adopted, whatever the event', () => {
    for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'SIGNED_OUT'] as const) {
      expect(reactToAuthEvent(event, SESSION), event).toEqual({
        kind: 'adopt',
        session: SESSION,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The settle mechanism — and that it TERMINATES
// ---------------------------------------------------------------------------

describe('fix-314: the settle window terminates, and fails closed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers from the single getSession() call when it resolves', async () => {
    const ask = vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null });
    const out = await confirmSession(ask, 50);
    expect(out.session).toBe(SESSION);
    expect(out.timedOut).toBe(false);
    // ★ ONE call. Not a poll, not a retry loop.
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('a confirmed-null session comes back as gone, not as a timeout', async () => {
    const ask = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const out = await confirmSession(ask, 50);
    expect(out.session).toBeNull();
    expect(out.timedOut).toBe(false);
  });

  // ★ THE TERMINATION PROOF. A getSession() that never settles must still
  // produce an answer, and the answer must be the FAIL-CLOSED one — otherwise
  // "don't bounce the user" quietly becomes "strand the user on Loading…",
  // which the brief rules out explicitly.
  it('★ a getSession() that NEVER resolves still terminates, answering "gone"', async () => {
    const ask = vi.fn(() => new Promise<never>(() => {}));
    const out = await confirmSession(ask, 10);
    expect(out.session).toBeNull();
    expect(out.timedOut).toBe(true);
  });

  it('a thrown getSession() is an answer too, not an unhandled rejection', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('network down'));
    const out = await confirmSession(ask, 50);
    expect(out.session).toBeNull();
    expect(out.timedOut).toBe(false);
    expect((out.error as Error).message).toBe('network down');
  });

  it('the backstop is short enough to be a backstop, not a hiding place', () => {
    // Not tuned to mask the bug: a refresh round-trip is sub-second.
    expect(SETTLE_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// 2. AuthGuard — no bounce on a transient, prompt bounce on a real sign-out
// ---------------------------------------------------------------------------

function renderGuard(initial = '/draw-schedule') {
  function Where() {
    const { pathname } = useLocation();
    return <div data-testid="where">{pathname}</div>;
  }
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/draw-schedule"
          element={
            <AuthGuard>
              <div data-testid="protected">the page</div>
            </AuthGuard>
          }
        />
        <Route path="/login" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('fix-314 §2: the guard', () => {
  it('renders the page while a session is held', () => {
    resetStore({ session: SESSION });
    renderGuard();
    expect(screen.getByTestId('protected')).toBeInTheDocument();
  });

  // ★ The common case after fix-314: the store is never cleared during a
  // verify, so the user's page does not even flicker.
  it('★ keeps rendering the page during a verify, because the session is untouched', () => {
    resetStore({ session: SESSION, verifying: true });
    renderGuard();
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-reconnecting')).toBeNull();
  });

  it('shows Reconnecting rather than bouncing when a verify starts with no session', () => {
    resetStore({ session: null, verifying: true });
    renderGuard();
    expect(screen.getByTestId('auth-reconnecting')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('★ a confirmed sign-out reaches /login promptly', () => {
    resetStore({ session: null, verifying: false });
    renderGuard();
    expect(screen.getByTestId('where').textContent).toBe('/login');
  });

  it('still shows Loading before the first getSession resolves', () => {
    resetStore({ session: null, initialized: false });
    renderGuard();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  // Prior contract (Q5.5.D).
  it('the no-tenant "Access denied" splash still shows for a member-less user', () => {
    resetStore({ session: SESSION, memberships: [] });
    renderGuard();
    expect(screen.getByTestId('no-tenant-splash')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. Return people to where they were
// ---------------------------------------------------------------------------

describe('fix-314 §3: sign-in returns you to where you were', () => {
  it('reads a location object, a string, or neither', () => {
    expect(landingAfterSignIn({ pathname: '/draw-schedule' })).toBe('/draw-schedule');
    expect(landingAfterSignIn({ pathname: '/project/p1', search: '?permit=3' })).toBe(
      '/project/p1?permit=3',
    );
    expect(landingAfterSignIn('/library')).toBe('/library');
    expect(landingAfterSignIn(undefined)).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn(null)).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn({})).toBe(DEFAULT_LANDING);
  });

  it('★ never trusts it into an off-site redirect', () => {
    // Router state is attacker-reachable in the general case, and "//evil.com"
    // looks like a pathname to a careless check.
    expect(landingAfterSignIn('//evil.com')).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn('/\\evil.com')).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn('https://evil.com')).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn({ pathname: '//evil.com' })).toBe(DEFAULT_LANDING);
  });

  it('never bounces back to /login itself — that is a loop', () => {
    expect(landingAfterSignIn('/login')).toBe(DEFAULT_LANDING);
    expect(landingAfterSignIn({ pathname: '/login', search: '?next=/x' })).toBe(
      DEFAULT_LANDING,
    );
  });

  // ★ The two halves, asserted separately, because the bug was that only one
  // of them existed. The guard has ALWAYS recorded `from`; nothing read it.

  it('the guard records where you were when it bounces you', () => {
    resetStore({ session: null, verifying: false });
    let seen: unknown = null;
    function Probe() {
      const loc = useLocation();
      seen = (loc.state as { from?: { pathname?: string } } | null)?.from ?? null;
      return <div data-testid="where">{loc.pathname}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/draw-schedule']}>
        <Routes>
          <Route
            path="/draw-schedule"
            element={
              <AuthGuard>
                <div data-testid="protected">the page</div>
              </AuthGuard>
            }
          />
          <Route path="/login" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where').textContent).toBe('/login');
    expect((seen as { pathname?: string } | null)?.pathname).toBe('/draw-schedule');
  });

  // ★★ THE RESOLVED ROUTE, from a non-dashboard starting point — the brief's
  // wording, and the fix-306 discipline: never assert an href string, navigate
  // and read back where the router actually landed.
  it('★★ signing in from a guard redirect lands back on /draw-schedule, not /dashboard', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    function Where() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { from: { pathname: '/draw-schedule' } } },
        ]}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/draw-schedule" element={<Where />} />
          <Route path="/dashboard" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('where').textContent).toBe('/draw-schedule');
    });
    // Said plainly: NOT the home page. That is the whole complaint.
    expect(screen.getByTestId('where').textContent).not.toBe('/dashboard');
  });

  it('lands on /dashboard when there is no origin to return to', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    function Where() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      expect(screen.getByTestId('where').textContent).toBe('/dashboard');
    });
  });

  it('a failed sign-in stays put and shows the error, rather than navigating', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    function Where() {
      const { pathname } = useLocation();
      return <div data-testid="where">{pathname}</div>;
    }
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/login', state: { from: { pathname: '/draw-schedule' } } },
        ]}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/draw-schedule" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('where')).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// ★ THE WIRING — where the bug actually lived
// ---------------------------------------------------------------------------
//
// reactToAuthEvent can be perfect while the caller ignores it, which is exactly
// the state this ticket found: App.tsx wrote
// `onAuthStateChange((_event, session) => setSession(session ?? null))`.
// Testing only the pure decision would have left the real defect uncovered, so
// the handler is exercised here with fakes for the store, the client and the
// logger.

function makeDeps(over: Partial<AuthHandlerDeps> = {}) {
  const calls = {
    setSession: [] as (Session | null)[],
    setVerifying: [] as boolean[],
    setMemberships: [] as unknown[][],
    logged: [] as { event: string; hadSession: boolean; timedOut: boolean; stage?: string }[],
  };
  let stored: Session | null = SESSION;
  const deps: AuthHandlerDeps = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    currentSession: () => stored,
    setSession: (sn) => {
      stored = sn;
      calls.setSession.push(sn);
    },
    setVerifying: (v) => calls.setVerifying.push(v),
    setMemberships: (m) => calls.setMemberships.push(m),
    loadMemberships: vi.fn().mockResolvedValue([{ tenant_id: 't1', role: 'admin' }]),
    logAuthFailure: (i) => calls.logged.push(i),
    isMounted: () => true,
    settleTimeoutMs: 20,
    ...over,
  };
  return { deps, calls, current: () => stored };
}

describe('fix-314 ★ the handler: a refresh does not sign you out', () => {
  // ★★ THE ACCEPTANCE TEST, at the layer that had the bug.
  it('★★ TOKEN_REFRESHED with a null session NEVER clears the store', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValue({ data: { session: SESSION }, error: null });
    const { deps, calls, current } = makeDeps({ getSession });

    await createAuthEventHandler(deps)('TOKEN_REFRESHED', null);

    // The store held a session throughout — nothing was ever set to null, so
    // AuthGuard never saw a falsy session and never bounced.
    expect(calls.setSession).not.toContain(null);
    expect(current()).toBe(SESSION);
    // ...and it asked exactly once.
    expect(getSession).toHaveBeenCalledTimes(1);
    // Nothing to tell anyone: this was a non-event.
    expect(calls.logged).toEqual([]);
  });

  it('an explicit SIGNED_OUT clears immediately, with no settle round-trip', async () => {
    const { deps, calls, current } = makeDeps();
    await createAuthEventHandler(deps)('SIGNED_OUT', null);
    expect(current()).toBeNull();
    expect(calls.setMemberships).toEqual([[]]);
    // Prompt: a real sign-out must not wait on the settle window.
    expect(deps.getSession).not.toHaveBeenCalled();
  });

  // ★ A genuinely expired session still reaches the login screen.
  it('★ a confirmed-gone session DOES clear, and IS logged with the event name', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const { deps, calls, current } = makeDeps({ getSession });

    await createAuthEventHandler(deps)('TOKEN_REFRESHED', null);

    expect(current()).toBeNull();
    expect(calls.setMemberships).toEqual([[]]);
    expect(calls.logged).toHaveLength(1);
    // The event name is the discriminator: a failed refresh vs a real sign-out.
    expect(calls.logged[0]!.event).toBe('TOKEN_REFRESHED');
    expect(calls.logged[0]!.hadSession).toBe(true);
    expect(calls.logged[0]!.timedOut).toBe(false);
    // And the verifying flag was raised then lowered — never left stuck on.
    expect(calls.setVerifying).toEqual([true, false]);
  });

  it('★ a hung auth server terminates, clears, and is logged AS a timeout', async () => {
    const getSession = vi.fn(() => new Promise<never>(() => {}));
    const { deps, calls, current } = makeDeps({ getSession });

    await createAuthEventHandler(deps)('TOKEN_REFRESHED', null);

    expect(current()).toBeNull();
    // Distinguishable from a real sign-out in the log — they look identical to
    // the user and must not look identical to us.
    expect(calls.logged[0]!.timedOut).toBe(true);
    expect(calls.setVerifying).toEqual([true, false]);
  });

  it('an anonymous visitor is not logged — no session to lose', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const { deps, calls } = makeDeps({ getSession, currentSession: () => null });
    await createAuthEventHandler(deps)('INITIAL_SESSION', null);
    expect(calls.logged[0]!.hadSession).toBe(false);
    // shouldLogAuthFailure is what turns that into "do not log" in App.tsx;
    // asserted directly in §4 above.
  });

  it('adopts a real session and reloads memberships', async () => {
    const { deps, calls, current } = makeDeps();
    await createAuthEventHandler(deps)('SIGNED_IN', SESSION);
    expect(current()).toBe(SESSION);
    expect(deps.loadMemberships).toHaveBeenCalledWith('u1');
    expect(calls.setMemberships[0]).toEqual([{ tenant_id: 't1', role: 'admin' }]);
    expect(calls.setVerifying).toEqual([false]);
  });

  // ★ The "authentication error" POPUP half of Miles's report.
  it('★ a failed membership refetch is LOGGED, not painted over the screen', async () => {
    const loadMemberships = vi.fn().mockRejectedValue(new Error('JWT expired'));
    const { deps, calls, current } = makeDeps({ loadMemberships });

    await createAuthEventHandler(deps)('TOKEN_REFRESHED', SESSION);

    // The session survives — a transient fetch failure is not a sign-out...
    expect(current()).toBe(SESSION);
    // ...and it does not blank the memberships either, which would have
    // triggered the "Access denied" splash instead.
    expect(calls.setMemberships).toEqual([]);
    expect(calls.logged).toHaveLength(1);
    expect(calls.logged[0]!.stage).toBe('membership-refresh');
  });

  it('writes nothing after unmount', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const { deps, calls } = makeDeps({ getSession, isMounted: () => false });
    await createAuthEventHandler(deps)('TOKEN_REFRESHED', null);
    expect(calls.setSession).toEqual([]);
    expect(calls.logged).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Stop hiding auth failures
// ---------------------------------------------------------------------------

describe('fix-314 §4: what gets logged', () => {
  it('★ an auth failure while a session exists IS logged', () => {
    expect(shouldLogAuthFailure({ hadSession: true, pathname: '/draw-schedule' })).toBe(
      true,
    );
    expect(shouldLogAuthFailure({ hadSession: true, pathname: '/dashboard' })).toBe(true);
  });

  it('★ a missing session on /login is NOT logged', () => {
    expect(shouldLogAuthFailure({ hadSession: false, pathname: '/login' })).toBe(false);
    // ...nor anywhere else — an anonymous visitor is expected user flow, and
    // logging it would bury the real signal under every page load.
    expect(shouldLogAuthFailure({ hadSession: false, pathname: '/dashboard' })).toBe(
      false,
    );
    // Belt and braces: a stale session in the store while sitting on /login is
    // still not the signal we want.
    expect(shouldLogAuthFailure({ hadSession: true, pathname: '/login' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Say something useful
// ---------------------------------------------------------------------------

describe('fix-314 §5: plain language, not a technical string', () => {
  it('★ translates the real Supabase strings a person would otherwise see', () => {
    // These are the literal messages that rendered through to Miles.
    expect(friendlyAuthMessage('Invalid Refresh Token: Refresh Token Not Found')).toBe(
      'Your session expired. Please sign in again.',
    );
    expect(friendlyAuthMessage(new Error('JWT expired'))).toBe(
      'Your session expired. Please sign in again.',
    );
    expect(friendlyAuthMessage('session_not_found')).toBe(
      'Your session expired. Please sign in again.',
    );
  });

  it('distinguishes "we could not reach the server" from "you are signed out"', () => {
    expect(friendlyAuthMessage('Failed to fetch')).toMatch(/connection/i);
    expect(friendlyAuthMessage(new Error('network timeout'))).toMatch(/connection/i);
  });

  it('falls back to plain language for anything unrecognised — never a raw dump', () => {
    const out = friendlyAuthMessage('AuthApiError: 400 grant_type=refresh_token');
    expect(out).toBe('You have been signed out. Please sign in again.');
    expect(out).not.toMatch(/grant_type|AuthApiError|400/);
    expect(friendlyAuthMessage(null)).not.toMatch(/null/);
    expect(friendlyAuthMessage(undefined)).toBe(
      'You have been signed out. Please sign in again.',
    );
  });
});
