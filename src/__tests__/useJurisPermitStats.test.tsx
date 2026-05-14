import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

const T = 'test-tenant-uuid';

const mocks = vi.hoisted(() => {
  let resolveResult: { data: unknown; error: Error | null } = {
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
    setResult: (r: { data: unknown; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useJurisPermitStats } from '../hooks/useJurisPermitStats';

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
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useJurisPermitStats', () => {
  it('calls bp_get_juris_permit_stats with the juris name', async () => {
    mocks.setResult({
      data: [
        {
          permit_type: 'Building Permit',
          projects_with_this_permit: 8,
          total_projects_in_juris: 8,
          usage_fraction: 1,
          usage_pct_display: 100,
        },
        {
          permit_type: 'PAR/Pre-Sub',
          projects_with_this_permit: 5,
          total_projects_in_juris: 8,
          usage_fraction: 0.625,
          usage_pct_display: 63,
        },
      ],
      error: null,
    });

    const { wrapper } = setup();
    const { result } = renderHook(() => useJurisPermitStats('Seattle'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });
    expect(mocks.rpcFn).toHaveBeenCalledWith('bp_get_juris_permit_stats', {
      p_juris: 'Seattle',
    });
    expect(result.current.data?.[0].permit_type).toBe('Building Permit');
  });

  it('returns usage_pct_display=null when juris has fewer than 5 projects', async () => {
    mocks.setResult({
      data: [
        {
          permit_type: 'Building Permit',
          projects_with_this_permit: 3,
          total_projects_in_juris: 3,
          usage_fraction: 1,
          usage_pct_display: null,
        },
      ],
      error: null,
    });

    const { wrapper } = setup();
    const { result } = renderHook(() => useJurisPermitStats('Bellevue'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });
    expect(result.current.data?.[0].usage_pct_display).toBeNull();
  });

  it('does not call the RPC when juris is empty', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useJurisPermitStats(''), { wrapper });
    // disabled queries stay idle — give the effect a tick to settle.
    await Promise.resolve();
    expect(result.current.isLoading).toBe(false);
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('does not call the RPC when juris is null', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useJurisPermitStats(null), { wrapper });
    await Promise.resolve();
    expect(result.current.isLoading).toBe(false);
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('does not call the RPC without an active tenant', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useJurisPermitStats('Seattle'), {
      wrapper,
    });
    await Promise.resolve();
    expect(result.current.isLoading).toBe(false);
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });
});
