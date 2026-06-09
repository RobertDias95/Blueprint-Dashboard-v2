import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { WaitingOnTaskRow, WaitingOnDiscipline } from '../lib/database.types';

const T = 'test-tenant-uuid';

// fix-140: WaitingOnView. Mocks supabase.rpc (returns fixture rows, with an
// extra Resolved row when p_include_completed is true) + the CSV module so the
// per-firm export button assertion doesn't touch the DOM download.

let seq = 0;
function makeRow(over: Partial<WaitingOnTaskRow> = {}): WaitingOnTaskRow {
  seq += 1;
  return {
    task_id: `task-${seq}`,
    task_text: `Task ${seq}`,
    bucket: 'de',
    waiting_on: 'Civil' as WaitingOnDiscipline,
    firm_id: 'f1',
    firm_name: 'Prism',
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
const rpcSpy = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcSpy(name, args);
      if (name === 'bp_list_waiting_on_tasks') {
        const rows = args.p_include_completed
          ? [...dataRef.active, ...dataRef.resolved]
          : dataRef.active;
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

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
  rpcSpy.mockClear();
  csvMock.exportAllToCsv.mockClear();
  csvMock.exportFirmToCsv.mockClear();
  // Fixture: Civil -> Prism (f1, active, 2 tasks) + (no firm, 1 task);
  //          Structural -> SSS (f3, archived, 1 task).
  dataRef.active = [
    makeRow({ task_id: 't1', waiting_on: 'Civil', firm_id: 'f1', firm_name: 'Prism', firm_active: true }),
    makeRow({ task_id: 't2', waiting_on: 'Civil', firm_id: 'f1', firm_name: 'Prism', firm_active: true }),
    makeRow({ task_id: 't3', waiting_on: 'Civil', firm_id: null, firm_name: null, firm_active: null }),
    makeRow({ task_id: 't4', waiting_on: 'Structural', firm_id: 'f3', firm_name: 'SSS', firm_active: false }),
  ];
  dataRef.resolved = [
    makeRow({ task_id: 't5', waiting_on: 'Civil', firm_id: 'f1', firm_name: 'Prism', firm_active: true, completion_status: 'Resolved' }),
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

  it('renders discipline sections, firm sections, and task rows', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-discipline-Civil')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('waiting-on-discipline-Structural')).toBeInTheDocument();
    // Civil -> Prism firm group with both Prism tasks.
    const prism = screen.getByTestId('waiting-on-firm-f1');
    expect(within(prism).getByText('Prism')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-task-t1')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-task-t2')).toBeInTheDocument();
    // project link points at the project page.
    expect(
      screen.getByTestId('waiting-on-task-t1-project').getAttribute('href'),
    ).toBe('/project/proj-1');
  });

  it('archived firm shows the "(archived)" label', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-firm-f3')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('waiting-on-firm-f3-archived'),
    ).toBeInTheDocument();
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

  it('per-firm CSV button calls exportFirmToCsv with the matching filter', async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-csv-firm-f1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('waiting-on-csv-firm-f1'));
    expect(csvMock.exportFirmToCsv).toHaveBeenCalledTimes(1);
    const [, filter] = csvMock.exportFirmToCsv.mock.calls[0];
    expect(filter).toEqual({ discipline: 'Civil', firmId: 'f1' });
  });

  it('"Include completed" toggle re-queries with p_include_completed=true', async () => {
    renderView();
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('bp_list_waiting_on_tasks', {
        p_include_completed: false,
      }),
    );
    fireEvent.click(screen.getByTestId('waiting-on-include-completed'));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('bp_list_waiting_on_tasks', {
        p_include_completed: true,
      }),
    );
    // The resolved task now surfaces.
    await waitFor(() =>
      expect(screen.getByTestId('waiting-on-task-t5')).toBeInTheDocument(),
    );
  });
});
