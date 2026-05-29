import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// fix-36: useUpdateProjectWithPermits wraps bp_update_project_with_permits —
// the atomic Project Settings save. This suite pins the wire contract:
// arg-name mapping, conflict surfacing, and fresh-token return.

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

import { useUpdateProjectWithPermits } from '../hooks/useUpdateProjectWithPermits';

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    out_conflict: false,
    out_conflict_kind: null,
    out_conflict_id: null,
    out_project_updated_at: '2026-05-20T18:00:00Z',
    out_permits: [{ id: 256, updated_at: '2026-05-20T18:00:00Z' }],
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

describe('useUpdateProjectWithPermits', () => {
  it('maps the input to the RPC arg names', async () => {
    mocks.setResult({ data: [row()], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProjectWithPermits(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'proj-1',
        projectExpectedUpdatedAt: '2026-05-20T17:00:00Z',
        projectPatch: { acq_lead: 'Jake' },
        permitUpserts: [
          { id: 256, expected_updated_at: '2026-05-20T17:00:00Z', num: 'BP-1' },
          { type: 'Demolition', num: 'NEW-1' },
        ],
        permitDeletes: [99],
      });
    });

    expect(mocks.rpcFn).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpcFn.mock.calls[0];
    expect(name).toBe('bp_update_project_with_permits');
    expect(args).toEqual({
      p_project_id: 'proj-1',
      p_project_expected_updated_at: '2026-05-20T17:00:00Z',
      p_project_patch: { acq_lead: 'Jake' },
      p_permit_upserts: [
        { id: 256, expected_updated_at: '2026-05-20T17:00:00Z', num: 'BP-1' },
        { type: 'Demolition', num: 'NEW-1' },
      ],
      p_permit_deletes: [99],
    });
  });

  it('surfaces a successful result with fresh tokens', async () => {
    mocks.setResult({ data: [row()], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProjectWithPermits(), { wrapper });

    let res!: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      res = await result.current.mutateAsync({
        projectId: 'proj-1',
        projectExpectedUpdatedAt: '2026-05-20T17:00:00Z',
        projectPatch: {},
        permitUpserts: [],
        permitDeletes: [],
      });
    });

    expect(res.conflict).toBe(false);
    expect(res.projectUpdatedAt).toBe('2026-05-20T18:00:00Z');
    expect(res.permits).toEqual([{ id: 256, updated_at: '2026-05-20T18:00:00Z' }]);
  });

  it('surfaces a conflict (not an error) with kind + id', async () => {
    mocks.setResult({
      data: [
        row({
          out_conflict: true,
          out_conflict_kind: 'permit',
          out_conflict_id: '256',
          out_project_updated_at: null,
          out_permits: [],
        }),
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateProjectWithPermits(), { wrapper });

    let res!: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      res = await result.current.mutateAsync({
        projectId: 'proj-1',
        projectExpectedUpdatedAt: 'stale',
        projectPatch: { acq_lead: 'Jake' },
        permitUpserts: [{ id: 256, expected_updated_at: 'stale', num: 'X' }],
        permitDeletes: [],
      });
    });

    expect(res.conflict).toBe(true);
    expect(res.conflictKind).toBe('permit');
    expect(res.conflictId).toBe('256');
  });

  // fix-73: on a non-conflict success, the hook writes each returned permit's
  // fresh updated_at and the project's projectUpdatedAt into the caches
  // synchronously. Without this, a follow-up inline edit captures the stale
  // OCC token (e.g. ScheduleHealth ACQ Target → Approval Date sequence Bobby
  // reported) and OCC-conflicts on its first save.
  it('fix-73: setQueryData writes fresh updated_at into permits + projects caches', async () => {
    mocks.setResult({
      data: [
        row({
          out_project_updated_at: '2026-05-20T19:00:00Z',
          out_permits: [
            { id: 256, updated_at: '2026-05-20T19:00:00Z' },
            { id: 257, updated_at: '2026-05-20T19:00:00Z' },
          ],
        }),
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    // Seed caches with stale tokens for the project + its permits.
    const stalePermits = [
      {
        id: 256,
        project_id: 'proj-1',
        type: 'Building Permit',
        updated_at: '2026-05-20T17:00:00Z',
        permit_cycles: [],
      },
      {
        id: 257,
        project_id: 'proj-1',
        type: 'Demolition',
        updated_at: '2026-05-20T17:00:00Z',
        permit_cycles: [],
      },
      {
        id: 999,
        project_id: 'other',
        type: 'Building Permit',
        updated_at: 'unchanged',
        permit_cycles: [],
      },
    ];
    const staleProjects = [
      { id: 'proj-1', address: '3522 Ashworth', updated_at: '2026-05-20T17:00:00Z' },
      { id: 'other', address: 'X', updated_at: 'unchanged' },
    ];
    queryClient.setQueryData(['permits', T], stalePermits);
    queryClient.setQueryData(['permits', T, { projectId: 'proj-1' }], stalePermits);
    queryClient.setQueryData(['projects', T], staleProjects);

    const { result } = renderHook(() => useUpdateProjectWithPermits(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'proj-1',
        projectExpectedUpdatedAt: '2026-05-20T17:00:00Z',
        projectPatch: { acq_lead: 'Jake' },
        permitUpserts: [
          { id: 256, expected_updated_at: '2026-05-20T17:00:00Z', num: 'BP-1' },
          { id: 257, expected_updated_at: '2026-05-20T17:00:00Z', num: 'DM-1' },
        ],
        permitDeletes: [],
      });
    });

    for (const key of [
      ['permits', T] as const,
      ['permits', T, { projectId: 'proj-1' }] as const,
    ]) {
      const rows = queryClient.getQueryData<typeof stalePermits>(key) ?? [];
      expect(rows.find((p) => p.id === 256)?.updated_at).toBe('2026-05-20T19:00:00Z');
      expect(rows.find((p) => p.id === 257)?.updated_at).toBe('2026-05-20T19:00:00Z');
      // Unrelated project's permit is untouched.
      expect(rows.find((p) => p.id === 999)?.updated_at).toBe('unchanged');
    }
    const projects = queryClient.getQueryData<typeof staleProjects>(['projects', T]) ?? [];
    expect(projects.find((p) => p.id === 'proj-1')?.updated_at).toBe('2026-05-20T19:00:00Z');
    expect(projects.find((p) => p.id === 'other')?.updated_at).toBe('unchanged');
  });

  it('fix-73: on conflict the caches are left alone (rolled-back edit)', async () => {
    mocks.setResult({
      data: [
        row({
          out_conflict: true,
          out_conflict_kind: 'permit',
          out_conflict_id: '256',
          out_project_updated_at: null,
          out_permits: [],
        }),
      ],
      error: null,
    });

    const { queryClient, wrapper } = setup();
    const stale = [
      {
        id: 256,
        project_id: 'proj-1',
        type: 'Building Permit',
        updated_at: 'stale',
        permit_cycles: [],
      },
    ];
    queryClient.setQueryData(['permits', T], stale);

    const { result } = renderHook(() => useUpdateProjectWithPermits(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'proj-1',
        projectExpectedUpdatedAt: 'stale',
        projectPatch: {},
        permitUpserts: [{ id: 256, expected_updated_at: 'stale' }],
        permitDeletes: [],
      });
    });

    const after = queryClient.getQueryData<typeof stale>(['permits', T]) ?? [];
    // Conflict = whole edit rolled back server-side; the cache stays as-is.
    expect(after.find((p) => p.id === 256)?.updated_at).toBe('stale');
  });
});
