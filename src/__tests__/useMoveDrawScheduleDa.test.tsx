import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// Q9.5.f-fix-20: useMoveDrawScheduleDa wraps bp_move_draw_schedule_da. This
// suite verifies (1) the RPC payload mapping, (2) propagation result is
// surfaced to the caller (so DrawScheduleGrid can open GapFillPrompt), and
// (3) OCC conflict throws + warn toast.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown[] | null; error: Error | null } = {
    data: [],
    error: null,
  };
  const rpcFn = vi.fn();
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve(resolveResult);
    },
  };
  return {
    builder,
    rpcFn,
    setResult: (r: { data: unknown[] | null; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useMoveDrawScheduleDa } from '../hooks/useMoveDrawScheduleDa';

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useMoveDrawScheduleDa', () => {
  it('maps the input to the RPC arg names + returns the propagation summary', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_updated_at: '2026-05-14T12:30:00Z',
          out_conflict: false,
          out_old_da: 'Ainsley',
          out_permits_updated: 3,
          out_tasks_updated: 7,
          out_gap_exists: true,
          out_gap_downstream_count: 2,
          out_gap_after_week: '2026-05-04',
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });

    let moveResult: unknown;
    await act(async () => {
      moveResult = await result.current.mutateAsync({
        projectId: 'p-1',
        newDa: 'Trevor',
        newDm: 'Lindsay',
        startWeek: '2026-06-01',
        endWeek: '2026-06-22',
        scheduleStatus: 'Scheduled',
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_move_draw_schedule_da', {
      p_project_id: 'p-1',
      p_new_da: 'Trevor',
      p_new_dm: 'Lindsay',
      p_start_week: '2026-06-01',
      p_end_week: '2026-06-22',
      p_status: 'Scheduled',
      p_expected_updated_at: '2026-05-14T12:00:00Z',
    });

    // Caller (DrawScheduleGrid) uses gapExists + gapDownstreamCount to
    // decide whether to open GapFillPrompt — those have to survive the
    // RPC → hook → caller mapping intact.
    expect(moveResult).toEqual({
      projectId: 'p-1',
      updatedAt: '2026-05-14T12:30:00Z',
      oldDa: 'Ainsley',
      permitsUpdated: 3,
      tasksUpdated: 7,
      gapExists: true,
      gapDownstreamCount: 2,
      gapAfterWeek: '2026-05-04',
    });
  });

  it('summarizes propagation counts in the success toast', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_updated_at: '2026-05-14T12:30:00Z',
          out_conflict: false,
          out_old_da: 'Ainsley',
          out_permits_updated: 2,
          out_tasks_updated: 5,
          out_gap_exists: false,
          out_gap_downstream_count: 0,
          out_gap_after_week: null,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        newDa: 'Trevor',
        newDm: 'Lindsay',
        startWeek: '2026-06-01',
        endWeek: '2026-06-22',
        scheduleStatus: null,
        expectedUpdatedAt: '2026-05-14T12:00:00Z',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success).toBeTruthy();
      // Toast must call out the propagation impact so the user knows the
      // move rewrote more than just the schedule.
      expect(success?.message).toMatch(/2 permits/);
      expect(success?.message).toMatch(/5 tasks/);
    });
  });

  it('throws on out_conflict=true with a warn toast', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_updated_at: null,
          out_conflict: true,
          out_old_da: null,
          out_permits_updated: 0,
          out_tasks_updated: 0,
          out_gap_exists: false,
          out_gap_downstream_count: 0,
          out_gap_after_week: null,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useMoveDrawScheduleDa(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: 'p-1',
          newDa: 'Trevor',
          newDm: 'Lindsay',
          startWeek: '2026-06-01',
          endWeek: '2026-06-22',
          scheduleStatus: null,
          expectedUpdatedAt: 'STALE',
        }),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});
