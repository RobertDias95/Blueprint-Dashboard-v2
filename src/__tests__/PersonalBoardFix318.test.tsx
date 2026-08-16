import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import routerSrc from '../router.tsx?raw';
import { allRibbonRoutes } from '../lib/ribbonNav';
// ★ fix-326 removed the draggable split — and boardSplitPrefs with it. My Board
// is the screen now and My Tasks folds behind a bar, so there are no longer two
// panels competing for one screen for a divider to referee. The contracts fix-318
// actually cared about — both halves present, ONE query behind them, the page
// never scrolling — are all still here; every test that needs the task list just
// opens the fold first, the way a person does.

// fix-318 (register #62) — My Board and My Tasks, one screen.
//
// ★ THIS FIXES A REGRESSION I SHIPPED. fix-313's brief said "redirect
// /my-tasks -> /board" and never specified the merge, so the removal shipped
// without the replacement: "I don't see my tasks anywhere."
//
// Nothing was rebuilt. MyTasks.tsx was intact — fix-313 left it deliberately —
// and this mounts it. The one structural change is an `export` keyword on
// MineTasks, explained where it sits.
//
// ★ THE HARNESS RULE (fix-306, fix-307): assert OBSERVABLE OUTCOMES, never
// mechanisms. The task store below is REAL — the mutation writes to it and the
// query reads it back — because "ticking in one half updates the other" cannot
// be shown by asserting that a mutate function was called.

const state = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  members: [] as unknown[],
  name: 'Miles' as string | null,
  userId: 'user-miles',
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (st: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: state.userId, email: 'miles@example.com' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: state.members, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: state.name, roles: [], scope: 'permit' },
    userId: state.userId,
    isLoading: false,
  }),
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: state.name, roles: [], scope: 'permit' },
  }),
}));
vi.mock('../hooks/useTaskOwnership', () => ({
  useTaskOwnership: () => ({ matches: () => true }),
}));
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: [] }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: [] }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({ rows: [] }),
}));
vi.mock('../hooks/useDaTeamRouting', () => ({
  useDaTeamRouting: () => ({ data: [] }),
}));
vi.mock('../hooks/useConfirmHandoff', () => ({
  useConfirmHandoff: () => ({ confirm: vi.fn(), pendingId: null, isPending: false }),
}));
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [] }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useNotes', () => ({
  useProjectNotes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ★ THE REAL STORE. Both halves read `useAllTasks`; the write goes through
// `useUpsertTask`. In production one invalidation of the shared `permit_tasks`
// key re-renders both — asserted structurally in its own test below. Here the
// mutation mutates the store so a second render genuinely sees the change.
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({ data: state.tasks, isLoading: false, error: null, refetch: vi.fn() }),
  useUpsertTask: () => ({
    mutate: (input: { id?: string; status?: string }) => {
      const t = state.tasks.find((x) => x.id === input.id);
      if (t && input.status) t.status = input.status;
    },
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: ({ task }: { task: { id: string } }) => (
    <div data-testid="stub-task-detail-editor" data-task={task.id} />
  ),
}));

import PersonalBoard from '../pages/PersonalBoard';

let seq = 0;
function task(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `t-${seq}`,
    permit_id: 1,
    project_id: 'p1',
    project_address: '123 Main St',
    permit_type: 'Building Permit',
    parent_task_id: null,
    discipline: 'arch',
    text: `Task ${seq}`,
    status: 'Open',
    start_date: null,
    target_date: null,
    done_at: null,
    sort_order: 0,
    primary_assignee: null,
    co_assignees: [],
    bucket: 'de',
    ...over,
  };
}

function renderBoard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PersonalBoard />, { wrapper });
}

beforeEach(() => {
  seq = 0;
  state.tasks = [];
  state.members = [{ id: 'm1', name: 'Miles', role: 'ent', active: true, former: false }];
  state.name = 'Miles';
  state.userId = 'user-miles';
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// ★ The acceptance test — the thing Bobby cannot currently find
// ---------------------------------------------------------------------------

/** ★ fix-326: My Tasks is FOLDED by default, so a test that wants the task list
 *  opens it first. Not a workaround — it is the shipped first-visit state, and a
 *  suite that quietly rendered it expanded would stop describing the screen. */
function expandTasks() {
  fireEvent.click(screen.getByTestId('personal-board-tasks-toggle'));
}

describe('fix-318 ★ the grouped task list is back, on /board', () => {
  it('★★ renders BOTH halves — My Board on top, the task list below', () => {
    state.tasks = [task({ text: 'Order the survey' })];
    renderBoard();
    expandTasks();

    const top = screen.getByTestId('personal-board-top');
    const bottom = screen.getByTestId('personal-board-bottom');
    // My Board, intact.
    expect(within(top).getByTestId('my-board')).toBeInTheDocument();
    // ★ The grouped task list — the screen that vanished.
    expect(within(bottom).getByTestId('mytasks-kanban')).toBeInTheDocument();
    expect(within(bottom).getByText('Order the survey')).toBeInTheDocument();
  });

  // ★ fix-294's nesting is the specific thing My Board's scattered forecast
  // does NOT give you, and it is why "the board already shows tasks" was not
  // an adequate answer.
  it('★★ subtasks render under their parents, not as loose rows', () => {
    const parent = task({ id: 't-parent', text: 'Submit the set' });
    const child = task({ id: 't-child', text: 'Chase the survey', parent_task_id: 't-parent' });
    state.tasks = [parent, child];
    renderBoard();
    expandTasks();

    const bottom = screen.getByTestId('personal-board-bottom');
    const sub = within(bottom).getByText('Chase the survey').closest('[data-subtask]');
    expect(sub, 'the subtask must render as a subtask').toBeTruthy();
    expect((sub as HTMLElement).dataset.subtask).toBe('true');
    // ...and the parent is not marked as one, so the assertion is not vacuous.
    const par = within(bottom).getByText('Submit the set').closest('[data-subtask]');
    expect((par as HTMLElement).dataset.subtask).toBe('false');
  });

  it('the filters and counters came with it', () => {
    state.tasks = [task()];
    renderBoard();
    expandTasks();
    const bottom = screen.getByTestId('personal-board-bottom');
    expect(within(bottom).getByTestId('mytasks-filterrow')).toBeInTheDocument();
    expect(within(bottom).getByTestId('mytasks-counters')).toBeInTheDocument();
  });

  // The shell's view switcher was deliberately left behind — see the comment
  // on the MineTasks export.
  // ★ fix-325 #5 INVERTS this. fix-318 deliberately mounted MineTasks WITHOUT
  // the switcher, because fix-315 had just given Waiting On its own route and
  // ribbon entry and a second home would have been duplication. Bobby then asked
  // for exactly that fold — "the waiting on needs to get folded into the my task
  // section" — and the ribbon entry went with it, so the switcher is now the ONE
  // way in rather than a second one.
  it('★ DOES bring the Mine / Waiting On switcher — it is the only way in now', () => {
    state.tasks = [task()];
    renderBoard();
    expandTasks();
    expect(screen.getByTestId('mytasks-shell')).toBeInTheDocument();
    expect(screen.getByTestId('my-tasks-view-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('my-tasks-view-waiting-on')).toBeInTheDocument();
    // The ribbon no longer offers it, which is what makes this the only way in.
    expect(allRibbonRoutes()).not.toContain('/waiting-on');
  });
});

// ---------------------------------------------------------------------------
// ★ The two halves cannot disagree
// ---------------------------------------------------------------------------

describe('fix-318 ★ one task, two halves, one truth', () => {
  // ★ THE ASSERTION THE BRIEF ASKS FOR. Two lists disagreeing about whether
  // something is done is worse than either list alone.
  //
  // ★ WHAT THIS FIXTURE PROVES, PRECISELY. Both halves read ONE store here, so
  // ticking in the list changes what the NEXT render of either half reads —
  // shown below by the checkbox's own visual moving from empty to partial,
  // which is state the card re-derives from the store rather than holding
  // locally. What it cannot show is the board half rendering that same task in
  // its forecast, because the forecast needs a permit + project fixture this
  // suite does not build. That half of the guarantee is STRUCTURAL and is
  // asserted in the next test: one query, one invalidation, both halves.
  it('★★ ticking a task in the list changes what the next render reads', () => {
    const t = task({ id: 't-shared', text: 'Resubmit to the city', target_date: '2026-08-20' });
    state.tasks = [t];
    const { rerender } = renderBoard();
    expandTasks();

    const bottom = screen.getByTestId('personal-board-bottom');
    // fix-235's forward-only checkbox: Open -> In Progress -> Resolved.
    const box = within(bottom).getByTestId('mytask-card-t-shared-status-toggle');
    const before = box.getAttribute('data-status-visual');
    expect(before).toBe('empty');

    fireEvent.click(box);
    // The write landed in the ONE store both halves read.
    expect(state.tasks.find((x) => x.id === 't-shared')!.status).toBe('In Progress');

    rerender(<PersonalBoard />);
    const after = screen
      .getByTestId('personal-board-bottom')
      .querySelector('[data-testid="mytask-card-t-shared-status-toggle"]')!
      .getAttribute('data-status-visual');
    expect(after).not.toBe(before);
    expect(after).toBe('partial');
    // Both halves are still mounted and reading the same store.
    expect(screen.getByTestId('personal-board-top')).toBeInTheDocument();
    expect(screen.getByTestId('personal-board-bottom')).toBeInTheDocument();
  });

  // ★ The structural guarantee behind that, which the fixture cannot show:
  // both halves read useAllTasks, whose key sits under the `permit_tasks`
  // prefix that every task write invalidates. One invalidation, both halves.
  it('★ both halves read ONE query, and the write invalidates its prefix', async () => {
    const { queryKeys } = await import('../lib/queryKeys');
    expect(queryKeys.allTasks('t1')[0]).toBe(queryKeys.permitTasksAll[0]);
    const src = (await import('../hooks/useTaskTree.ts?raw')).default;
    expect(src).toContain('queryKeys.permitTasksAll');
    // And both screens genuinely call it, rather than one holding its own copy.
    const boardSrc = (await import('../pages/MyBoard.tsx?raw')).default;
    const tasksSrc = (await import('../pages/MyTasks.tsx?raw')).default;
    expect(boardSrc).toContain('useAllTasks');
    expect(tasksSrc).toContain('useAllTasks');
  });

  it('opening a task from the list opens the shared TaskDetailEditor', () => {
    state.tasks = [task({ id: 't-open', text: 'Open me' })];
    renderBoard();
    expandTasks();
    const bottom = screen.getByTestId('personal-board-bottom');
    fireEvent.click(within(bottom).getByText('Open me'));
    const editor = screen.getByTestId('stub-task-detail-editor');
    expect(editor.dataset.task).toBe('t-open');
  });
});

// ---------------------------------------------------------------------------
// The layout contract
// ---------------------------------------------------------------------------

// ★ jsdom has NO layout engine, so a getBoundingClientRect comparison here
// would pass vacuously whatever the CSS said — the brief says so explicitly.
// These assert OVERFLOW OWNERSHIP, which is the contract; the pixel behaviour
// was measured separately in headless Chrome, at 1280/1440/1600 — the page never
// scrolls and the task region genuinely scrolls horizontally at 1280.
//
// ★ fix-326 kept every line of this contract and changed only which element owns
// the bottom scroller: the fold's body, so the bar stays put above it.
describe('fix-318: the page does not scroll, the two regions do', () => {
  it('★ the shell hides its own overflow and fills the pane', () => {
    renderBoard();
    const shell = screen.getByTestId('personal-board');
    expect(getComputedStyle(shell).overflow).toBe('hidden');
    expect(shell.className).toContain('h-full');
    expect(shell.className).toContain('flex-col');
  });

  it('★ the TOP region scrolls vertically and never horizontally', () => {
    renderBoard();
    const top = screen.getByTestId('personal-board-top');
    expect(top.className).toContain('overflow-y-auto');
    expect(top.className).toContain('overflow-x-hidden');
    expect(top.className).toContain('min-h-0');
  });

  // ★ Bobby's "fixed vertically and horizontally" — the bottom owns BOTH axes,
  // which is what lets the task columns keep their width instead of widening
  // the page.
  it('★ the BOTTOM region scrolls both axes', () => {
    renderBoard();
    expandTasks();
    // ★ fix-326: the scroller is the fold's BODY — the bar above it must not
    // scroll away, which is the whole point of a bar you can find.
    const body = screen.getByTestId('personal-board-tasks-body');
    expect(body.className).toContain('overflow-auto');
    expect(body.className).toContain('min-h-0');
    expect(body.className).not.toContain('overflow-x-hidden');
  });
});

// ---------------------------------------------------------------------------
// Prior contracts
// ---------------------------------------------------------------------------

describe('fix-318: what must not have moved', () => {
  it('/my-tasks still redirects to /board, which now genuinely holds the tasks', () => {
    expect(routerSrc).toMatch(
      /path: 'my-tasks', element: <Navigate to="\/board" replace \/>/,
    );
    expect(routerSrc).toContain('<PersonalBoard />');
  });

  it('★ the ribbon has ONE personal entry, not two', () => {
    const routes = allRibbonRoutes();
    expect(routes).toContain('/board');
    expect(routes).not.toContain('/my-tasks');
    expect(routes.filter((r) => r === '/board')).toHaveLength(1);
  });

  it('★ no count pill was added to My Board — fix-313 left it off deliberately', () => {
    state.tasks = [task(), task(), task()];
    renderBoard();
    const board = screen.getByTestId('my-board');
    // The unseen count lives on the bell in the top bar; two places for one
    // number is how fix-298 Phase 2 ended up collapsing two bells.
    expect(within(board).queryByTestId('my-board-count-pill')).toBeNull();
  });

  it('MyTasks.tsx was mounted, not rewritten — its default export still exists', async () => {
    const mod = await import('../pages/MyTasks');
    expect(typeof mod.default).toBe('function');
    expect(typeof mod.MineTasks).toBe('function');
  });
});
