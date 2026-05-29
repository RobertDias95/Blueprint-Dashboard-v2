import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { MyTaskNode } from '../lib/database.types';

// fix-70: My Tasks rebuilt on bp_my_tasks. The page resolves the caller's
// display name from the team roster (by auth email), then renders ONLY the
// tasks the RPC returns (primary OR co-assigned) grouped project -> permit ->
// discipline. The bucket-scoped visibility rule itself lives in the SQL; here
// we verify the page (a) resolves the name, (b) renders exactly what the RPC
// returns, (c) nests subtasks, (d) handles an unmatched email.

const myTasksSpy = vi.hoisted(() => vi.fn());
const teamRef = vi.hoisted(() => ({
  current: [
    { name: 'Bobby', email: 'bobby@x.com' },
    { name: 'Edmund', email: 'edmund@x.com' },
  ] as { name: string; email: string | null }[],
}));
const tasksRef = vi.hoisted(() => ({ current: [] as MyTaskNode[] }));

vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: teamRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/useTaskTree', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useTaskTree')>();
  return {
    ...actual, // keep the real resolveUserName
    useMyTasks: (userName: string | null) => {
      myTasksSpy(userName);
      return {
        data: tasksRef.current,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      };
    },
  };
});

import MyTasks from '../pages/MyTasks';

function node(over: Partial<MyTaskNode> & Pick<MyTaskNode, 'id'>): MyTaskNode {
  return {
    permit_id: 1,
    project_id: 'p1',
    project_address: '123 Main St',
    permit_type: 'Building Permit',
    parent_task_id: null,
    discipline: 'arch',
    text: 'Task text',
    status: 'Open',
    start_date: null,
    target_date: null,
    done_at: null,
    sort_order: 0,
    primary_assignee: 'Bobby',
    co_assignees: [],
    ...over,
  };
}

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<MyTasks />, { wrapper });
}

beforeEach(() => {
  myTasksSpy.mockReset();
  teamRef.current = [
    { name: 'Bobby', email: 'bobby@x.com' },
    { name: 'Edmund', email: 'edmund@x.com' },
  ];
  tasksRef.current = [];
  // Default: signed in as bobby@x.com -> resolves to 'Bobby'.
  useAuthStore.setState({
    user: { email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
});

describe('MyTasks (fix-70)', () => {
  it('resolves the auth email to the roster name and queries bp_my_tasks with it', () => {
    renderIt();
    expect(myTasksSpy).toHaveBeenCalledWith('Bobby');
  });

  it('renders only the tasks the RPC returns, grouped by project + permit', () => {
    tasksRef.current = [
      node({
        id: 'a',
        project_id: 'p1',
        project_address: '123 Main St',
        permit_id: 1,
        discipline: 'arch',
        text: 'Arch task (mine as DA)',
      }),
      node({
        id: 'b',
        project_id: 'p2',
        project_address: '500 Pike St',
        permit_id: 2,
        discipline: 'ent',
        text: 'Ent task (co-assigned)',
        primary_assignee: 'Edmund',
        co_assignees: ['Bobby'],
      }),
    ];
    renderIt();
    expect(screen.getByTestId('mytask-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-project-p1')).toBeInTheDocument();
    expect(screen.getByTestId('mytasks-project-p2')).toBeInTheDocument();
    // A task the RPC did NOT return is absent (server filters; page renders
    // only what it gets — the visibility rule itself is enforced in SQL).
    expect(screen.queryByTestId('mytask-row-not-mine')).toBeNull();
  });

  it('nests a subtask under its parent rather than as a separate top-level row', () => {
    tasksRef.current = [
      node({ id: 'parent', text: 'Parent' }),
      node({ id: 'child', parent_task_id: 'parent', text: 'Child' }),
    ];
    renderIt();
    const parentRow = screen.getByTestId('mytask-row-parent');
    const childRow = screen.getByTestId('mytask-row-child');
    // The child row is rendered inside the parent row's subtree.
    expect(parentRow.contains(childRow)).toBe(true);
  });

  it('shows status + assignees on a task row', () => {
    tasksRef.current = [
      node({
        id: 'a',
        status: 'In Progress',
        primary_assignee: 'Bobby',
        co_assignees: ['Edmund'],
      }),
    ];
    renderIt();
    expect(screen.getByTestId('mytask-status-a').textContent).toBe('In Progress');
    expect(screen.getByTestId('mytask-assignees-a').textContent).toContain('Bobby');
    expect(screen.getByTestId('mytask-assignees-a').textContent).toContain('Edmund');
  });

  it('empty state when the user has no assigned tasks', () => {
    tasksRef.current = [];
    renderIt();
    expect(screen.getByTestId('mytasks-empty')).toBeInTheDocument();
  });

  it('shows a no-identity message when the auth email matches no roster member', () => {
    useAuthStore.setState({ user: { email: 'stranger@x.com' } as never });
    renderIt();
    expect(screen.getByTestId('mytasks-no-identity')).toBeInTheDocument();
    // Never queries bp_my_tasks without a resolved name.
    expect(myTasksSpy).toHaveBeenCalledWith('');
  });
});
