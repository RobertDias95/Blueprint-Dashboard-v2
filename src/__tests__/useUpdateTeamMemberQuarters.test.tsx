import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// fix-25-feat-b: useUpdateTeamMemberQuarters wraps
// bp_update_team_member_quarters. Pin the RPC contract: payload mapping,
// success toast, OCC conflict surface, RPC-error surface.

const T = 'test-tenant-uuid';
const MEMBER = '00000000-1111-2222-3333-444444444444';

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

import { useUpdateTeamMemberQuarters } from '../hooks/useUpdateTeamMemberQuarters';

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

describe('useUpdateTeamMemberQuarters', () => {
  it('maps input to RPC arg names + fires success toast', async () => {
    mocks.setResult({
      data: [
        {
          out_id: MEMBER,
          out_updated_at: '2026-05-16T18:00:00Z',
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpdateTeamMemberQuarters(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberId: MEMBER,
        activeStart: '2026-Q1',
        activeEnd: '2026-Q4',
        expectedUpdatedAt: '2026-05-16T17:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith(
      'bp_update_team_member_quarters',
      {
        p_id: MEMBER,
        p_active_start: '2026-Q1',
        p_active_end: '2026-Q4',
        p_expected_updated_at: '2026-05-16T17:00:00Z',
      },
    );

    await waitFor(() => {
      const success = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'success');
      expect(success).toBeTruthy();
      expect(success?.message).toMatch(/Saved active quarters/i);
    });
  });

  it('null start + end maps to NULL through the RPC (clear range)', async () => {
    mocks.setResult({
      data: [
        {
          out_id: MEMBER,
          out_updated_at: '2026-05-16T18:00:00Z',
          out_conflict: false,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpdateTeamMemberQuarters(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        memberId: MEMBER,
        activeStart: null,
        activeEnd: null,
        expectedUpdatedAt: '2026-05-16T17:00:00Z',
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledWith(
      'bp_update_team_member_quarters',
      {
        p_id: MEMBER,
        p_active_start: null,
        p_active_end: null,
        p_expected_updated_at: '2026-05-16T17:00:00Z',
      },
    );
  });

  it('throws on out_conflict=true with a warn toast', async () => {
    mocks.setResult({
      data: [
        {
          out_id: MEMBER,
          out_updated_at: null,
          out_conflict: true,
        },
      ],
      error: null,
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpdateTeamMemberQuarters(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          memberId: MEMBER,
          activeStart: '2026-Q1',
          activeEnd: '2026-Q4',
          expectedUpdatedAt: 'STALE',
        }),
      ).rejects.toThrow(/Team member was modified/i);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
      expect(warn?.message).toMatch(/modified by someone else/i);
    });
  });

  it('surfaces RPC errors via the error toast', async () => {
    mocks.setResult({
      data: null,
      error: new Error('active_end must be >= active_start'),
    });

    const { wrapper } = setupQueryClient();
    const { result } = renderHook(() => useUpdateTeamMemberQuarters(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          memberId: MEMBER,
          activeStart: '2026-Q3',
          activeEnd: '2026-Q1',
          expectedUpdatedAt: '2026-05-16T17:00:00Z',
        }),
      ).rejects.toThrow(/active_end/i);
    });

    await waitFor(() => {
      const err = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'error');
      expect(err).toBeTruthy();
    });
  });
});
