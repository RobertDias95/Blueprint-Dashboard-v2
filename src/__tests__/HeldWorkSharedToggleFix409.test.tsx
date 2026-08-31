import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockTaskOwnership } from '../test/taskOwnership';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { resetShowHeldWorkCache } from '../lib/heldWorkPref';

// ===========================================================================
// fix-409 §3 (rendered) — "they live together in display"
// ===========================================================================
//
// Bobby, 2026-08-25 (register P-039): *"maybe when you turn it on in my tasks
// or my board, it will turn them on together — that way they live together in
// display."*
//
// ★★★ WHAT THIS PINS THAT THE PURE STORE TEST CANNOT. HeldWorkFix409.test.ts
// proves the mechanism — one value, broadcast, session-scoped. This proves the
// two SCREENS are actually wired to it: flip the switch on the My Tasks tab,
// navigate to My Board, and its own control is already on WITHOUT anybody
// having touched it. That is the requirement in Bobby's words, and it is the
// half that a refactor could silently break while every unit test still passed.

const state = vi.hoisted(() => ({
  tasks: [] as Record<string, unknown>[],
  projectHolds: [] as Record<string, unknown>[],
  userId: 'user-miles' as string | null,
}));

vi.mock('../hooks/usePermitHolds', () => ({
  useAllPermitHolds: () => ({ data: [] }),
  usePermitHolds: () => ({ data: [] }),
  activeHoldPermitIds: () => new Set<number>(),
  activeHoldByPermitId: () => new Map(),
  activePermitHold: () => null,
  useSetPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
  useLiftPermitHold: () => ({ mutate: vi.fn(), isPending: false }),
}));
// ★ The REAL cancelledProjectIds runs over a settable holds list, so this suite
//   exercises the same hold→set path production does rather than a stub of it.
vi.mock('../hooks/useProjectHolds', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useAllProjectHolds: () => ({
      data: state.projectHolds,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (st: unknown) => unknown) =>
    selector({
      session: null,
      user: state.userId ? { id: state.userId, email: 'miles@example.com' } : null,
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      activeTenantId: 't1',
    }),
}));
vi.mock('../hooks/useBoardLens', () => ({
  useBoardLens: () => ({
    associates: [],
    hasAssociates: false,
    lens: { mode: 'all' },
    setLens: vi.fn(),
    unmanaged: [],
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  activeMemberNamesOf: () => [],
}));
vi.mock('../hooks/useSelfScope', () => ({
  useSelfScope: () => ({
    identity: { name: 'Miles', roles: ['ent'], scope: 'permit', notes: null },
    userId: state.userId,
    isLoading: false,
  }),
  useScopeMode: () => ({
    mode: 'all',
    setMode: vi.fn(),
    identity: { name: 'Miles', roles: ['ent'], scope: 'permit', notes: null },
    ready: true,
  }),
}));
vi.mock('../hooks/useTaskOwnership', () => mockTaskOwnership());
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
vi.mock('../hooks/useWaitingOnTasks', () => ({
  useWaitingOnTasks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  groupByDisciplineThenFirm: () => [],
}));
vi.mock('../hooks/useTaskTree', () => ({
  useAllTasks: () => ({
    data: state.tasks,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpsertTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useSetTaskAssignees: () => ({ mutate: vi.fn() }),
  resolveUserName: () => null,
}));
vi.mock('../components/TaskDetailEditor', () => ({
  default: ({ task }: { task: { id: string } }) => (
    <div data-testid="stub-task-detail-editor" data-task={task.id} />
  ),
}));
vi.mock('../hooks/useBoardNotifications', () => ({
  useBoardNotifications: () => ({
    viewer: { name: 'Miles', roles: [], scope: 'permit' },
    items: [],
    unseen: [],
    readKeys: new Set<string>(),
    unseenCount: 0,
    signature: '',
    suppressed: { retries: 0, guarded: 0, notYours: 0 },
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
    target_date: '2026-08-01',
    due_date: null,
    done_at: null,
    sort_order: 0,
    assigned_to: 'Miles',
    primary_assignee: 'Miles',
    co_assignees: [],
    bucket: 'de',
    ...over,
  };
}

const openHold = (projectId: string) => ({
  id: `h-${projectId}`,
  project_id: projectId,
  kind: 'hold',
  reason: 'Waiting on builder',
  note: null,
  hold_start: '2026-08-01',
  hold_end: null,
});

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
    </Routes>,
    { wrapper },
  );
}

const tab = (id: string) => screen.getByTestId(`personal-board-tab-${id}`);

beforeEach(() => {
  seq = 0;
  state.tasks = [];
  state.projectHolds = [];
  state.userId = 'user-miles';
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetShowHeldWorkCache();
});

describe('fix-409: one switch, both screens', () => {
  it('★★★ THE REQUIREMENT: turn it on in My Tasks, My Board is already on', () => {
    state.tasks = [task()];
    state.projectHolds = [openHold('p1')];
    const view = renderAt('/board');

    // My Board first: its own control is OFF by default.
    expect(screen.getByTestId('my-board-show-held').dataset.on).toBe('false');

    // Over to My Tasks, and flip it there.
    fireEvent.click(tab('tasks'));
    const tasksSwitch = screen.getByTestId('mytasks-filter-held');
    expect(tasksSwitch.dataset.on).toBe('false');
    fireEvent.click(tasksSwitch);
    expect(screen.getByTestId('mytasks-filter-held').dataset.on).toBe('true');

    // ★★★ Back to My Board — nobody touched ITS control, and it is on.
    fireEvent.click(tab('board'));
    expect(screen.getByTestId('my-board-show-held').dataset.on).toBe('true');

    // ...and the other way round: turning it off on the BOARD turns it off in
    // My Tasks. "Together" has to mean both directions.
    fireEvent.click(screen.getByTestId('my-board-show-held'));
    fireEvent.click(tab('tasks'));
    expect(screen.getByTestId('mytasks-filter-held').dataset.on).toBe('false');
    view.unmount();
  });

  it('★★★ it SURVIVES A RELOAD — the same tab, a fresh mount', () => {
    state.tasks = [task()];
    state.projectHolds = [openHold('p1')];
    const first = renderAt('/board');
    fireEvent.click(screen.getByTestId('my-board-show-held'));
    expect(screen.getByTestId('my-board-show-held').dataset.on).toBe('true');
    first.unmount();

    // A reload: everything in memory goes, sessionStorage stays.
    resetShowHeldWorkCache();
    renderAt('/board');
    expect(screen.getByTestId('my-board-show-held').dataset.on).toBe('true');
  });

  it('★★★ a FRESH TAB is back to the default — Bobby: held work is auto off', () => {
    const first = renderAt('/board');
    fireEvent.click(screen.getByTestId('my-board-show-held'));
    first.unmount();

    window.sessionStorage.clear(); // what a new tab sees
    resetShowHeldWorkCache();
    renderAt('/board');
    expect(screen.getByTestId('my-board-show-held').dataset.on).toBe('false');
  });

  it('★★★ the My Tasks TAB BADGE agrees with the tab it labels', () => {
    // ★ The brief's hard rule: "counts in headers, badges, and any 'N open'
    //   summaries must agree with what is displayed." A badge saying "1 open"
    //   over an empty task list is the fix-264 defect wearing a new hat.
    state.tasks = [task({ project_id: 'p1' })];
    state.projectHolds = [openHold('p1')];
    renderAt('/board');

    const counts = () =>
      screen.getByTestId('personal-board-tasks-counts').textContent ?? '';
    expect(counts()).toContain('0 open');

    fireEvent.click(tab('tasks'));
    fireEvent.click(screen.getByTestId('mytasks-filter-held'));
    expect(counts()).toContain('1 open');
  });

  it('★★ the switch is not part of My Tasks\' filter Reset', () => {
    // ★ Deliberate: Reset clears THIS screen's filters. The held-work switch is
    //   a shared preference that also governs My Board, so resetting one
    //   screen's chips must not silently change what the other one shows.
    state.tasks = [task()];
    state.projectHolds = [openHold('p1')];
    renderAt('/board');
    fireEvent.click(tab('tasks'));
    fireEvent.click(screen.getByTestId('mytasks-filter-held'));
    expect(screen.getByTestId('mytasks-filter-held').dataset.on).toBe('true');
    fireEvent.click(screen.getByTestId('mytasks-filter-reset'));
    expect(screen.getByTestId('mytasks-filter-held').dataset.on).toBe('true');
  });
});
