import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows } from '../lib/fetchAllRows';

// fix-189: the paginator must return EVERY row regardless of count, so a table
// past PostgREST's 1000-row cap is never silently truncated.

function rows(n: number, offset = 0): { id: number }[] {
  return Array.from({ length: n }, (_, i) => ({ id: offset + i }));
}

describe('fetchAllRows', () => {
  it('returns the single page unchanged when the table is under the page size', async () => {
    const make = vi.fn(async (from: number, to: number) => {
      expect([from, to]).toEqual([0, 999]);
      return { data: rows(42), error: null };
    });
    const out = await fetchAllRows<{ id: number }>(make);
    expect(out).toHaveLength(42);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('pages across a >1000-row response and concatenates the full set (1029)', async () => {
    const calls: Array<[number, number]> = [];
    const make = vi.fn(async (from: number, to: number) => {
      calls.push([from, to]);
      if (from === 0) return { data: rows(1000, 0), error: null }; // full page → keep going
      return { data: rows(29, 1000), error: null }; // short page → stop
    });
    const out = await fetchAllRows<{ id: number }>(make);
    expect(out).toHaveLength(1029);
    // Ranges requested were [0,999] then [1000,1999].
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // No row dropped or duplicated — ids 0..1028 in order.
    expect(out[0].id).toBe(0);
    expect(out[1028].id).toBe(1028);
  });

  it('fetches one extra (empty) page when the count is an exact multiple of the page size', async () => {
    const make = vi.fn(async (from: number) => {
      if (from === 0) return { data: rows(1000, 0), error: null };
      return { data: [] as { id: number }[], error: null }; // empty short page → stop
    });
    const out = await fetchAllRows<{ id: number }>(make);
    expect(out).toHaveLength(1000);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('handles three full pages then a short one', async () => {
    const make = vi.fn(async (from: number) => {
      if (from < 3000) return { data: rows(1000, from), error: null };
      return { data: rows(5, from), error: null };
    });
    const out = await fetchAllRows<{ id: number }>(make);
    expect(out).toHaveLength(3005);
    expect(make).toHaveBeenCalledTimes(4);
  });

  it('treats null data as an empty (terminal) page', async () => {
    const make = vi.fn(async () => ({ data: null, error: null }));
    const out = await fetchAllRows<{ id: number }>(make);
    expect(out).toEqual([]);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('throws and stops paging when a page returns an error', async () => {
    const err = { message: 'boom', details: '', hint: '', code: '500', name: 'PostgrestError' };
    const make = vi.fn(async () => ({ data: null, error: err as never }));
    await expect(fetchAllRows<{ id: number }>(make)).rejects.toBe(err);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('respects a custom page size', async () => {
    const make = vi.fn(async (from: number, to: number) => {
      expect(to - from + 1).toBe(2);
      if (from === 0) return { data: rows(2, 0), error: null };
      return { data: rows(1, 2), error: null };
    });
    const out = await fetchAllRows<{ id: number }>(make, 2);
    expect(out).toHaveLength(3);
    expect(make).toHaveBeenCalledTimes(2);
  });
});
