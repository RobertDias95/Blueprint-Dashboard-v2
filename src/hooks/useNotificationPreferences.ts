import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import {
  NOTIFICATION_CATEGORIES,
  preferencesFromRows,
  type NotificationCategory,
  type NotificationPreferences,
} from '../lib/notificationPreferences';

// ===========================================================================
// ★★★ fix-634 (P-323) — YOUR EMAIL-NOTIFICATION OPT-OUTS
// ===========================================================================
//
// ⚖️ Bobby, 2026-09-16: on by default, with a per-person opt-out. So the table
//    holds only the exceptions — ABSENCE MEANS ON — and a person who never opens
//    this panel gets every email.
//
// ★★ RLS lets a user read and write only their own rows, so the queries below
//    filter by user id for clarity, not for safety.

export function useNotificationPreferences() {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  return useQuery<NotificationPreferences, Error>({
    queryKey: queryKeys.notificationPreferences(userId ?? ''),
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('category, enabled')
        .eq('user_id', userId!);
      if (error) throw error;
      return preferencesFromRows((data ?? []) as { category: string; enabled: boolean }[]);
    },
  });
}

export function useSetNotificationPreference() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  return useMutation<void, Error, { category: NotificationCategory; enabled: boolean }>({
    meta: { write: 'notification_preferences.upsert' },
    mutationFn: async ({ category, enabled }) => {
      if (!userId) throw new Error('Not signed in.');
      if (!NOTIFICATION_CATEGORIES.includes(category)) {
        throw new Error(`Unknown notification category: ${category}`);
      }
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(
          { user_id: userId, category, enabled, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,category' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notificationPreferences(userId),
        });
      }
    },
  });
}
