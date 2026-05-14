import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// fix-23a: useSetBpDdDates wraps bp_set_bp_dd_dates. Closes the
// propagation gap where editing DD on Project Overview wrote only the
// permits row and left draw_schedule + sibling target_submit stale. This
// suite pins the RPC contract: payload mapping, clear-mode (both null),
// OCC conflict, success-toast cascade summary.

const T = 'test-tenant-uuid';
const PROJECT = '094e7d54-43ee-4dba-9e1a-37cfb392a95b'; // "test 678"

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

import { useSetBpDdDates } from '../hooks/useSetBpDdDates';

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

describe('useSetBpDdDates', () => {
  it('maps the input to RPC arg names + returns the cascade summary', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: PROJECT,
          out_bp_updated_at: '2026-05-14T16:00:00Z',
          out_draw_schedule_updated_at: '2026-05-14T16:00:00Z',
          out_conflict: false,
          out_permits_updated: 3,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    let mutateResult: unknown;
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        projectId: PROJECT,
        ddStart: '2025-10-13',
        ddEnd: '2025-12-19',
        expectedUpdatedAt: '2026-05-14T15:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_set_bp_dd_dates', {
      p_project_id: PROJECT,
      p_dd_start: '2025-10-13',
      p_dd_end: '2025-12-19',
      p_expected_updated_at: '2026-05-14T15:00:00Z',
    });

    expect(mutateResult).toEqual({
      projectId: PROJECT,
      bpUpdatedAt: '2026-05-14T16:00:00Z',
      drawScheduleUpdatedAt: '2026-05-14T16:00:00Z',
      permitsUpdated: 3,
    });
  });

  it('clear-mode (both null) passes null through — RPC handles the wipe', async () => {
    // The hook's contract is pass-through: clear-mode is a UI decision,
    // not the hook's. The RPC validates internally.
    mocks.setResult({
      data: [
        {
          out_project_id: PROJECT,
          out_bp_updated_at: '2026-05-14T17:00:00Z',
          out_draw_schedule_updated_at: '2026-05-14T17:00:00Z',
          out_conflict: false,
          out_permits_updated: 2,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT,
        ddStart: null,
        ddEnd: null,
        expectedUpdatedAt: '2026-05-14T16:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_set_bp_dd_dates', {
      p_project_id: PROJECT,
      p_dd_start: null,
      p_dd_end: null,
      p_expected_updated_at: '2026-05-14T16:00:00Z',
    });
  });

  it('surfaces cascade-count in the success toast', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: PROJECT,
          out_bp_updated_at: '2026-05-14T18:00:00Z',
          out_draw_schedule_updated_at: '2026-05-14T18:00:00Z',
          out_conflict: false,
          out_permits_updated: 4,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT,
        ddStart: '2025-10-13',
        ddEnd: '2025-12-19',
        expectedUpdatedAt: '2026-05-14T17:00:00Z',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success).toBeTruthy();
      expect(success?.message).toMatch(/DD dates saved/);
      expect(success?.message).toMatch(/4 permits/);
    });
  });

  it('throws on out_conflict=true with a warn toast', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: PROJECT,
          out_bp_updated_at: null,
          out_draw_schedule_updated_at: null,
          out_conflict: true,
          out_permits_updated: 0,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: PROJECT,
          ddStart: '2025-10-13',
          ddEnd: '2025-12-19',
          expectedUpdatedAt: 'STALE',
        }),
      ).rejects.toThrow(/DD dates was modified/i);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
      expect(warn?.message).toMatch(/modified by someone else/i);
    });
  });

  it('surfaces RPC error via toast and rejects', async () => {
    mocks.setResult({
      data: null,
      error: new Error('partial-null rejected'),
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: PROJECT,
          // The hook trusts callers — this test verifies the RPC's
          // partial-null rejection surfaces cleanly. (The UI gate in
          // DDPhaseEditor prevents this state from being sent in
          // normal usage.)
          ddStart: '2025-10-13',
          ddEnd: null,
          expectedUpdatedAt: '2026-05-14T15:00:00Z',
        }),
      ).rejects.toThrow(/partial-null/i);
    });

    await waitFor(() => {
      const error = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'error');
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/partial-null/i);
    });
  });

  it('returns null projectGoDate-style fields untouched (no in-hook coercion)', async () => {
    // The hook is pass-through on the result side too. Verify NULL
    // out_draw_schedule_updated_at (when no draw_schedule row exists yet)
    // propagates to the caller as null, not undefined or empty string.
    mocks.setResult({
      data: [
        {
          out_project_id: PROJECT,
          out_bp_updated_at: '2026-05-14T19:00:00Z',
          out_draw_schedule_updated_at: null,
          out_conflict: false,
          out_permits_updated: 1,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useSetBpDdDates(), { wrapper });

    let mutateResult: unknown;
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        projectId: PROJECT,
        ddStart: '2025-10-13',
        ddEnd: '2025-12-19',
        expectedUpdatedAt: '2026-05-14T18:00:00Z',
      });
    });

    expect(mutateResult).toMatchObject({
      drawScheduleUpdatedAt: null,
      permitsUpdated: 1,
    });
  });
});
