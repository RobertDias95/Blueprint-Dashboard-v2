import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import type { DrawScheduleRow } from '../lib/database.types';

// Q6.2.a-fix Bug B: useUpdateDrawSchedule.onSuccess must write the fresh
// out_updated_at into the draw_schedule cache SYNCHRONOUSLY, not via async
// invalidate. Otherwise an immediate follow-up drag captures the row's
// stale updated_at and the next RPC hits OCC instead of overlap detection.

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

import { useUpdateDrawSchedule } from '../hooks/useUpdateDrawSchedule';

function makeRow(over: Partial<DrawScheduleRow> = {}): DrawScheduleRow {
  return {
    project_id: 'p-1',
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
    updated_at: '2026-05-09T12:00:00Z',
    ...over,
  };
}

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

describe('useUpdateDrawSchedule', () => {
  it('Bug B: onSuccess writes the fresh out_updated_at into the cache synchronously', async () => {
    const original = makeRow({ updated_at: '2026-05-09T12:00:00Z' });
    const FRESH = '2026-05-09T12:30:00Z';
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_updated_at: FRESH,
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [original]);

    const { result } = renderHook(() => useUpdateDrawSchedule(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        expectedUpdatedAt: original.updated_at,
        daAssigned: 'Ahmadi',
        startWeek: '2026-06-01',
        endWeek: '2026-06-15',
        scheduleStatus: 'Submitted',
      });
    });

    // The cache row's updated_at must be the fresh server value the moment
    // onSuccess returns — NOT pending an async refetch. This is what closes
    // the stale-OCC race for an immediate follow-up drag.
    const cached = queryClient.getQueryData<DrawScheduleRow[]>(
      queryKeys.drawSchedule(T),
    );
    expect(cached?.[0].updated_at).toBe(FRESH);
    expect(cached?.[0].da_assigned).toBe('Ahmadi');
    expect(cached?.[0].start_week).toBe('2026-06-01');
    expect(cached?.[0].end_week).toBe('2026-06-15');
    expect(cached?.[0].status).toBe('Submitted');
  });

  it('rolls back optimistic state + warn toast on out_conflict=true', async () => {
    const original = makeRow();
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_updated_at: null,
          out_conflict: true,
        },
      ],
      error: null,
    });

    const { queryClient, wrapper } = setupQueryClient();
    queryClient.setQueryData(queryKeys.drawSchedule(T), [original]);

    const { result } = renderHook(() => useUpdateDrawSchedule(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: 'p-1',
          expectedUpdatedAt: original.updated_at,
          daAssigned: 'Ahmadi',
          startWeek: '2026-06-01',
          endWeek: '2026-06-15',
          scheduleStatus: 'Submitted',
        }),
      ).rejects.toThrow();
    });

    // Cache should have rolled back to original.
    const cached = queryClient.getQueryData<DrawScheduleRow[]>(
      queryKeys.drawSchedule(T),
    );
    expect(cached?.[0].da_assigned).toBe('Trevor');
    expect(cached?.[0].start_week).toBe('2026-05-04');
    expect(cached?.[0].updated_at).toBe('2026-05-09T12:00:00Z');

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});
