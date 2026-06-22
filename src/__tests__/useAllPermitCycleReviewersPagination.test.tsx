import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

// fix-189: useAllPermitCycleReviewers must page past the 1000-row cap so the
// full reviewer set loads. Mock the supabase builder chain so .range(from,to)
// returns the matching page.

const T = 'test-tenant-uuid';

const state = vi.hoisted(() => ({
  // total rows the fake table holds; the chain serves them in 1000-row pages.
  total: 0,
  rangeCalls: [] as Array<[number, number]>,
}));

vi.mock('../lib/supabase', () => {
  // Chainable builder: select/order return `this`; range(from,to) resolves to
  // the requested slice of a `state.total`-row table.
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.order = () => chain;
  chain.range = (from: number, to: number) => {
    state.rangeCalls.push([from, to]);
    const slice: { id: string; cycle_index: number }[] = [];
    for (let i = from; i <= to && i < state.total; i++) {
      slice.push({ id: `r-${i}`, cycle_index: 1 });
    }
    return Promise.resolve({ data: slice, error: null });
  };
  return { supabase: { from: () => chain } };
});

import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  useAuthStore.setState({ activeTenantId: T, memberships: [{ tenant_id: T, role: 'admin' }] });
  state.total = 0;
  state.rangeCalls = [];
});

describe('useAllPermitCycleReviewers pagination (fix-189)', () => {
  it('returns ALL 1029 rows across two .range() pages (not the truncated 1000)', async () => {
    state.total = 1029;
    const { result } = renderHook(() => useAllPermitCycleReviewers(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1029);
    expect(state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('returns the full set in a single page when under the cap', async () => {
    state.total = 3; // e.g. BLD2026-0536's 3 reviewers
    const { result } = renderHook(() => useAllPermitCycleReviewers(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(state.rangeCalls).toEqual([[0, 999]]);
  });
});
