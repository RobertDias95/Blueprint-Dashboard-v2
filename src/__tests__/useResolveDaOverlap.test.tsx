import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import type { DrawScheduleRow } from '../lib/database.types';

// Q6.2.b: useResolveDaOverlap wire-shape + cache-write tests. Server math
// is verified by execute_sql smokes (5 scenarios) — these tests only cover
// (1) RPC arg shape, (2) anchor cache writeback on success (Bug B fix
// pattern), (3) optimistic anchor patch + rollback on conflict, (4) toast
// content matches the pushed count.

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

import { useResolveDaOverlap } from '../hooks/useResolveDaOverlap';

function makeRow(over: Partial<DrawScheduleRow> = {}): DrawScheduleRow {
  return {
    project_id: 'anchor-id',
    da_assigned: 'Trevor',
    start_week: '2026-05-04',
    end_week: '2026-05-18',
    status: 'Scheduled',
    manual_status: null,
    manually_placed: true,
    dd_start: '2026-05-04',
    dd_end: '2026-05-22',
    notes: null,
    color_override: null,
    status_override: null,
    updated_at: '2026-05-10T14:32:10Z',
    ...over,
  };
}

function setup() {
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

describe('useResolveDaOverlap', () => {
  it('fires bp_resolve_da_overlap with the right param shape', async () => {
    mocks.setResult({
      data: [
        {
          out_anchor_project_id: 'anchor-id',
          out_anchor_updated_at: '2026-05-10T15:00:00Z',
          out_pushed_project_ids: ['p-a', 'p-b'],
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [makeRow()]);

    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        anchorProjectId: 'anchor-id',
        expectedUpdatedAt: '2026-05-10T14:32:10Z',
        daAssigned: 'Ahmadi',
        startWeek: '2026-06-01',
        endWeek: '2026-06-15',
        scheduleStatus: 'Submitted',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_resolve_da_overlap');
    expect(args).toEqual({
      p_anchor_project_id: 'anchor-id',
      p_target_da: 'Ahmadi',
      p_target_start_week: '2026-06-01',
      p_target_end_week: '2026-06-15',
      p_anchor_status: 'Submitted',
      p_anchor_expected_updated_at: '2026-05-10T14:32:10Z',
    });
  });

  it('on success: writes the fresh out_anchor_updated_at into the cache synchronously', async () => {
    const FRESH = '2026-05-10T15:00:00Z';
    mocks.setResult({
      data: [
        {
          out_anchor_project_id: 'anchor-id',
          out_anchor_updated_at: FRESH,
          out_pushed_project_ids: ['p-a'],
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [makeRow()]);

    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        anchorProjectId: 'anchor-id',
        expectedUpdatedAt: '2026-05-10T14:32:10Z',
        daAssigned: 'Ahmadi',
        startWeek: '2026-06-01',
        endWeek: '2026-06-15',
        scheduleStatus: 'Submitted',
      });
    });

    const cached = queryClient.getQueryData<DrawScheduleRow[]>(
      queryKeys.drawSchedule(T),
    );
    expect(cached?.[0].updated_at).toBe(FRESH);
    expect(cached?.[0].da_assigned).toBe('Ahmadi');
    expect(cached?.[0].start_week).toBe('2026-06-01');
    expect(cached?.[0].end_week).toBe('2026-06-15');
    expect(cached?.[0].status).toBe('Submitted');
  });

  it('toasts "Pushed N projects down" with the correct count', async () => {
    mocks.setResult({
      data: [
        {
          out_anchor_project_id: 'anchor-id',
          out_anchor_updated_at: '2026-05-10T15:00:00Z',
          out_pushed_project_ids: ['p-a', 'p-b', 'p-c'],
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [makeRow()]);

    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        anchorProjectId: 'anchor-id',
        expectedUpdatedAt: '2026-05-10T14:32:10Z',
        daAssigned: 'Ahmadi',
        startWeek: '2026-06-01',
        endWeek: '2026-06-15',
        scheduleStatus: 'Submitted',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success?.message).toMatch(/Pushed 3 projects down/i);
    });
  });

  it('on out_conflict=true: rolls back optimistic anchor patch + warn toast', async () => {
    const original = makeRow();
    mocks.setResult({
      data: [
        {
          out_anchor_project_id: 'anchor-id',
          out_anchor_updated_at: null,
          out_pushed_project_ids: [],
          out_conflict: true,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [original]);

    const { result } = renderHook(() => useResolveDaOverlap(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          anchorProjectId: 'anchor-id',
          expectedUpdatedAt: '2026-05-10T14:32:10Z',
          daAssigned: 'Ahmadi',
          startWeek: '2026-06-01',
          endWeek: '2026-06-15',
          scheduleStatus: 'Submitted',
        }),
      ).rejects.toThrow();
    });

    const cached = queryClient.getQueryData<DrawScheduleRow[]>(
      queryKeys.drawSchedule(T),
    );
    // Rollback: original DA + start_week restored.
    expect(cached?.[0].da_assigned).toBe('Trevor');
    expect(cached?.[0].start_week).toBe('2026-05-04');

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn?.message).toMatch(/modified by someone else/i);
    });
  });
});
