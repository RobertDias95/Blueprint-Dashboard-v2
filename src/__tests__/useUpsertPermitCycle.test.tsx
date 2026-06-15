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
  // fix-76: the hook also fetches `supabase.from('permits').select('updated_at')
  // .eq('id', id).single()` after the cycle RPC so it can patch the parent
  // permit's fresh updated_at into the cache. Stub a chainable builder that
  // returns this value; default to a benign no-op so pre-fix-76 tests that
  // don't care still pass.
  let permitsFromResult: {
    data: { updated_at: string } | null;
    error: Error | null;
  } = { data: null, error: null };
  const rpcFn = vi.fn();
  const fromFn = vi.fn();
  const builder = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcFn(name, args);
      return Promise.resolve(resolveResult);
    },
    from: (table: string) => {
      fromFn(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: () => Promise.resolve(permitsFromResult),
      };
      return chain;
    },
  };
  return {
    builder,
    rpcFn,
    fromFn,
    setResult: (r: { data: unknown[] | null; error: Error | null }) => {
      resolveResult = r;
    },
    setPermitsFromResult: (r: {
      data: { updated_at: string } | null;
      error: Error | null;
    }) => {
      permitsFromResult = r;
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
  mocks.fromFn.mockClear();
  // fix-76: default to a benign null parent updated_at so pre-fix-76 tests
  // that don't seed it keep their existing expectations on permit.updated_at.
  mocks.setPermitsFromResult({ data: null, error: null });
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

// fix-76: on a successful cycle save, the parent permit's updated_at bumps
// server-side (denormalized columns / triggers — verified in prod on 3522
// Ashworth: setting cycle 0 intake_accepted bumped permits.10098.updated_at
// from 21:48:43 to 22:07:09). Without this fix, any DateCell mounted on that
// permit (Approval Date, Actual Issue, …) sends the pre-RPC OCC token and
// hits a conflict on its next save. The hook now fetches the parent's fresh
// updated_at after the RPC and patches the permits caches synchronously,
// mirroring the fix-73 pattern from useSetBpDdDates.
describe('useUpsertPermitCycle — fix-76 parent permit updated_at patch', () => {
  it('patches permit.updated_at in BOTH cache keys from the fresh from(permits).single() fetch', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: [
        {
          out_id: 'c0-uuid',
          updated_at: '2026-05-10T22:07:09Z',
          conflict: false,
          snap_id: null,
          snap_cycle_index: null,
          snap_submitted: null,
          snap_updated_at: null,
        },
      ],
      error: null,
    });
    // Server-side bump landed at 22:07:09 (parent permit).
    mocks.setPermitsFromResult({
      data: { updated_at: '2026-05-10T22:07:09Z' },
      error: null,
    });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    let mutateResult: { parentPermitUpdatedAt?: string | null } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT_ID,
        projectId: PROJECT,
        cycle: c0,
        patch: { intake_accepted: '2026-05-10' },
      });
    });

    expect(mocks.fromFn).toHaveBeenCalledWith('permits');
    expect(mutateResult.parentPermitUpdatedAt).toBe('2026-05-10T22:07:09Z');

    // Both cache keys now carry the fresh parent permit updated_at — the next
    // DateCell save on this permit uses a current OCC token.
    for (const key of [
      queryKeys.permits(T),
      queryKeys.permitsByProject(T, PROJECT),
    ]) {
      const rows = queryClient.getQueryData<PermitWithCycles[]>(key);
      expect(rows?.[0].updated_at).toBe('2026-05-10T22:07:09Z');
    }
  });

  it('falls back gracefully when the auxiliary fetch returns nothing (cache permit.updated_at unchanged)', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: [
        {
          out_id: 'c0-uuid',
          updated_at: '2026-05-10T12:00:00Z',
          conflict: false,
          snap_id: null,
          snap_cycle_index: null,
          snap_submitted: null,
          snap_updated_at: null,
        },
      ],
      error: null,
    });
    // No data returned for the from() call.
    mocks.setPermitsFromResult({ data: null, error: null });

    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    let mutateResult: { parentPermitUpdatedAt?: string | null } = {};
    await act(async () => {
      mutateResult = await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT_ID,
        projectId: PROJECT,
        cycle: c0,
        patch: { intake_accepted: '2026-05-10' },
      });
    });

    expect(mutateResult.parentPermitUpdatedAt).toBeNull();
    // permit.updated_at stays at the seeded value (caller's invalidate path
    // will eventually refresh).
    const rows = queryClient.getQueryData<PermitWithCycles[]>(queryKeys.permits(T));
    expect(rows?.[0].updated_at).toBe('2026-05-01T00:00:00Z');
  });
});

// fix-89: bp_upsert_permit_cycle_row now enforces the full chronology
// chain on every save: submitted ≤ intake_accepted ≤ corr_issued ≤
// resubmitted. The migration is plpgsql; vitest can't exercise the
// validation directly, but it CAN pin the wire contract — for each new
// rule, the server emits a specific error message with ERRCODE=22008,
// and the hook surfaces it via the standard toast + cache-rollback
// path. These tests guard against either:
//   * the server changing the error wording (would silently weaken the
//     fix-87 fingerprint grouping by source),
//   * the hook regressing its error-surfacing for this RPC.
//
// The intake_accepted < submitted regression check stays in the
// "fix-26a / -73 / -75 OCC + retry" block above as the canonical test
// for the pre-existing rule.
describe('useUpsertPermitCycle — fix-89 chronology rejections', () => {
  // [server error message ROOT (after the `bp_upsert_permit_cycle_row:`
  // prefix is stripped by the hook), patch that triggers it].
  const cases: Array<{
    rule: string;
    serverMessage: string;
    patch: Record<string, string>;
    matcher: RegExp;
  }> = [
    {
      rule: 'intake_accepted < submitted (existing rule — regression)',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 0: intake_accepted (2026-04-30) cannot precede submitted (2026-05-01)',
      patch: { intake_accepted: '2026-04-30' },
      matcher: /intake_accepted/,
    },
    {
      rule: 'corr_issued < intake_accepted',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 0: corr_issued (2026-05-05) cannot precede intake_accepted (2026-05-10)',
      patch: { intake_accepted: '2026-05-10', corr_issued: '2026-05-05' },
      matcher: /corr_issued/,
    },
    {
      rule: 'corr_issued < submitted (when intake is null)',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 0: corr_issued (2026-04-15) cannot precede submitted (2026-05-01)',
      patch: { corr_issued: '2026-04-15' },
      matcher: /corr_issued/,
    },
    {
      rule: 'resubmitted < submitted',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 0: resubmitted (2026-04-15) cannot precede submitted (2026-05-01)',
      patch: { resubmitted: '2026-04-15' },
      matcher: /resubmitted/,
    },
    {
      rule: 'resubmitted < intake_accepted',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 0: resubmitted (2026-05-05) cannot precede intake_accepted (2026-05-10)',
      patch: { intake_accepted: '2026-05-10', resubmitted: '2026-05-05' },
      matcher: /resubmitted/,
    },
    {
      rule: 'resubmitted < corr_issued (Bobby 2601 E Galer)',
      serverMessage:
        'bp_upsert_permit_cycle_row: Cycle 1: resubmitted (2026-06-12) cannot precede corr_issued (2026-06-19)',
      patch: { corr_issued: '2026-06-19', resubmitted: '2026-06-12' },
      matcher: /resubmitted/,
    },
  ];

  // fix-165: a chronology rejection carries SQLSTATE 22008. The hook still
  // surfaces the inline toast, but passes { log: false } so the toast store
  // skips the frontend_toast log (paired with App.tsx skipping backend_rpc) —
  // no Error Reports row for a user typing an out-of-order date.
  it('a 22008 rejection pushes the toast with { log: false } (not logged)', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: null,
      error: Object.assign(
        new Error(
          'bp_upsert_permit_cycle_row: Cycle 0: resubmitted (2026-04-15) cannot precede submitted (2026-05-01)',
        ),
        { code: '22008' },
      ),
    });

    const pushSpy = vi.spyOn(useToastStore.getState(), 'push');
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT_ID,
          projectId: PROJECT,
          cycle: c0,
          patch: { resubmitted: '2026-04-15' },
        }),
      ).rejects.toThrow(/resubmitted/);
    });

    await waitFor(() => {
      const call = pushSpy.mock.calls.find(([, kind]) => kind === 'error');
      expect(call).toBeTruthy();
      expect(call![0]).not.toMatch(/bp_upsert_permit_cycle_row:/); // fix-26a
      expect(call![2]).toEqual({ log: false }); // fix-165
    });
    pushSpy.mockRestore();
  });

  it('a non-22008 rejection pushes the error toast WITHOUT log suppression', async () => {
    const { queryClient, wrapper } = setupQueryClient();
    const seeded = seedPermitWithC0(queryClient);
    const c0 = seeded.permit_cycles![0];

    mocks.setResult({
      data: null,
      error: Object.assign(new Error('Insert failed: deadlock detected'), {
        code: '40P01',
      }),
    });

    const pushSpy = vi.spyOn(useToastStore.getState(), 'push');
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT_ID,
          projectId: PROJECT,
          cycle: c0,
          patch: { resubmitted: '2026-04-15' },
        }),
      ).rejects.toThrow(/deadlock/);
    });

    await waitFor(() => {
      const call = pushSpy.mock.calls.find(([, kind]) => kind === 'error');
      expect(call).toBeTruthy();
      // log not suppressed → { log: true } (genuine system error still logs).
      expect(call![2]).toEqual({ log: true });
    });
    pushSpy.mockRestore();
  });

  for (const c of cases) {
    it(`rejects ${c.rule} — surfaces the error to a toast + rolls back the cache`, async () => {
      const { queryClient, wrapper } = setupQueryClient();
      const seeded = seedPermitWithC0(queryClient);
      const c0 = seeded.permit_cycles![0];

      mocks.setResult({
        data: null,
        error: new Error(c.serverMessage),
      });

      const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });
      await act(async () => {
        await expect(
          result.current.mutateAsync({
            op: 'update',
            permitId: PERMIT_ID,
            projectId: PROJECT,
            cycle: c0,
            patch: c.patch,
          }),
        ).rejects.toThrow(c.matcher);
      });

      // Cache rolled back — no partial write lingers under the optimistic key.
      const rows = queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT),
      );
      const cycles = rows?.[0].permit_cycles ?? [];
      expect(cycles).toHaveLength(1);
      // The seeded c0 had submitted only — every patched field is null again.
      for (const f of Object.keys(c.patch)) {
        expect(
          (cycles[0] as unknown as Record<string, unknown>)[f],
        ).toBeNull();
      }

      // Toast surfaces the error with the RPC prefix stripped (fix-26a contract).
      await waitFor(() => {
        const err = useToastStore
          .getState()
          .toasts.find((t) => t.kind === 'error');
        expect(err).toBeTruthy();
        expect(err?.message).not.toMatch(/bp_upsert_permit_cycle_row:/);
        expect(err?.message).toMatch(c.matcher);
      });
    });
  }
});
