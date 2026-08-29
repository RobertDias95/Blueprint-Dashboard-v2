import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { resetShowHeldWorkCache } from '../lib/heldWorkPref';
import { taskStatusUpsertInput } from '../lib/taskStatusWrite';
import {
  cancelTaskReconcile,
  taskReconcilePending,
  TASK_RECONCILE_DELAY_MS,
} from '../lib/taskReconcile';
import type { MyTaskNode } from '../lib/database.types';

// ===========================================================================
// fix-434 — the chip becomes the control, and the row stops stalling
// ===========================================================================
//
// P-063 (Bobby): the status chip should offer Not Started / In Progress /
// Resolved in place — "being able to just mark something off as Resolved,
// Resolved, Resolved". P-065 (Miles): the click-to-advance checkbox lags when
// clicked quickly.
//
// ★★★ THE MEASUREMENT IS THE TEST. This file drives the REAL page through a
// REAL `useUpsertTask` against a fake `supabase.rpc`, so it counts actual RPC
// calls and actual card renders rather than asserting a mock was poked. Every
// number in the PR body comes from here.

type TaskFixture = MyTaskNode & { bucket?: 'de' | 'pm' };

const store = vi.hoisted(() => ({
  /** The server's tasks. `bp_upsert_permit_task` mutates these. */
  rows: [] as Record<string, unknown>[],
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  /** Incremented once per TaskCard render — see the permitDiscriminator mock. */
  cardRenders: 0,
  /** When set, every upsert is refused with this message. */
  failWith: null as string | null,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      store.calls.push({ fn, args });
      if (fn === 'bp_list_tasks') {
        return Promise.resolve({ data: store.rows.slice(), error: null });
      }
      if (fn === 'bp_upsert_permit_task') {
        if (store.failWith) {
          return Promise.resolve({
            data: null,
            error: { message: store.failWith },
          });
        }
        const row = store.rows.find((t) => t.id === args.p_id);
        if (row) row.status = args.p_status;
        return Promise.resolve({ data: args.p_id, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

// ★ `taskPermitSuffix` is called exactly once per TaskCard body, so counting it
//   counts card renders without instrumenting the component under test.
vi.mock('../lib/permitDiscriminator', async (imp) => {
  const actual = await imp<typeof import('../lib/permitDiscriminator')>();
  return {
    ...actual,
    taskPermitSuffix: (...a: Parameters<typeof actual.taskPermitSuffix>) => {
      store.cardRenders += 1;
      return actual.taskPermitSuffix(...a);
    },
  };
});

const toasts = vi.hoisted(() => ({ list: [] as { msg: string; kind: string }[] }));
vi.mock('../stores/toastStore', async (imp) => {
  const actual = await imp<typeof import('../stores/toastStore')>();
  return {
    ...actual,
    pushToast: (msg: string, kind = 'info') => {
      toasts.list.push({ msg, kind });
    },
  };
});

vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTeamMembers', async (imp) => {
  const actual = await imp<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useProjectHolds', async (imp) => {
  const actual = await imp<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useWaitingOnTasks', async (imp) => {
  const actual = await imp<typeof import('../hooks/useWaitingOnTasks')>();
  return {
    ...actual,
    useWaitingOnTasks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

import MyTasks from '../pages/MyTasks';
import TaskStatusChip from '../components/MyTasks/TaskStatusChip';

function task(over: Partial<TaskFixture> & Pick<TaskFixture, 'id'>): TaskFixture {
  return {
    permit_id: 7,
    project_id: 'p1',
    project_address: '123 Main St',
    permit_type: 'Building Permit',
    parent_task_id: null,
    discipline: 'arch',
    text: `Task ${over.id}`,
    status: 'Open',
    start_date: '2026-05-01',
    target_date: '2026-06-15',
    done_at: null,
    sort_order: 0,
    primary_assignee: null,
    co_assignees: [],
    bucket: 'de',
    ...over,
  } as TaskFixture;
}

function renderIt() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<MyTasks />, { wrapper });
}

/** Let promise callbacks (and therefore react-query) settle. */
async function settle(passes = 20) {
  for (let i = 0; i < passes; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** ★ Wait for the FIRST load to finish. `MineTasks` renders six skeleton rows
 *  while `bp_list_tasks` is in flight, and a microtask flush is not a reliable
 *  way to wait for react-query — draining N microtasks passed some tests and
 *  not others in the same file. Waiting on the rendered state is. */
async function boardReady() {
  await waitFor(() =>
    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0),
  );
}

function upserts() {
  return store.calls.filter((c) => c.fn === 'bp_upsert_permit_task');
}
function listCalls() {
  return store.calls.filter((c) => c.fn === 'bp_list_tasks');
}

beforeEach(() => {
  store.rows = [];
  store.calls = [];
  store.cardRenders = 0;
  store.failWith = null;
  toasts.list = [];
  cancelTaskReconcile();
  useAuthStore.setState({
    user: { id: 'u-bobby', email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetShowHeldWorkCache();
});

afterEach(() => {
  // ★ The coalesced reconciler is a module-level timer. Left pending it would
  //   fire inside the NEXT test with that test's query client.
  cancelTaskReconcile();
});

// ---------------------------------------------------------------------------
// §A2 — one write path
// ---------------------------------------------------------------------------

describe('fix-434 §A2 — the chip and the checkbox write the same thing', () => {
  it('★★★ identical RPC arguments for the same transition, asserted on BOTH paths', async () => {
    const fixture = task({ id: 't1', status: 'Open' });

    // (1) the checkbox: Open → In Progress
    store.rows = [{ ...fixture }] as unknown as Record<string, unknown>[];
    const a = renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-toggle'));
    await settle();
    const viaCheckbox = upserts().map((c) => c.args);
    a.unmount();

    // (2) the chip, asking for the same status
    store.rows = [{ ...fixture }] as unknown as Record<string, unknown>[];
    store.calls = [];
    cancelTaskReconcile();
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-option-In-Progress'));
    await settle();
    const viaChip = upserts().map((c) => c.args);

    expect(viaCheckbox).toHaveLength(1);
    expect(viaChip).toHaveLength(1);
    // ★★★ Not "both set the status" — every argument, byte for byte. Two
    //     controls on one row that write different fields is the defect this
    //     ticket was told not to create.
    expect(viaChip[0]).toEqual(viaCheckbox[0]);
    expect(viaChip[0]).toMatchObject({
      p_id: 't1',
      p_permit_id: 7,
      p_status: 'In Progress',
      p_discipline: 'arch',
      p_bucket: 'de',
      p_text: 'Task t1',
      // ★★ fix-224: the RPC OVERWRITES these two, so a status-only write still
      //    has to carry them or it silently nulls a date.
      p_start_date: '2026-05-01',
      p_target_date: '2026-06-15',
    });
  });

  it('★★ the shared payload is what the detail-pane dropdown already sent', () => {
    // components/TaskDetailEditor `patch()` builds exactly this object for a
    // status change. Pinning it here means the three status controls in the app
    // cannot drift without a failing test.
    const t = task({ id: 't9', status: 'Open' });
    expect(taskStatusUpsertInput(t, 'Resolved')).toEqual({
      id: 't9',
      permitId: 7,
      parentTaskId: null,
      discipline: 'arch',
      bucket: 'de',
      text: 'Task t9',
      status: 'Resolved',
      startDate: '2026-05-01',
      targetDate: '2026-06-15',
      statusOnly: true,
    });
  });

  it('★ the audit is not skipped, because there is no second write path', async () => {
    store.rows = [task({ id: 't1' })] as unknown as Record<string, unknown>[];
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-option-Resolved'));
    await settle();
    // `permit_task_audit_trg` is an AFTER trigger on permit_tasks itself, so
    // the only way to skip it is to not write the table. Every status write
    // goes through this one RPC.
    expect(upserts()).toHaveLength(1);
    expect(store.calls.every((c) => c.fn.startsWith('bp_'))).toBe(true);
    expect(
      store.calls.some((c) => c.fn === 'bp_upsert_permit_task'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §A1/A3 — the control
// ---------------------------------------------------------------------------

describe('fix-434 §A — the chip is the control', () => {
  beforeEach(() => {
    store.rows = [task({ id: 't1', status: 'Open' })] as unknown as Record<
      string,
      unknown
    >[];
  });

  it('★★★ offers the trio in place — no dialog, no navigation', async () => {
    renderIt();
    await boardReady();
    const chip = screen.getByTestId('mytask-card-t1-status');
    expect(chip.textContent).toBe('Not Started');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    const menu = screen.getByTestId('mytask-card-t1-status-menu');
    expect(menu.getAttribute('role')).toBe('listbox');
    const options = Array.from(menu.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent?.replace(/^[○◐●]\s*/, ''),
    );
    expect(options).toEqual(['Not started', 'In Progress', 'Resolved']);
    // ★ Still on the same page, same list, nothing pushed onto history.
    expect(screen.getByTestId('mytask-card-t1')).toBeInTheDocument();
  });

  it('★★ opening the chip does NOT select the card underneath', async () => {
    renderIt();
    await boardReady();
    expect(
      screen.getByTestId('mytask-card-t1').getAttribute('data-selected'),
    ).toBe('false');
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    expect(
      screen.getByTestId('mytask-card-t1').getAttribute('data-selected'),
    ).toBe('false');
  });

  it('★★★ A3: keyboard operable — arrows move, Enter chooses, Escape closes', async () => {
    renderIt();
    await boardReady();
    // ★ Reveal Resolved rows first. Without this the assertion below cannot be
    //   made at all: choosing Resolved works so well the row leaves the Active
    //   view and takes the chip with it.
    fireEvent.click(screen.getByTestId('mytasks-filter-active'));
    const chip = screen.getByTestId('mytask-card-t1-status');
    // ArrowDown on the closed chip opens it…
    fireEvent.keyDown(chip, { key: 'ArrowDown' });
    const menu = screen.getByTestId('mytask-card-t1-status-menu');
    // …focused on the option the task is currently on.
    expect(document.activeElement).toBe(
      screen.getByTestId('mytask-card-t1-status-option-Open'),
    );
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByTestId('mytask-card-t1-status-option-In-Progress'),
    );
    fireEvent.keyDown(menu, { key: 'End' });
    const resolved = screen.getByTestId('mytask-card-t1-status-option-Resolved');
    expect(document.activeElement).toBe(resolved);
    // Enter on a <button role="option"> is a click.
    fireEvent.click(resolved);
    await settle();
    expect(upserts().map((c) => c.args.p_status)).toEqual(['Resolved']);
  });

  // ★ Focus return is asserted on the CHIP ALONE. On the board a status change
  //   moves the row to a different sub-column, which remounts the card and
  //   takes the focus with it — the row moving IS the feedback there, and no
  //   amount of ref juggling can hold focus through an unmount.
  it('★★ A3: focus returns to the chip after choosing', () => {
    render(
      <TaskStatusChip
        taskId="k1"
        status="Open"
        background="var(--color-s2)"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mytask-card-k1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-k1-status-option-Resolved'));
    expect(screen.queryByTestId('mytask-card-k1-status-menu')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByTestId('mytask-card-k1-status'),
    );
  });

  it('★ Escape closes without writing, and returns focus', async () => {
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.keyDown(screen.getByTestId('mytask-card-t1-status-menu'), {
      key: 'Escape',
    });
    expect(screen.queryByTestId('mytask-card-t1-status-menu')).toBeNull();
    expect(upserts()).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByTestId('mytask-card-t1-status'),
    );
  });

  it('★★ screen-reader labelled: the chip says what it is and what it does', async () => {
    renderIt();
    await boardReady();
    const chip = screen.getByTestId('mytask-card-t1-status');
    expect(chip.getAttribute('aria-haspopup')).toBe('listbox');
    expect(chip.getAttribute('aria-label')).toBe(
      'Status: Not Started. Change status',
    );
    fireEvent.click(chip);
    const current = screen.getByTestId('mytask-card-t1-status-option-Open');
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(
      screen
        .getByTestId('mytask-card-t1-status-option-Resolved')
        .getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('★★★ the chip can move a task BACKWARD, which the checkbox never could', async () => {
    store.rows = [task({ id: 't1', status: 'Resolved' })] as unknown as Record<
      string,
      unknown
    >[];
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytasks-filter-active')); // reveal Resolved
    // The checkbox is terminal at Resolved (fix-235) and stays that way.
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-toggle'));
    expect(upserts()).toHaveLength(0);
    // The chip is not.
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-option-Open'));
    await settle();
    expect(upserts().map((c) => c.args.p_status)).toEqual(['Open']);
  });

  // ★ Rendered DIRECTLY, not through the board. `BucketColumn` partitions by
  //   Open / In Progress / Resolved, so a 'Cancelled' row lands in no
  //   sub-column and the page never draws one — which is fix-262 working, and
  //   which would have made a page-level assertion here vacuous. The guard
  //   still has to hold, because the chip is shared and the permit bar's rows
  //   are the surface where a parked task does appear.
  it('★★ fix-262: a CANCELLED task shows a label, not a control', () => {
    const onSelect = vi.fn();
    render(
      <TaskStatusChip
        taskId="t1"
        status="Cancelled"
        background="var(--color-s2)"
        onSelect={onSelect}
      />,
    );
    const chip = screen.getByTestId('mytask-card-t1-status');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Cancelled');
    fireEvent.click(chip);
    expect(screen.queryByTestId('mytask-card-t1-status-menu')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §B — it must not stall
// ---------------------------------------------------------------------------

describe('fix-434 §B — speed', () => {
  it('★★★ B2: ten rapid clicks on the chip land on Resolved, written ONCE', async () => {
    store.rows = [task({ id: 't1', status: 'Open' })] as unknown as Record<
      string,
      unknown
    >[];
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    const option = screen.getByTestId('mytask-card-t1-status-option-Resolved');
    act(() => {
      for (let i = 0; i < 10; i++) fireEvent.click(option);
    });
    await settle();
    // ★ One write. Clicks 2-10 asked for the status the row is already on and
    //   the chip refuses to re-send it.
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].args.p_status).toBe('Resolved');
    expect(store.rows[0].status).toBe('Resolved');
  });

  it('★★★ B2: ten rapid clicks on the CHECKBOX land on Resolved — the pre-fix bug', async () => {
    store.rows = [task({ id: 't1', status: 'Open' })] as unknown as Record<
      string,
      unknown
    >[];
    renderIt();
    await boardReady();
    const box = screen.getByTestId('mytask-card-t1-status-toggle');
    act(() => {
      for (let i = 0; i < 10; i++) fireEvent.click(box);
    });
    await settle();
    // ★★★ MEASURED BEFORE THIS TICKET: ten writes, every one of them
    //     'In Progress', final state 'In Progress'. Ten handlers in one React
    //     batch all read the same stale prop.
    //
    // ★★★ NOW: two writes, one per REAL transition, and the eight clicks past
    //     Resolved are the no-ops fix-235 always intended. The server agrees.
    expect(upserts().map((c) => c.args.p_status)).toEqual([
      'In Progress',
      'Resolved',
    ]);
    expect(store.rows[0].status).toBe('Resolved');
  });

  it('★★★ B1: the burst costs ZERO refetches, and exactly one afterwards', async () => {
    vi.useFakeTimers();
    try {
      store.rows = Array.from({ length: 50 }, (_, i) =>
        task({ id: `t${i}` }),
      ) as unknown as Record<string, unknown>[];
      renderIt();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      store.calls = [];

      const box = screen.getByTestId('mytask-card-t0-status-toggle');
      act(() => {
        for (let i = 0; i < 10; i++) fireEvent.click(box);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // ★★★ Measured before: 10 × bp_list_tasks, each returning EVERY task in
      //     the tenant (1,643 rows / ~1.1 MB on prod). Now: none during the
      //     burst — the row moved optimistically, so nothing had to be fetched
      //     for it to move.
      expect(listCalls()).toHaveLength(0);
      expect(taskReconcilePending()).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASK_RECONCILE_DELAY_MS + 50);
      });
      // ★ One confirmation, after the clicking stops.
      expect(listCalls()).toHaveLength(1);
      expect(taskReconcilePending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('★★ B1: a click does not re-render the rest of the board', async () => {
    store.rows = Array.from({ length: 50 }, (_, i) =>
      task({ id: `t${i}` }),
    ) as unknown as Record<string, unknown>[];
    renderIt();
    await boardReady();
    store.cardRenders = 0;
    fireEvent.click(screen.getByTestId('mytask-card-t0-status-toggle'));
    // ★ The clicked row re-renders (it changed). Its 49 neighbours do not —
    //   `TaskCard` is memoised, `onSelect` is stable, and the overlay's actions
    //   context never changes identity. Measured without those three: 49.
    expect(store.cardRenders).toBeLessThanOrEqual(2);
  });

  it('★★★ B3: a refused write rolls the row back, visibly, and says so', async () => {
    store.rows = [task({ id: 't1', status: 'Open' })] as unknown as Record<
      string,
      unknown
    >[];
    renderIt();
    await boardReady();
    fireEvent.click(screen.getByTestId('mytasks-filter-active')); // keep Resolved visible
    store.failWith = 'permission denied for table permit_tasks';

    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-option-Resolved'));
    // Optimistically the row says Resolved straight away.
    expect(screen.getByTestId('mytask-card-t1-status').textContent).toBe(
      'Resolved',
    );

    await waitFor(() =>
      // …and once the server refuses, it is back to what the database holds.
      expect(screen.getByTestId('mytask-card-t1-status').textContent).toBe(
        'Not Started',
      ),
    );
    expect(store.rows[0].status).toBe('Open');
    // ★ And it SAYS so. A silent divergence is worse than the lag it replaced.
    expect(
      toasts.list.some(
        (t) => t.kind === 'error' && t.msg.includes('permission denied'),
      ),
    ).toBe(true);
    // ★★ A failure is never coalesced — the correcting refetch is immediate.
    expect(taskReconcilePending()).toBe(false);
    expect(listCalls().length).toBeGreaterThan(0);
  });

  it('★★ the row moves before any round trip has happened', async () => {
    store.rows = [task({ id: 't1', status: 'Open' })] as unknown as Record<
      string,
      unknown
    >[];
    renderIt();
    await boardReady();
    store.calls = [];
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-toggle'));
    // Synchronously, with nothing awaited: the chip already reads the new
    // status and NO list refetch has happened.
    expect(screen.getByTestId('mytask-card-t1-status').textContent).toBe(
      'In Progress',
    );
    expect(listCalls()).toHaveLength(0);
    await settle();
  });

  it('★★ the counters agree with the chip, not with the server lag', async () => {
    store.rows = [
      task({ id: 't1', status: 'Open' }),
      task({ id: 't2', status: 'Open' }),
    ] as unknown as Record<string, unknown>[];
    renderIt();
    await boardReady();
    const openCount = () =>
      screen.getByTestId('mytasks-counter-open').textContent ?? '';
    expect(openCount()).toContain('2');
    fireEvent.click(screen.getByTestId('mytask-card-t1-status'));
    fireEvent.click(screen.getByTestId('mytask-card-t1-status-option-Resolved'));
    // ★ fix-409's rule: what is counted and what is displayed must agree. The
    //   overlay is applied ABOVE the counters for exactly this reason.
    expect(openCount()).toContain('1');
    await settle();
  });
});

// ---------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------

import myTasksSrc from '../pages/MyTasks.tsx?raw';
import upsertSrc from '../hooks/useTaskTree.ts?raw';
import overlaySrc from '../lib/taskStatusOverlayContext.ts?raw';

/** Strip block, line and JSX comments — the files below discuss every symbol
 *  asserted on at length in prose. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-434 — source contract', () => {
  it('the stripper actually stripped', () => {
    expect(myTasksSrc).toContain('ONE write path, two entry points');
    expect(code(myTasksSrc)).not.toContain('ONE write path, two entry points');
  });

  it('★★★ the row has exactly ONE status writer left in it', () => {
    const src = code(myTasksSrc);
    // The card no longer builds its own upsert payload; both controls go
    // through the shared hook.
    expect(src).toContain('useSetTaskStatus');
    expect(src).not.toContain('nextCheckboxStatus');
    expect(src).not.toContain('useUpsertTask');
  });

  it('★★ the coalesced reconcile is opt-in, so nothing else changed', () => {
    const src = code(upsertSrc);
    // Only a statusOnly write defers; every other caller invalidates as before.
    expect(src).toMatch(/if \(input\.statusOnly\)\s*\{\s*scheduleTaskReconcile/);
    expect(src).toContain('queryKeys.permitTasksAll');
  });

  it("★★★ the rollback is in the MUTATION's onError, never a per-call one", () => {
    // ★ The per-call form was written first and silently never ran: an
    //   optimistic tick unmounts the card that called `mutate`, and React Query
    //   drops that call's callbacks. Pinned, because it looks correct.
    expect(code(upsertSrc)).toContain('clearStatusOverlay(input.id)');
    expect(code(myTasksSrc)).not.toContain('onError');
  });

  it('★★ the overlay hands out ONE status, applied above the counters', () => {
    const src = code(overlaySrc);
    // Two contexts: actions (stable) and version (the only thing that changes).
    expect(src).toContain('TaskStatusPendingContext');
    expect(src).toContain('applyStatusOverlay');
    // ★ And the page applies it to the whole array, not per card.
    expect(code(myTasksSrc)).toContain(
      'applyStatusOverlay(liveTasks, pendingStatuses)',
    );
  });
});
