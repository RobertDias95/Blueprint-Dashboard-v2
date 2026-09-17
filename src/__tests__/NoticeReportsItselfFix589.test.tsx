// ===========================================================================
// ★★★ fix-589 §A + §3 (P-289) — THE HEARTBEAT, THE TRAIL, AND THE CONTROL
// ===========================================================================
//
// Bobby: *"Is there a way to see if others are on a super outdated version?
// Can we make sure the reload is popping up for everyone?"*
//
// ★★★ THE SECOND QUESTION WAS UNANSWERABLE IN PRINCIPLE before this ticket —
//     the ribbon rendered and recorded nothing, so **"it never showed" and "it
//     showed and was ignored" were the same observation.** Every test in this
//     file is that gap: an appearance, a dismissal and a use each leave a mark,
//     and the mark is at the grain the question is asked at.
//
// ⚠️ THE SUITE MOCKS `lib/clientBuild`'s WRITER, NOT THE WHOLE MODULE. The
//    ladder is pure and is asserted for real in `WhoIsRunningWhatFix589` —
//    stubbing it here would let the component and the ladder drift apart while
//    both suites stayed green.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { markNewBuildLive, BUILD_CHECK_FIRST_MS } from '../lib/appVersion';
import { useAuthStore } from '../stores/authStore';

const recordClientBuild = vi.hoisted(() =>
  // ★ Typed with its real signature, so `calls[0][0]` is the event and a test
  //   that asserts on it is checked rather than inferred as an empty tuple.
  vi.fn<(event?: 'shown' | 'dismissed' | 'reloaded') => Promise<void>>(() =>
    Promise.resolve(),
  ),
);
const reloadOntoNewBuild = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(() => Promise.resolve()),
);
const buildAgeDays = vi.hoisted(() => vi.fn<() => number | null>(() => 0));

vi.mock('../lib/clientBuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/clientBuild')>();
  // ★ The real ladder, the real display-mode detection, the real `daysBehind`.
  //   Only the two functions that reach the network or the browser are stubbed.
  return { ...actual, recordClientBuild, buildAgeDays };
});
vi.mock('../lib/appVersion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/appVersion')>();
  return { ...actual, reloadOntoNewBuild };
});

import NewBuildNotice from '../components/NewBuildNotice';
import ClientBuildsPanel from '../components/Settings/ClientBuildsPanel';

const TENANT = 'test-tenant-uuid';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  recordClientBuild.mockClear();
  reloadOntoNewBuild.mockClear();
  buildAgeDays.mockReturnValue(0);
  useAuthStore.setState({
    activeTenantId: TENANT,
    memberships: [{ tenant_id: TENANT, role: 'admin' }],
  } as never);
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// §A — THE HEARTBEAT
// ===========================================================================

describe('fix-589 §A — the heartbeat rides the check that was already happening', () => {
  it('★★★ upserts once on load, before any timer has run', () => {
    // The only heartbeat a person who opens the app and closes it again ever
    // sends. It must not wait out BUILD_CHECK_FIRST_MS.
    render(<NewBuildNotice />);
    // ★ Counted by SHAPE, not by total: `newBuildIsLive` is module state that
    //   survives across tests in this file, so a total would silently depend on
    //   which describe ran first. A plain heartbeat carries NO event — the
    //   trail is for the notice.
    const plain = recordClientBuild.mock.calls.filter((c) => c.length === 0);
    expect(plain).toHaveLength(1);
  });

  it('★★★ and it does NOT burst under repeated checks', () => {
    // fix-424 gave the notice three triggers — a poll, `visibilitychange` and
    // `focus`. Alt-tabbing fires two of them in quick succession. The heartbeat
    // reuses BUILD_CHECK_MIN_GAP_MS, the SAME floor the check itself uses, so
    // it cannot be burst any harder than the check can.
    vi.useFakeTimers();
    try {
      render(<NewBuildNotice />);
      const afterMount = recordClientBuild.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(BUILD_CHECK_FIRST_MS + 1);
      });
      act(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // ★ At most ONE more than the mount heartbeat: the first deferred check.
      //   The three events that follow are inside the floor and are dropped by
      //   `check` before they ever reach the heartbeat.
      expect(recordClientBuild.mock.calls.length).toBeLessThanOrEqual(afterMount + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('★★ it adds NO timer of its own', () => {
    // The brief: *"reuse BUILD_CHECK_MIN_GAP_MS so this adds no new timer and
    // cannot burst."* Counted rather than trusted.
    const setInterval = vi.spyOn(window, 'setInterval');
    const setTimeout = vi.spyOn(window, 'setTimeout');
    try {
      render(<NewBuildNotice />);
      expect(setInterval).toHaveBeenCalledTimes(1); // the poll fix-424 shipped
      expect(setTimeout).toHaveBeenCalledTimes(1); // the deferred first check
    } finally {
      setInterval.mockRestore();
      setTimeout.mockRestore();
    }
  });
});

// ===========================================================================
// §3a — THE NOTICE RECORDS ITSELF
// ===========================================================================

describe('fix-589 §3a — shown, dismissed, acted', () => {
  it('★★★ records that it was SHOWN — the fact nothing recorded before', () => {
    markNewBuildLive();
    render(<NewBuildNotice />);
    expect(screen.getByTestId('new-build-notice')).toBeInTheDocument();
    expect(recordClientBuild).toHaveBeenCalledWith('shown');
  });

  it('★★ once per appearance, not once per render', () => {
    // Otherwise `notice_shown_count` measures React re-renders — a number that
    // looks like evidence and is not.
    markNewBuildLive();
    const { rerender } = render(<NewBuildNotice />);
    rerender(<NewBuildNotice />);
    rerender(<NewBuildNotice />);
    const shown = recordClientBuild.mock.calls.filter((c) => c[0] === 'shown');
    expect(shown).toHaveLength(1);
  });

  it('★★★ records that it was DISMISSED, and hides without reloading', () => {
    markNewBuildLive();
    render(<NewBuildNotice />);
    fireEvent.click(screen.getByTestId('new-build-dismiss'));
    expect(recordClientBuild).toHaveBeenCalledWith('dismissed');
    expect(screen.queryByTestId('new-build-notice')).not.toBeInTheDocument();
    expect(reloadOntoNewBuild).not.toHaveBeenCalled();
  });

  it('★★★ records that it was ACTED ON — before the navigation starts', () => {
    // A reload tears the document down, so recording after it would be a race
    // that loses most of the time. The order is the assertion.
    markNewBuildLive();
    render(<NewBuildNotice />);
    fireEvent.click(screen.getByTestId('new-build-reload'));
    expect(recordClientBuild).toHaveBeenCalledWith('reloaded');
    expect(reloadOntoNewBuild).toHaveBeenCalledTimes(1);
    const reloadedAt = recordClientBuild.mock.invocationCallOrder[
      recordClientBuild.mock.calls.findIndex((c) => c[0] === 'reloaded')
    ] as number;
    expect(reloadedAt).toBeLessThan(reloadOntoNewBuild.mock.invocationCallOrder[0] as number);
  });
});

// ===========================================================================
// §3b — THE LADDER, ON SCREEN
// ===========================================================================

describe('fix-589 §3b — the copy changes as the build ages', () => {
  it('★★★ the STEP on the ribbon climbs with the age — asserted as the step', () => {
    for (const [age, step] of [
      [0, 'ready'],
      [1, 'dated'],
      [4, 'behind'],
      [21, 'stale'],
    ] as const) {
      cleanup();
      buildAgeDays.mockReturnValue(age);
      markNewBuildLive();
      render(<NewBuildNotice />);
      expect(screen.getByTestId('new-build-notice').getAttribute('data-step')).toBe(step);
    }
  });

  it('★★ and the far rungs are the loud ones', () => {
    buildAgeDays.mockReturnValue(21);
    markNewBuildLive();
    render(<NewBuildNotice />);
    expect(screen.getByTestId('new-build-notice').getAttribute('data-tone')).toBe('loud');
  });

  it('★★★ NO step blocks work — the Reload control is never the only way out', () => {
    // *"do not add a step that blocks work."* At every rung the person can
    // dismiss and carry on, and the ribbon is a `role="status"` line, not a
    // dialog that takes focus.
    for (const age of [0, 1, 4, 21]) {
      cleanup();
      buildAgeDays.mockReturnValue(age);
      markNewBuildLive();
      render(<NewBuildNotice />);
      const notice = screen.getByTestId('new-build-notice');
      expect(notice.getAttribute('role')).toBe('status');
      expect(screen.getByTestId('new-build-dismiss')).toBeEnabled();
      expect(screen.getByTestId('new-build-reload')).toBeEnabled();
    }
  });
});

// ===========================================================================
// §4 — NOTHING RELOADS BY ITSELF
// ===========================================================================

describe('fix-589 §4 — nothing in this ticket reloads a page by itself', () => {
  it('★★★ mounting, polling, focusing and ageing all reload NOTHING', () => {
    // Bobby's standing ruling: auto-reloading discards what somebody is
    // typing. Exercised across every trigger fix-424 added AND at the oldest
    // rung of the new ladder, which is where the temptation would be.
    vi.useFakeTimers();
    try {
      buildAgeDays.mockReturnValue(99);
      markNewBuildLive();
      render(<NewBuildNotice />);
      act(() => {
        vi.advanceTimersByTime(BUILD_CHECK_FIRST_MS + 1);
      });
      act(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(60 * 60 * 1000);
      });
      expect(reloadOntoNewBuild).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// §A — THE ADMIN SURFACE
// ===========================================================================

const listClientBuilds = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useClientBuilds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useClientBuilds')>();
  return { ...actual, useClientBuilds: () => listClientBuilds() };
});

function row(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u-brittani',
    email: 'brittani@example.com',
    name: 'Brittani',
    build: 'aaa1111',
    // ★ Three weeks behind the viewer's own bundle — the reported case.
    built_at: new Date(Date.now() - 21 * 86_400_000).toISOString(),
    display_mode: 'standalone' as const,
    first_seen_at: new Date(Date.now() - 21 * 86_400_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    notice_shown_count: 63,
    notice_first_shown_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    notice_dismissed_at: null,
    notice_reloaded_at: new Date().toISOString(),
    ...over,
  };
}

describe('fix-589 §A — the admin surface answers the question', () => {
  it('★★★ lists a client behind the current build, AND says how far behind', () => {
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: { kind: 'ready', rows: [row()] },
    });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-builds-table')).toBeInTheDocument();
    // ★★ The number, not a vague "behind" — that is the brief's own word and
    //    it is what makes the screen actionable on a support call.
    expect(screen.getByTestId('client-build-behind-u-brittani').textContent).toMatch(
      /^2[01] days$/,
    );
    expect(screen.getByTestId('client-builds-summary').textContent).toMatch(/1.*behind/);
  });

  it('★★★ and says whether they were in the INSTALLED APP or a tab', () => {
    // The column the whole ticket is for. An installed window is never closed,
    // which is the difference between "their reload did nothing" and "they
    // reloaded a window that was already current".
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: { kind: 'ready', rows: [row()] },
    });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-build-row-u-brittani').textContent).toContain(
      'Installed app',
    );
  });

  it('★★★ "never shown" and "shown 63× · reloaded" read differently', () => {
    // The half that was unanswerable in principle. Brittani's own words were
    // *"I swear I hit that reload button 4–5x a day"* and nothing could confirm
    // or deny it.
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: { kind: 'ready', rows: [row(), row({ user_id: 'u-quiet', notice_shown_count: 0 })] },
    });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-build-notice-u-brittani').textContent).toContain(
      'shown 63×',
    );
    expect(screen.getByTestId('client-build-notice-u-brittani').textContent).toContain(
      'reloaded',
    );
    expect(screen.getByTestId('client-build-notice-u-quiet').textContent).toBe(
      'never shown',
    );
  });

  it('★★★ with the migration UNAPPLIED it says so — never an empty all-clear', () => {
    // The state of production from merge until Bobby runs it. An empty table
    // here would read as "everybody is current", which is fix-588's injury in
    // a new costume: a surface reporting success for work that never happened.
    listClientBuilds.mockReturnValue({ isLoading: false, data: { kind: 'unavailable' } });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-builds-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('client-builds-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('client-builds-summary')).not.toBeInTheDocument();
  });

  it('★★ a refusal reads as "admin only", not as an outage', () => {
    listClientBuilds.mockReturnValue({ isLoading: false, data: { kind: 'refused' } });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-builds-refused')).toBeInTheDocument();
  });

  it('★ a recorded, genuinely-empty roster is a DIFFERENT sentence', () => {
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: { kind: 'ready', rows: [] },
    });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getByTestId('client-builds-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('client-builds-unavailable')).not.toBeInTheDocument();
  });

  it('★★ one line per PERSON, not one per build they have ever run', () => {
    // A heartbeat row exists for every build somebody has used. The question is
    // what they are running NOW, and the RPC already orders by last_seen_at.
    listClientBuilds.mockReturnValue({
      isLoading: false,
      data: {
        kind: 'ready',
        rows: [row({ build: 'newest' }), row({ build: 'older' })],
      },
    });
    render(<ClientBuildsPanel />, { wrapper });
    expect(screen.getAllByTestId(/^client-build-row-/)).toHaveLength(1);
    expect(screen.getByTestId('client-build-row-u-brittani').textContent).toContain(
      'newest',
    );
  });
});
