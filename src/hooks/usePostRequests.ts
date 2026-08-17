import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { pushToast } from '../stores/toastStore';
import type { PostRequestItemInput } from '../lib/boardReads';

// fix-339 — "request a post", and the first SHARED board item.
//
// ★★ THERE IS NO READ MODEL HERE, AND THAT IS THE DESIGN. A post request lands
// with the oversight holders and the project's ent lead, and clears from all of
// their queues the moment any one of them acts. Writing a read row per
// recipient would mean five people dismissing the same thing — the busywork
// this deletes — and would make "satisfied" unrepresentable. Instead the item
// is derived only while `status = 'open'`, so resolving it removes it
// everywhere at once. See NewItemAudience in lib/boardReads.
//
// ★ FIRST-RESPONDER-WINS IS THE DATABASE'S. The UPDATE policy requires
// `status = 'open'`, so a second resolver affects ZERO rows — and this hook
// reports that honestly rather than pretending both succeeded.

export interface ProjectPostRequest {
  id: string;
  title: string;
  reason: string;
  status: 'open' | 'created' | 'acknowledged' | 'declined';
  requested_by: string | null;
  requester_name: string | null;
  unresolved_recipients: string[];
  created_at: string;
}

/**
 * ★ Everything the board needs: open requests addressed to me (shared) AND
 * requests I raised that have been resolved (my personal outcome).
 *
 * ONE query for the bell and My Board both, so the two cannot disagree about an
 * open request.
 */
export function useMyPostRequests() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<PostRequestItemInput[]>({
    queryKey: queryKeys.myPostRequests(tenantId ?? '', userId ?? ''),
    enabled: !!tenantId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_my_post_requests');
      if (error) throw error;
      return (data ?? []) as PostRequestItemInput[];
    },
  });
}

/** The open requests on ONE project — what an admin sees when they open its
 *  chat, whether or not they were a resolved recipient. */
export function useProjectPostRequests(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectPostRequest[]>({
    queryKey: queryKeys.projectPostRequests(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_project_post_requests', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as ProjectPostRequest[];
    },
  });
}

export interface RequestPostResult {
  id: string;
  recipient_count: number;
  unresolved_recipients: string[];
}

/**
 * Raise a request. ★ ANYONE MAY — that is the entire point: fix-334 gated post
 * CREATION to admins, and without this a non-admin's topic gets buried at the
 * bottom of General.
 *
 * ★ The recipients are resolved SERVER-SIDE (oversight + the project's ent
 * lead), because the client cannot see other people's profiles under RLS and
 * because "who should know about this" is not a decision to leave to a browser.
 */
export function useRequestPost() {
  const queryClient = useQueryClient();
  return useMutation<
    RequestPostResult,
    Error,
    { projectId: string; title: string; reason: string }
  >({
    mutationFn: async ({ projectId, title, reason }) => {
      const { data, error } = await supabase.rpc('bp_request_post', {
        p_project_id: projectId,
        p_title: title.trim(),
        p_reason: reason.trim(),
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as RequestPostResult;
      return row;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.postRequestsAll });
      // ★★ A RECIPIENT WHO COULD NOT BE REACHED IS SAID OUT LOUD. Dave holds
      // oversight and his roster row has no email, so his login cannot be
      // matched to it. Letting him vanish silently is how somebody concludes
      // this worked when it half did.
      if (result?.unresolved_recipients?.length) {
        pushToast(
          `Requested. ${result.unresolved_recipients.join(', ')} could not be notified — no email on their roster row.`,
          'info',
        );
      } else {
        pushToast(
          `Requested — ${result?.recipient_count ?? 0} people notified.`,
          'success',
        );
      }
    },
    onError: (error) => {
      pushToast(`Could not send the request — ${error.message}`, 'error');
    },
  });
}

/**
 * ★★ Resolve a request — once, for everybody.
 *
 * The RPC returns the number of rows it changed: 1 for the first responder, 0
 * for anybody arriving after. ★ A zero is NOT an error and must not be reported
 * as one — it means a colleague got there first, which is the feature working.
 * Saying "failed" at somebody for that would teach them to distrust it.
 */
export function useResolvePostRequest() {
  const queryClient = useQueryClient();
  return useMutation<
    { changed: number },
    Error,
    {
      id: string;
      status: 'created' | 'acknowledged' | 'declined';
      note?: string | null;
      createdPostId?: string | null;
    }
  >({
    mutationFn: async ({ id, status, note, createdPostId }) => {
      const { data, error } = await supabase.rpc('bp_resolve_post_request', {
        p_id: id,
        p_status: status,
        p_note: note ?? null,
        p_created_post_id: createdPostId ?? null,
      });
      if (error) throw error;
      return { changed: (data as number | null) ?? 0 };
    },
    onSuccess: ({ changed }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.postRequestsAll });
      if (changed === 0) {
        pushToast('Someone else handled that request first.', 'info');
      }
    },
    onError: (error) => {
      pushToast(`Could not update the request — ${error.message}`, 'error');
    },
  });
}
