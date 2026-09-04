import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { useUpsertTask } from './useTaskTree';
import { uploadChatAttachments } from './useChatAttachments';
import { groupIntoPosts } from '../lib/projectChat';
import type { MentionItemInput } from '../lib/boardReads';
import type {
  MentionablePerson,
  Permit,
  ProjectMessage,
} from '../lib/database.types';

// fix-329 (register #71) — project chat data hooks.
//
// READS go through bp_list_project_messages (SECURITY DEFINER, explicit tenant
// filter) because the author's display name lives on `profiles`, which is
// read-own-only under RLS — the fix-70 / fix-notes-1 pattern. The same call
// returns the linked task, so "✓ Task created" costs no second round trip.
//
// WRITES are direct table INSERT under tenant RLS.
//
// ★★ fix-334 REVERSED fix-329's append-only rule, and Bobby's own answer is why.
// The rule existed because "a message someone can silently rewrite makes
// 'created from this message' a claim about text that no longer exists". Keeping
// the original reachable removes the word SILENTLY — the objection was never to
// editing, it was to editing without a trace. So there are edit and delete hooks
// here now, and the trace they leave is written by a DATABASE TRIGGER rather
// than by this file, because a history the client appends is a claim about
// client code.
//
// ★ Nothing is ever hard deleted. useDeleteMessage sets `deleted_at`; there is
// no DELETE grant and no DELETE policy, so a task created from a message can
// never be orphaned by one.
//
// ★ AND THE COLUMN GRANT IS THE OTHER HALF. `authenticated` may UPDATE exactly
// (body, mentions, deleted_at) — so even a hand-rolled request cannot move a
// message to another project or re-attribute it, and cannot forge `revisions`.

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

/** ★ fix-345 §3: how many POSTS a project's thread has.
 *
 *  The Team card's Chat button prints it, so the control says what is behind it
 *  rather than only where it goes. It lives here rather than beside the preview
 *  that also needs it, because ProjectChatSection.tsx is a component file and
 *  the react-refresh rule lets one export only components — the same split that
 *  put ribbonNav's model in a lib away from Ribbon.tsx.
 *
 *  ★ It costs no second fetch: React Query dedupes `useProjectMessages`, so the
 *  preview and the button read one request. */
export function useProjectPostCount(projectId: string): number {
  const messagesQ = useProjectMessages(projectId);
  return useMemo(
    () => groupIntoPosts(messagesQ.data ?? []).length,
    [messagesQ.data],
  );
}

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
        // ★ fix-334: a DELETED message stops pinging the bell. Its words are
        // still kept — that is the point of the soft delete — but a
        // notification pointing at text somebody withdrew is noise, and it
        // could never be cleared by reading the thread because it no longer
        // renders there.
        .is('deleted_at', null)
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
  /** fix-330: files the composer is holding. Uploaded HERE, in the same
   *  mutation as the insert — see uploadChatAttachments for why. */
  files?: readonly File[];
  /** ★ fix-334: the post this reply hangs under. NULL creates a POST, which
   *  RLS admits only for an admin. */
  parentMessageId?: string | null;
  /** ★ fix-334: a post's title. Required when parentMessageId is null; the DB
   *  CHECK enforces the pairing, so a mistake here is refused rather than
   *  silently stored as a shapeless row. */
  title?: string | null;
  /**
   * ★★ fix-334 §5: the task to create IN THE SAME SEND.
   *
   * Bobby: "as you're typing your message, add a task or send it to this permit,
   * and then click send so it's all done in one sweep." Passing it here rather
   * than calling a second mutation afterwards is what makes it one send — the
   * message and its task share a failure surface, so a task can never be
   * created against a message that did not post.
   */
  task?: {
    permitId: number;
    text: string;
    discipline: 'arch' | 'ent';
    /** ★★★ fix-494 (P-155): the PHASE the task lands in.
     *
     *  Before this, the composer sent nothing here and
     *  `bp_trg_permit_task_default_bucket` filled it in from `c0.submitted` —
     *  a different date from the one the permit screen reads, so a task made
     *  from chat on a submitted permit landed in D&E. The composer now sends
     *  the same answer the screen shows, from the same helper.
     *
     *  ★ Still optional: the trigger's default is a real fallback for any
     *    caller that genuinely has no permit context, and fix-494 fixed that
     *    default too rather than relying on every caller to remember. */
    bucket?: 'de' | 'pm';
    assignedTo?: string | null;
    targetDate?: string | null;
  } | null;
}

/**
 * Post a message — a reply, or (for an admin) a new post.
 *
 * ★ Returns the new message's id, which §5 needs: the task is attached to the
 * row that was just written, in the same mutation.
 */
export function usePostMessage() {
  const queryClient = useQueryClient();
  const upsert = useUpsertTask();
  return useMutation<string | null, Error, PostMessageInput>({
    mutationFn: async ({
      projectId,
      body,
      mentions,
      files,
      parentMessageId,
      title,
      task,
    }) => {
      const trimmed = body.trim();
      const pending = files ?? [];
      // ★ fix-330: a snip with no words is a message. The DB CHECK says the same
      // thing (body non-empty OR attachments non-empty), so this guard and the
      // constraint agree rather than one silently swallowing what the other
      // would have refused.
      if (!trimmed && pending.length === 0) return null;
      const attachments = pending.length
        ? await uploadChatAttachments(projectId, pending)
        : [];
      // tenant_id and author_id are stamped by triggers; the insert policy
      // refuses any author but the caller — and refuses a POST outright unless
      // the caller is an admin.
      const { data, error } = await supabase
        .from('project_messages')
        .insert({
          project_id: projectId,
          body: trimmed,
          mentions,
          attachments,
          parent_message_id: parentMessageId ?? null,
          title: parentMessageId ? null : (title ?? null),
        })
        .select('id')
        .single();
      if (error) throw error;
      const messageId = (data as { id: string }).id;

      // ★★ §5: ONE SEND, BOTH THINGS. Same write path as fix-330 — useUpsertTask
      // → bp_upsert_permit_task — so a task composed alongside a message is a
      // task in every way, and still renders back on its permit.
      if (task) {
        const taskId = await upsert.mutateAsync({
          permitId: task.permitId,
          discipline: task.discipline,
          // ★ fix-494: undefined still means "let the trigger decide", which is
          //   now the same decision this value would have made.
          bucket: task.bucket,
          text: task.text,
          status: 'Open',
          assignedTo: task.assignedTo ?? null,
          targetDate: task.targetDate ?? null,
        });
        const { error: linkError } = await supabase
          .from('permit_tasks')
          .update({ source_message_id: messageId })
          .eq('id', taskId);
        if (linkError) throw linkError;
      }
      return messageId;
    },
    onSuccess: () => {
      // One prefix covers the thread, the rail card and the bell's mention
      // query — they are the same data and they refresh together.
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMessagesAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not send — ${error.message}`, 'error');
    },
  });
}

/**
 * ★★ fix-334 §4: edit your own message, with the original kept.
 *
 * The client sends only the new body (and re-parsed mentions). It does NOT send
 * `revisions` or `edited_at` — it CANNOT: `authenticated` has no column grant on
 * either, so the history is the trigger's and cannot be forged from here.
 *
 * ★ RLS refuses somebody else's row, so a wrong id is a no-op rather than a
 * hijack. Proved on prod with a second identity, not read off the policy.
 */
export function useEditMessage() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { messageId: string; body: string; mentions: string[] }
  >({
    mutationFn: async ({ messageId, body, mentions }) => {
      const trimmed = body.trim();
      if (!trimmed) throw new Error('A message cannot be edited to nothing.');
      const { error } = await supabase
        .from('project_messages')
        .update({ body: trimmed, mentions })
        .eq('id', messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMessagesAll });
    },
    onError: (error) => {
      pushToast(`Could not save the edit — ${error.message}`, 'error');
    },
  });
}

/**
 * ★★ fix-334 §4: delete your own message — softly.
 *
 * Sets `deleted_at` and nothing else. The trigger files the current body into
 * `revisions` on the way, so "a deleted message keeps its original" is a
 * property of the database rather than of this call.
 *
 * ★ A HARD DELETE IS NOT AVAILABLE AND MUST NOT BE ADDED. permit_tasks.
 * source_message_id points here; fix-329 made it ON DELETE SET NULL so a task
 * survives its message, and a soft delete means it never has to.
 */
export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { messageId: string }>({
    mutationFn: async ({ messageId }) => {
      const { error } = await supabase
        .from('project_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMessagesAll });
    },
    onError: (error) => {
      pushToast(`Could not delete — ${error.message}`, 'error');
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
 * ★ Which permit a chat-born task STARTS on.
 *
 * `permit_tasks` is permit-scoped and the chat is project-scoped, so the task
 * needs an anchor. The Building Permit with the lowest id is the project's
 * anchor everywhere else in this app (fix-66's Target Submit, the cascade in the
 * wizard), so it is the anchor here too rather than a new rule.
 *
 * ★★ fix-330: IT IS NOW A DEFAULT, NOT A DECISION. fix-329 picked this permit
 * silently and gave nobody a way to disagree, which on a five-permit project is
 * the tool choosing wrong four times out of five without saying so. The composer
 * pre-selects this and then lets the person change it.
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

/**
 * ★ fix-330: how a permit reads in the chooser.
 *
 * The brief is specific about this: `7133443-DM · Demolition` has to be
 * distinguishable from `7133442-CN · Building Permit`. A list of bare types is
 * useless on a project with two Building Permits, and a list of bare numbers is
 * useless before a number exists — so it is both, and it falls back to the type
 * alone rather than rendering a dangling separator.
 */
export function permitChoiceLabel(
  permit: Pick<Permit, 'num' | 'type'>,
): string {
  const num = (permit.num ?? '').trim();
  const type = (permit.type ?? '').trim() || 'Permit';
  return num ? `${num} · ${type}` : `${type} (no number yet)`;
}
