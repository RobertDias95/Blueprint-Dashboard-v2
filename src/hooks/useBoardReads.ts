import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';

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

const READS_KEY = ['board_item_reads'] as const;

/** The item keys this user has acknowledged. */
export function useBoardReads() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<string[]>({
    queryKey: [...READS_KEY, tenantId ?? '', userId ?? ''],
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      // RLS narrows this to the caller's own rows; the filter is belt-and-
      // braces so a policy change can never widen it silently.
      const { data, error } = await supabase
        .from('board_item_reads')
        .select('item_key')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((r) => (r as { item_key: string }).item_key);
    },
  });
}

/** Acknowledge one or many items. Idempotent: reading twice is the same fact,
 *  so the insert ignores a duplicate rather than erroring. */
export function useMarkBoardItemsRead() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useMutation<void, Error, string[]>({
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
