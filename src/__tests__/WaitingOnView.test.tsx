import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { WaitingOnTaskRow, WaitingOnDiscipline } from '../lib/database.types';

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
  useAuthStore.setState({
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
});
