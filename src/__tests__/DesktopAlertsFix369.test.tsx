import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NewItem, NewItemSource } from '../lib/boardReads';

// ===========================================================================
// fix-369 — the running app: banners, the ding, the badge, the permission
// ===========================================================================
//
// ★★★ The suite that has to be RENDERED rather than read. Three of the four
// things the brief calls out cannot be asserted from source text:
//
//   · permission is not requested on load — a claim about what HAPPENS, not
//     about what is written;
//   · a denial degrades cleanly — the bell, the badge and the centre keep
//     working, which means watching them keep working with permission denied;
//   · the badge reaches zero — a call, with an argument, at the right moment.

const state = vi.hoisted(() => ({
  unseen: [] as NewItem[],
  unseenCount: 0,
  isLoading: false,
  pref: 'mentions' as 'all' | 'mentions' | 'off',
  ding: vi.fn(),
  showNotification: vi.fn(),
  registration: true,
  markRead: vi.fn(),
}));

vi.mock('../hooks/useBoardNotifications', () => ({
  useBoardNotifications: () => ({
    viewer: { name: 'Bobby', scope: 'permit' },
    items: state.unseen,
    unseen: state.unseen,
    readKeys: new Set<string>(),
    unseenCount: state.unseenCount,
    signature: state.unseen.map((i) => i.key).join('|'),
    suppressed: { retries: 0, guarded: 0, notYours: 0 },
    suppressedRows: { retries: [], guarded: [], notYours: [] },
    isLoading: state.isLoading,
  }),
}));

vi.mock('../hooks/useSoundPref', () => ({
  useSoundPref: () => ({
    pref: state.pref,
    setPref: (p: 'all' | 'mentions' | 'off') => {
      state.pref = p;
    },
  }),
}));

vi.mock('../lib/alertSound', () => ({
  playDing: (...args: unknown[]) => state.ding(...args),
  ensureDingContext: () => ({ state: 'running' }),
  // ★ fix-371: the control now reads whether a ding can actually be HEARD, and
  // unlocks the context on the click rather than merely constructing one.
  // 'unlocked' keeps every expectation in this suite about fix-369's contracts
  // meaningful — the blocked path has its own tests in fix-371's suite.
  unlockDing: async () => 'unlocked',
  getDingState: () => 'unlocked',
  subscribeDingState: () => () => {},
}));

vi.mock('../lib/serviceWorker', () => ({
  registerAppServiceWorker: async () => null,
  appServiceWorker: async () =>
    state.registration
      ? ({ showNotification: state.showNotification } as unknown as ServiceWorkerRegistration)
      : null,
}));

vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [] as string[] }),
  useMarkBoardItemsRead: () => ({ mutate: state.markRead, isPending: false }),
}));
vi.mock('../hooks/usePostRequests', () => ({
  useMyPostRequests: () => ({ data: [], isLoading: false, error: null }),
  useResolvePostRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../components/RealtimeStatusLine', () => ({
  RealtimeStatusLine: () => <span data-testid="realtime-stub" />,
}));
vi.mock('../components/TaskProvenance', () => ({ default: () => null }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'bobby-uuid' }, activeTenantId: 't1' }),
}));

import { useDesktopAlerts } from '../hooks/useDesktopAlerts';
import NotificationsPage from '../pages/Notifications';

// ---------------------------------------------------------------------------
// The browser doubles. jsdom has neither Notification nor the Badging API, so
// both are installed here — which is also the honest picture of a browser that
// has one and not the other.
// ---------------------------------------------------------------------------

const setAppBadge = vi.fn(() => Promise.resolve());
const clearAppBadge = vi.fn(() => Promise.resolve());
const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));

function installBrowser(permission: NotificationPermission | null) {
  if (permission === null) {
    delete (window as unknown as Record<string, unknown>).Notification;
  } else {
    (window as unknown as Record<string, unknown>).Notification = {
      permission,
      requestPermission,
    };
  }
  Object.assign(navigator, { setAppBadge, clearAppBadge });
}

function item(source: NewItemSource, over: Partial<NewItem> = {}): NewItem {
  return {
    key: `${source}:1`,
    source,
    title: 'Mentioned you in chat',
    subtitle: 'can you check the tree report',
    where: '233 31st Ave E · Building Permit',
    at: '2026-08-20T10:00:00Z',
    permitId: null,
    projectId: 'p-1',
    target: { kind: 'message', projectId: 'p-1', messageId: 'msg-9' },
    ...over,
  };
}

/** A probe that does nothing but run the driver, the way Chrome does. */
function Probe() {
  const { badge } = useDesktopAlerts();
  return <span data-testid="probe-badge">{badge}</span>;
}

async function settle() {
  // The banner path awaits the registration, so let the microtasks drain.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  state.unseen = [];
  state.unseenCount = 0;
  state.isLoading = false;
  state.pref = 'mentions';
  state.ding = vi.fn();
  state.showNotification = vi.fn();
  state.registration = true;
  state.markRead = vi.fn();
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  requestPermission.mockClear();
  window.localStorage.clear();
  installBrowser('granted');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §1 — banners, and only for what arrived while you were here
// ---------------------------------------------------------------------------

describe('fix-369 §1: banners while the app is open', () => {
  it('★★★ the backlog on arrival raises nothing', async () => {
    state.unseen = [item('mention', { key: 'm1' }), item('mention', { key: 'm2' })];
    state.unseenCount = 2;
    render(<Probe />);
    await settle();
    expect(state.showNotification).not.toHaveBeenCalled();
    expect(state.ding).not.toHaveBeenCalled();
    // ★ …but the taskbar still says two are waiting. A count is not an
    // interruption, which is why it needs no seeding rule.
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it('★★★ something arriving after that DOES raise one, once', async () => {
    state.unseen = [item('mention', { key: 'm1' })];
    state.unseenCount = 1;
    const view = render(<Probe />);
    await settle();

    state.unseen = [item('mention', { key: 'm1' }), item('mention', { key: 'm2' })];
    state.unseenCount = 2;
    view.rerender(<Probe />);
    await settle();

    expect(state.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = state.showNotification.mock.calls[0];
    expect(title).toBe('Mentioned you in chat');
    expect(options.body).toBe(
      'can you check the tree report · 233 31st Ave E · Building Permit',
    );
    // ★★ fix-362's target, unchanged — the banner lands where the centre's
    // row lands, because it is the same item and the same function.
    expect(options.data.url).toBe('/project/p-1?msg=msg-9');
    expect(options.tag).toBe('m2');
    // ★★ Silent at the OS level: this app's sound rule is not the OS's.
    expect(options.silent).toBe(true);
    expect(state.ding).toHaveBeenCalledTimes(1);

    // ★ And re-rendering with the same list announces nothing further.
    view.rerender(<Probe />);
    await settle();
    expect(state.showNotification).toHaveBeenCalledTimes(1);
  });

  it('★★★ a reaction digest banners but NEVER dings', async () => {
    // fix-360 made fifteen reactions one aggregating row so they would stop
    // being fifteen interruptions. A ding here would undo that.
    state.pref = 'all';
    state.unseen = [];
    const view = render(<Probe />);
    await settle();

    state.unseen = [
      item('reaction', {
        key: 'reaction:msg-1:2026-08-20T10:00:00Z',
        title: '15 reactions on your post',
      }),
    ];
    state.unseenCount = 1;
    view.rerender(<Probe />);
    await settle();

    expect(state.showNotification).toHaveBeenCalledTimes(1);
    expect(state.ding).not.toHaveBeenCalled();
  });

  it('★ nothing breaks when there is no service worker', async () => {
    state.registration = false;
    const view = render(<Probe />);
    await settle();
    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    view.rerender(<Probe />);
    await settle();
    // No banner, but the sound and the badge are untouched by its absence.
    expect(state.showNotification).not.toHaveBeenCalled();
    expect(state.ding).toHaveBeenCalledTimes(1);
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// §2 — ★★★ a denial leaves the mechanism intact
// ---------------------------------------------------------------------------

describe('fix-369 §2: a denied permission degrades cleanly', () => {
  it('★★★ no banner — but the sound and the badge still work', async () => {
    installBrowser('denied');
    const view = render(<Probe />);
    await settle();

    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    view.rerender(<Probe />);
    await settle();

    expect(state.showNotification).not.toHaveBeenCalled();
    // ★★ Deliberate: someone who refused BANNERS did not refuse being told.
    // Coupling them would silently remove a second feature.
    expect(state.ding).toHaveBeenCalledTimes(1);
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
    expect(screen.getByTestId('probe-badge').textContent).toBe('1');
  });

  it('★★ …and the notification centre lists everything, as before', () => {
    installBrowser('denied');
    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('notification-centre-count').textContent).toContain(
      '1 unread',
    );
    expect(screen.getByText('Mentioned you in chat')).toBeInTheDocument();
    // The control says so out loud rather than leaving a dead switch.
    expect(screen.getByTestId('desktop-alerts-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-alerts-enable')).toBeNull();
  });

  it('★ a browser with no Notification API at all is fine too', async () => {
    installBrowser(null);
    const view = render(<Probe />);
    await settle();
    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    view.rerender(<Probe />);
    await settle();
    expect(state.showNotification).not.toHaveBeenCalled();
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — ★★★ the permission prompt
// ---------------------------------------------------------------------------

describe('fix-369 §3: permission is asked from a control, never on load', () => {
  it('★★★ rendering the notification centre asks for NOTHING', () => {
    installBrowser('default');
    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    // ★★★ A prompt on first paint is the one everybody denies, and a denial is
    // STICKY — there is no shipping a fix for it afterwards.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByTestId('desktop-alerts-enable')).toBeInTheDocument();
  });

  it('★★★ …and the button asks, once, on the click', () => {
    installBrowser('default');
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('desktop-alerts-enable'));
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('★★ running the alert driver never asks either', async () => {
    installBrowser('default');
    const view = render(<Probe />);
    await settle();
    state.unseen = [item('mention', { key: 'm2' })];
    state.unseenCount = 1;
    view.rerender(<Probe />);
    await settle();
    // Undecided is treated exactly like denied: no banner, no prompt.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(state.showNotification).not.toHaveBeenCalled();
  });

  it('★ the sound control offers three settings and shows the default', () => {
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    const select = screen.getByTestId('desktop-alerts-sound') as HTMLSelectElement;
    expect(select.value).toBe('mentions');
    expect(select.options).toHaveLength(3);
    fireEvent.change(select, { target: { value: 'off' } });
    expect(state.pref).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// §4 — ★★ the badge, and reaching zero
// ---------------------------------------------------------------------------

describe('fix-369 §4: the taskbar count', () => {
  it('★★ it CLEARS at zero rather than setting zero', async () => {
    // fix-307's lesson: a badge that never empties gets ignored.
    // setAppBadge(0) is specified to show a badge with no number, which would
    // be a permanent dot on the taskbar.
    state.unseen = [item('mention', { key: 'm1' })];
    state.unseenCount = 1;
    const view = render(<Probe />);
    await settle();
    expect(setAppBadge).toHaveBeenLastCalledWith(1);

    state.unseen = [];
    state.unseenCount = 0;
    view.rerender(<Probe />);
    await settle();
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalledWith(0);
    expect(screen.getByTestId('probe-badge').textContent).toBe('0');
  });

  it('★★ it is the same number the bell shows', async () => {
    state.unseen = [item('mention', { key: 'm1' }), item('flip', { key: 'f1' })];
    state.unseenCount = 2;
    render(<Probe />);
    await settle();
    // ★ Not a recount of anything — `unseenCount` is fix-360's own field, the
    // one BoardBell renders and the centre prints.
    expect(setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('★ nothing is set while the model is still loading', async () => {
    state.isLoading = true;
    state.unseenCount = 7;
    render(<Probe />);
    await settle();
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('★ a browser without the Badging API is unaffected', async () => {
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
    state.unseenCount = 3;
    expect(() => render(<Probe />)).not.toThrow();
    await settle();
  });
});
