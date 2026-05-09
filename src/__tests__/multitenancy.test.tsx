import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// Q5.5.D: cross-tenant isolation tests at the client layer. Server enforcement
// is verified by the inline RLS smokes during Migration B; these tests cover
// (1) cache-key isolation, (2) query gating on activeTenantId, (3) mutations
// shipping the right tenant_id, and (4) the no-tenant access-denied splash.

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mocks = vi.hoisted(() => {
  const fromFn = vi.fn();
  const selectFn = vi.fn();
  const orderFn = vi.fn();
  const eqFn = vi.fn();
  const rpcFn = vi.fn();

  let resolveResult: { data: unknown[] | null; error: Error | null } = {
    data: [],
    error: null,
  };

  const builder = {
    from: (table: string) => {
      fromFn(table);
      return builder;
    },
    select: (selection: string) => {
      selectFn(selection);
      return builder;
    },
    eq: (col: string, val: unknown) => {
      eqFn(col, val);
      return Promise.resolve(resolveResult);
    },
    order: (col: string) => {
      orderFn(col);
      return Promise.resolve(resolveResult);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve(resolveResult);
    },
  } as const;

  return {
    builder,
    fromFn,
    selectFn,
    orderFn,
    eqFn,
    rpcFn,
    setResult: (r: { data: unknown[] | null; error: Error | null }) => {
      resolveResult = r;
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.builder }));

import { useProjects } from '../hooks/useProjects';
import { useCreateProjectWithPermits } from '../hooks/useCreateProjectWithPermits';
import AuthGuard from '../components/AuthGuard';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  mocks.fromFn.mockClear();
  mocks.selectFn.mockClear();
  mocks.orderFn.mockClear();
  mocks.eqFn.mockClear();
  mocks.rpcFn.mockClear();
  useToastStore.getState().clear();
  // Reset auth store to a clean state.
  useAuthStore.setState({
    session: null,
    user: null,
    initialized: true,
    memberships: [],
    activeTenantId: null,
  });
});

// ============================================================
// (1) Query keys are tenant-scoped — same hook produces different cache keys
// for different active tenants.
// ============================================================
describe('queryKeys are tenant-scoped', () => {
  it('produces distinct cache keys for two different tenants', () => {
    expect(queryKeys.projects(TENANT_A)).not.toEqual(queryKeys.projects(TENANT_B));
    expect(queryKeys.permits(TENANT_A)).not.toEqual(queryKeys.permits(TENANT_B));
    expect(queryKeys.permitsByProject(TENANT_A, 'p1')).not.toEqual(
      queryKeys.permitsByProject(TENANT_B, 'p1'),
    );
    expect(queryKeys.permitTasksFor(TENANT_A, 7)).not.toEqual(
      queryKeys.permitTasksFor(TENANT_B, 7),
    );
  });
});

// ============================================================
// (2) Hooks gated on activeTenantId — query does NOT fire when no tenant active.
// ============================================================
describe('hooks are gated on activeTenantId', () => {
  it('useProjects does not call supabase when activeTenantId is null', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });
    const { Wrapper } = makeWrapper();
    renderHook(() => useProjects(), { wrapper: Wrapper });
    // Give react-query a tick to attempt the query (it shouldn't, due to enabled: false).
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.fromFn).not.toHaveBeenCalled();
  });

  it('useProjects does call supabase when activeTenantId is set', async () => {
    useAuthStore.setState({
      activeTenantId: TENANT_A,
      memberships: [{ tenant_id: TENANT_A, role: 'admin' }],
    });
    mocks.setResult({ data: [], error: null });
    const { Wrapper } = makeWrapper();
    renderHook(() => useProjects(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(mocks.fromFn).toHaveBeenCalledWith('projects');
    });
  });
});

// ============================================================
// (3) Mutations pass tenant_id from authStore on insert.
// ============================================================
describe('mutations pass tenant_id from authStore', () => {
  it('useCreateProjectWithPermits ships activeTenantId as p_tenant_id', async () => {
    useAuthStore.setState({
      activeTenantId: TENANT_A,
      memberships: [{ tenant_id: TENANT_A, role: 'admin' }],
    });
    mocks.setResult({
      data: [{ project_id: 'new-uuid', permit_ids: [10000], conflict: false }],
      error: null,
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        address: '500 Test Ave',
        juris: 'Seattle',
        permits: [{ type: 'Building Permit' }],
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [, args] = mocks.rpcFn.mock.calls[0];
    expect(args.p_tenant_id).toBe(TENANT_A);
  });

  it('useCreateProjectWithPermits rejects when no tenant is active', async () => {
    useAuthStore.setState({ activeTenantId: null, memberships: [] });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateProjectWithPermits(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          address: '500 Test Ave',
          juris: 'Seattle',
          permits: [{ type: 'Building Permit' }],
        }),
      ).rejects.toThrow(/no active tenant/i);
    });
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });
});

// ============================================================
// (4) Empty memberships → AuthGuard renders no-tenant splash, NOT app shell.
// ============================================================
describe('AuthGuard handles empty memberships', () => {
  it('renders the no-tenant splash when session exists but memberships is empty', () => {
    useAuthStore.setState({
      session: { user: { id: 'u1' } } as unknown as ReturnType<typeof useAuthStore.getState>['session'],
      user: { id: 'u1' } as unknown as ReturnType<typeof useAuthStore.getState>['user'],
      initialized: true,
      memberships: [],
      activeTenantId: null,
    });

    render(
      <MemoryRouter>
        <AuthGuard>
          <div data-testid="app-content">app content</div>
        </AuthGuard>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('no-tenant-splash')).toBeInTheDocument();
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    expect(screen.getByText(/Access denied/i)).toBeInTheDocument();
  });

  it('renders the children when memberships is non-empty', () => {
    useAuthStore.setState({
      session: { user: { id: 'u1' } } as unknown as ReturnType<typeof useAuthStore.getState>['session'],
      user: { id: 'u1' } as unknown as ReturnType<typeof useAuthStore.getState>['user'],
      initialized: true,
      memberships: [{ tenant_id: TENANT_A, role: 'editor' }],
      activeTenantId: TENANT_A,
    });

    render(
      <MemoryRouter>
        <AuthGuard>
          <div data-testid="app-content">app content</div>
        </AuthGuard>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('app-content')).toBeInTheDocument();
    expect(screen.queryByTestId('no-tenant-splash')).not.toBeInTheDocument();
  });
});
