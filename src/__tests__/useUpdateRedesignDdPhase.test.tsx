import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-145: bp_update_redesign_dd_phase wrapper. Pins the OCC-conflict path
// (RPC returns conflict=true → warn toast, no throw to the caller's success
// path) and the happy path.

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let result: { data: unknown; error: Error | null } = { data: [], error: null };
  const rpcFn = vi.fn();
  return {
    rpcFn,
    builder: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcFn(name, args);
        return Promise.resolve(result);
      },
    },
    setResult: (r: { data: unknown; error: Error | null }) => {
      result = r;
    },
  };
});
vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

const pushToast = vi.hoisted(() => vi.fn());
vi.mock('../stores/toastStore', () => ({
  pushToast,
  useToastStore: () => ({ toasts: [], push: vi.fn(), dismiss: vi.fn() }),
}));

import { useUpdateRedesignDdPhase } from '../hooks/useUpdateRedesignDdPhase';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const input = {
  projectId: 'p1',
  da: 'Cam',
  dd_start: '2026-06-22',
  dd_end: '2026-07-17',
  status: 'Scheduled',
  expectedUpdatedAt: 'stale-token',
};

beforeEach(() => {
  mocks.rpcFn.mockClear();
  pushToast.mockClear();
  useAuthStore.setState({ activeTenantId: T } as never);
});

describe('useUpdateRedesignDdPhase', () => {
  it('passes the snapped params through to the RPC and toasts success', async () => {
    mocks.setResult({
      data: [{ project_id: 'p1', updated_at: 'tok-2', conflict: false }],
      error: null,
    });
    const { result } = renderHook(() => useUpdateRedesignDdPhase(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_update_redesign_dd_phase', {
      p_project_id: 'p1',
      p_da: 'Cam',
      p_dd_start: '2026-06-22',
      p_dd_end: '2026-07-17',
      p_status: 'Scheduled',
      p_expected_updated_at: 'stale-token',
    });
    expect(pushToast).toHaveBeenCalledWith('Redesign DD phase updated', 'success');
  });

  it('surfaces the OCC warn toast when the RPC reports a conflict', async () => {
    mocks.setResult({
      data: [{ project_id: 'p1', updated_at: 'tok-current', conflict: true }],
      error: null,
    });
    const { result } = renderHook(() => useUpdateRedesignDdPhase(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow();
    });
    expect(pushToast).toHaveBeenCalledWith(
      'Lane was edited elsewhere — refresh and retry',
      'warn',
    );
    // The success toast must NOT fire on a conflict.
    expect(pushToast).not.toHaveBeenCalledWith(
      'Redesign DD phase updated',
      'success',
    );
  });
});
