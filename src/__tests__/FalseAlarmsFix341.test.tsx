import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '../lib/queryKeys';
import { useToastStore } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import {
  isCancelledRequest,
  shouldLogQueryFailure,
  shouldSkipBackendRpcLog,
} from '../lib/errorLogger';
import type { PermitCycle, PermitWithCycles } from '../lib/database.types';

// ===========================================================================
// fix-341 — two errors that told people things that were not true
// ===========================================================================
//
// §1 "Cycle was modified by someone else", with nobody else there. Four times
// in three months, three users, every one working alone. The database says what
// happened, to the millisecond (user_activity, 25 W Dravus St, 2026-08-18):
//
//   20:01:40.655  cycle 1 UPDATE resubmitted  +  cycle 2 INSERT   ← ONE call
//   20:01:41.786  ✗ "Cycle was modified by someone else"
//   20:01:48.352  cycle 2 UPDATE submitted    +  cycle 1 UPDATE resubmitted
//   20:01:49.360  ✗ same error
//   20:01:52.071  both written — the retry succeeded
//
// Setting `resubmitted` on cycle N snaps cycle N+1's `submitted`, bumping a row
// the user is about to type into. Their save carries the token from before the
// snap, and the guard — correctly — refuses it.
//
// ★★★ THE GUARD IS NOT WEAKENED. The assertions below hold BOTH ends: the
// false alarm is gone AND a genuine stale token is still refused. If only the
// first were true this fix would be data loss.

const T = 'test-tenant-uuid';
const PERMIT = 7;
const PROJECT = 'proj-1';

// ── A supabase fake with the two surfaces this hook uses: the RPC (a queue of
// responses) and the permits read-back (`select('updated_at, permit_cycles(…)')`).
const db = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcQueue: [] as { data: unknown; error: Error | null }[],
  /** When set, the RPC waits on this before resolving — for the race tests. */
  gate: null as null | { promise: Promise<void>; release: () => void },
  permitUpdatedAt: '2026-08-18T20:01:40.700Z',
  cycleStamps: [] as { id: string; updated_at: string }[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args });
      if (db.gate) await db.gate.promise;
      return db.rpcQueue.shift() ?? { data: [], error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              updated_at: db.permitUpdatedAt,
              permit_cycles: db.cycleStamps,
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { useUpsertPermitCycle, freshestCycleStamp } from '../hooks/useUpsertPermitCycle';

function rpcOk(over: Record<string, unknown> = {}) {
  return {
    data: [
      {
        out_id: 'cycle-1',
        updated_at: '2026-08-18T20:01:41.000Z',
        conflict: false,
        snap_id: null,
        snap_cycle_index: null,
        snap_submitted: null,
        snap_updated_at: null,
        ...over,
      },
    ],
    error: null,
  };
}

function cycle(over: Partial<PermitCycle> = {}): PermitCycle {
  return {
    id: 'cycle-1',
    permit_id: PERMIT,
    cycle_index: 1,
    submitted: '2026-01-15',
    city_target: '2026-02-01',
    corr_issued: null,
    resubmitted: null,
    intake_accepted: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-08-18T20:01:00.000Z',
    ...over,
  };
}

function permitWith(cycles: PermitCycle[]): PermitWithCycles {
  return {
    id: PERMIT,
    project_id: PROJECT,
    type: 'Building Permit',
    updated_at: '2026-08-18T20:01:00.000Z',
    permit_cycles: cycles,
  } as unknown as PermitWithCycles;
}

function setup(cycles: PermitCycle[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.permitsByProject(T, PROJECT), [permitWith(cycles)]);
  queryClient.setQueryData(queryKeys.permits(T), [permitWith(cycles)]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function cachedCycles(queryClient: QueryClient): PermitCycle[] {
  const rows = queryClient.getQueryData<PermitWithCycles[]>(
    queryKeys.permitsByProject(T, PROJECT),
  );
  return rows?.[0]?.permit_cycles ?? [];
}

beforeEach(() => {
  db.rpcCalls.length = 0;
  db.rpcQueue.length = 0;
  db.gate = null;
  db.permitUpdatedAt = '2026-08-18T20:01:40.700Z';
  db.cycleStamps = [];
  useToastStore.getState().clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

// ---------------------------------------------------------------------------
// ★★★ §1 — the false alarm
// ---------------------------------------------------------------------------

describe('fix-341 §1: one person writing sibling cycles raises no conflict', () => {
  it('★★★ Shire\'s run: resubmitted on cycle 1 snaps cycle 2, and the next save on cycle 2 succeeds', async () => {
    const c1 = cycle({ id: 'c1', cycle_index: 1 });
    const c2 = cycle({
      id: 'c2',
      cycle_index: 2,
      submitted: null,
      city_target: '2026-03-01',
      updated_at: '2026-08-18T20:01:05.000Z', // ← the stamp the CELL captured
    });
    const { wrapper } = setup([c1, c2]);
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    // 1. The write that touches two rows: cycle 1 + the snap on cycle 2.
    db.rpcQueue.push(
      rpcOk({
        out_id: 'c1',
        updated_at: '2026-08-18T20:01:40.655Z',
        snap_id: 'c2',
        snap_cycle_index: 2,
        snap_submitted: '2026-08-10',
        snap_updated_at: '2026-08-18T20:01:40.655Z', // ← cycle 2 moved
      }),
    );
    db.cycleStamps = [
      { id: 'c1', updated_at: '2026-08-18T20:01:40.655Z' },
      { id: 'c2', updated_at: '2026-08-18T20:01:40.655Z' },
    ];
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT,
        projectId: PROJECT,
        cycle: c1,
        patch: { resubmitted: '2026-08-10' },
      });
    });

    // 2. …and now the user types into cycle 2, whose object was captured
    //    BEFORE the snap. This is the save that used to fail.
    db.rpcQueue.push(rpcOk({ out_id: 'c2', updated_at: '2026-08-18T20:01:48.352Z' }));
    db.cycleStamps = [
      { id: 'c1', updated_at: '2026-08-18T20:01:40.655Z' },
      { id: 'c2', updated_at: '2026-08-18T20:01:48.352Z' },
    ];
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT,
        projectId: PROJECT,
        cycle: c2, // ★ deliberately the STALE captured object
        patch: { submitted: '2026-08-10' },
      });
    });

    // ★ The token that went to the server is the one the snap produced, not the
    // one the component was holding.
    const second = db.rpcCalls[1];
    expect(second.args.p_expected_updated_at).toBe('2026-08-18T20:01:40.655Z');
    expect(second.args.p_expected_updated_at).not.toBe(c2.updated_at);

    // ★ And no conflict reached the user.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => /changed since you loaded/i.test(t.message))).toBe(false);
    expect(toasts.filter((t) => t.kind === 'success')).toHaveLength(2);
  });

  // ★★ THE ASSERTION THAT STOPS THIS BEING DATA LOSS.
  it('★★ a REAL conflict is still refused', async () => {
    const c1 = cycle({ id: 'c1' });
    const { queryClient, wrapper } = setup([c1]);
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    // Somebody else wrote the row: the server rejects our token.
    db.rpcQueue.push(rpcOk({ out_id: 'c1', conflict: true }));

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT,
          projectId: PROJECT,
          cycle: c1,
          patch: { submitted: '2026-08-10' },
        }),
      ).rejects.toThrow(/Cycle changed since you loaded it/i);
    });

    // ★ The token we sent was the cache's — a stamp the SERVER gave us. The fix
    // never invents one, which is why the guard can still fire.
    expect(db.rpcCalls[0].args.p_expected_updated_at).toBe(c1.updated_at);
    expect(
      useToastStore.getState().toasts.some((t) => t.kind === 'warn'),
    ).toBe(true);
    // …and the optimistic patch was rolled back.
    expect(cachedCycles(queryClient).find((c) => c.id === 'c1')?.submitted).toBe(
      '2026-01-15',
    );
  });

  it('★ the freshest-stamp helper prefers the cache and falls back to the caller', () => {
    const cached = [permitWith([cycle({ id: 'c1', updated_at: 'FRESH' })])];
    expect(freshestCycleStamp([cached], PERMIT, 'c1', 'STALE')).toBe('FRESH');
    // Unknown row, empty cache, wrong permit → the caller's value, never a guess.
    expect(freshestCycleStamp([cached], PERMIT, 'c9', 'STALE')).toBe('STALE');
    expect(freshestCycleStamp([undefined], PERMIT, 'c1', 'STALE')).toBe('STALE');
    expect(freshestCycleStamp([cached], 999, 'c1', 'STALE')).toBe('STALE');
  });

  it('★ a bulk write refreshes the stamps of EVERY row it touched', async () => {
    const c0 = cycle({ id: 'c0', cycle_index: 0 });
    const c1 = cycle({ id: 'c1', cycle_index: 1 });
    const c2 = cycle({ id: 'c2', cycle_index: 2 });
    const { queryClient, wrapper } = setup([c0, c1, c2]);
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    db.rpcQueue.push(rpcOk({ out_id: 'c0', updated_at: 'STAMP-0' }));
    // The server moved all three — only one of which the RPC reports.
    db.cycleStamps = [
      { id: 'c0', updated_at: 'STAMP-0' },
      { id: 'c1', updated_at: 'STAMP-1' },
      { id: 'c2', updated_at: 'STAMP-2' },
    ];
    db.permitUpdatedAt = 'PERMIT-STAMP';

    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT,
        projectId: PROJECT,
        cycle: c0,
        patch: { intake_accepted: '2026-08-10' },
      });
    });

    const cached = cachedCycles(queryClient);
    expect(cached.find((c) => c.id === 'c0')?.updated_at).toBe('STAMP-0');
    expect(cached.find((c) => c.id === 'c1')?.updated_at).toBe('STAMP-1');
    expect(cached.find((c) => c.id === 'c2')?.updated_at).toBe('STAMP-2');
    // fix-76's parent stamp still lands too.
    expect(
      queryClient.getQueryData<PermitWithCycles[]>(
        queryKeys.permitsByProject(T, PROJECT),
      )?.[0].updated_at,
    ).toBe('PERMIT-STAMP');
  });

  // ★ The snap reports only `submitted`; replacing the cached row with it wiped
  // the sibling's other dates — and this hook ships a FULL-ROW payload built
  // from the cache, so the next save would have written those nulls back.
  it('★★ the snap patches the sibling row, it does not blank it', async () => {
    const c1 = cycle({ id: 'c1', cycle_index: 1 });
    const c2 = cycle({
      id: 'c2',
      cycle_index: 2,
      submitted: null,
      city_target: '2026-03-01',
      corr_issued: '2026-03-20',
    });
    const { queryClient, wrapper } = setup([c1, c2]);
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    db.rpcQueue.push(
      rpcOk({
        out_id: 'c1',
        snap_id: 'c2',
        snap_cycle_index: 2,
        snap_submitted: '2026-08-10',
        snap_updated_at: 'SNAP-STAMP',
      }),
    );
    await act(async () => {
      await result.current.mutateAsync({
        op: 'update',
        permitId: PERMIT,
        projectId: PROJECT,
        cycle: c1,
        patch: { resubmitted: '2026-08-10' },
      });
    });

    const snapped = cachedCycles(queryClient).find((c) => c.id === 'c2')!;
    expect(snapped.submitted).toBe('2026-08-10'); // the snap landed…
    expect(snapped.city_target).toBe('2026-03-01'); // …and took nothing with it
    expect(snapped.corr_issued).toBe('2026-03-20');
    expect(snapped.updated_at).toBe('SNAP-STAMP');
  });

  // ★★ Serialised: the second save waits for the first, so it cannot race the
  // snap the first is about to perform. Shire's two failures were 1.1s and 1.0s
  // after the write that moved their token.
  it('★★ two cycle writes run one at a time', async () => {
    const c1 = cycle({ id: 'c1' });
    const c2 = cycle({ id: 'c2', cycle_index: 2 });
    const { wrapper } = setup([c1, c2]);
    const { result } = renderHook(() => useUpsertPermitCycle(), { wrapper });

    let release!: () => void;
    db.gate = {
      promise: new Promise<void>((r) => {
        release = r;
      }),
      release: () => release(),
    };
    db.rpcQueue.push(rpcOk({ out_id: 'c1' }), rpcOk({ out_id: 'c2' }));

    let both: Promise<unknown>;
    await act(async () => {
      both = Promise.all([
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT,
          projectId: PROJECT,
          cycle: c1,
          patch: { resubmitted: '2026-08-10' },
        }),
        result.current.mutateAsync({
          op: 'update',
          permitId: PERMIT,
          projectId: PROJECT,
          cycle: c2,
          patch: { submitted: '2026-08-10' },
        }),
      ]);
      await Promise.resolve();
    });

    // ★ The gate is holding the FIRST call; the second has not been sent.
    expect(db.rpcCalls).toHaveLength(1);
    await act(async () => {
      db.gate = null;
      release();
      await both;
    });
    expect(db.rpcCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ★ §2 — a background query nobody was looking at
// ---------------------------------------------------------------------------
//
// ★★ WHICH CAUSE WAS CONFIRMED. The brief offered two. The second — "a
// background refetch after a note write" — is ruled out by React Query itself:
// `invalidateQueries` defaults to `refetchType: 'active'`, and this codebase
// never passes anything else, so a query with no mounted consumer is marked
// stale and NOT refetched. That is asserted below against a real QueryClient.
//
// What remains is the first: the fetch was in flight while ProjectList was
// mounted, the user clicked into a project, and the failure landed after the
// component had gone — which is exactly why the report carried a /project/…
// URL for a query only /projects runs. The URL is read at LOG time.

describe('fix-341 §2: a cancelled or unobserved query is not a fault', () => {
  it('★ a cancellation is recognised by its identity, not its words', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const rqCancel = Object.assign(new Error('CancelledError'), {
      name: 'CancelledError',
      silent: true,
    });
    expect(isCancelledRequest(abort)).toBe(true);
    expect(isCancelledRequest(rqCancel)).toBe(true);
    // ★ And a real outage says almost the same thing, and is NOT one.
    expect(isCancelledRequest(new TypeError('Failed to fetch'))).toBe(false);
    expect(isCancelledRequest(new Error('AbortController'))).toBe(false);
  });

  it('★★ a cancelled query does not reach logError', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(shouldSkipBackendRpcLog(abort, ['notes', 't', 'search-index'])).toBe(true);
    expect(shouldLogQueryFailure(abort, ['notes', 't', 'search-index'], 3)).toBe(false);
  });

  it('★★★ an unobserved query does not log; the SAME failure with a watcher does', () => {
    const err = new TypeError('Failed to fetch');
    const key = ['notes', 't', 'search-index'];
    // The reported case: ProjectList unmounted, nobody waiting.
    expect(shouldLogQueryFailure(err, key, 0)).toBe(false);
    // ★ The discriminator: the permit_cycle_reviewers failure in the same batch
    // happened ON /projects, with the list mounted — same message, still logged.
    expect(
      shouldLogQueryFailure(err, ['permit_cycle_reviewers', 't'], 1),
    ).toBe(true);
  });

  it('★ a genuine failure on a watched query still logs — this is not a silencer', () => {
    for (const err of [
      new TypeError('Failed to fetch'),
      new Error('permission denied for table permits'),
      { message: 'boom', code: '42501' },
    ]) {
      expect(shouldLogQueryFailure(err, ['permits', 't'], 1)).toBe(true);
    }
  });

  it('★ the pre-existing skips are untouched', () => {
    // fix-165: a chronology rejection is user input, not a fault.
    expect(
      shouldLogQueryFailure({ message: 'bad date', code: '22008' }, ['permits'], 1),
    ).toBe(false);
    // The log RPC itself — the re-entry guard.
    expect(
      shouldLogQueryFailure(new Error('bp_log_error failed'), ['permits'], 1),
    ).toBe(false);
    // fix-314's auth guard.
    expect(shouldLogQueryFailure(new Error('nope'), ['auth/session'], 1)).toBe(false);
  });

  it('★★ CONFIRMED: invalidating a prefix does not refetch a query nobody is watching', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryFn = vi.fn().mockResolvedValue('x');
    // Seed the query as an observer would, then drop the observer — the state
    // ProjectList leaves behind when the user opens a project.
    const unsub = client
      .getQueryCache()
      .build(client, { queryKey: ['notes', T, 'search-index'], queryFn });
    await unsub.fetch();
    expect(queryFn).toHaveBeenCalledTimes(1);

    // A note write invalidates the whole notes prefix, by design.
    await client.invalidateQueries({ queryKey: ['notes'] });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    // ★ Still one call: no observers, no refetch. So the failures in the report
    // cannot have been a post-write background refetch.
    expect(unsub.state.isInvalidated).toBe(true);
  });
});
