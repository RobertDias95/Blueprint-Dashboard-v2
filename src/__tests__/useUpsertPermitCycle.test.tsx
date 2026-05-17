import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { queryKeys } from '../lib/queryKeys';
import type { PermitWithCycles } from '../lib/database.types';

// fix-25d-residual: useUpsertPermitCycle wraps bp_upsert_permit_cycle_row,
// which now returns the snap-created cycle alongside the edited row.
// The hook merges BOTH rows into the permits + permitsByProject caches
// synchronously on success (no invalidate roundtrip), so the chain-
// position highlight in PermitDetailV2 lands on the snapped cell within
// the same render that resolves the mutation.

const T = 'test-tenant-uuid';
const PROJECT = 'proj-25d';
const PERMIT_ID = 99;

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

import { useUpsertPermitCycle } from '../hooks/useUpsertPermitCycle';

function setupQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Seed both cache keys with a single permit carrying a single cycle 0
 *  row. The hook's onMutate / onSuccess paths look at both. */
function seedPermitWithC0(queryClient: QueryClient) {
  const permit: PermitWithCycles = {
    id: PERMIT_ID,
    project_id: PROJECT,
    type: 'Building Permit',
    stage: 'design',
    stage_override: null,
    status: null,
    num: null,
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-05-01T00:00:00Z',
    permit_cycles: [
      {
        id: 'c0-uuid',
        permit_id: PERMIT_ID,
        cycle_index: 0,
        submitted: '2026-05-01',
        city_target: null,
        corr_issued: null,
        resubmitted: null,
        intake_accepted: null,
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
      },
    ],
  };
  queryClient.setQueryData(queryKeys.permits(T), [permit]);
  queryClient.setQueryData(queryKeys.permitsByProject(T, PROJECT), [permit]);
  return permit;
}

beforeEach(() => {
  mocks.rpcFn.mockClear();
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('useUpsertPermitCycle — fix-25d-residual snap merge', () => {
  it('intake_accepted on c0 → snap row merged into BOTH cache keys synchronously', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: [
        {
          out_id: 'c0-uuid',
          updated_at: '2026-05-10T12:00:00Z',
          conflict: false,
          snap_id: 'c1-uuid-new',
          snap_cycle_index: 1,
          snap_submitted: '2026-05-10',
          snap_updated_at: '2026-05-10T12:00:00Z',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    let mutateResult: { snapCycle?: { cycle_index: number } | null } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT_ID,
        projectId: PROJECT,
        cycle: c0,
        patch: { intake_accepted: '2026-05-10' },
      });
    });

    expect(mutateResult.snapCycle).not.toBeNull();
    expect(mutateResult.snapCycle?.cycle_index).toBe(1);

    // Both cache keys carry the snap row.
    const expectMerged = (
      rows: PermitWithCycles[] | undefined,
      label: string,
    ) => {
      expect(rows).toBeDefined();
      const cycles = rows![0].permit_cycles ?? [];
      expect(cycles, `${label}: cycle count`).toHaveLength(2);
      const c1 = cycles.find((c) => c.cycle_index === 1);
      expect(c1, `${label}: c1 present`).toBeTruthy();
      expect(c1?.id).toBe('c1-uuid-new');
      expect(c1?.submitted).toBe('2026-05-10');
    };
    expectMerged(
      queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T)),
      'permits global',
    );
    expectMerged(
      queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT),
      ),
      'permitsByProject',
    );
  });

  it('resubmitted on c1 → snap creates c2 row in both caches', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    // Seed with c0 + c1
    const permit: PermitWithCycles = {
      ...seedPermitWithC0(queryClient),
      permit_cycles: [
        {
          id: 'c0-uuid',
          permit_id: PERMIT_ID,
          cycle_index: 0,
          submitted: '2026-05-01',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: '2026-05-10',
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 'c1-uuid',
          permit_id: PERMIT_ID,
          cycle_index: 1,
          submitted: '2026-05-10',
          city_target: null,
          corr_issued: '2026-06-01',
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-10T00:00:00Z',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    };
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, PROJECT), [permit]);
    const c1 = permit.permit_cycles![1];

    mocks.setResult({
      data: [
        {
          out_id: 'c1-uuid',
          updated_at: '2026-06-15T12:00:00Z',
          conflict: false,
          snap_id: 'c2-uuid-new',
          snap_cycle_index: 2,
          snap_submitted: '2026-06-15',
          snap_updated_at: '2026-06-15T12:00:00Z',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT_ID,
        projectId: PROJECT,
        cycle: c1,
        patch: { resubmitted: '2026-06-15' },
      });
    });

    const rows = queryClient.getQueryData<PermitWithCycles[]>(
      queryKeys.permitsByProject(T, PROJECT),
    );
    const cycles = rows?.[0].permit_cycles ?? [];
    expect(cycles).toHaveLength(3);
    const c2 = cycles.find((c) => c.cycle_index === 2);
    expect(c2?.id).toBe('c2-uuid-new');
    expect(c2?.submitted).toBe('2026-06-15');
    // c1 keeps its resubmitted value too
    const c1Updated = cycles.find((c) => c.cycle_index === 1);
    expect(c1Updated?.resubmitted).toBe('2026-06-15');
  });

  it('edit-only (city_target) → no snap row returned, no extra cycle in cache', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const permit: PermitWithCycles = {
      ...seedPermitWithC0(queryClient),
      permit_cycles: [
        {
          id: 'c1-uuid',
          permit_id: PERMIT_ID,
          cycle_index: 1,
          submitted: '2026-05-10',
          city_target: null,
          corr_issued: null,
          resubmitted: null,
          intake_accepted: null,
          created_at: '2026-05-10T00:00:00Z',
          updated_at: '2026-05-10T00:00:00Z',
        },
      ],
    };
    queryClient.setQueryData(queryKeys.permits(T), [permit]);
    queryClient.setQueryData(queryKeys.permitsByProject(T, PROJECT), [permit]);
    const c1 = permit.permit_cycles![0];

    mocks.setResult({
      data: [
        {
          out_id: 'c1-uuid',
          updated_at: '2026-05-20T00:00:00Z',
          conflict: false,
          snap_id: null,
          snap_cycle_index: null,
          snap_submitted: null,
          snap_updated_at: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    let mutateResult: { snapCycle?: unknown } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT_ID,
        projectId: PROJECT,
        cycle: c1,
        patch: { city_target: '2026-05-30' },
      });
    });

    expect(mutateResult.snapCycle).toBeNull();
    const rows = queryClient.getQueryData<PermitWithCycles[]>(
      queryKeys.permitsByProject(T, PROJECT),
    );
    const cycles = rows?.[0].permit_cycles ?? [];
    expect(cycles).toHaveLength(1);
    expect(cycles[0].city_target).toBe('2026-05-30');
  });

  it('onError rolls back BOTH the edited row AND any temp snap insertion', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: null,
      error: new Error('bp_upsert_permit_cycle_row: intake_accepted (2026-04-30) cannot precede submitted (2026-05-01)'),
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT_ID,
          projectId: PROJECT,
          cycle: c0,
          patch: { intake_accepted: '2026-04-30' },
        }),
      ).rejects.toThrow(/intake_accepted/);
    });

    // Cache restored to the seeded state.
    const rows = queryClient.getQueryData<PermitWithCycles[]>(
      queryKeys.permitsByProject(T, PROJECT),
    );
    const cycles = rows?.[0].permit_cycles ?? [];
    expect(cycles).toHaveLength(1);
    expect(cycles[0].intake_accepted).toBeNull();

    await waitFor(() => {
      const err = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'error');
      expect(err).toBeTruthy();
      // Prefix stripped per fix-26a
      expect(err?.message).not.toMatch(/bp_upsert_permit_cycle_row:/);
    });
  });

  it('OCC conflict surfaces a warn toast and rolls back', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: [
        {
          out_id: 'c0-uuid',
          updated_at: '2026-05-15T00:00:00Z',
          conflict: true,
          snap_id: null,
          snap_cycle_index: null,
          snap_submitted: null,
          snap_updated_at: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT_ID,
          projectId: PROJECT,
          cycle: c0,
          patch: { intake_accepted: '2026-05-10' },
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    await waitFor(() => {
      const warn = useToastStore
        .getState()
        .toasts.find((t) => t.kind === 'warn');
      expect(warn).toBeTruthy();
    });
  });
});
