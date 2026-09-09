import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import type { DaTimeBlock } from './database.types';

// ===========================================================================
// ★★★ fix-442 (P-067) — THE GRID MUST LEARN THE NEW TOKEN, NOT THE GUARD RELAX
// ===========================================================================
//
// MEASURED ON PROD 2026-08-29. `error_reports` holds exactly six rows matching
// "changed since you loaded" and ALL SIX say "Time block" — none say "Draw
// schedule" or "Permit". Three users, all on /draw-schedule, and every one of
// the six lands 1.5–2.5 s after a SUCCESSFUL update of a block inserted 3–10 s
// before it. One person, one block, add → edit → edit again, alone in the app.
//
// ★★★ WHAT WAS ACTUALLY WRONG. The three `da_time_blocks` writers only
// INVALIDATE the list after a write; not one of them wrote the returned
// `updated_at` back. So between the write landing and the refetch arriving,
// the grid still rendered the PRE-write row — and every OCC token in the UI is
// read straight off that row: the two resize handles
// (DrawScheduleGrid ~1911 / ~1950, `expectedUpdatedAt: np.updated_at`) and the
// edit popup (~2802 / ~2811, `npPopup.block.updated_at`). The user's second
// action therefore handed the server a token it had already superseded, and
// `bp_resize_da_time_block`'s `v_current_updated_at IS DISTINCT FROM
// p_expected_updated_at` was quite right to refuse it.
//
// ★★★ SO THE GUARD DOES NOT MOVE. This is fix-73 / fix-341's class exactly —
// the guard is right about the row and wrong about the cause — and the fix for
// that class is never to widen the check. First-writer-wins still holds, the
// RPCs are untouched, and fix-341 §1's sentence is untouched. What changes is
// that the cache stops lying about what the row currently is.
//
// ★★ ONE MODULE, THREE CALLERS. The write-back is the same three lines in
// resize, upsert and delete, and three copies is how one of them ends up
// forgetting the token — which is the bug being fixed, one level up.
//
// ★ THE WINDOW IS NOT 2 SECONDS WIDE BY LUCK. App.tsx sets
//   `staleTime: 30_000` and `refetchOnWindowFocus: false`, so a stale cached
//   token survives well past the observed window whenever an invalidation is
//   skipped or its refetch is slow. The write-back closes it at the moment the
//   write returns rather than at the moment a network round trip finishes.

/**
 * ★★ Absent cache → NO-OP, deliberately.
 *
 * React Query treats an updater returning `undefined` as "no change", and that
 * is the behaviour wanted: if the grid has not loaded the list yet there is no
 * list to correct, and inventing a one-row array would make the first real
 * fetch look like a change.
 */
function patchList(
  queryClient: QueryClient,
  tenantId: string,
  apply: (rows: DaTimeBlock[]) => DaTimeBlock[],
): void {
  queryClient.setQueryData<DaTimeBlock[]>(
    queryKeys.daTimeBlocks(tenantId),
    (rows) => (rows ? apply(rows) : undefined),
  );
}

/**
 * ★★★ A RESIZE MOVES THREE FIELDS AND NOTHING ELSE — the two weeks the user
 * dragged, and the token the server minted for them. The label, the owner and
 * the project link are not a resize's business, and copying a whole row from a
 * stale snapshot is how a concurrent rename gets silently reverted.
 *
 * `updatedAt` may be null only on the overlap path, which is not a write —
 * callers must not reach here in that case, and the guard is kept anyway.
 */
export function applyResizedBlock(
  queryClient: QueryClient,
  tenantId: string,
  blockId: string,
  startWeek: string,
  endWeek: string,
  updatedAt: string | null,
): void {
  if (!updatedAt) return;
  patchList(queryClient, tenantId, (rows) =>
    rows.map((r) =>
      r.id === blockId
        ? { ...r, start_week: startWeek, end_week: endWeek, updated_at: updatedAt }
        : r,
    ),
  );
}

/**
 * ★★ An upsert already knows the WHOLE row — `useUpsertDaTimeBlock`'s
 * mutationFn builds it from the payload it sent plus the returned
 * `updated_at` — so this replaces by id, or appends when the id is new.
 *
 * ★ Appending matters as much as replacing: the prod shape is add → edit →
 *   edit, and after the insert the block has to BE in the list for the second
 *   action to read a correct token off it.
 */
export function applyUpsertedBlock(
  queryClient: QueryClient,
  tenantId: string,
  row: DaTimeBlock,
): void {
  patchList(queryClient, tenantId, (rows) =>
    rows.some((r) => r.id === row.id)
      ? rows.map((r) => (r.id === row.id ? { ...r, ...row } : r))
      : [...rows, row],
  );
}

// ===========================================================================
// ★★★ fix-511 §B — THE FOURTH WRITER, AND WHY IT GETS A DIFFERENT HELPER
// ===========================================================================
//
// fix-442's header says "ONE MODULE, THREE CALLERS". Prod says four.
// `pg_proc` on 2026-09-09: exactly five functions write `da_time_blocks` —
// `bp_upsert_da_time_block_row`, `bp_delete_da_time_block_row`,
// `bp_resize_da_time_block`, `bp_rename_da`, and `bp_replace_da_time_blocks`
// (no caller in `src`). The first three are the three above. **The fourth is
// `bp_rename_da`, via `useRenameDA`, and it was the one writer that called no
// helper here.** fix-442's own property test could not see it, because that
// test names three source files rather than enumerating the writers — which is
// why §B's replacement test enumerates.
//
// ★★★ AND IT CANNOT USE THE OTHER THREE. A rename is a BULK write: it sets
// `da_name` on every block belonging to that DA, so `bp_set_updated_at` mints a
// new token for every one of them at once — fix-341's diagnosed class, "a bulk
// write bumping sibling updated_at", arriving on the table fix-341 was not
// looking at. The RPC returns per-table COUNTS, not rows, so there is no token
// to write back: the client genuinely does not know what the new stamps are.
//
// ★★ SO THE HONEST ANSWER IS TO FORGET, NOT TO PATCH. `invalidateQueries`
// alone — which is what the hook did — leaves the old rows rendered until the
// refetch lands, and every token on every one of them is now wrong. That is
// fix-442's bug multiplied by the DA's whole column. `resetQueries` drops them
// and refetches, so the grid shows one round trip of skeleton instead of a
// screenful of rows whose tokens would each be refused. A rename is a rare
// admin action in Settings; a moment of skeleton costs nothing and a silently
// superseded token costs an edit.
/**
 * Forget every cached `da_time_blocks` list, for a write whose new tokens the
 * client cannot know. Tenant-wide by design: `bp_rename_da` crosses whatever
 * the caller happened to have loaded.
 */
export function forgetDaTimeBlocks(queryClient: QueryClient): void {
  void queryClient.resetQueries({ queryKey: queryKeys.daTimeBlocksAll });
}

/** ★ Removed on SUCCESS only. A refused delete must leave the block on the
 *  grid — showing it gone while the database still holds it would be a worse
 *  lie than the one this ticket is fixing. */
export function applyDeletedBlock(
  queryClient: QueryClient,
  tenantId: string,
  blockId: string,
): void {
  patchList(queryClient, tenantId, (rows) => rows.filter((r) => r.id !== blockId));
}
