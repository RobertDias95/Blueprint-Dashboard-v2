import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { PostReactionRow } from '../lib/postReactions';

// ★★ fix-360 §2 — reactions to the viewer's OWN posts.
//
// Bobby: *"instead of us getting 15 notifications, it's one notification, but
// it pops up the bell 12 times … in the actual notification center it just
// shows that this post got 15 reactions."*
//
// ★ ONE ROW PER REACTION on the wire, one item per POST on screen. The
// aggregation is `lib/postReactions.buildReactionDigests`, deliberately in TS
// rather than a SQL GROUP BY: "8 👍 · 6 😊" is the part a person reads, and a
// grouped RPC would put it where no test in this repo can reach it.
//
// ★★ THE VIEWER'S OWN REACTIONS ARE ALREADY GONE. `bp_my_post_reactions`
// filters `mr.user_id <> auth.uid()` server-side, so "never notify someone
// about their own reaction" is a property of the query rather than a client
// convention somebody can forget to restate. The same is true of the audience:
// the function returns rows only for posts the caller AUTHORED.
//
// ★ Realtime: `message_reactions` is in the publication (fix-347 put it there
// so two people on one post cannot disagree about who has acknowledged it), and
// REALTIME_TABLES now invalidates this key from the same event. That is what
// makes the bell move as reactions land, which §2 asks for explicitly.

export function useMyPostReactions() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<PostReactionRow[]>({
    queryKey: [...queryKeys.myPostReactionsAll, tenantId ?? '', userId ?? ''],
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_my_post_reactions', {});
      if (error) throw error;
      return (data ?? []) as PostReactionRow[];
    },
    // The feed is small by construction — it is only ever applause for one
    // person's own posts — and realtime keeps it honest, so this is a
    // background floor rather than the mechanism.
    staleTime: 60 * 1000,
  });
}
