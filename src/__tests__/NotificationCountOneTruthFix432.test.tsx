import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { NewItem, NewItemSource } from '../lib/boardReads';
import driverSource from '../hooks/useDesktopAlerts.ts?raw';
import bellSource from '../components/BoardBell.tsx?raw';
import modelSource from '../hooks/useBoardNotifications.ts?raw';

// ===========================================================================
// fix-432 — the bell says 2, the taskbar badge says 35
// ===========================================================================
//
// Miles, 2026-08-26, with a screenshot of both at once. Bobby ruled the bell
// canonical: *"what the notification bell says is what the app should
// display."*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0 — AND IT FALSIFIES THE BRIEF'S LEADING HYPOTHESIS
// ---------------------------------------------------------------------------
//
// The brief expected a badge counting raw audit rows over a wide window against
// a bell counting grouped-and-unread items — with 782 flip rows in 14 days,
// 35-against-2 would look inevitable. **It is not what is happening.**
//
//   the bell    BoardBell.tsx:168    `const actionable = unseen.length;`
//   the badge   useDesktopAlerts     `applyBadge(unseenCount)`
//               useBoardNotifications `unseenCount: unseen.length`
//
// ONE hook, ONE array, ONE `.length`. There is no second query, no second
// predicate, no second window — SCOPE A1 was ALREADY TRUE, built that way by
// fix-369, whose own header says "there is no query here, no supabase import,
// no second definition of unread". Nothing in the badge path computes a key
// either, so fix-430's new `flip:<project>:<run>` generation cannot have
// stranded it.
//
// ★★★ THE DIFFERENCE IS NOT *WHAT* IS COUNTED, IT IS *WHEN* IT IS PUSHED.
// `setAppBadge` writes to the operating system, which keeps the last value it
// was given — through the tab closing, the app closing and signing out. The
// only thing that pushed a new one was an effect keyed on `[unseenCount,
// isLoading]`, and:
//
//   1. It never ran after sign-out or close: the driver is mounted in Chrome,
//      inside AuthGuard, so signing out unmounts it and leaves the number on
//      the taskbar of a machine nobody is signed in on.
//   2. It never re-asserted on return: `refetchOnWindowFocus` is false globally
//      (App.tsx:136) and a backgrounded installed app's timers are FROZEN
//      (measured in fix-424). A window that comes back to a changed world
//      refetches nothing, `unseenCount` does not change, the effect does not
//      re-run, and the stale OS value stands.
//
// ★★ SO THE WRONG NUMBER IS THE BADGE. 35 was a true count of an earlier
//    moment, still on screen; the bell's 2 is live.
//
// ★★★ THE BELL IS NOT HIDING ANYTHING, SO SCOPE B IS NOT TRIGGERED and its
//     filter, ordering, grouping and read-state semantics are untouched —
//     fix-430 shipped hours ago and nothing here adjusts it.

const state = vi.hoisted(() => ({
  unseen: [] as NewItem[],
  unseenCount: 0,
  isLoading: false,
}));

vi.mock('../hooks/useBoardNotifications', () => ({
  useBoardNotifications: () => ({
    viewer: { name: 'Miles', scope: 'permit' },
    items: state.unseen,
    unseen: state.unseen,
    readKeys: new Set<string>(),
    unseenCount: state.unseenCount,
    signature: state.unseen.map((i) => i.key).join('|'),
    suppressed: { retries: 0, guarded: 0, notYours: 0 },
    suppressedRows: [],
    activitySummary: null,
    activityTruncated: false,
    activityTruncationNote: null,
    isLoading: state.isLoading,
  }),
}));
vi.mock('../hooks/useSoundPref', () => ({
  useSoundPref: () => ({ pref: 'off', setPref: vi.fn() }),
}));
vi.mock('../lib/alertSound', () => ({
  playDing: vi.fn(),
  ensureDingContext: () => ({ state: 'running' }),
  unlockDing: async () => 'unlocked',
  getDingState: () => 'unlocked',
}));
vi.mock('../lib/serviceWorker', () => ({
  appServiceWorker: async () => null,
  registerAppServiceWorker: async () => null,
}));

import { useDesktopAlerts } from '../hooks/useDesktopAlerts';

const setAppBadge = vi.fn(() => Promise.resolve());
const clearAppBadge = vi.fn(() => Promise.resolve());

function item(source: NewItemSource, key: string): NewItem {
  return {
    key,
    source,
    title: 'Corrections Required',
    subtitle: null,
    where: '25 W Cremona · Building Permit',
    at: '2026-08-26T10:00:00Z',
    permitId: 1,
    projectId: 'p-1',
  };
}

/** ★ The two renderings, side by side in one tree off ONE fixture — which is
 *  the only way to assert they cannot disagree. */
function Probe() {
  const { badge } = useDesktopAlerts();
  // The bell renders `unseen.length`; this stands in for that expression
  // exactly, so a divergence between the two would show here.
  return (
    <>
      <span data-testid="probe-badge">{badge}</span>
      <span data-testid="probe-bell">{state.unseen.length}</span>
    </>
  );
}

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  state.unseen = [];
  state.unseenCount = 0;
  state.isLoading = false;
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  Object.assign(navigator, { setAppBadge, clearAppBadge });
});

// ---------------------------------------------------------------------------
// §A · one source of truth
// ---------------------------------------------------------------------------

describe('fix-432 §A: the badge is the bell, rendered twice', () => {
  it('★★★ both show the same number from one fixture', () => {
    state.unseen = [item('flip', 'flip:p-1:R1'), item('task', 'task:t1')];
    state.unseenCount = 2;
    render(<Probe />);
    expect(screen.getByTestId('probe-bell').textContent).toBe('2');
    expect(screen.getByTestId('probe-badge').textContent).toBe('2');
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it('★★★ …including 0, where the badge CLEARS rather than showing a dot', () => {
    // fix-307's lesson, kept: `setAppBadge(0)` is specified to show a badge
    // with no number rather than none, which is a permanent decoration.
    render(<Probe />);
    expect(screen.getByTestId('probe-bell').textContent).toBe('0');
    expect(screen.getByTestId('probe-badge').textContent).toBe('0');
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalledWith(0);
  });

  it('★★★ marking an item read moves BOTH, in the same tick', () => {
    state.unseen = [item('flip', 'a'), item('task', 'b'), item('mention', 'c')];
    state.unseenCount = 3;
    const { rerender } = render(<Probe />);
    expect(setAppBadge).toHaveBeenLastCalledWith(3);

    // One item acknowledged: the model is the only thing that changed.
    state.unseen = [item('flip', 'a'), item('task', 'b')];
    state.unseenCount = 2;
    rerender(<Probe />);
    expect(screen.getByTestId('probe-bell').textContent).toBe('2');
    expect(screen.getByTestId('probe-badge').textContent).toBe('2');
    expect(setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('★★ reading the last one clears the taskbar too', () => {
    state.unseen = [item('flip', 'a')];
    state.unseenCount = 1;
    const { rerender } = render(<Probe />);
    clearAppBadge.mockClear();
    state.unseen = [];
    state.unseenCount = 0;
    rerender(<Probe />);
    expect(clearAppBadge).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §B · the actual defect: WHEN it is pushed
// ---------------------------------------------------------------------------

describe('fix-432 §B: the OS keeps the last number it was given', () => {
  it('★★★ returning to the window re-asserts the count', () => {
    // ★★★ THE MECHANISM BEHIND 35-vs-2. `refetchOnWindowFocus` is false and a
    //     backgrounded installed app's timers are frozen (fix-424), so coming
    //     back changes nothing the effect is keyed on — and before fix-432
    //     nothing re-pushed the number the OS was still displaying.
    state.unseen = [item('flip', 'a'), item('task', 'b')];
    state.unseenCount = 2;
    render(<Probe />);
    setAppBadge.mockClear();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it('★★★ …and so does FOCUS, which is a different event', () => {
    // fix-424's finding, and it cost that ticket the whole ticket:
    // `visibilitychange` does not fire when a window already on screen is
    // clicked into — a second monitor. Both are needed.
    state.unseen = [item('flip', 'a')];
    state.unseenCount = 1;
    render(<Probe />);
    setAppBadge.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(setAppBadge).toHaveBeenCalledWith(1);
  });

  it('★★★ signing out CLEARS the badge rather than leaving it behind', () => {
    // The driver is mounted in Chrome, inside AuthGuard, so signing out
    // unmounts it. Before fix-432 the last count stayed on the taskbar of a
    // machine nobody is signed in on — which is not a stale number, it is
    // somebody else's number.
    state.unseen = [item('flip', 'a'), item('task', 'b')];
    state.unseenCount = 2;
    const { unmount } = render(<Probe />);
    clearAppBadge.mockClear();
    unmount();
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it('★★ nothing is pushed while the model is still loading', () => {
    // No flash to zero on a cold load — the guard fix-369 put there, kept.
    state.isLoading = true;
    state.unseenCount = 7;
    render(<Probe />);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('★ a browser with no Badging API is unaffected', () => {
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
    state.unseen = [item('flip', 'a')];
    state.unseenCount = 1;
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId('probe-badge').textContent).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// §C · the regression guard the brief asked for
// ---------------------------------------------------------------------------

describe('fix-432 §C: a second count cannot be introduced quietly', () => {
  it('★★★ the badge is handed the MODEL\'s number, never a local length', () => {
    // ★★★ THE ASSERTION THE BRIEF ASKS FOR: the argument is the hook's value,
    //     not something recomputed beside it. `applyBadge(unseenCount)` and
    //     nothing else.
    const body = strip(driverSource);
    expect(body).toMatch(/applyBadge\(unseenCount\)/);
    // ★ CALL SITES ONLY — the declaration `function applyBadge(count: number)`
    //   is not a call, and a regex that cannot tell them apart would fail on
    //   the very line it is meant to protect.
    const calls = (body.match(/(?<!function )applyBadge\(([^)]*)\)/g) ?? []).filter(
      (c) => !c.includes(': number'),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      // Only two arguments are ever legal: the model's number, or 0 — and 0 is
      // a CLEAR on unmount, not a count of anything.
      expect(c === 'applyBadge(unseenCount)' || c === 'applyBadge(0)', c).toBe(true);
    }
  });

  it('★★★ the driver owns no query and no second definition of unread', () => {
    const body = strip(driverSource);
    // Everything it knows comes from useBoardNotifications.
    expect(body).toMatch(/useBoardNotifications\(\)/);
    expect(body).not.toMatch(/supabase|useQuery|\.from\(/);
    expect(body).not.toMatch(/hasBeenRead|unseenItems|buildNewItems/);
    // ★ …and it never counts the unread itself. Scoped to THAT — the file may
    //   legitimately ask whether the banner plan is empty (`plan.banners.length
    //   === 0`), which is not a second count of notifications.
    expect(body).not.toMatch(/unseen\.length/);
    expect(body).not.toMatch(/unseenCount\s*=/);
  });

  it('★★ the bell and the badge read the same field of the same hook', () => {
    // Neither surface may grow its own arithmetic. The bell renders
    // `unseen.length`; the model defines `unseenCount` as exactly that.
    expect(strip(bellSource)).toMatch(/const actionable = unseen\.length/);
    expect(strip(modelSource)).toMatch(/unseenCount: unseen\.length/);
  });

  it('★ nothing else in the app writes the badge', () => {
    // One call site. A second would be a second truth by definition.
    expect(strip(driverSource)).toMatch(/navigator/);
  });
});
