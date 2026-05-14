import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// Q9.5.f-fix-20: useShiftDaBlocksUp wraps bp_shift_da_blocks_up. Verifies
// RPC payload + that the cap-kicked-in flag is surfaced in the success
// toast so users know not every block shifted fully.

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

import { useShiftDaBlocksUp } from '../hooks/useShiftDaBlocksUp';

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

describe('useShiftDaBlocksUp', () => {
  it('passes (da, gap_start_week, gap_end_week) to the RPC', async () => {
    mocks.setResult({
      data: [{ out_shifted_count: 3, out_blocked_at_current_week: false }],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useShiftDaBlocksUp(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        daName: 'Ainsley',
        gapStartWeek: '2026-05-04',
        gapEndWeek: '2026-05-18',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_shift_da_blocks_up', {
      p_da: 'Ainsley',
      p_gap_start_week: '2026-05-04',
      p_gap_end_week: '2026-05-18',
    });
  });

  it('mentions cap in the toast when blocked_at_current_week=true', async () => {
    mocks.setResult({
      data: [{ out_shifted_count: 2, out_blocked_at_current_week: true }],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useShiftDaBlocksUp(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        daName: 'Ainsley',
        gapStartWeek: '2026-05-04',
        gapEndWeek: '2026-05-18',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success?.message).toMatch(/capped/i);
    });
  });

  it('emits an info toast when nothing actually shifted', async () => {
    mocks.setResult({
      data: [{ out_shifted_count: 0, out_blocked_at_current_week: false }],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useShiftDaBlocksUp(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        daName: 'Ainsley',
        gapStartWeek: '2026-05-04',
        gapEndWeek: '2026-05-18',
      });
    });

    await waitFor(() => {
      const info = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'info');
      expect(info).toBeTruthy();
    });
  });
});
