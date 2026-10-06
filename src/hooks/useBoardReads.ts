import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
// ★★★ fix-627 (P-322): the SHARED pager. fix-189 centralised it precisely so a
//     later load-all hook could not re-introduce the silent 1000-row truncation.
//     This hook did, and it cost Miles two days.
import { fetchAllRows } from '../lib/fetchAllRows';

// fix-307 — per-user read state for board items.
//
// ★ READ IS NOT DONE. Nothing in this file resolves a task, performs a
// milestone, or changes a board row. It records that a person has SEEN
// something, which removes it from the badge and clears its highlight and does
// nothing else.
//
// ★ ALWAYS THE VIEWER. The row is written for auth.uid() and RLS only ever
// exposes a caller their own rows, so Brittani reading an item while scoped to
// Fisk's queue marks it read for HER — the database will not let it be
// otherwise. That isolation is not a client convention.

// ★ fix-336: the bare prefix moved to lib/queryKeys so REALTIME_TABLES can
// name it. Same key, one spelling — a realtime event on board_item_reads now
// invalidates exactly this query, which is what makes acknowledging in one tab
// clear the badge in every other one.
const READS_KEY = queryKeys.boardItemReadsAll;

// ===========================================================================
// ★★★ fix-627 (P-322) — THE LIST STOPPED AT 1,000 AND SAID NOTHING
// ===========================================================================
//
// Miles, 2026-10-06: *"The Bridge has been broken for me since yesterday
// afternoon … I cannot close the update pop-up even if I restart."*
//
// This hook did `.select('item_key').eq('user_id', userId)` with NO `.range()`.
// PostgREST caps an un-ranged select at `db-max-rows` (1000) and returns the
// first page **silently — no error, no header anybody was reading**. So:
//
//   ★★★ MEASURED 2026-10-06: Miles had **1,001** rows (next: Briana 463). His
//       `weekly-update:2026-09-30` row EXISTED and was the single row the cap cut
//       off — 5 of his 6 weekly keys came back, the newest did not. So
//       `acknowledged` was false, the modal showed, Close upserted a row that was
//       already there (`ignoreDuplicates`), nothing changed, and it showed again.
//       **A loop with no exit, caused by a read.**
//
// ★★ AND IT IS NOT ONLY THE MODAL. Every read mark past row 1,000 looked UNREAD
//    — the bell counted items he had already seen, and the board re-highlighted
//    them. The modal is just the one that could not be dismissed.
//
// ★★★ fix-189 ALREADY CENTRALISED THE FIX. `fetchAllRows` exists, with a comment
//     saying it was centralised "so future load-all hooks reuse it instead of
//     re-introducing the silent-truncation bug". This hook was written later and
//     did not. The lesson is not "page your queries" — it is that a helper whose
//     own comment predicts the bug is not enough on its own, which is why §B
//     sweeps for the others.

/** Every item key this user has acknowledged — **all** of them. */
export function useBoardReads() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<string[]>({
    queryKey: [...READS_KEY, tenantId ?? '', userId ?? ''],
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      // RLS narrows this to the caller's own rows; the filter is belt-and-
      // braces so a policy change can never widen it silently.
      //
      // ★ `fetchAllRows` needs a TOTAL ordering or rows can shift between pages
      //   and be duplicated or skipped. `item_key` is unique PER USER here
      //   (board_item_reads_user_item_uidx), and this query is filtered to one
      //   user — but `id` is appended anyway so the ordering is total on its own
      //   terms rather than relying on a filter staying in place.
      const rows = await fetchAllRows<{ item_key: string }>((from, to) =>
        supabase
          .from('board_item_reads')
          .select('item_key')
          .eq('user_id', userId)
          .order('item_key', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((r) => r.item_key);
    },
  });
}

/**
 * ★★★ fix-627 §A2 — ONE KEY, ASKED FOR DIRECTLY.
 *
 * Paging the whole list fixes the truncation, but a yes/no decision that matters
 * — *is this edition acknowledged?* — should not be a lookup inside a list whose
 * size is somebody's activity history. Miles's modal was unclosable because a
 * boolean was being derived from 1,001 rows, 1,000 of which were irrelevant.
 *
 * ★★ So the question is asked of the database: one row, by key. It is exact
 *    whatever happens to the list, it stays exact if someone reaches 10,000
 *    reads, and it cannot be broken again by a cap.
 *
 * ★ KEYED UNDER `READS_KEY` so `useMarkBoardItemsRead`'s invalidation and
 *   fix-336's realtime subscription on `board_item_reads` both reach it. A
 *   sibling key here would have left Close working and the modal still up.
 */
export function useBoardItemRead(itemKey: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<boolean>({
    queryKey: [...READS_KEY, tenantId ?? '', userId ?? '', 'item', itemKey ?? ''],
    enabled: !!tenantId && !!userId && !!itemKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board_item_reads')
        .select('item_key')
        .eq('user_id', userId)
        .eq('item_key', itemKey)
        .maybeSingle();
      if (error) throw error;
      return data != null;
    },
  });
}

/** Acknowledge one or many items. Idempotent: reading twice is the same fact,
 *  so the insert ignores a duplicate rather than erroring. */
export function useMarkBoardItemsRead() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation<void, Error, string[]>({
    meta: { write: 'board_item_reads.upsert' },
    mutationFn: async (itemKeys) => {
      if (!userId || itemKeys.length === 0) return;
      const { error } = await supabase.from('board_item_reads').upsert(
        itemKeys.map((item_key) => ({ user_id: userId, item_key })),
        // INSERT ... ON CONFLICT DO NOTHING — no UPDATE privilege needed, and
        // the table is granted SELECT + INSERT only.
        { onConflict: 'user_id,item_key', ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READS_KEY });
    },
    onError: (error) => {
      pushToast(`Could not mark as read — ${error.message}`, 'error');
    },
  });
}
