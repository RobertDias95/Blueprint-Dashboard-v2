import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { MyTaskNode } from '../lib/database.types';

// fix-78: My Tasks reverts to v1's "show all tasks with filters" model. fix-70
// had walled it down to "primary OR co-assigned" per Bobby's spec at the time;
// that broke his manager workflows (find every Open Corrections, every task on
// project X, every task assigned to Miles). These tests pin the new contract:
// all tenant tasks visible by default, filter chips narrow client-side,
// localStorage persists filters across remounts.

const allTasksSpy = vi.hoisted(() => vi.fn());
const teamRef = vi.hoisted(() => ({
  current: [
    { name: 'Bobby', email: 'bobby@x.com' },
    { name: 'Edmund', email: 'edmund@x.com' },
    { name: 'Miles', email: 'miles@x.com' },
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
    useAllTasks: () => {
      allTasksSpy();
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
    bucket: 'de',
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

/** A varied fixture set the filter tests can narrow against. Covers: two
 *  projects, two permits, both disciplines, all three statuses, both
 *  primary-assignee and co-assignee paths, and one explicit subtask. */
function varied(): MyTaskNode[] {
  return [
    node({
      id: 'a-arch-open',
      project_id: 'p1',
      project_address: '123 Main St',
      permit_id: 1,
      permit_type: 'Building Permit',
      discipline: 'arch',
      status: 'Open',
      text: 'Submit corrections to SDCI',
      primary_assignee: 'Bobby',
    }),
    node({
      id: 'a-arch-inprog',
      project_id: 'p1',
      project_address: '123 Main St',
      permit_id: 1,
      permit_type: 'Building Permit',
      discipline: 'arch',
      status: 'In Progress',
      text: 'Review structural drawings',
      primary_assignee: 'Bobby',
    }),
    node({
      id: 'a-ent-resolved',
      project_id: 'p1',
      project_address: '123 Main St',
      permit_id: 1,
      permit_type: 'Building Permit',
      discipline: 'ent',
      status: 'Resolved',
      text: 'Submit MUP application',
      primary_assignee: 'Miles',
    }),
    node({
      id: 'b-ent-open',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'ent',
      status: 'Open',
      text: 'Address ECA corrections',
      primary_assignee: 'Edmund',
      co_assignees: ['Bobby'],
    }),
    node({
      id: 'b-arch-open',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'arch',
      status: 'Open',
      text: 'Update site plan',
      primary_assignee: 'Miles',
    }),
    node({
      id: 'b-ent-sub',
      parent_task_id: 'b-ent-open',
      project_id: 'p2',
      project_address: '500 Pike St',
      permit_id: 2,
      permit_type: 'PAR/Pre-Sub',
      discipline: 'ent',
      status: 'Open',
      text: 'Pull steep-slope study',
      primary_assignee: 'Edmund',
    }),
  ];
}

beforeEach(() => {
  allTasksSpy.mockReset();
  teamRef.current = [
    { name: 'Bobby', email: 'bobby@x.com' },
    { name: 'Edmund', email: 'edmund@x.com' },
    { name: 'Miles', email: 'miles@x.com' },
  ];
  tasksRef.current = [];
  // Default: signed in as bobby@x.com → resolves to 'Bobby' for the Me preset.
  useAuthStore.setState({
    user: { email: 'bobby@x.com' } as never,
    activeTenantId: 'test-tenant',
  });
  window.localStorage.clear();
});

describe('MyTasks (fix-78 all-tasks view + filter chips)', () => {
  it('renders ALL tenant tasks by default (no personal-scope wall)', () => {
    tasksRef.current = varied();
    renderIt();
    // Default status filter is Open + In Progress, so the Resolved task is
    // hidden by default. Open + In Progress tasks (4 of them) all render.
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-a-arch-inprog')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-ent-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    // Subtask nested under its parent.
    expect(screen.getByTestId('mytask-row-b-ent-sub')).toBeInTheDocument();
    // The Resolved one is excluded by the default Open+InProgress filter.
    expect(screen.queryByTestId('mytask-row-a-ent-resolved')).toBeNull();
  });

  it('All statuses preset shows every task — the page is no longer a personal wall', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-status-all'));
    // Includes the Resolved task that the default filter hid.
    expect(screen.getByTestId('mytask-row-a-ent-resolved')).toBeInTheDocument();
    // And tasks NOT assigned to Bobby still show (Edmund's, Miles').
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
  });

  it('Discipline=Architecture hides ENT tasks', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-discipline-arch'));
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-a-arch-inprog')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    // ENT tasks gone.
    expect(screen.queryByTestId('mytask-row-b-ent-open')).toBeNull();
    expect(screen.queryByTestId('mytask-row-b-ent-sub')).toBeNull();
  });

  it('Status=Open hides In Progress + Resolved', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-status-Open'));
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-row-a-arch-inprog')).toBeNull();
    expect(screen.queryByTestId('mytask-row-a-ent-resolved')).toBeNull();
  });

  it('Title contains "correction" narrows to matching tasks', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-title'), {
      target: { value: 'correction' },
    });
    // Both tasks with "corrections" in the title (case-insensitive).
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-ent-open')).toBeInTheDocument();
    // Others gone.
    expect(screen.queryByTestId('mytask-row-a-arch-inprog')).toBeNull();
    expect(screen.queryByTestId('mytask-row-b-arch-open')).toBeNull();
  });

  it('Project filter narrows to matching addresses', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-project'), {
      target: { value: 'Pike' },
    });
    // Only the 500 Pike St tasks survive (default Open+InProgress also applies).
    expect(screen.getByTestId('mytask-row-b-ent-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-row-a-arch-open')).toBeNull();
  });

  it('Assignee chip "Miles" surfaces only Miles\'s tasks (as primary OR co-assignee)', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-assignee-select'), {
      target: { value: 'Miles' },
    });
    // Miles is the primary on b-arch-open. (a-ent-resolved is hidden by the
    // default status filter; that's the right interaction — filters compose.)
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-row-a-arch-open')).toBeNull();
    expect(screen.queryByTestId('mytask-row-b-ent-open')).toBeNull();
    // Chip is rendered + removable.
    expect(
      screen.getByTestId('mytasks-filter-assignee-chip-Miles'),
    ).toBeInTheDocument();
  });

  it('Me preset filters to the signed-in user (primary OR co-assignee)', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-preset-me'));
    // Bobby is the primary on a-arch-open + a-arch-inprog, and a co-assignee
    // on b-ent-open (which also drags in the subtask b-ent-sub by nesting).
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-a-arch-inprog')).toBeInTheDocument();
    expect(screen.getByTestId('mytask-row-b-ent-open')).toBeInTheDocument();
    // Miles's b-arch-open is hidden.
    expect(screen.queryByTestId('mytask-row-b-arch-open')).toBeNull();
  });

  it('empty state when filters exclude everything', () => {
    tasksRef.current = varied();
    renderIt();
    fireEvent.change(screen.getByTestId('mytasks-filter-title'), {
      target: { value: 'nothing-matches-this' },
    });
    expect(screen.getByTestId('mytasks-empty').textContent).toMatch(
      /no tasks match/i,
    );
  });

  it('filters persist across an unmount + remount via localStorage', () => {
    tasksRef.current = varied();
    const { unmount } = renderIt();
    fireEvent.click(screen.getByTestId('mytasks-filter-discipline-arch'));
    fireEvent.change(screen.getByTestId('mytasks-filter-title'), {
      target: { value: 'site' },
    });
    // Only b-arch-open (text "Update site plan") survives.
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-row-a-arch-open')).toBeNull();

    unmount();
    renderIt();
    // After remount, the discipline + title filters restored from localStorage.
    expect(screen.getByTestId('mytask-row-b-arch-open')).toBeInTheDocument();
    expect(screen.queryByTestId('mytask-row-a-arch-open')).toBeNull();
    expect(
      (screen.getByTestId('mytasks-filter-title') as HTMLInputElement).value,
    ).toBe('site');
  });

  it('unmapped email DOES NOT hide tasks (fix-78 dropped the personal wall)', () => {
    useAuthStore.setState({ user: { email: 'stranger@x.com' } as never });
    tasksRef.current = varied();
    renderIt();
    // Page renders normally. The fix-70 no-identity message is gone.
    expect(screen.queryByTestId('mytasks-no-identity')).toBeNull();
    expect(screen.getByTestId('mytask-row-a-arch-open')).toBeInTheDocument();
    // The Me preset button is disabled (no userName to match) but doesn't
    // throw, doesn't block the page.
    expect(
      (
        screen.getByTestId('mytasks-filter-preset-me') as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
