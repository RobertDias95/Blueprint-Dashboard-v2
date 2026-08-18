import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';

// ★★★ fix-347 §1 — reactions, which are READ RECEIPTS.
//
// Bobby: "Sometimes when we post we always say, react this to let us know that
// you saw it… and we can hover over that thumbs up and see if anyone MISSED
// that post and didn't react."
//
// ★ A REACTION NOTIFIES NOBODY. There is no write to project_messages.mentions
// here, and message_reactions is deliberately not one of the seven sources
// lib/boardReads derives board items from. Acknowledging is not messaging, and
// a "seen it" that pinged everybody would be self-defeating.
//
// ★★ IT STREAMS. fix-336 made publishing a table a per-table decision;
// message_reactions earns it because the entire feature is who-has-seen-this,
// and two people looking at the same post must not disagree about whether
// fifteen or sixteen have acknowledged it. REALTIME_TABLES.message_reactions →
// this query's key.

/** The fixed set. Bobby named the first four; ✅ and 👀 are here because this is
 *  a read-receipt feature and "seen it" / "looking at it" are what people
 *  actually want to say in one click. A full picker is a different feature. */
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '✅', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export interface MessageReaction {
  message_id: string;
  emoji: string;
  user_id: string;
  /** Resolved server-side through bp_profile_display_name — the same name the
   *  chat shows as an author, so the hover cannot disagree with the byline. */
  user_name: string | null;
}

/** Every reaction on one project's chat. One query per open modal, not one per
 *  message — a thread of forty posts would otherwise be forty round trips. */
export function useProjectReactions(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<MessageReaction[]>({
    queryKey: queryKeys.messageReactions(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_message_reactions', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as MessageReaction[];
    },
  });
}

/** Add or remove YOUR reaction. The server decides which — the same click does
 *  both, and what is already there is a question only the database can answer
 *  without a race. */
export function useToggleReaction(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { messageId: string; emoji: string }>({
    mutationFn: async ({ messageId, emoji }) => {
      const { error } = await supabase.rpc('bp_toggle_message_reaction', {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messageReactions(tenantId, projectId ?? ''),
      });
    },
    onError: (error) => {
      pushToast(`Could not react — ${error.message}`, 'error');
    },
  });
}
