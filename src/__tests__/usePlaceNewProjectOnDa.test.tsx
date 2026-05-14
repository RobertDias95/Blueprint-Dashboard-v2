import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// Q9.5.f-fix-20: usePlaceNewProjectOnDa wraps bp_place_new_project_on_da.
// Verifies (1) RPC payload (including default duration), (2) success toast
// surfaces where the project landed, (3) no-op (already-scheduled) stays
// quiet — toast spam on every wizard close is annoying.

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

import { usePlaceNewProjectOnDa } from '../hooks/usePlaceNewProjectOnDa';

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

describe('usePlaceNewProjectOnDa', () => {
  it('defaults to 4-week duration when not provided', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_da: 'Francesca',
          out_start_week: '2026-05-18',
          out_end_week: '2026-06-08',
          out_placed: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => usePlaceNewProjectOnDa(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        da: 'Francesca',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_place_new_project_on_da', {
      p_project_id: 'p-1',
      p_da: 'Francesca',
      p_duration_weeks: 4,
    });
  });

  it('surfaces the landing slot in the success toast on a fresh placement', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_da: 'Francesca',
          out_start_week: '2026-05-18',
          out_end_week: '2026-06-08',
          out_placed: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => usePlaceNewProjectOnDa(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        da: 'Francesca',
      });
    });

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success?.message).toMatch(/Francesca/);
      expect(success?.message).toMatch(/2026-05-18/);
    });
  });

  it('stays quiet on no-op (out_placed=false)', async () => {
    mocks.setResult({
      data: [
        {
          out_project_id: 'p-1',
          out_da: 'Francesca',
          out_start_week: '2026-04-27',
          out_end_week: '2026-05-18',
          out_placed: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => usePlaceNewProjectOnDa(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'p-1',
        da: 'Francesca',
      });
    });

    // No success toast on idempotent no-op. The wizard shouldn't double-
    // toast on top of "Project created".
    expect(
      useToastStore.getState().toasts.find((t) => t.kind === 'success'),
    ).toBeUndefined();
  });
});
