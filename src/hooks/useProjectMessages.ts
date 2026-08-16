import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { useUpsertTask } from './useTaskTree';
import type { MentionItemInput } from '../lib/boardReads';
import type { MentionablePerson, ProjectMessage } from '../lib/database.types';

// fix-329 (register #71) — project chat data hooks.
//
// READS go through bp_list_project_messages (SECURITY DEFINER, explicit tenant
// filter) because the author's display name lives on `profiles`, which is
// read-own-only under RLS — the fix-70 / fix-notes-1 pattern. The same call
// returns the linked task, so "✓ Task created" costs no second round trip.
//
// WRITES are direct table INSERT under tenant RLS. There is no update or delete
// hook anywhere in this file, and that is the point: project_messages has no
// UPDATE or DELETE grant (see the migration), because a task can be created
// from a message and a silently rewritten message would make that link a lie.

export function useProjectMessages(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectMessage[]>({
    queryKey: queryKeys.projectMessages(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_project_messages', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as ProjectMessage[];
    },
  });
}

/** Who can be @-mentioned: people who can actually open this tenant, so every
 *  mention resolves to somebody the bell can reach. */
export function useMentionablePeople() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<MentionablePerson[]>({
    queryKey: queryKeys.mentionablePeople(tenantId ?? ''),
    enabled: !!tenantId,
    // The roster changes when somebody joins the tenant, which is rare — but it
    // is still invalidated by the shared realtime map, so this is a cache
    // lifetime, not a staleness risk.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_mentionable_people');
      if (error) throw error;
      return (data ?? []) as MentionablePerson[];
    },
  });
}

/**
 * ★ Every message in the tenant that mentions ME — the bell's source.
 *
 * ★ ONE SOURCE, TWO SURFACES. The rail card's unread count and the bell's badge
 * both come from this query plus board_item_reads, so a mention read in one
 * place stops counting in the other. Two counts that can disagree is the defect
 * fix-298 Phase 2 spent a ticket collapsing, and it is not being rebuilt here.
 *
 * `.contains('mentions', [userId])` is an index lookup on the GIN index the
 * migration adds — not a scan, and not a client-side re-parse of every body.
 */
export function useMyMentions() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<MentionItemInput[]>({
    queryKey: queryKeys.myMentions(tenantId ?? '', userId ?? ''),
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_messages')
        .select('id, project_id, body, created_at, mentions')
        .contains('mentions', [userId])
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MentionItemInput[];
    },
  });
}

export interface PostMessageInput {
  projectId: string;
  body: string;
  /** Resolved by the composer via projectChat.parseMentions. */
  mentions: string[];
}

export function usePostMessage() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, PostMessageInput>({
    mutationFn: async ({ projectId, body, mentions }) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      // tenant_id and author_id are stamped by triggers; the insert policy
      // refuses any author but the caller.
      const { error } = await supabase.from('project_messages').insert({
        project_id: projectId,
        body: trimmed,
        mentions,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // One prefix covers the thread, the rail card and the bell's mention
      // query — they are the same data and they refresh together.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMessagesAll });
    },
    onError: (error) => {
      pushToast(`Could not send — ${error.message}`, 'error');
    },
  });
}

export interface CreateTaskFromMessageInput {
  messageId: string;
  /** The permit the task hangs off — see the note on the anchor below. */
  permitId: number;
  text: string;
  /** fix-244: the task column follows the TEAM — the chat composer passes the
   *  same two the rest of the app uses. */
  discipline: 'arch' | 'ent';
  assignedTo?: string | null;
  targetDate?: string | null;
}

/**
 * ★ Create a task FROM a message, and remember which message.
 *
 * ★ IT USES THE EXISTING WRITE PATH. The task itself is created by
 * `useUpsertTask` → `bp_upsert_permit_task`, the same RPC every other surface
 * uses, so a chat-born task is a task: it obeys the discipline/bucket triggers,
 * it appears in My Tasks and on My Board, and fix-308's ownership rules apply to
 * it unchanged. There is no second task-creation path in this codebase and this
 * ticket does not add one.
 *
 * The link is then written as a single column update on the row just created.
 * That is not a second write path for tasks — it is the provenance column this
 * ticket added, and putting it in `bp_upsert_permit_task` would have meant
 * dropping and recreating the hottest RPC in the app to add a parameter.
 */
export function useCreateTaskFromMessage() {
  const queryClient = useQueryClient();
  const upsert = useUpsertTask();
  return useMutation<string, Error, CreateTaskFromMessageInput>({
    mutationFn: async (input) => {
      const taskId = await upsert.mutateAsync({
        permitId: input.permitId,
        discipline: input.discipline,
        text: input.text,
        status: 'Open',
        assignedTo: input.assignedTo ?? null,
        targetDate: input.targetDate ?? null,
      });
      const { error } = await supabase
        .from('permit_tasks')
        .update({ source_message_id: input.messageId })
        .eq('id', taskId);
      if (error) throw error;
      return taskId;
    },
    onSuccess: () => {
      // The thread shows "✓ Task created" off the same RPC that lists it.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMessagesAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not create the task — ${error.message}`, 'error');
    },
  });
}

/**
 * ★ Which permit a chat-born task hangs off.
 *
 * `permit_tasks` is permit-scoped and the chat is project-scoped, so the task
 * needs an anchor. The Building Permit with the lowest id is the project's
 * anchor everywhere else in this app (fix-66's Target Submit, the cascade in the
 * wizard), so it is the anchor here too rather than a new rule.
 *
 * Returns null when the project has no permits at all — the caller disables the
 * button and says why, because a control that throws when pressed is worse than
 * one that explains itself.
 */
export function anchorPermitIdFor(
  permits: ReadonlyArray<{ id: number; type: string | null }>,
): number | null {
  const bps = permits.filter((p) => p.type === 'Building Permit');
  const pool = bps.length > 0 ? bps : permits;
  if (pool.length === 0) return null;
  return pool.reduce((lo, p) => (p.id < lo.id ? p : lo)).id;
}
