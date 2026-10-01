import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { REALTIME_TABLES, queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

const ROOT = resolve(__dirname, '../..');
const NEWLINE = String.fromCharCode(10);

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

// ★ fix-613: the `block` fixture went with §B1’s rename tests — nothing
//   builds a da_time_block here any more.

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

  it('★★★ §B1’s writer is GONE from the client — fix-613 retired the rename', () => {
    // ⚠️⚠️ SUPERSEDED, AND THIS SUITE WAS RIGHT ABOUT EVERYTHING IT FOUND.
    //
    //    fix-511 §B census: four writers touch `da_time_blocks`, and ONE of
    //    them — `bp_rename_da` via `useRenameDA` — invalidated NOTHING. A
    //    renamed DA's blocks kept their old `da_name` until a reload. §B1 wired
    //    it, and this test proved the wiring.
    //
    // ⚖️ Bobby, 2026-10-01 then retired the rename path altogether: it renamed
    //    the roster row and some references and MISSED projects, routing and the
    //    draw schedule, so what it advertised as a cascade split one person
    //    into two.
    //
    // ★★★ THE CACHE HOLE IS CLOSED BY REMOVAL RATHER THAN BY WIRING, which is
    //     the stronger end state: there is no client path that renames a DA, so
    //     there is no stale `da_name` to invalidate. The RPC survives on prod
    //     with no caller (no migration) — reported in fix-613's PR.
    expect(existsSync(resolve(ROOT, 'src/hooks/useRenameDA.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/hooks/useRenameDM.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §B1 — the fourth writer
// ---------------------------------------------------------------------------

// ===========================================================================
// ⚠️⚠️ fix-511 §B1's DESCRIBE IS REPLACED BY ONE ASSERTION — fix-613
// ===========================================================================
//
// fix-511 §B found four writers touching `da_time_blocks` and ONE that
// invalidated nothing: `bp_rename_da`, via `useRenameDA`. A renamed DA's blocks
// kept their old `da_name` until a reload. §B1 wired it, and the four tests
// that stood here proved the wiring: the list is dropped rather than refetched,
// a no-op rename still forgets, and a FAILED rename leaves the cache alone.
//
// ★★★ EVERY ONE OF THOSE WAS CORRECT. What changed is that the writer is gone.
//     ⚖️ Bobby, 2026-10-01 retired the rename path from Settings: it renamed the
//     roster row and some references and MISSED projects, routing and the draw
//     schedule, so what it advertised as a cascade split one person into two.
//
// ★★ SO THE CACHE HOLE IS CLOSED BY REMOVAL RATHER THAN BY WIRING, which is the
//    stronger end state: no client path renames a DA, so there is no stale
//    `da_name` left to invalidate. `bp_rename_da` and `bp_rename_dm` survive on
//    prod with NO CLIENT CALLER (no migration) — reported in fix-613's PR, and
//    the honest state until something cascades all 11 columns.
describe('fix-511 §B1 — superseded: the rename path is gone', () => {
  it('★★★ neither rename hook exists, so neither can strand a token', () => {
    expect(existsSync(resolve(ROOT, 'src/hooks/useRenameDA.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/hooks/useRenameDM.ts'))).toBe(false);
    // ★ and nothing in src/ calls the RPCs any more
    const hooks = import.meta.glob('../hooks/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const all = Object.values(hooks).join(NEWLINE);
    expect(all).not.toContain("rpc('bp_rename_da'");
    expect(all).not.toContain("rpc('bp_rename_dm'");
  });
});
