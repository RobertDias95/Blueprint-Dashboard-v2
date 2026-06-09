import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-147: useCascadeEntLead caller contract. The SQL behavior (respect explicit
// ent_lead picks) is verified by a live MCP probe; this pins the hook → RPC wire
// so a future refactor can't silently drop the cascade call, and confirms the
// "Updated DM" toast fires only when the cascade actually filled something
// (count > 0) — after fix-147, a cascade that respects an explicit pick returns
// 0 and must stay silent (no surprise notification).

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let result: { data: unknown; error: Error | null } = { data: 0, error: null };
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

import { useCascadeEntLead } from '../hooks/useDaTeamRouting';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  pushToast.mockClear();
  mocks.setResult({ data: 0, error: null });
  useAuthStore.setState({ activeTenantId: T } as never);
});

describe('useCascadeEntLead', () => {
  it('invokes bp_cascade_ent_lead_for_project with the project_id', async () => {
    mocks.setResult({ data: 2, error: null });
    const { result } = renderHook(() => useCascadeEntLead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'proj-1' });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_cascade_ent_lead_for_project', {
      p_project_id: 'proj-1',
    });
  });

  it('toasts "Updated DM" when the cascade filled at least one permit', async () => {
    mocks.setResult({ data: 2, error: null });
    const { result } = renderHook(() => useCascadeEntLead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'proj-1' });
    });
    expect(pushToast).toHaveBeenCalledWith('Updated DM on 2 permits', 'success');
  });

  it('stays silent when the cascade filled nothing (explicit pick respected)', async () => {
    // fix-147: an explicit ent_lead is not overwritten → RPC returns 0 → no toast.
    mocks.setResult({ data: 0, error: null });
    const { result } = renderHook(() => useCascadeEntLead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'proj-1' });
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_cascade_ent_lead_for_project', {
      p_project_id: 'proj-1',
    });
    expect(pushToast).not.toHaveBeenCalled();
  });
});
