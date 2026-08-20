import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import indexHtml from '../../index.html?raw';
import {
  BOARD_TASKS_KEY,
  defaultBoardCollapsed,
  loadBoardCollapsed,
  saveBoardCollapsed,
} from '../lib/boardPanelPrefs';
import { loadCollapsedKeys, saveCollapsedKeys } from '../lib/collapsePrefs';
import { loadPipelineCollapsed, savePipelineCollapsed } from '../lib/pipelinePrefs';
import { isTaskOverdue } from '../lib/taskStatus';

// fix-326 — My Board is the screen; My Tasks folds beneath it.
//
// Bobby: "the my board section just seems very clustered and very congested. I
// think the primary focus should be the my board, and then the my task should be
// expandable and collapsible … my task is something they could dive into if and
// need be."
//
// ★ This REPLACES fix-318's 45/55 draggable split. What fix-318 actually
// guaranteed — both halves on one screen, ONE query behind them, the page never
// scrolling — is untouched and re-asserted in its own suite; what goes is the
// divider, which existed to referee two panels competing for one screen.

const state = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  name: 'Miles' as string | null,
  userId: 'user-miles',
}));

// ★ fix-365: the design-manager lens. It reads dm_da_groups + the roster, and
// these suites render the board without a QueryClient by design — so it is
// mocked inert here. `hasAssociates: false` is also the state 25 of the 29
// logins are in, so this is the ordinary board, unchanged.
vi.mock('../hooks/useBoardLens', () => ({
  useBoardLens: () => ({
    associates: [],
    hasAssociates: false,
    lens: { mode: 'off', focus: null },
    setLens: vi.fn(),
    unmanaged: [],
  }),
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
vi.mock('../hooks/usePermits', () => ({ usePermits: () => ({ data: [], isLoading: false }) }));
vi.mock('../hooks/useProjects', () => ({ useProjects: () => ({ data: [], isLoading: false }) }));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
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
  // ★ fix-370: the model reads a second, uncapped aggregate for the TRUE
  // suppressed totals. Null here = the pre-fix-370 fallback (count the page),
  // which keeps every existing expectation in this suite meaningful.
  useScraperActivitySummary: () => ({ data: null }),
}));
vi.mock('../hooks/useMilestoneAcks', () => ({
  useMilestoneAcks: () => ({ data: [] }),
  useAckMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useDaTeamRouting', () => ({ useDaTeamRouting: () => ({ data: [] }) }));
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
    due_date: null,
    completed_at: null,
    assigned_to: 'Miles',
    co_assignees: [],
    bucket: 'de',
    is_bot: false,
    priority: false,
    notes: null,
    permit_da: null,
    permit_num: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
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

const toggle = () => screen.getByTestId('personal-board-tasks-toggle');

beforeEach(() => {
  window.localStorage.clear();
  state.tasks = [];
  state.name = 'Miles';
  state.userId = 'user-miles';
});

// ------------------------------------------------- the default, and the bar --

describe('fix-326: My Board leads, My Tasks folds', () => {
  // ★ THE ACCEPTANCE TEST. A first visit shows the board, not a screen split in
  // half with the task list eating the bottom of it.
  it('★ a first visit renders My Board full height with My Tasks folded', () => {
    state.tasks = [task({ text: 'Order the survey' })];
    renderBoard();

    const top = screen.getByTestId('personal-board-top');
    expect(within(top).getByTestId('my-board')).toBeInTheDocument();
    // My Board takes what is left, rather than a fixed share of the screen.
    expect(top.className).toContain('flex-1');
    expect(top.style.flex).toBeFalsy();

    const bottom = screen.getByTestId('personal-board-bottom');
    expect(bottom.dataset.collapsed).toBe('true');
    expect(defaultBoardCollapsed()).toEqual([BOARD_TASKS_KEY]);
  });

  // ★ FOLDED MEANS NOT BUILT. fix-324b found the same on the Pipeline: a folded
  // panel that still renders its rows costs the page hundreds of nodes on every
  // load for something nobody is looking at. "Hidden" and "absent" look
  // identical on screen and differ entirely in cost, so this asserts ABSENCE.
  it('★ folded, it builds no task cards at all', () => {
    state.tasks = [task({ text: 'Order the survey' }), task({ text: 'Chase the survey' })];
    renderBoard();
    expect(screen.queryByTestId('personal-board-tasks-body')).toBeNull();
    expect(screen.queryByTestId('mytasks-shell')).toBeNull();
    expect(screen.queryByTestId('mytasks-kanban')).toBeNull();
    expect(screen.queryByText('Order the survey')).toBeNull();
    // Not merely display:none — the nodes are not in the document.
    expect(document.querySelectorAll('[data-testid^="mytask-card-"]')).toHaveLength(0);
  });

  // ★ Folding a panel must not hide that there is work in it — fix-324's spines
  // carry their counts for the same reason.
  it('★ the folded bar carries the open and overdue counts', () => {
    state.tasks = [
      task({ status: 'Open', target_date: '2020-01-01' }),   // open + overdue
      task({ status: 'In Progress', target_date: null }),    // open
      task({ status: 'Resolved', target_date: '2020-01-01' }), // neither
      task({ status: 'Cancelled', target_date: '2020-01-01' }), // neither
    ];
    renderBoard();
    const counts = screen.getByTestId('personal-board-tasks-counts');
    expect(counts.textContent).toContain('2 open');
    expect(counts.textContent).toContain('1 overdue');
  });

  it('the counts use the shared overdue rule, cancelled tasks included in neither', () => {
    // The rule itself, at the boundary: a cancelled task is not overdue, it is
    // not in play (fix-262), and today is not yet late.
    expect(isTaskOverdue({ status: 'Open', target_date: '2026-08-15' }, '2026-08-16')).toBe(true);
    expect(isTaskOverdue({ status: 'Open', target_date: '2026-08-16' }, '2026-08-16')).toBe(false);
    expect(isTaskOverdue({ status: 'Cancelled', target_date: '2020-01-01' }, '2026-08-16')).toBe(false);
    expect(isTaskOverdue({ status: 'Resolved', target_date: '2020-01-01' }, '2026-08-16')).toBe(false);
    expect(isTaskOverdue({ status: 'Open', target_date: null }, '2026-08-16')).toBe(false);
  });

  it('expanding gives My Tasks a share and the board gives way', () => {
    state.tasks = [task({ text: 'Order the survey' })];
    renderBoard();
    fireEvent.click(toggle());

    const bottom = screen.getByTestId('personal-board-bottom');
    expect(bottom.dataset.collapsed).toBe('false');
    // ★ "The screen shifts down" — My Tasks takes a fixed generous share, My
    // Board keeps the rest rather than being pushed off.
    expect(bottom.style.flex).toBe('0 0 58%');
    expect(within(bottom).getByTestId('mytasks-shell')).toBeInTheDocument();
    expect(within(bottom).getByText('Order the survey')).toBeInTheDocument();
    // The bar is still there, and still counting.
    expect(screen.getByTestId('personal-board-tasks-counts')).toBeInTheDocument();
  });

  it('the bar is the control, and says which way it goes', () => {
    renderBoard();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Show');
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().textContent).toContain('Hide');
  });
});

// ------------------------------------------------------------ persistence --

describe('fix-326: the choice is remembered, per user', () => {
  it('★ expanding survives a remount', () => {
    state.tasks = [task({ text: 'Order the survey' })];
    const first = renderBoard();
    fireEvent.click(toggle());
    expect(screen.getByTestId('personal-board-bottom').dataset.collapsed).toBe('false');
    first.unmount();

    renderBoard();
    expect(screen.getByTestId('personal-board-bottom').dataset.collapsed).toBe('false');
    expect(screen.getByTestId('mytasks-shell')).toBeInTheDocument();
  });

  // ★ THE OTHER DIRECTION, which is the half that is easy to get wrong: a
  // DEFAULT is not a floor. Once someone has chosen, the default is never
  // consulted again — fix-324b's rule, restated here because this is the second
  // panel to rely on it.
  it('★ and the default never overrides a stored choice', () => {
    saveBoardCollapsed('user-miles', []);
    renderBoard();
    expect(screen.getByTestId('personal-board-bottom').dataset.collapsed).toBe('false');

    // ...and folding it again is equally remembered.
    fireEvent.click(toggle());
    expect(loadBoardCollapsed('user-miles')).toEqual([BOARD_TASKS_KEY]);
  });

  it('is stored per user, so one login cannot fold another\'s panel', () => {
    saveBoardCollapsed('user-a', [BOARD_TASKS_KEY]);
    saveBoardCollapsed('user-b', []);
    expect(loadBoardCollapsed('user-a')).toEqual([BOARD_TASKS_KEY]);
    expect(loadBoardCollapsed('user-b')).toEqual([]);
    expect(loadBoardCollapsed('user-never-chose')).toBeNull();
    expect(loadBoardCollapsed(null)).toBeNull();
  });

  it('a corrupt stored value falls back to the default rather than throwing', () => {
    window.localStorage.setItem('board.collapsed.user-miles', '{not json');
    expect(loadBoardCollapsed('user-miles')).toBeNull();
    renderBoard();
    expect(screen.getByTestId('personal-board-bottom').dataset.collapsed).toBe('true');
  });

  // ★ NOT A THIRD PREFERENCE STORE — the brief's instruction. One mechanism
  // (collapsePrefs), two namespaces, and the Pipeline's stored key is untouched
  // so nobody's folded columns spring open on deploy.
  it('★ reuses fix-324b\'s mechanism rather than inventing another', () => {
    saveBoardCollapsed('user-x', ['my-tasks']);
    savePipelineCollapsed('user-x', ['g:ap']);
    // Separate drawers, same lock.
    expect(window.localStorage.getItem('board.collapsed.user-x')).toBe('["my-tasks"]');
    expect(window.localStorage.getItem('pipeline.collapsed.user-x')).toBe('["g:ap"]');
    expect(loadBoardCollapsed('user-x')).toEqual(['my-tasks']);
    expect(loadPipelineCollapsed('user-x')).toEqual(['g:ap']);
    // And both go through the one implementation.
    saveCollapsedKeys('board.collapsed', 'user-y', ['my-tasks']);
    expect(loadBoardCollapsed('user-y')).toEqual(['my-tasks']);
    expect(loadCollapsedKeys('pipeline.collapsed', 'user-x')).toEqual(['g:ap']);
  });
});

// -------------------------------------------------- fix-318's guarantee ----

describe('fix-326: what fix-318 guaranteed still holds', () => {
  // ★ ONE QUERY. Ticking in the list changes what the next render of either half
  // reads — the guarantee that made the merge worth doing.
  it('★ ticking a task changes what the next render reads', () => {
    state.tasks = [task({ id: 't-shared', text: 'Resubmit to the city' })];
    const { rerender } = renderBoard();
    fireEvent.click(toggle());

    const box = screen.getByTestId('mytask-card-t-shared-status-toggle');
    expect(box.getAttribute('data-status-visual')).toBe('empty');
    fireEvent.click(box);
    expect(state.tasks.find((x) => x.id === 't-shared')!.status).toBe('In Progress');

    rerender(<PersonalBoard />);
    expect(
      screen
        .getByTestId('mytask-card-t-shared-status-toggle')
        .getAttribute('data-status-visual'),
    ).toBe('partial');
  });

  // ★ And the BAR reads that same query, so folding the panel does not freeze
  // its counts — the number moves with the work.
  it('★ the bar\'s counts come from the same query the panel reads', () => {
    state.tasks = [task({ id: 't-c', status: 'Open' })];
    const { rerender } = renderBoard();
    expect(screen.getByTestId('personal-board-tasks-counts').textContent).toContain('1 open');

    state.tasks = [
      { ...state.tasks[0], status: 'Resolved' },
      task({ status: 'Open' }),
      task({ status: 'Open' }),
    ];
    rerender(<PersonalBoard />);
    expect(screen.getByTestId('personal-board-tasks-counts').textContent).toContain('2 open');
  });

  it('the page still owns no scrollbar; the regions do', () => {
    renderBoard();
    const shell = screen.getByTestId('personal-board');
    expect(getComputedStyle(shell).overflow).toBe('hidden');
    expect(screen.getByTestId('personal-board-top').className).toContain('overflow-y-auto');
    fireEvent.click(toggle());
    expect(screen.getByTestId('personal-board-tasks-body').className).toContain('overflow-auto');
  });

  it('the Mine / Waiting On switcher still works inside My Tasks', () => {
    state.tasks = [task()];
    renderBoard();
    fireEvent.click(toggle());
    expect(screen.getByTestId('my-tasks-view-switcher')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-tasks-view-waiting-on'));
    expect(screen.getByTestId('my-tasks-view-waiting-on').getAttribute('aria-pressed')).toBe('true');
  });

  it('MyTasks.tsx was mounted, not rewritten', async () => {
    const src = (await import('../pages/MyTasks.tsx?raw')).default as string;
    expect(src).toContain('export default function MyTasks');
    expect(src).toContain('export function MineTasks');
  });
});

// ------------------------------------------------- §2 · the dead component --

describe('fix-326 §2: NotificationBell was dead code', () => {
  // ★★ THE ERROR THIS SECTION CORRECTS. An earlier draft of the brief told me to
  // "remove NotificationBell from the top bar" — a component that was not on
  // screen and had not been for several tickets. Bobby caught it: "the current
  // bell I see is the myboard notification bell, not the scraper bell?" The
  // stale comments in four files are what made that draft plausible.
  it('★ nothing imports it, and the file is gone', async () => {
    const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default' });
    const offenders: string[] = [];
    for (const [path, load] of Object.entries(files)) {
      const src = (await load()) as string;
      if (/from\s+['"][^'"]*NotificationBell['"]/.test(src)) offenders.push(path);
    }
    expect(offenders, 'NotificationBell is deleted; nothing may import it').toEqual([]);
    expect(Object.keys(files).some((p) => p.endsWith('/NotificationBell.tsx'))).toBe(false);
    // ★ 60s, not the 5s default: this deliberately reads EVERY source file, and
    // under the full parallel suite that is real work. Narrowing the glob would
    // narrow the guarantee — 'nothing anywhere imports it' is the assertion.
    //
    // ★ fix-369 raised it from 30s. The tree this reads grew, and fix-369's own
    // suite sweeps it the same way for the same kind of guarantee, so the two
    // now compete for the worker pool. The budget is the thing that was wrong,
    // not the assertion: it passes in about 8s alone and only ever crept past
    // 30 under a full parallel run.
  }, 60_000);

  // ★ The comments, not just the code — a file that DESCRIBES a deleted
  // component as live is how the next brief concludes it is.
  it('★ no comment claims it is mounted or linked', async () => {
    const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default' });
    const claims = [
      /Mounted by the NotificationBell/i,
      /NotificationBell links here/i,
      /Chrome now mounts NotificationBell/i,
      /The existing NotificationBell is/i,
    ];
    const offenders: string[] = [];
    for (const [path, load] of Object.entries(files)) {
      const src = (await load()) as string;
      if (claims.some((re) => re.test(src))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  }, 30_000);

  // ★ useScraperActivity STAYS — BoardBell builds its flip feed and suppression
  // counts on it. The brief was explicit, and deleting it would have taken the
  // bell's contents with it.
  it('★ useScraperActivity is still live, and BoardBell still uses it', async () => {
    const hook = (await import('../hooks/useScraperActivity.ts?raw')).default as string;
    expect(hook).toContain('export function useScraperActivity');
    const bell = (await import('../components/BoardBell.tsx?raw')).default as string;
    expect(bell).toContain('useScraperActivity');
  });

  // ★ /activity is still reachable — fix-325 put it on the Reporting hub, and My
  // Board's health panel links to it in context ("untouched 14d+" → the feed
  // that explains it). Bobby's "no bell needed for it" was about the BELL.
  it('/activity still resolves and is still linked from both places', async () => {
    const routerSrc = (await import('../router.tsx?raw')).default as string;
    expect(routerSrc).toContain("path: 'activity'");
    const boardSrc = (await import('../pages/MyBoard.tsx?raw')).default as string;
    expect(boardSrc).toContain('/activity');
    const hubSrc = (await import('../components/Settings/AdminReportingTab.tsx?raw'))
      .default as string;
    expect(hubSrc).toContain("navigate('/activity')");
  });
});

// ------------------------------------------------------- §3 · the favicon --

describe('fix-326 §3: the tab carries the brand sheet\'s own icon', () => {
  // ★ fix-351 retargets the filenames. The RULE — the tab gets a purpose-made
  // square at two sizes, never the wide artwork — is why the square exists in
  // the 2026 set at all, and is asserted below as well.
  it('★ points at the simplified icon, at both sizes', () => {
    expect(indexHtml).toContain('href="/bridge-favicon-2026-32.png"');
    expect(indexHtml).toContain('href="/bridge-icon-2026-256.png"');
  });

  it('★ the crop and the placeholder are both gone from the tab', () => {
    expect(indexHtml).not.toContain('bridge-icon-256.png');
    expect(indexHtml).not.toContain('href="/bridge-mark.svg"');
  });

  // ★ The ribbon logo is NOT this. The brief said so, and the two have different
  // jobs: an illustration in the ribbon, a shape that survives 16px in the tab.
  //
  // ★★ fix-335 MOVED BOTH ENDS OF THAT SENTENCE AND THE RULE SURVIVED INTACT.
  // §1 gave the ribbon the original Blueprint logo; §2 put the Bridge mark in
  // the white header — where, per Bobby, it is deliberately "the logo from the
  // tab", so BridgeMark now imports the favicon on purpose rather than by
  // accident. The claim worth keeping is the ORIGINAL one: the detailed 4:1
  // illustration and the 16px tab icon are different artwork for different
  // jobs, and neither is ever used as the other.
  it('★ the ribbon logo is untouched', async () => {
    const bridgeSrc = (await import('../components/BridgeMark.tsx?raw')).default as string;
    const blueprintSrc = (await import('../components/BlueprintMark.tsx?raw'))
      .default as string;

    // The ribbon's mark: the Blueprint lockup and roundel, and NOT the tab icon
    // nor the Bridge illustration.
    expect(blueprintSrc).toMatch(/blueprint-logo-lockup\.png/);
    expect(blueprintSrc).toMatch(/blueprint-logo-icon\.png/);
    expect(blueprintSrc).not.toMatch(/bridge-/);

    // ★★ fix-351: the Bridge component still owns the wide artwork and still
    // owns a distinct square, so the tab's mark is never served as the detailed
    // one — the whole reason fix-326 exists, unchanged.
    //
    // ★ WHAT CHANGED IS THE VARIANT NAME. fix-335 needed a third variant called
    // `favicon` because the OLD set held two near-identical squares and Bobby
    // had named the tab's one specifically. The 2026 set has exactly one square,
    // used by the tab and the app, so `icon` and `favicon` would have been two
    // names for one file. The distinction is gone because the thing it
    // distinguished is gone.
    expect(bridgeSrc).toMatch(/bridge-logo-2026\.png/);
    expect(bridgeSrc).toMatch(/bridge-icon-2026-256\.png/);
    expect(bridgeSrc).toMatch(/const isIcon = variant === 'icon'/);
    expect(indexHtml).not.toMatch(/bridge-logo-400|bridge-logo-full|bridge-logo-2026/);
  });
});
