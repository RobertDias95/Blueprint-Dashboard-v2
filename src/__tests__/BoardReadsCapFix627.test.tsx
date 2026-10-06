import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===========================================================================
// ★★★ fix-627 (HOTFIX, P-322) — THE BOARD-READS LIST STOPPED AT 1,000 ROWS
// ===========================================================================
//
// Miles, 2026-10-06: *"The Bridge has been broken for me since yesterday
// afternoon"* · *"I cannot close the update pop-up even if I restart."*
//
// `useBoardReads` did `.select('item_key').eq('user_id', userId)` with no
// `.range()`. PostgREST caps an un-ranged select at `db-max-rows` (1000) and
// returns the first page SILENTLY. Measured on prod 2026-10-06: Miles had
// **1,001** rows (next: Briana 463), and his `weekly-update:2026-09-30` row was
// the single row the cap cut off — so `acknowledged` read false although the row
// existed, the modal showed, Close upserted a duplicate (ignored), and it showed
// again. A modal with no exit, caused by a read.
//
// ★★★ THE MOCK BELOW *IS* THE BUG. Awaiting a query with no `.range()` returns
//     only the first `DB_MAX_ROWS`, exactly as PostgREST does — no error, no
//     warning. A test whose fake client returned everything would pass against
//     the broken code and prove nothing.

const DB_MAX_ROWS = 1000;

const store = vi.hoisted(() => ({
  /** item_keys belonging to the signed-in user, in the order the server returns. */
  rows: [] as string[],
  /** every select the hook issued, for asserting it really paged. */
  calls: [] as { table: string; ranged: boolean; from?: number; to?: number; eqKeys: string[] }[],
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ activeTenantId: 'tenant-1', user: { id: 'miles' } }),
}));
vi.mock('../stores/toastStore', () => ({ pushToast: vi.fn() }));

vi.mock('../lib/supabase', () => {
  function builder(table: string) {
    const eqs: Record<string, string> = {};
    let range: { from: number; to: number } | null = null;

    // Resolve exactly as PostgREST would: the filters, then either the
    // requested window or — crucially — a SILENTLY CAPPED first page.
    function resolve() {
      let rows = store.rows.map((item_key) => ({ item_key }));
      if (eqs.item_key !== undefined) {
        rows = rows.filter((r) => r.item_key === eqs.item_key);
      }
      store.calls.push({
        table,
        ranged: range !== null,
        from: range?.from,
        to: range?.to,
        eqKeys: Object.keys(eqs),
      });
      if (range) return { data: rows.slice(range.from, range.to + 1), error: null };
      return { data: rows.slice(0, DB_MAX_ROWS), error: null };
    }

    const api: Record<string, unknown> = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: string) => {
        eqs[col] = val;
        return api;
      },
      range: (from: number, to: number) => {
        range = { from, to };
        return api;
      },
      maybeSingle: async () => {
        const { data, error } = resolve();
        return { data: (data as unknown[])[0] ?? null, error };
      },
      then: (
        onFulfilled: (v: { data: unknown; error: null }) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled),
    };
    return api;
  }
  return { supabase: { from: (table: string) => builder(table) } };
});

const { useBoardReads, useBoardItemRead } = await import('../hooks/useBoardReads');

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Miles's shape: `n` ordinary reads with the edition key LAST, so it is exactly
 *  the row an un-paged select drops. */
function milesRows(total: number, editionKey: string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < total - 1; i += 1) {
    rows.push(`auto_closed:${String(i).padStart(6, '0')}`);
  }
  rows.push(editionKey);
  return rows;
}

const EDITION_KEY = 'weekly-update:2026-09-30';

beforeEach(() => {
  store.rows = [];
  store.calls = [];
});

describe('fix-627 §A1 — useBoardReads returns EVERY row', () => {
  it('★★★ 1,001 rows: the 1,001st comes back (it did not before)', async () => {
    store.rows = milesRows(1001, EDITION_KEY);
    const { result } = renderHook(() => useBoardReads(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1001);
    expect(result.current.data).toContain(EDITION_KEY);
  });

  it('★★ it pages — two requests, both ranged', async () => {
    store.rows = milesRows(1001, EDITION_KEY);
    const { result } = renderHook(() => useBoardReads(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const reads = store.calls.filter((c) => c.table === 'board_item_reads');
    expect(reads).toHaveLength(2);
    expect(reads.every((c) => c.ranged)).toBe(true);
    expect(reads[0]).toMatchObject({ from: 0, to: 999 });
    expect(reads[1]).toMatchObject({ from: 1000, to: 1999 });
  });

  it('★ a short first page stops after one request', async () => {
    store.rows = milesRows(5, EDITION_KEY);
    const { result } = renderHook(() => useBoardReads(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
    expect(store.calls.filter((c) => c.table === 'board_item_reads')).toHaveLength(1);
  });

  it('★★ and far past the cap too — 2,500 rows, three pages', async () => {
    store.rows = milesRows(2500, EDITION_KEY);
    const { result } = renderHook(() => useBoardReads(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2500);
    expect(result.current.data).toContain(EDITION_KEY);
    expect(store.calls.filter((c) => c.table === 'board_item_reads')).toHaveLength(3);
  });

  it('★★★ the mock really does cap an un-ranged select — the bug is reproducible', async () => {
    // Guards the guard: if this ever returned everything, every test above would
    // pass against the original un-paged hook and prove nothing.
    store.rows = milesRows(1001, EDITION_KEY);
    const { supabase } = await import('../lib/supabase');
    const unranged = (await (supabase as unknown as {
      from: (t: string) => { select: () => { eq: () => PromiseLike<{ data: unknown[] }> } };
    })
      .from('board_item_reads')
      .select()
      .eq()) as { data: unknown[] };
    expect(unranged.data).toHaveLength(DB_MAX_ROWS);
  });
});

describe('fix-627 §A2 — the edition check asks for its one key', () => {
  it('★★★ true for the key that an un-paged list would have missed', async () => {
    store.rows = milesRows(1001, EDITION_KEY);
    const { result } = renderHook(() => useBoardItemRead(EDITION_KEY), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });

  it('★★ false for an edition that has NOT been acknowledged', async () => {
    store.rows = milesRows(1001, EDITION_KEY);
    const { result } = renderHook(() => useBoardItemRead('weekly-update:2026-10-07'), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it('★★★ one request, filtered by key — the answer cannot depend on list size', async () => {
    store.rows = milesRows(5000, EDITION_KEY);
    const { result } = renderHook(() => useBoardItemRead(EDITION_KEY), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    const reads = store.calls.filter((c) => c.table === 'board_item_reads');
    expect(reads).toHaveLength(1);
    expect(reads[0].eqKeys).toContain('item_key');
    // ★ and it did NOT page a 5,000-row history to answer a yes/no question
    expect(reads[0].ranged).toBe(false);
  });

  it('★ disabled until there is a key', async () => {
    const { result } = renderHook(() => useBoardItemRead(null), { wrapper: wrap() });
    expect(result.current.isSuccess).toBe(false);
    expect(store.calls).toHaveLength(0);
  });
});

describe('fix-627 §A — the wiring that makes Close work', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const code = (s: string) =>
    s
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');

  it('★★★ useWeeklyEdition uses the targeted read, not the list', () => {
    const c = code(read('hooks/useWeeklyEdition.ts'));
    expect(c).toMatch(/useBoardItemRead/);
    // ★ the list-scan that broke Miles is gone
    expect(c).not.toMatch(/readsQ\.data/);
    expect(c).not.toMatch(/useBoardReads\(\)/);
    expect(c).toMatch(/const acknowledged = readQ\.data === true;/);
    // ★ fix-463's "don't flash the modal before the answer arrives" guard stays
    expect(c).toMatch(/readQ\.isSuccess/);
  });

  it('★★★ the targeted query is keyed UNDER the reads key, so Close invalidates it', () => {
    // A sibling key here would leave Close writing the row and the modal still
    // up — the same unclosable loop with a different cause.
    const c = code(read('hooks/useBoardReads.ts'));
    expect(c).toMatch(/queryKey: \[\.\.\.READS_KEY, tenantId \?\? '', userId \?\? '', 'item', itemKey \?\? ''\]/);
    expect(c).toMatch(/invalidateQueries\(\{ queryKey: READS_KEY \}\)/);
  });

  it('★★ useBoardReads uses the SHARED pager, not a second one', () => {
    // fix-189 centralised `fetchAllRows` with a comment saying it existed so a
    // later load-all hook would not re-introduce this bug. This hook is why that
    // comment was not enough — §B sweeps for the others.
    const c = code(read('hooks/useBoardReads.ts'));
    expect(c).toMatch(/import \{ fetchAllRows \} from '\.\.\/lib\/fetchAllRows'/);
    expect(c).toMatch(/fetchAllRows<\{ item_key: string \}>/);
    // ★ a total ordering, or rows shift between pages
    expect(c).toMatch(/\.order\('item_key'/);
    expect(c).toMatch(/\.order\('id'/);
  });
});
