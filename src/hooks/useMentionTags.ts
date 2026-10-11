import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type { MentionTag } from '../lib/mentionTags';

// ★★ fix-347 §2 — the custom tags, tenant-wide.
//
// Bobby: "The group tags should be customizable. I should be able to create
// different tags for different groups of people… one group tag, or 30 group
// tags, and it could be a different combination of anyone in the tool."
//
// ★ ADMIN-OWNED, and the gate is the DATABASE's — bp_upsert_mention_tag and
// bp_delete_mention_tag refuse a non-admin, and the tables carry no write
// policy at all. The client hides the controls (below) so nobody is offered a
// button that will fail, but hiding is not the gate.
//
// ★ NOT PUBLISHED TO REALTIME, deliberately: a tag changes when an admin saves
// a form on a Settings screen that refetches, not continuously, and fix-336's
// rule is that publishing a table is a decision made per table.

export function useMentionTags() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<MentionTag[]>({
    queryKey: queryKeys.mentionTags(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_mention_tags');
      if (error) throw error;
      return (data ?? []) as MentionTag[];
    },
  });
}

/**
 * ★★★ fix-643b — every tag resolved for ONE chat by the database's one
 * resolver (`bp_mention_tags_for_project` → `bp_resolve_mention_tag`), so a
 * smart tag such as @Corrections stores exactly the ids the Bridge's own
 * corrections notice would. tag id → user ids.
 */
export function useResolvedMentionTags(projectId: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Map<string, string[]>>({
    queryKey: [...queryKeys.mentionTagsAll, 'resolved', tenantId ?? '', projectId ?? ''],
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_mention_tags_for_project', {
        p_project_id: projectId,
      });
      if (error) throw error;
      const out = new Map<string, string[]>();
      for (const r of (data ?? []) as { tag_id: string; user_ids: string[] | null }[]) {
        out.set(r.tag_id, r.user_ids ?? []);
      }
      return out;
    },
  });
}

export function useUpsertMentionTag() {
  const queryClient = useQueryClient();
  return useMutation<
    string,
    Error,
    { id?: string | null; name: string; memberIds: string[]; includeProjectTeam?: boolean }
  >({
    meta: { write: 'bp_upsert_mention_tag' },
    mutationFn: async ({ id, name, memberIds, includeProjectTeam }) => {
      const { data, error } = await supabase.rpc('bp_upsert_mention_tag', {
        p_id: id ?? null,
        p_name: name,
        p_member_ids: memberIds,
        // ★ fix-643b: always sent by this client, so the flag saves as shown.
        p_include_project_team: includeProjectTeam ?? false,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mentionTagsAll });
      pushToast('Saved tag', 'success');
    },
    onError: (error) => {
      pushToast(`Could not save tag — ${error.message}`, 'error');
    },
  });
}

export function useDeleteMentionTag() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    meta: { write: 'bp_delete_mention_tag' },
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('bp_delete_mention_tag', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mentionTagsAll });
      // ★ The messages that used it keep their resolved ids — deleting a tag
      // cannot rewrite who a past post reached. §4's rule, and the reason this
      // is a safe thing to allow at all.
      pushToast('Tag deleted — past messages keep who they notified', 'success');
    },
    onError: (error) => {
      pushToast(`Could not delete tag — ${error.message}`, 'error');
    },
  });
}
