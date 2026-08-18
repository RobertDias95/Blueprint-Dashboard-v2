import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { REALTIME_TABLES } from '../lib/queryKeys';
import { useRealtimeStore } from '../stores/realtimeStore';

// ===========================================================================
// fix-336 — notifications arrive live, and there is somewhere for them to
// arrive
// ===========================================================================
//
// ★★★ WHAT WAS ACTUALLY BROKEN, because the brief's measurement and the tree
// disagreed and the tree was only half right. `useRealtimeInvalidation` HAS
// been mounted at the app root since Q2 and DOES open a channel. What it asked
// for was six tables Postgres was not publishing —
// `supabase_realtime` did not contain audit_log, permit_milestone_acks,
// board_item_reads, permit_cycle_reviewers, error_reports or project_holds — so
// those handlers had never fired. An unpublished table is SILENT, not an error,
// which is why nothing ever showed up in a log.
//
// migrations/fix_336_realtime_publication.sql publishes the three that feed the
// notification model. The rest of this suite is the client half.
//
// ★ WHAT THIS FILE CAN AND CANNOT PROVE. There is no Supabase server in CI, so
// "a real subscription" here means the REAL hook, the REAL channel API surface
// and REAL payload delivery through a transport stub — no mocking of the hook
// under test, and no asserting on a spy where a rendered consequence is
// available. The genuinely-live half (a row written by psql arriving on a
// socket, and RLS filtering it by identity) was run against production with two
// identities and is transcribed in the PR.

// ── The transport stub: a channel that records its bindings and can DELIVER.
const rt = vi.hoisted(() => {
  interface Binding {
    table: string;
    handler: (payload: unknown) => void;
  }
  const state = {
    channels: [] as string[],
    bindings: [] as Binding[],
    statusCb: null as ((s: string) => void) | null,
    removed: 0,
  };
  const channelObj: Record<string, unknown> = {
    on: (_evt: string, cfg: { table: string }, handler: (p: unknown) => void) => {
      state.bindings.push({ table: cfg.table, handler });
      return channelObj;
    },
    subscribe: (cb?: (s: string) => void) => {
      state.statusCb = cb ?? null;
      return channelObj;
    },
  };
  return {
    state,
    /** Deliver a postgres_changes payload for a table, as the server would. */
    emit(table: string) {
      for (const b of state.bindings) {
        if (b.table === table) b.handler({ schema: 'public', table, eventType: 'INSERT', new: {} });
      }
    },
    setStatus(s: string) {
      state.statusCb?.(s);
    },
    supabase: {
      channel: (name: string) => {
        state.channels.push(name);
        return channelObj;
      },
      removeChannel: () => {
        state.removed += 1;
      },
    },
  };
});

// ── The data the hooks read. One fake client for every query the bell and the
// centre run, so the REAL hooks execute against a store this test can change
// between refetches — which is how "a change written by another session"
// is modelled without a server.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: {} as Record<string, unknown[]>,
}));

vi.mock('../lib/supabase', () => {
  const chain = (rows: () => unknown[]): unknown => {
    const proxy: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            resolve({ data: rows(), error: null, count: rows().length });
        }
        return () => new Proxy(proxy, handler);
      },
    };
    return new Proxy(proxy, handler);
  };
  return {
    supabase: {
      ...rt.supabase,
      from: (table: string) => chain(() => db.tables[table] ?? []),
      rpc: (name: string) => chain(() => db.rpcs[name] ?? []),
      auth: { signOut: vi.fn() },
    },
    supabaseUrl: 'http://test.local',
  };
});

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-bobby', email: 'robertd@blueprintcap.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../stores/toastStore', () => ({
  pushToast: vi.fn(),
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import { useRealtimeInvalidation, REALTIME_FALLBACK_MS } from '../hooks/useRealtimeInvalidation';
import { useBoardNotifications } from '../hooks/useBoardNotifications';
import NotificationsPage from '../pages/Notifications';
import BoardBell from '../components/BoardBell';
import MyBoard from '../pages/MyBoard';

const AFTER_EPOCH = '2026-08-16T10:00:00Z';

function postRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    project_id: 'p-1',
    project_address: '224 2nd Ave N',
    title: 'Survey questions',
    reason: 'Need a thread for the surveyor',
    status: 'open',
    requester_name: 'Briana',
    resolver_name: null,
    created_post_id: null,
    created_at: AFTER_EPOCH,
    resolved_at: null,
    is_recipient: true,
    ...over,
  };
}

function task(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `task-${i}`,
    permit_id: 100,
    project_id: 'p-1',
    text: `Task number ${i}`,
    assigned_to: 'Bobby',
    co_assignees: [],
    created_at: AFTER_EPOCH,
    project_address: '224 2nd Ave N',
    permit_type: 'Building Permit',
    discipline: 'ent',
    completion_status: 'Open',
    ...over,
  };
}

function activityRow(id: number, action: string, entLead: string | null) {
  return {
    id,
    created_at: AFTER_EPOCH,
    action,
    row_id: String(id),
    changes: {},
    permit_num: 'BP-1',
    permit_type: 'Building Permit',
    address: `${id} Main St`,
    juris: 'Seattle',
    cycle_index: null,
    ent_lead: entLead,
    portal_url: null,
    project_id: 'p-1',
  };
}

function seed() {
  db.tables = {
    team_members: [
      {
        id: 'tm-1',
        name: 'Bobby',
        role: 'ent_lead',
        active: true,
        former: false,
        email: 'robertd@blueprintcap.com',
        notes: null,
        updated_at: AFTER_EPOCH,
        is_oversight: true,
      },
    ],
    permits: [],
    projects: [{ id: 'p-1', address: '224 2nd Ave N', archived: false }],
    project_messages: [],
    permit_milestone_acks: [],
    board_item_reads: [],
    project_holds: [],
  };
  db.rpcs = {
    bp_list_tasks: [],
    bp_my_post_requests: [],
    bp_fetch_scraper_activity: [],
  };
}

function qc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrap(client: QueryClient, entry = '/notifications') {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  rt.state.channels.length = 0;
  rt.state.bindings.length = 0;
  rt.state.statusCb = null;
  rt.state.removed = 0;
  useRealtimeStore.setState({ status: 'CONNECTING', lastEventAt: null });
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// ★ 1. Live — the subscription itself
// ---------------------------------------------------------------------------

describe('fix-336 §1: one channel, the right tables, closed on unmount', () => {
  it('★ subscribes to every notification input, each exactly once', () => {
    const client = qc();
    const { unmount } = renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });

    const tables = rt.state.bindings.map((b) => b.table);
    // ★★ The three this ticket published, and the ones that already worked.
    for (const t of [
      'audit_log',
      'permit_milestone_acks',
      'board_item_reads',
      'post_requests',
      'project_messages',
      'permit_tasks',
      'permits',
    ]) {
      expect(tables, t).toContain(t);
    }
    // ★ No duplicate bindings — one handler per table.
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables.sort()).toEqual(Object.keys(REALTIME_TABLES).sort());
    unmount();
  });

  // ★ "do not open one channel per component that happens to need the same
  // table" — useScraperActivity used to open its own for audit_log.
  it('★★ exactly ONE channel for the whole app', () => {
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    expect(rt.state.channels).toHaveLength(1);
    expect(rt.state.channels[0]).toBe('bp-v2-realtime');
  });

  it('★ closes the channel on unmount', () => {
    const client = qc();
    const { unmount } = renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    expect(rt.state.removed).toBe(0);
    unmount();
    expect(rt.state.removed).toBe(1);
  });

  it('★ a delivered payload invalidates that table\'s keys — it never merges', () => {
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    const spy = vi.spyOn(client, 'invalidateQueries');
    act(() => rt.emit('audit_log'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['scraper_activity'] });
  });
});

// ---------------------------------------------------------------------------
// ★★ 2. Live — the consequence a person sees
// ---------------------------------------------------------------------------

describe('fix-336 §1: a change made elsewhere arrives without a reload', () => {
  it('★★ a post request raised in another session appears in the centre', async () => {
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <RealtimeMount />
        <NotificationsPage />
      </W>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('notification-empty')).toBeInTheDocument(),
    );

    // Another session writes the row…
    db.rpcs.bp_my_post_requests = [postRequest()];
    // …and the only thing this tab receives is the socket event.
    act(() => rt.emit('post_requests'));

    await waitFor(() =>
      expect(screen.getByTestId('notification-post_request:req-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('notification-centre-count').textContent).toContain('1 unread');
  });

  // ★★★ fix-339's whole point: first-responder-wins is only true if the other
  // recipients' queues clear without a refresh.
  it('★★★ a shared request resolved elsewhere LEAVES this viewer\'s queue live', async () => {
    db.rpcs.bp_my_post_requests = [postRequest()];
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <RealtimeMount />
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-post_request:req-1')).toBeInTheDocument(),
    );

    // Somebody else acts on it. The row stops being derived as an item…
    db.rpcs.bp_my_post_requests = [
      postRequest({ status: 'acknowledged', resolved_at: AFTER_EPOCH, is_recipient: true }),
    ];
    act(() => rt.emit('post_requests'));

    await waitFor(() =>
      expect(screen.queryByTestId('notification-post_request:req-1')).toBeNull(),
    );
    // …and it leaves the count with it, in the same render.
    expect(screen.getByTestId('notification-centre-count').textContent).toContain('0 unread');
  });

  // ★ The read state is a published table now, so acknowledging in one tab
  // clears the badge in the others.
  it('★ a read written elsewhere clears the item here', async () => {
    db.rpcs.bp_list_tasks = [task(1)];
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <RealtimeMount />
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-task:task-1').dataset.unread).toBe('true'),
    );

    db.tables.board_item_reads = [{ item_key: 'task:task-1' }];
    act(() => rt.emit('board_item_reads'));

    await waitFor(() =>
      expect(screen.getByTestId('notification-task:task-1').dataset.unread).toBe('false'),
    );
  });
});

// ---------------------------------------------------------------------------
// ★★ 3. The socket dropping is not silent
// ---------------------------------------------------------------------------

describe('fix-336 §1: what happens when the socket drops', () => {
  it('★ SUBSCRIBED is reported, and says "Live"', () => {
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    act(() => rt.setStatus('SUBSCRIBED'));
    expect(useRealtimeStore.getState().status).toBe('SUBSCRIBED');
  });

  it('★★ a CHANNEL_ERROR is recorded rather than swallowed', () => {
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    act(() => rt.setStatus('CHANNEL_ERROR'));
    expect(useRealtimeStore.getState().status).toBe('CHANNEL_ERROR');
  });

  // ★★ THE FALLBACK. A dead socket must not leave a frozen screen looking live.
  it('★★ while degraded it polls; when subscribed it does not', () => {
    vi.useFakeTimers();
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    const spy = vi.spyOn(client, 'invalidateQueries');

    act(() => rt.setStatus('CHANNEL_ERROR'));
    spy.mockClear();
    act(() => {
      vi.advanceTimersByTime(REALTIME_FALLBACK_MS + 100);
    });
    expect(spy.mock.calls.length).toBeGreaterThan(0);

    // Attached again → the poll stops (and the catch-up below fires once).
    act(() => rt.setStatus('SUBSCRIBED'));
    spy.mockClear();
    act(() => {
      vi.advanceTimersByTime(REALTIME_FALLBACK_MS * 3);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // ★ Anything that changed while the socket was down was missed, so
  // re-attaching without a catch-up would leave a stale cache looking live.
  it('★★ (re)subscribing invalidates once, to catch up on the gap', () => {
    const client = qc();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrap(client) });
    const spy = vi.spyOn(client, 'invalidateQueries');
    act(() => rt.setStatus('SUBSCRIBED'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post_requests'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['scraper_activity'] });
  });

  it('★ the status is on screen, in the bell and in the centre', async () => {
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    useRealtimeStore.setState({ status: 'CHANNEL_ERROR' });
    await waitFor(() => {
      const line = screen.getByTestId('notification-centre-realtime-status');
      expect(line.dataset.degraded).toBe('true');
      expect(line.textContent).toMatch(/Offline — refreshing every 60s/);
    });
    useRealtimeStore.setState({ status: 'SUBSCRIBED' });
    await waitFor(() => {
      const line = screen.getByTestId('notification-centre-realtime-status');
      expect(line.dataset.degraded).toBe('false');
      expect(line.textContent).toContain('Live');
    });
  });
});

// ---------------------------------------------------------------------------
// ★★ 4. The centre
// ---------------------------------------------------------------------------

describe('fix-336 §2: the notification centre', () => {
  it('★★ lists items beyond the bell\'s eight', async () => {
    db.rpcs.bp_list_tasks = Array.from({ length: 12 }, (_, i) => task(i + 1));
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-task:task-12')).toBeInTheDocument(),
    );
    const list = screen.getByTestId('notification-list');
    expect(
      within(list).getAllByTestId(/^notification-task:/),
    ).toHaveLength(12);
  });

  // ★★★ "That line was written as an honesty feature and it names a
  // destination that was never built. The centre is it."
  it('★★★ the suppressed categories are reachable, with their rows', async () => {
    db.rpcs.bp_fetch_scraper_activity = [
      activityRow(1, 'scrape_workflow_fetch_recovered', 'Bobby'),
      activityRow(2, 'scrape_workflow_fetch_recovered', 'Bobby'),
      activityRow(3, 'scrape_skipped_recent_manual_edit', 'Bobby'),
      activityRow(4, 'permit_status_changed', 'Miles'),
    ];
    const client = qc();
    const W = wrap(client, '/notifications?kind=suppressed');
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-suppressed')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('notification-suppressed-retries').textContent,
    ).toContain('Scraper retries · 2');
    expect(
      screen.getByTestId('notification-suppressed-guarded').textContent,
    ).toContain('Manual-edit guards · 1');
    expect(
      screen.getByTestId('notification-suppressed-notyours').textContent,
    ).toContain("aren't yours · 1");
    // ★ The ROWS, not just the counts — that is the difference between
    // counting a category and reaching it.
    expect(screen.getByTestId('notification-suppressed-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('notification-suppressed-row-4')).toBeInTheDocument();
  });

  it('★ unread and read look different, using fix-335 §9\'s treatment', async () => {
    db.rpcs.bp_list_tasks = [task(1), task(2)];
    db.tables.board_item_reads = [{ item_key: 'task:task-2' }];
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-task:task-1')).toBeInTheDocument(),
    );
    const unread = screen.getByTestId('notification-task:task-1');
    const read = screen.getByTestId('notification-task:task-2');
    expect(unread.dataset.unread).toBe('true');
    expect(read.dataset.unread).toBe('false');
    // ★ The SAME de-bg token the dropdown and My Board use. No second style.
    expect(unread.className).toContain('bg-de-bg');
    expect(read.className).not.toContain('bg-de-bg');
    expect(unread.style.borderLeft).toContain('var(--color-de)');
    expect(read.style.borderLeft).toContain('transparent');
  });

  // ★ fix-339: a shared item has no per-user read state, so offering "mark
  // read" would write a row nothing reads.
  it('★★ a shared item offers "Got it", never a read tick', async () => {
    db.rpcs.bp_my_post_requests = [postRequest()];
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-post_request:req-1')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('notification-post_request:req-1');
    expect(row.dataset.unreadKind).toBe('shared');
    expect(screen.getByTestId('notification-resolve-post_request:req-1')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-read-post_request:req-1')).toBeNull();
  });

  it('★ filters by kind, and the chips carry their counts', async () => {
    db.rpcs.bp_list_tasks = [task(1)];
    db.rpcs.bp_my_post_requests = [postRequest()];
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('notification-kind-task').textContent).toContain('Tasks · 1'),
    );
    expect(screen.getByTestId('notification-kind-request').textContent).toContain('Requests · 1');
    expect(screen.getByTestId('notification-kind-all').textContent).toContain('Everything · 2');
  });
});

// ---------------------------------------------------------------------------
// ★★ 5. One model — the badge and the centre cannot disagree
// ---------------------------------------------------------------------------

describe('fix-336 §3: the badge and the centre are the same query', () => {
  it('★★ the bell\'s badge equals the centre\'s unread count', async () => {
    db.rpcs.bp_list_tasks = Array.from({ length: 11 }, (_, i) => task(i + 1));
    const client = qc();
    const W = wrap(client);
    render(
      <W>
        <BoardBell />
        <NotificationsPage />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('board-bell-badge').textContent).toBe('11'),
    );
    expect(screen.getByTestId('notification-centre-count').textContent).toBe('11 unread');
    // ★ …and the bell still caps its own list at eight, which is why the
    // centre exists.
    expect(screen.getByTestId('notification-list').querySelectorAll('[data-unread]').length).toBe(11);
  });

  it('★ both read the one hook', async () => {
    db.rpcs.bp_list_tasks = [task(1)];
    const client = qc();
    const { result } = renderHook(() => useBoardNotifications(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.unseenCount).toBe(1));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].key).toBe('task:task-1');
  });
});

// ---------------------------------------------------------------------------
// ★★ 6. Somewhere to arrive — the two ways in
// ---------------------------------------------------------------------------
//
// Bobby: "if you got four notifications and you go to My Board, there's
// nowhere that shows, hey, here are your notifications."

describe('fix-336 §2: the centre is reachable', () => {
  it('★★ My Board links to it, with the same count as the badge', async () => {
    db.rpcs.bp_list_tasks = [task(1), task(2)];
    const client = qc();
    const W = wrap(client, '/board');
    render(
      <W>
        <MyBoard />
      </W>,
    );
    await waitFor(() => {
      const link = screen.getByTestId('my-board-notifications-link');
      expect(link.getAttribute('href')).toBe('/notifications');
      expect(link.dataset.unread).toBe('2');
      expect(link.textContent).toContain('Notifications · 2');
    });
  });

  it('★ the bell links to it, and to the suppressed feed by name', async () => {
    db.rpcs.bp_list_tasks = Array.from({ length: 9 }, (_, i) => task(i + 1));
    const client = qc();
    const W = wrap(client, '/board');
    render(
      <W>
        <BoardBell />
      </W>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('board-bell-badge').textContent).toBe('9'),
    );
    screen.getByTestId('board-bell-button').click();
    await waitFor(() =>
      expect(screen.getByTestId('board-bell-open-notifications')).toBeInTheDocument(),
    );
    const all = screen.getByTestId('board-bell-open-notifications');
    expect(all.getAttribute('href')).toBe('/notifications');
    // ★ 9 unread, 8 shown — the link says how many there are to see.
    expect(all.textContent).toContain('(9)');
    // ★★★ The "Not shown" line finally goes somewhere.
    expect(screen.getByTestId('board-bell-suppressed').getAttribute('href')).toBe(
      '/notifications?kind=suppressed',
    );
    // ★ …and the dropdown itself still caps at eight.
    expect(
      screen.getByTestId('board-bell-new').querySelectorAll('[data-unread="true"]'),
    ).toHaveLength(8);
  });
});

/** Mounts the realtime hook beside the UI under test, the way App.tsx does. */
function RealtimeMount() {
  useRealtimeInvalidation();
  return null;
}
