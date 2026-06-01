import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-87: Errors page renders groups; expand shows full context; the
// action buttons fire the status RPC with the right fingerprint + status.

const T = 'tenant-uuid';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}));
// The Errors page imports pushToast for the copy-to-clipboard flow; the
// toast store transitively imports logError. Stub logError so the toast
// path doesn't trip the supabase mock.
vi.mock('../lib/errorLogger', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
  messageOf: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import ErrorsPage from '../pages/Errors';

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  rpcMock.mockReset();
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ErrorsPage />, { wrapper });
}

const sampleGroups = [
  {
    fingerprint: 'f-aaa',
    source: 'frontend_toast',
    level: 'error',
    sample_message: 'Could not save permit',
    sample_context: { url: '/project/abc' },
    status: 'new',
    first_seen: new Date(Date.now() - 60_000).toISOString(),
    last_seen: new Date(Date.now() - 30_000).toISOString(),
    count: 3,
    user_count: 1,
    backlog_ref: null,
  },
  {
    fingerprint: 'f-bbb',
    source: 'backend_rpc',
    level: 'error',
    sample_message: 'permission denied for table permits',
    sample_context: { kind: 'mutation' },
    status: 'queued',
    first_seen: new Date(Date.now() - 600_000).toISOString(),
    last_seen: new Date(Date.now() - 60_000).toISOString(),
    count: 1,
    user_count: 1,
    backlog_ref: 'fix-90',
  },
];

describe('<ErrorsPage /> (fix-87)', () => {
  it('renders one row per group from bp_list_error_groups', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'bp_list_error_groups') {
        return Promise.resolve({ data: sampleGroups, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    renderIt();
    await waitFor(() => {
      expect(screen.getByTestId('error-group-f-aaa')).toBeInTheDocument();
      expect(screen.getByTestId('error-group-f-bbb')).toBeInTheDocument();
    });
  });

  it('expanding a row reveals the sample context jsonb', async () => {
    rpcMock.mockImplementation((name: string) =>
      name === 'bp_list_error_groups'
        ? Promise.resolve({ data: sampleGroups, error: null })
        : Promise.resolve({ data: null, error: null }),
    );
    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-aaa')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('error-group-toggle-f-aaa'));
    const detail = screen.getByTestId('error-group-detail-f-aaa');
    expect(detail.textContent).toContain('/project/abc');
  });

  it('"Queue for fix" fires bp_update_error_group_status with newStatus=queued', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'bp_list_error_groups')
        return Promise.resolve({ data: sampleGroups, error: null });
      if (name === 'bp_update_error_group_status')
        return Promise.resolve({ data: 2, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    // window.prompt isn't implemented in jsdom — stub it.
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('fix-88');

    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-aaa')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('error-group-toggle-f-aaa'));
    fireEvent.click(screen.getByTestId('error-group-queue-f-aaa'));

    await waitFor(() => {
      const updateCalls = rpcMock.mock.calls.filter(
        (c) => c[0] === 'bp_update_error_group_status',
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual({
        p_fingerprint: 'f-aaa',
        p_new_status: 'queued',
        p_backlog_ref: 'fix-88',
      });
    });

    promptSpy.mockRestore();
  });

  it('switching to Resolved tab refetches with the resolved status set', async () => {
    rpcMock.mockImplementation((name: string, args: { p_status: string[] }) => {
      if (name === 'bp_list_error_groups') {
        const active = args.p_status.includes('new');
        return Promise.resolve({
          data: active ? sampleGroups : [],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId('error-group-f-aaa')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('errors-tab-resolved'));
    await waitFor(() => {
      expect(screen.getByTestId('errors-empty')).toBeInTheDocument();
    });
    // The most recent bp_list_error_groups call carries the resolved set.
    const lastListCall = rpcMock.mock.calls
      .filter((c) => c[0] === 'bp_list_error_groups')
      .at(-1);
    expect(lastListCall?.[1].p_status).toEqual(['dismissed', 'resolved']);
  });
});
