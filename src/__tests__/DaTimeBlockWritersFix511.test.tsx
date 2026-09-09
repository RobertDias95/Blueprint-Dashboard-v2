import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { DaTimeBlock } from '../lib/database.types';

// ===========================================================================
// fix-511 §B (P-067, REOPENED) — THE WRITE PATHS fix-442 DID NOT WIRE
// ===========================================================================
//
// P-067 was closed on 2026-08-29 by fix-442 and prod says it is back. The
// trail, from `error_reports` + `da_time_blocks` on 2026-09-09:
//
//   19:20:53.305  write SUCCEEDS  — np_1786128245182_g3g2 (Trevor / Vacation)
//   19:20:55.809  OCC refused     — dave@blueprintcap.com, /draw-schedule
//   19:20:57.973  write SUCCEEDS  — np_1784918494126_xtct (Trevor / Corrections)
//   19:20:59.611  OCC refused     — same user
//
// Exactly three `da_time_blocks` rows were written that whole day, and two of
// them are the two successes above — so the two refusals wrote NOTHING. Both
// carry the identical fingerprint 8ee44bdbaa67d6630df4b32a9c391641 and the
// message "Time block changed since you loaded it", which only
// `OCCConflictError(0, 'Time block')` produces.
//
// ---------------------------------------------------------------------------
// ★★★ EVERY WRITE TO `da_time_blocks`, ENUMERATED AGAINST PROD, NOT GREPPED
// ---------------------------------------------------------------------------
//
// `pg_proc` on 2026-09-09, every function whose body writes the table:
//
//   bp_upsert_da_time_block_row  → useUpsertDaTimeBlock  → applyUpsertedBlock ✓
//   bp_resize_da_time_block      → useResizeDaTimeBlock  → applyResizedBlock  ✓
//   bp_delete_da_time_block_row  → useDeleteDaTimeBlock  → applyDeletedBlock  ✓
//   bp_rename_da                 → useRenameDA           → NOTHING            ✗
//   bp_replace_da_time_blocks    → no caller in src
//   migrate_auxiliary            → migration helper, not a client path
//
// ONE unwired writer, so no STOP. It is `useRenameDA`, and §B1 wires it.
//
// ★★ BUT IT IS NOT WHAT DAVE HIT, AND THIS FILE SAYS SO RATHER THAN IMPLYING
//    OTHERWISE. No rename happened on 2026-09-09 — all three rows written that
//    day kept their `da_name`. `useRenameDA` is a latent hole of exactly
//    fix-341's class ("a bulk write bumping sibling updated_at"), found by the
//    enumeration the brief asked for, and closed here because it was found.
//
// ---------------------------------------------------------------------------
// ★★★ WHAT DAVE HIT IS THE READER HALF, AND IT IS fix-393's INVARIANT INVERTED
// ---------------------------------------------------------------------------
//
// fix-442 taught the WRITER's own cache the new token. Nothing teaches anybody
// else: `da_time_blocks` is a member of `supabase_realtime` on prod (verified
// alongside draw_schedule / projects / permits) and had NO entry in
// REALTIME_TABLES, so every change Postgres emitted for it went to a channel
// with no handler. With App.tsx's `staleTime: 30_000` and
// `refetchOnWindowFocus: false`, a second surface holds its load-time
// `updated_at` for as long as it stays mounted — and every OCC token the grid
// sends is read straight off that list. A write here, a refusal two seconds
// later there, twice, is that shape exactly.
//
// ★ Its neighbour on the same screen was already wired (`draw_schedule`, one
//   line above it in the map), which is what hid this for so long: project
//   blocks refreshed live and NP blocks silently did not.
// ★ NO MIGRATION. The publication membership already exists.
//
// ---------------------------------------------------------------------------
// ★★ P-095 STILL HOLDS, CHECKED BY CONTENT AND NOT BY ITS STATUS
// ---------------------------------------------------------------------------
//
// P-095 ("project block hooks do not carry the token") is marked resolved by
// fix-443. Read on 2026-09-09: `useUpdateDrawSchedule` writes
// `data.out_updated_at` into the cached row, `useMoveDrawScheduleDa` writes
// `result.updatedAt`, and `useResolveDaOverlap` writes
// `data.out_anchor_updated_at`. All three carry the token. It holds.
// ★ One caveat worth recording rather than fixing here: each does it with its
//   own inline `setQueryData`, so the draw-schedule side has the three copies
//   `daTimeBlockCache`'s own header exists to prevent. Not this ticket.

// ---------------------------------------------------------------------------
// §B3 — THE PROPERTY: every writer goes through the cache module
// ---------------------------------------------------------------------------
//
// ★★★ fix-442's version of this test named three FILES. That is the assertion
// that let a fourth writer in: it can only ever be true of the files it lists.
// This one enumerates instead — it reads every hook in the tree, finds the ones
// that name a `da_time_blocks`-writing RPC, and requires each of them to import
// from `daTimeBlockCache`. A fifth writer added tomorrow fails here on the day
// it is written.

/** Every DB function that writes `da_time_blocks`, from `pg_proc` on prod
 *  2026-09-09. ★ `bp_replace_da_time_blocks` is included deliberately: it has
 *  no caller today, and the day it gets one this test must apply to it. */
const DA_TIME_BLOCK_WRITE_RPCS = [
  'bp_upsert_da_time_block_row',
  'bp_delete_da_time_block_row',
  'bp_resize_da_time_block',
  'bp_rename_da',
  'bp_replace_da_time_blocks',
] as const;

const hookSources = import.meta.glob('../hooks/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Strip comments — these files discuss the RPCs by name at length in prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-511 §B3 — the property: every da_time_blocks writer goes through the cache', () => {
  it('the enumeration actually found the hooks (and the stripper stripped)', () => {
    expect(Object.keys(hookSources).length).toBeGreaterThan(50);
    const upsert = hookSources['../hooks/useUpsertDaTimeBlock.ts'];
    expect(upsert).toBeTruthy();
    expect(upsert).toContain('P-067');
    expect(code(upsert)).not.toContain('P-067');
  });

  it('★★★ every hook that calls a da_time_blocks write RPC imports daTimeBlockCache', () => {
    const writers: string[] = [];
    for (const [path, src] of Object.entries(hookSources)) {
      const c = code(src);
      if (!DA_TIME_BLOCK_WRITE_RPCS.some((rpc) => c.includes(`'${rpc}'`))) continue;
      writers.push(path);
      expect(c, `${path} writes da_time_blocks but never imports daTimeBlockCache`)
        .toMatch(/from\s+'\.\.\/lib\/daTimeBlockCache'/);
    }
    // ★ Four writers, named — so a writer DISAPPEARING is a failure too, not a
    //   quietly-passing empty loop.
    expect(writers.sort()).toEqual([
      '../hooks/useDeleteDaTimeBlock.ts',
      '../hooks/useRenameDA.ts',
      '../hooks/useResizeDaTimeBlock.ts',
      '../hooks/useUpsertDaTimeBlock.ts',
    ]);
  });

  it('★★ …and the helper it imports is used, not merely imported', () => {
    for (const [path, src] of Object.entries(hookSources)) {
      const c = code(src);
      if (!DA_TIME_BLOCK_WRITE_RPCS.some((rpc) => c.includes(`'${rpc}'`))) continue;
      expect(c, path).toMatch(/onSuccess:[\s\S]*?(apply\w+Block|forgetDaTimeBlocks)\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// §B2 — the reader half, on fix-391's table-aware harness
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const byTable = new Map<string, Array<() => void>>();
  const channelObj: {
    on: (...a: unknown[]) => unknown;
    subscribe: (cb?: (s: string) => void) => unknown;
  } = {
    on: (...args: unknown[]) => {
      const filter = args[1] as { table: string };
      const handler = args[2] as () => void;
      const list = byTable.get(filter.table) ?? [];
      list.push(handler);
      byTable.set(filter.table, list);
      return channelObj;
    },
    subscribe: () => channelObj,
  };
  const rpcFn = vi.fn();
  return {
    byTable,
    rpcFn,
    supabase: {
      channel: () => channelObj,
      removeChannel: vi.fn(),
      rpc: (name: string, args: Record<string, unknown>) => rpcFn(name, args),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import { useRealtimeInvalidation, allRealtimeKeys } from '../hooks/useRealtimeInvalidation';
import { useRenameDA } from '../hooks/useRenameDA';

const T = 'test-tenant-uuid';

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function block(over: Partial<DaTimeBlock> = {}): DaTimeBlock {
  return {
    id: 'np_1786128245182_g3g2',
    da_name: 'Trevor',
    type: 'Vacation',
    label: 'Marketing',
    start_week: '2026-08-10',
    end_week: '2026-08-31',
    created_at: '2026-08-07T18:44:05.437516+00:00',
    updated_at: '2026-09-09T19:20:00.000000+00:00',
    project_id: null,
    ...over,
  };
}

beforeEach(() => {
  mocks.byTable.clear();
  mocks.rpcFn.mockReset();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
});

describe('fix-511 §B2 — a surface that did NOT write learns the new token', () => {
  it('★★★ da_time_blocks has a handler at all — it had none, and the table was published', () => {
    const qc = newClient();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrapperFor(qc) });
    // ★ THE WHOLE DEFECT IN ONE ASSERTION. Before this ticket `byTable` had no
    //   `da_time_blocks` entry, so every change Postgres emitted for the table
    //   arrived at a channel with nobody on it.
    expect(mocks.byTable.get('da_time_blocks')?.length).toBe(1);
  });

  it('★★★ …and an event on it invalidates the list every OCC token is read off', () => {
    const qc = newClient();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrapperFor(qc) });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    mocks.byTable.get('da_time_blocks')![0]!();
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.daTimeBlocksAll });
    // One key, no fan-out: nothing else reads this table.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('★★ the bare prefix reaches BOTH readers — the grid list and fix-384\'s project card', () => {
    // queryKeys.daTimeBlocksAll is ['da_time_blocks'], and React Query matches
    // by prefix, so one entry covers daTimeBlocks(tenant) AND
    // projectTimeBlocks(tenant, project) — which reads the same table with its
    // own five-minute staleTime and would otherwise be the stalest thing here.
    expect(queryKeys.daTimeBlocks(T).slice(0, 1)).toEqual([...queryKeys.daTimeBlocksAll]);
    expect(queryKeys.projectTimeBlocks(T, 'p1').slice(0, 1)).toEqual([
      ...queryKeys.daTimeBlocksAll,
    ]);
  });

  it('★★ it maps to its own key and is reachable by fix-371\'s fallback poll', () => {
    expect(REALTIME_TABLES).toHaveProperty('da_time_blocks');
    expect(REALTIME_TABLES.da_time_blocks).toEqual([queryKeys.daTimeBlocksAll]);
    // While the socket is degraded the 60-second floor invalidates
    // allRealtimeKeys(); a new entry must be on the slow path too.
    const all = allRealtimeKeys().map((k) => JSON.stringify(k));
    expect(all).toContain(JSON.stringify(queryKeys.daTimeBlocksAll));
  });

  it('★★ every handler registered still matches the map, one per table', () => {
    const qc = newClient();
    renderHook(() => useRealtimeInvalidation(), { wrapper: wrapperFor(qc) });
    expect(mocks.byTable.size).toBe(Object.keys(REALTIME_TABLES).length);
    void qc;
  });
});

// ---------------------------------------------------------------------------
// §B1 — the fourth writer
// ---------------------------------------------------------------------------

describe('fix-511 §B1 — a rename cannot leave a column of superseded tokens rendered', () => {
  async function rename(qc: QueryClient, shouldThrow = false) {
    const { result } = renderHook(() => useRenameDA(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      const p = result.current.mutateAsync({ oldName: 'Trevor', newName: 'Trev' });
      if (shouldThrow) await p.catch(() => undefined);
      else await p;
    });
  }

  it('★★★ the cached list is DROPPED, not left to be refetched under the user', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block()]);
    qc.setQueryData(queryKeys.projectTimeBlocks(T, 'p1'), [block()]);
    mocks.rpcFn.mockResolvedValue({
      data: { team_members: 1, da_time_blocks: 4 },
      error: null,
    });
    await rename(qc);
    // ★★★ bp_rename_da sets `da_name` on EVERY block of that DA, so
    // bp_set_updated_at mints a new token for every one of them and the RPC
    // returns only counts. An invalidation leaves these rows ON SCREEN with
    // tokens that are all superseded — fix-442's bug, times the whole column.
    expect(qc.getQueryData(queryKeys.daTimeBlocks(T))).toBeUndefined();
    // ★ …and fix-384's project card reads the same table under the same prefix.
    expect(qc.getQueryData(queryKeys.projectTimeBlocks(T, 'p1'))).toBeUndefined();
  });

  it('★★ a no-op rename still forgets — the RPC reports it, the cache cannot', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block()]);
    mocks.rpcFn.mockResolvedValue({ data: { noop: true }, error: null });
    await rename(qc);
    // The forget runs BEFORE the noop early-return, deliberately: a helper that
    // only fires on the interesting branch is a helper somebody forgets.
    expect(qc.getQueryData(queryKeys.daTimeBlocks(T))).toBeUndefined();
  });

  it('★ a FAILED rename leaves the cache alone — nothing was written', async () => {
    const qc = newClient();
    qc.setQueryData(queryKeys.daTimeBlocks(T), [block()]);
    mocks.rpcFn.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await rename(qc, true);
    expect(qc.getQueryData(queryKeys.daTimeBlocks(T))).toHaveLength(1);
  });
});
