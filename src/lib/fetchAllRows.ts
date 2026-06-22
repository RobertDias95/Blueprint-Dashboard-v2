import type { PostgrestError } from '@supabase/supabase-js';

// fix-189: PostgREST caps an un-ranged select at `db-max-rows` (default 1000)
// and returns the first page SILENTLY — no error. A "load every row for the
// tenant" hook that does a bare `.select()` therefore truncates once the table
// crosses 1000 rows, dropping the tail and (e.g.) mislabeling permits whose
// reviewer rows landed past row 1000.
//
// fetchAllRows pages through the result with `.range()` until a short page is
// returned, then concatenates — so callers always get the COMPLETE set
// regardless of table size. Centralized so future load-all hooks reuse it
// instead of re-introducing the silent-truncation bug.

export const FETCH_ALL_PAGE_SIZE = 1000;

interface RangeResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

/**
 * Fetch every row of a Supabase select by paging with `.range()`.
 *
 * `makeQuery` MUST return a FRESH query builder each call — Supabase builders
 * are single-use (awaiting one runs it), so each page needs its own. It MUST
 * also carry a TOTAL ordering (include a unique tiebreaker such as the primary
 * key) so rows can't shift across page boundaries and get duplicated or
 * skipped.
 *
 * Stops when a page returns fewer than `pageSize` rows (the final page). A table
 * whose size is an exact multiple of `pageSize` costs one extra empty request,
 * which is correct and cheap.
 */
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<RangeResult<T>>,
  pageSize: number = FETCH_ALL_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
