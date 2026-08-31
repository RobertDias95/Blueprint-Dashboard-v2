import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockTaskOwnership } from '../test/taskOwnership';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import routerSource from '../router.tsx?raw';
import personalBoardSource from '../pages/PersonalBoard.tsx?raw';
import ribbonNavSource from '../lib/ribbonNav.ts?raw';

// ===========================================================================
// fix-385 — My Board becomes tabs: My Board · My Tasks · Notifications
// ===========================================================================
//
// Bobby: "i think for my board, it you can make my tasks and notifications a
// tab in the my board. i think that would look cleaner for now"
//
// ★★★ THIS SUPERSEDES fix-326's collapsible bar, knowingly. Asked directly
// whether he accepted that tabs make the panels mutually exclusive — the very
// thing the bar was chosen to avoid — Bobby chose tabs (2026-08-21). The two
// suites in BoardPrimaryFix326.test.tsx that pinned the bar and its remembered
// fold were removed there, deliberately and with a note saying so; everything
// fix-326 carried forward from fix-318 still lives in that file and still
// passes against the tabs.
//
// What this suite pins is the NEW contract: three tabs, the badges that keep
// folded work visible, and the /notifications deep link surviving the move.

const state = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  name: 'Miles' as string | null,
  userId: 'user-miles',
  unseenCount: 0,
}));

// ★ fix-409: My Tasks reads permit-scoped holds now, the way My Board has
// since fix-390. Mocked inert — an unheld book is the state every assertion in
// this file was written against, and a real query here would reach the network.
vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
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
vi.mock('../hooks/useTaskOwnership', () => mockTaskOwnership());
vi.mock('../hooks/useProjectHolds', () => ({
  useAllProjectHolds: () => ({ data: [] }),
  cancelledProjectIds: () => new Set<string>(),
}));
vi.mock('../hooks/useScraperActivity', () => ({
  useScraperActivity: () => ({ data: [] }),
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

// ★ The notification MODEL is stubbed, not the centre. fix-336's own behaviour
// is pinned in LiveNotificationsFix336.test.tsx and is not re-litigated here;
// what this suite needs from it is a controllable unread count and enough shape
// for the real centre to render, so that "the tab mounts the existing
// component" is a claim about the component and not about a fixture.
vi.mock('../hooks/useBoardNotifications', () => ({
  useBoardNotifications: () => ({
    viewer: { name: state.name, roles: [], scope: 'permit' },
    items: [],
    unseen: [],
    readKeys: new Set<string>(),
    unseenCount: state.unseenCount,
    signature: '',
    suppressed: { retries: 2, guarded: 0, notYours: 0 },
    suppressedRows: { retries: [], guarded: [], notYours: [] },
    activitySummary: null,
    activityTruncated: false,
    activityTruncationNote: null,
    isLoading: false,
  }),
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

/** Renders the real routes for /board and /notifications, so a tab click is a
 *  real navigation and the deep link is exercised through the router rather
 *  than through a prop. */
function renderAt(entry: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/board" element={<PersonalBoard />} />
      <Route
        path="/notifications"
        element={<PersonalBoard pinnedTab="notifications" />}
      />
    </Routes>,
    { wrapper },
  );
}

const tab = (id: string) => screen.getByTestId(`personal-board-tab-${id}`);
const activeTab = () =>
  screen.getByTestId('personal-board-panel').dataset.tab;

beforeEach(() => {
  window.localStorage.clear();
  state.tasks = [];
  state.name = 'Miles';
  state.userId = 'user-miles';
  state.unseenCount = 0;
});

// -------------------------------------------------------------- the shape --

describe('fix-385: three tabs, one screen', () => {
  it('★★★ renders three tabs in order, with My Board active by default', () => {
    renderAt('/board');
    const tabs = within(screen.getByTestId('personal-board-tabs')).getAllByRole(
      'tab',
    );
    expect(tabs.map((t) => t.textContent?.replace(/\d.*/, '').trim())).toEqual([
      'My Board',
      'My Tasks',
      'Notifications',
    ]);
    expect(activeTab()).toBe('board');
    expect(tab('board').getAttribute('aria-selected')).toBe('true');
  });

  it('★★★ each tab shows the EXISTING component, mounted not rewritten', () => {
    renderAt('/board');
    expect(screen.getByTestId('my-board')).toBeInTheDocument();

    fireEvent.click(tab('tasks'));
    // fix-325's full shell, with the Mine / Waiting On switcher inside it.
    expect(screen.getByTestId('mytasks-shell')).toBeInTheDocument();
    expect(screen.getByTestId('my-tasks-view-switcher')).toBeInTheDocument();

    fireEvent.click(tab('notifications'));
    // fix-336's centre, by its own testid.
    expect(screen.getByTestId('notification-centre')).toBeInTheDocument();
  });

  it('★★ an inactive tab is UNMOUNTED, not hidden', () => {
    // "Hidden" and "absent" look identical on screen and differ entirely in
    // cost — fix-326's rule, from fix-324b, carried onto the tabs.
    state.tasks = [task({ text: 'Order the survey' })];
    renderAt('/board');
    expect(screen.queryByTestId('mytasks-shell')).toBeNull();
    expect(screen.queryByTestId('notification-centre')).toBeNull();

    fireEvent.click(tab('tasks'));
    expect(screen.queryByTestId('my-board')).toBeNull();
    expect(screen.getByTestId('mytasks-shell')).toBeInTheDocument();
  });

  it('★ the page still owns no scrollbar; the panel does', () => {
    renderAt('/board');
    expect(getComputedStyle(screen.getByTestId('personal-board')).overflow).toBe(
      'hidden',
    );
    expect(screen.getByTestId('personal-board-panel').className).toContain(
      'overflow-y-auto',
    );
  });
});

// ------------------------------------------------------------- the badges --

describe('fix-385: folded work stays visible', () => {
  it('★★ the My Tasks tab shows open/overdue while another tab is active', () => {
    state.tasks = [
      task({ status: 'Open', target_date: '2020-01-01' }),
      task({ status: 'Open' }),
      task({ status: 'Resolved' }),
    ];
    renderAt('/board');
    // We are on My Board, and the My Tasks tab still says what is behind it.
    expect(activeTab()).toBe('board');
    const counts = screen.getByTestId('personal-board-tasks-counts');
    expect(counts.textContent).toContain('2 open');
    expect(counts.textContent).toContain('1 overdue');
  });

  it('★★ the Notifications tab shows unread while another tab is active', () => {
    state.unseenCount = 7;
    renderAt('/board');
    expect(activeTab()).toBe('board');
    expect(
      screen.getByTestId('personal-board-notifications-count').textContent,
    ).toBe('7');
  });

  it('★ zero unread draws no badge, but zero open still says "0 open"', () => {
    // The asymmetry is deliberate: "0 open" answers "is there anything in
    // there", while a 0 on a bell says nothing anyone needed to be told.
    state.unseenCount = 0;
    renderAt('/board');
    expect(screen.queryByTestId('personal-board-notifications-count')).toBeNull();
    expect(
      screen.getByTestId('personal-board-tasks-counts').textContent,
    ).toContain('0 open');
  });

  it('★★ ticking a task on the My Tasks tab moves the tab\'s own count', () => {
    // ★ THE ONE-QUERY RULE, observable. The badge is computed at page level
    // from the same useAllTasks the panel reads, so a tick moves both with
    // nothing to keep in step.
    state.tasks = [task({ id: 't-shared', status: 'Open' })];
    const { rerender } = renderAt('/board');
    fireEvent.click(tab('tasks'));
    expect(
      screen.getByTestId('personal-board-tasks-counts').textContent,
    ).toContain('1 open');

    fireEvent.click(screen.getByTestId('mytask-card-t-shared-status-toggle'));
    expect(state.tasks[0].status).toBe('In Progress');

    state.tasks = [{ ...state.tasks[0], status: 'Resolved' }];
    rerender(
      <Routes>
        <Route path="/board" element={<PersonalBoard />} />
      </Routes>,
    );
    expect(
      screen.getByTestId('personal-board-tasks-counts').textContent,
    ).toContain('0 open');
  });

  it('★ neither badge mounts a second subscription', () => {
    // useBoardNotifications is a pure composition of shared react-query hooks
    // ("NOTHING HERE READS A SOCKET"), and the task counts read useAllTasks.
    // The page must not reach for anything else to decorate a tab.
    expect(personalBoardSource).toContain('useBoardNotifications');
    expect(personalBoardSource).toContain('useAllTasks');
    expect(personalBoardSource).not.toMatch(/supabase\s*\.\s*channel/);
    expect(personalBoardSource).not.toContain('useRealtime');
  });
});

// --------------------------------------------------------- the deep links --

describe('fix-385: /notifications survives the move', () => {
  it('★★★ /notifications lands on the Notifications tab', () => {
    renderAt('/notifications');
    expect(activeTab()).toBe('notifications');
    expect(tab('notifications').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('notification-centre')).toBeInTheDocument();
  });

  it('★★★ /notifications?kind=suppressed still selects the suppressed filter', () => {
    // ★ THE DEEP LINK CARRYING STATE. It works because the route was KEPT
    // rather than redirected, so the URL is untouched and Notifications.tsx's
    // own useSearchParams reads `kind` exactly as it did before the move —
    // no parameter plumbing at the seam at all.
    renderAt('/notifications?kind=suppressed');
    expect(activeTab()).toBe('notifications');
    const chip = screen.getByTestId('notification-kind-suppressed');
    expect(chip.dataset.active).toBe('true');
    // and the other chips are not
    expect(screen.getByTestId('notification-kind-all').dataset.active).toBe('false');
  });

  it('★★ the route renders the board, so the tabs are reachable from it', () => {
    renderAt('/notifications');
    expect(screen.getByTestId('personal-board-tabs')).toBeInTheDocument();
    fireEvent.click(tab('board'));
    expect(activeTab()).toBe('board');
    expect(screen.getByTestId('my-board')).toBeInTheDocument();
  });

  it('★★ the standing links still point at /notifications', () => {
    // BoardBell's "see all" and its fix-298 suppressed line, and MyBoard's
    // header link. They are unchanged BECAUSE the route was kept — the reason
    // LiveNotificationsFix336.test.tsx needed no edit.
    expect(routerSource).toContain("path: 'notifications'");
    expect(routerSource).toContain('pinnedTab="notifications"');
  });

  it('★ /board?tab=tasks is addressable, and the tabs get no ribbon rows', () => {
    renderAt('/board?tab=tasks');
    expect(activeTab()).toBe('tasks');
    // fix-336 refused a ribbon row for the centre; a tab is not a third entry
    // point either, so nothing new appears in the rail. ONE board link, and
    // /notifications stays an exempt path rather than becoming a row.
    expect(ribbonNavSource).toContain("path: '/notifications'");
    const links = [...ribbonNavSource.matchAll(/to: '\/board[^']*'/g)].map(
      (m) => m[0],
    );
    expect(links).toEqual(["to: '/board'"]);
  });

  it("★★★ fix-362's task link lands on My Tasks, not the Board tab", () => {
    // notificationTargets.ts:97 sends a task notification to `/board?task=<id>`
    // and MyTasks.tsx:313 is what reads that param. Defaulting to the Board tab
    // would have quietly broken every task notification ever sent.
    state.tasks = [task({ id: 't-deep', text: 'Open me from a notification' })];
    renderAt('/board?task=t-deep');
    expect(activeTab()).toBe('tasks');
    expect(screen.getByTestId('mytasks-shell')).toBeInTheDocument();
  });

  it('★ a plain /board with no params is still the Board tab', () => {
    renderAt('/board');
    expect(activeTab()).toBe('board');
  });

  it('★ the tab choice is read from the URL, never set in an effect', () => {
    // fix-313's rule. There is no stored tab to initialise, so there is no
    // flinch frame to avoid — the URL is available on the first render.
    // (The retirement is NAMED in a comment, so assert on the import, not the
    // word — the comment is the record of why the module is gone.)
    expect(personalBoardSource).not.toMatch(/from '\.\.\/lib\/boardPanelPrefs'/);
    const effects = personalBoardSource.match(/useEffect\(/g) ?? [];
    expect(effects).toHaveLength(0);
  });
});

// ------------------------------------------------------------ the history --

describe('fix-385: fix-326 is history, not the spec', () => {
  it('★★ no comment still claims My Tasks folds beneath My Board', () => {
    // The brief's rule: do not leave a comment arguing with the code below it.
    expect(personalBoardSource).not.toContain('BOARD_TASKS_KEY');
    expect(personalBoardSource).not.toContain('tasksCollapsed');
    expect(personalBoardSource).not.toMatch(/Folded by default/);
    expect(personalBoardSource).not.toMatch(/personal-board-tasks-toggle/);
  });

  it('★★ the old quote is kept, but labelled as history', () => {
    // It is kept because the reasoning it produced still explains rules that
    // survived; it is labelled because it no longer describes the screen.
    expect(personalBoardSource).toContain('the primary focus should be the my board');
    expect(personalBoardSource).toContain('HISTORY, not the spec');
    expect(personalBoardSource).toContain('SUPERSEDES fix-326');
  });

  it('★ boardPanelPrefs is retired, and nothing imports it', async () => {
    const mods = import.meta.glob('../lib/*.ts');
    expect(Object.keys(mods)).not.toContain('../lib/boardPanelPrefs.ts');
    // collapsePrefs itself is untouched and still serves the Pipeline.
    expect(Object.keys(mods)).toContain('../lib/collapsePrefs.ts');
  });
});
