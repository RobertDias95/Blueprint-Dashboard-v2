import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// fix-25-feat-a: useResizeDaTimeBlock wraps bp_resize_da_time_block. The
// RPC overlap-checks the proposed weeks against project + NP blocks on
// the same DA and returns a conflict response (no write) when found.
// This suite pins the wire contract: payload mapping, conflict shapes
// for both kinds, force flag bypass, and OCC behavior.

const T = 'test-tenant-uuid';
const BLOCK = 'np_test_resize';

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

import { useResizeDaTimeBlock } from '../hooks/useResizeDaTimeBlock';

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Build a clean (no-overlap) RPC response row. */
function cleanRow(overrides: Record<string, unknown> = {}) {
  return {
    out_id: BLOCK,
    out_updated_at: '2026-05-16T17:00:00Z',
    out_conflict: false,
    out_overlap_kind: null,
    out_overlap_conflicts: null,
    out_proposed_start_week: null,
    out_proposed_end_week: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useResizeDaTimeBlock', () => {
  it('maps the input to RPC arg names', async () => {
    mocks.setResult({ data: [cleanRow()], error: null });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        blockId: BLOCK,
        newStartWeek: '2026-06-08',
        newEndWeek: '2026-06-22',
        expectedUpdatedAt: '2026-05-16T16:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_resize_da_time_block', {
      p_id: BLOCK,
      p_new_start_week: '2026-06-08',
      p_new_end_week: '2026-06-22',
      p_expected_updated_at: '2026-05-16T16:00:00Z',
      p_force: false,
    });
  });

  it('clean response invalidates cache + fires success toast', async () => {
    mocks.setResult({ data: [cleanRow()], error: null });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        blockId: BLOCK,
        newStartWeek: '2026-06-08',
        newEndWeek: '2026-06-22',
        expectedUpdatedAt: '2026-05-16T16:00:00Z',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success).toBeTruthy();
      expect(success?.message).toMatch(/Resized time block/);
    });
  });

  it('project-overlap response returns conflict info — no success toast', async () => {
    const projectConflicts = [
      {
        project_id: 'proj-1',
        address: '12827 NE 80th St',
        start_week: '2026-06-08',
        end_week: '2026-06-22',
      },
    ];
    mocks.setResult({
      data: [
        cleanRow({
          out_overlap_kind: 'project',
          out_overlap_conflicts: projectConflicts,
          out_proposed_start_week: '2026-06-01',
          out_proposed_end_week: '2026-06-15',
        }),
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    let mutateResult: { overlapKind?: string | null } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        blockId: BLOCK,
        newStartWeek: '2026-06-01',
        newEndWeek: '2026-06-15',
        expectedUpdatedAt: '2026-05-16T16:00:00Z',
      });
    });

    expect(mutateResult).toMatchObject({
      overlapKind: 'project',
      overlapConflicts: projectConflicts,
      proposedStartWeek: '2026-06-01',
      proposedEndWeek: '2026-06-15',
    });

    const success = useToastStore
      .getState()
      .toasts.find((t) => t.kind === 'success');
    expect(success).toBeFalsy();
  });

  it('np-overlap response returns conflict info', async () => {
    const npConflicts = [
      {
        id: 'np_other',
        type: 'Vacation',
        label: 'PTO',
        start_week: '2026-07-06',
        end_week: '2026-07-13',
      },
    ];
    mocks.setResult({
      data: [
        cleanRow({
          out_overlap_kind: 'np',
          out_overlap_conflicts: npConflicts,
          out_proposed_start_week: '2026-06-29',
          out_proposed_end_week: '2026-07-06',
        }),
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    let mutateResult: { overlapKind?: string | null } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        blockId: BLOCK,
        newStartWeek: '2026-06-29',
        newEndWeek: '2026-07-06',
        expectedUpdatedAt: '2026-05-16T16:00:00Z',
      });
    });

    expect(mutateResult).toMatchObject({
      overlapKind: 'np',
      overlapConflicts: npConflicts,
    });
  });

  it('forwards force=true so the user can bypass overlap warning', async () => {
    mocks.setResult({ data: [cleanRow()], error: null });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        blockId: BLOCK,
        newStartWeek: '2026-06-08',
        newEndWeek: '2026-06-22',
        expectedUpdatedAt: '2026-05-16T16:00:00Z',
        force: true,
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_resize_da_time_block', {
      p_id: BLOCK,
      p_new_start_week: '2026-06-08',
      p_new_end_week: '2026-06-22',
      p_expected_updated_at: '2026-05-16T16:00:00Z',
      p_force: true,
    });
  });

  it('throws on out_conflict=true with a warn toast', async () => {
    mocks.setResult({
      data: [
        cleanRow({
          out_updated_at: null,
          out_conflict: true,
        }),
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useResizeDaTimeBlock(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          blockId: BLOCK,
          newStartWeek: '2026-06-08',
          newEndWeek: '2026-06-22',
          expectedUpdatedAt: 'STALE',
        }),
      ).rejects.toThrow(/Time block was modified/i);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
      expect(warn?.message).toMatch(/modified by someone else/i);
    });
  });
});
