import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type {
  MyTaskNode,
  TeamMember,
  WaitingOnTaskRow,
  WaitingOnDiscipline,
} from '../lib/database.types';

const T = 'test-tenant-uuid';

// fix-140 / fix-190d: WaitingOnView renders discipline -> firm groups. The firm
// now comes from projects.external_team (the editor's store) — so the hook keys
// firm_id by the firm NAME. This view test mocks useWaitingOnTasks (keeps the
// real groupByDisciplineThenFirm) so it exercises the render/grouping; the blob
// resolver itself is unit-tested in externalTeam.test.ts.

let seq = 0;
function makeRow(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  seq += 1;
  return {
    task_id: `task-${seq}`,
    task_text: `Task ${seq}`,
    bucket: 'de',
    waiting_on: 'Civil' as WaitingOnDiscipline,
    firm_id: null,
    firm_name: null,
    firm_active: true,
    project_id: 'proj-1',
    project_address: '500 Pike St',
    project_juris: 'Seattle',
    permit_id: 1,
    permit_type: 'Building Permit',
    assigned_to: 'Bobby',
    priority: false,
    start_date: null,
    due_date: null,
    target_date: null,
    completion_status: 'Open',
    done: false,
    done_at: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const dataRef = vi.hoisted(() => ({
  active: [] as unknown[],
  resolved: [] as unknown[],
}));
const hookSpy = vi.hoisted(() => vi.fn());

// fix-236: WaitingOnView now hosts the same Mine/All scope control as the board.
// That pulls in useScopeMode (→ useTeamMembers + useProjects) and useAllTasks
// (the full task set, cross-referenced by task_id to resolve ownership). Mock
// them here so the view stays hermetic; the default auth login below has no
// roster email, so scope resolves to 'all' and the existing render/grouping
// tests see every row (the scope-filter tests set a matching login explicitly).
const teamRef = vi.hoisted(() => ({ current: [] as TeamMember[] }));
const allTasksRef = vi.hoisted(() => ({ current: [] as MyTaskNode[] }));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../hooks/useTeamMembers', async (orig) => {
  const real = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...real,
    useTeamMembers: () => ({
      all: teamRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useTaskTree', async (orig) => {
  const real = await orig<typeof import('../hooks/useTaskTree')>();
  return {
    ...real,
    useAllTasks: () => ({
      data: allTasksRef.current,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

// Keep the real groupByDisciplineThenFirm; mock only the data hook.
vi.mock('../hooks/useWaitingOnTasks', async (orig) => {
  const real = await orig<typeof import('../hooks/useWaitingOnTasks')>();
  return {
    ...real,
    useWaitingOnTasks: (opts: { includeCompleted: boolean }) => {
      hookSpy(opts);
      const rows = opts.includeCompleted
        ? [...dataRef.active, ...dataRef.resolved]
        : dataRef.active;
      return { data: rows, isLoading: false, error: null, refetch: vi.fn() };
    },
  };
});

function member(
  over: Partial<TeamMember> & Pick<TeamMember, 'name' | 'role'>,
): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-01-01T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

let taskSeq = 0;
function ownedTask(
  over: Partial<MyTaskNode> & Pick<MyTaskNode, 'id'>,
): MyTaskNode {
  taskSeq += 1;
  return {
    permit_id: 1,
    parent_task_id: null,
    discipline: 'ent',
    bucket: 'de',
    text: `Task ${taskSeq}`,
    status: 'Open',
    start_date: null,
    target_date: null,
    project_id: 'proj-1',
    project_address: '500 Pike St',
    permit_type: 'Building Permit',
    primary_assignee: null,
    co_assignees: [],
    ...over,
  } as MyTaskNode;
}

const csvMock = vi.hoisted(() => ({
  exportAllToCsv: vi.fn(),
  exportFirmToCsv: vi.fn(),
}));
vi.mock('../lib/waitingOnCsv', () => csvMock);

import WaitingOnView from '../components/MyTasks/WaitingOnView';

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<WaitingOnView />, { wrapper });
}

beforeEach(() => {
  hookSpy.mockClear();
  csvMock.exportAllToCsv.mockClear();
  csvMock.exportFirmToCsv.mockClear();
  // Firm comes from the project blob → firm_id carries the firm NAME.
  // Civil -> Emerald (2 tasks) + (no firm, 1 task); Structural -> SSS (1 task).
  dataRef.active = [
    makeRow({ task_id: 't1', waiting_on: 'Civil', firm_id: 'Emerald', firm_name: 'Emerald' }),
    makeRow({ task_id: 't2', waiting_on: 'Civil', firm_id: 'Emerald', firm_name: 'Emerald' }),
    makeRow({ task_id: 't3', waiting_on: 'Civil', firm_id: null, firm_name: null, project_id: 'proj-2' }),
    makeRow({ task_id: 't4', waiting_on: 'Structural', firm_id: 'SSS', firm_name: 'SSS' }),
  ];
  dataRef.resolved = [
    makeRow({ task_id: 't5', waiting_on: 'Civil', firm_id: 'Emerald', firm_name: 'Emerald', completion_status: 'Resolved' }),
  ];
  // fix-236: default to an unmapped login (no roster email match) so scope
  // resolves to 'all' — the render/grouping tests below see every row. The
  // scope-filter tests set a matching login + roster explicitly.
  teamRef.current = [];
  allTasksRef.current = [];
  window.localStorage.clear();
  useAuthStore.setState({
    user: null,
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('WaitingOnView', () => {
  it('renders the empty state when there are zero tasks', async () => {
    dataRef.active = [];
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-empty')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('waiting-on-empty').textContent).toMatch(
      /No tasks are waiting on external teams/i,
    );
  });

  it('renders discipline sections, firm sections (keyed by firm name), and task rows', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-discipline-Civil')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('waiting-on-discipline-Structural')).toBeInTheDocument();
    const emerald = screen.getByTestId('waiting-on-firm-Emerald');
    expect(within(emerald).getByText('Emerald')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-task-t1')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-task-t2')).toBeInTheDocument();
    expect(
      screen.getByTestId('waiting-on-task-t1-project').getAttribute('href'),
    ).toBe('/project/proj-1');
  });

  it('null-firm group renders "(no firm assigned)" and no CSV button', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-firm-none')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('waiting-on-firm-none').textContent).toMatch(
      /\(no firm assigned\)/,
    );
    expect(screen.queryByTestId('waiting-on-csv-firm-none')).toBeNull();
  });

  it('per-firm CSV button calls exportFirmToCsv with the matching filter (firm name id)', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-csv-firm-Emerald')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('waiting-on-csv-firm-Emerald'));
    expect(csvMock.exportFirmToCsv).toHaveBeenCalledTimes(1);
    const [, filter] = csvMock.exportFirmToCsv.mock.calls[0];
    expect(filter).toEqual({ discipline: 'Civil', firmId: 'Emerald' });
  });

  it('"Include completed" toggle re-queries the hook with includeCompleted=true', async () => {
    renderView();
    await waitFor(() =>
      expect(hookSpy).toHaveBeenCalledWith({ includeCompleted: false }),
    );
    fireEvent.click(screen.getByTestId('waiting-on-include-completed'));
    await waitFor(() =>
      expect(hookSpy).toHaveBeenCalledWith({ includeCompleted: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-task-t5')).toBeInTheDocument(),
    );
  });

  it('an unmapped login (no roster match) shows the holistic list and no scope toggle', async () => {
    // Default beforeEach login has no roster email → scope 'all', toggle hidden.
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-task-t1')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('waiting-on-scope')).toBeNull();
    // Every waiting-on row is visible (no personal narrowing).
    expect(screen.getByTestId('waiting-on-task-t4')).toBeInTheDocument();
  });
});

// fix-236: the Mine/All scope toggle mirrors the board — "Mine" narrows to the
// rows whose task_id is owned by the logged-in user under the board's ownership
// rule (primary assignee OR co-assignee, resolved from the full task set),
// "Everyone" shows all. Default follows the board's role-aware default ('mine'
// for a rostered user with no remembered choice).
describe('WaitingOnView scope filter (fix-236)', () => {
  beforeEach(() => {
    // Rostered login: Bobby matches by email → scope resolves to a self default.
    teamRef.current = [member({ name: 'Bobby', role: 'ent_lead', email: 'bobby@x.com' })];
    // Ownership per the board's rule: Bobby is primary on t1 and a co-assignee
    // on t2; t3/t4 belong to others. So "Mine" keeps only t1 + t2 (both Civil /
    // Emerald) and drops t3 (no-firm Civil) and t4 (Structural).
    allTasksRef.current = [
      ownedTask({ id: 't1', primary_assignee: 'Bobby' }),
      ownedTask({ id: 't2', primary_assignee: 'Trevor', co_assignees: ['Bobby'] }),
      ownedTask({ id: 't3', primary_assignee: 'Trevor' }),
      ownedTask({ id: 't4', primary_assignee: 'Ainsley' }),
    ];
    useAuthStore.setState({
      user: { id: 'u-bobby', email: 'bobby@x.com' } as never,
      activeTenantId: T,
      memberships: [{ tenant_id: T, role: 'admin' }],
    });
  });

  it('defaults to "Mine" for a rostered user and shows only their owned rows', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-scope')).toBeInTheDocument(),
    );
    // Mine is the active default.
    expect(
      screen.getByTestId('waiting-on-scope-mine').getAttribute('aria-pressed'),
    ).toBe('true');
    // Owned rows (t1, t2) present; others (t3, t4) filtered out.
    expect(screen.getByTestId('waiting-on-task-t1')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-task-t2')).toBeInTheDocument();
    expect(screen.queryByTestId('waiting-on-task-t3')).toBeNull();
    expect(screen.queryByTestId('waiting-on-task-t4')).toBeNull();
    // The Structural discipline (only t4) drops out entirely.
    expect(screen.queryByTestId('waiting-on-discipline-Structural')).toBeNull();
  });

  it('toggling to "Everyone" reveals every waiting-on row', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-task-t1')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('waiting-on-task-t4')).toBeNull();

    fireEvent.click(screen.getByTestId('waiting-on-scope-all'));

    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-task-t4')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('waiting-on-task-t3')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-discipline-Structural')).toBeInTheDocument();
    // Toggling back to Mine re-applies the personal narrowing.
    fireEvent.click(screen.getByTestId('waiting-on-scope-mine'));
    await waitFor(() =>
      expect(screen.queryByTestId('waiting-on-task-t4')).toBeNull(),
    );
  });

  it('CSV export reflects the scoped rows ("Mine" exports only owned rows)', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-csv-all')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('waiting-on-csv-all'));
    expect(csvMock.exportAllToCsv).toHaveBeenCalledTimes(1);
    const [exported] = csvMock.exportAllToCsv.mock.calls[0] as [
      WaitingOnTaskRow[],
    ];
    expect(exported.map((r) => r.task_id).sort()).toEqual(['t1', 't2']);
  });
});
