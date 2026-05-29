import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { TaskNode, MyTaskNode } from '../lib/database.types';

// fix-70: v1-parity task system data hooks. All go through the bp_* RPCs that
// derive the primary assignee from permits.da / permits.ent_lead at read time
// (so a DA change reattributes Architecture tasks automatically) and read/write
// explicit co-assignees via permit_task_assignees.
//
//   usePermitTaskTree(permitId) — nested top-level tasks + subtasks for a permit
//   useUpsertTask()             — create / edit a task (or subtask)
//   useDeleteTask()             — delete a task (subtasks + assignees cascade)
//   useSetTaskAssignees()       — atomic replace of a task's co-assignees
//   useMyTasks(userName)        — tasks the user is assigned to (primary OR co)
//
// Mutations invalidate the permit_tasks bare prefix so the tree + My Tasks both
// refresh; the per-permit tree and My Tasks queries live under that prefix.

export function usePermitTaskTree(permitId: number | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<TaskNode[]>({
    queryKey: queryKeys.permitTaskTree(tenantId ?? '', permitId ?? -1),
    enabled: !!tenantId && permitId != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_permit_tasks', {
        p_permit_id: permitId,
      });
      if (error) throw error;
      return (data ?? []) as TaskNode[];
    },
  });
}

export function useMyTasks(userName: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<MyTaskNode[]>({
    queryKey: queryKeys.myTasks(tenantId ?? '', userName ?? ''),
    enabled: !!tenantId && !!userName,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_my_tasks', {
        p_user_name: userName,
      });
      if (error) throw error;
      return (data ?? []) as MyTaskNode[];
    },
  });
}

export interface UpsertTaskInput {
  /** null to create; an id to edit. */
  id?: string | null;
  permitId: number;
  /** Set for a subtask; omit/null for a top-level task. */
  parentTaskId?: string | null;
  bucket: 'arch' | 'ent';
  text: string;
  status?: 'Open' | 'In Progress' | 'Resolved';
  startDate?: string | null;
  targetDate?: string | null;
  sortOrder?: number;
}

export function useUpsertTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<string, Error, UpsertTaskInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_permit_task', {
        p_id: input.id ?? null,
        p_permit_id: input.permitId,
        p_parent_task_id: input.parentTaskId ?? null,
        p_bucket: input.bucket,
        p_text: input.text,
        p_status: input.status ?? 'Open',
        p_start_date: input.startDate ?? null,
        p_target_date: input.targetDate ?? null,
        p_sort_order: input.sortOrder ?? 0,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitTaskTree(tenantId, input.permitId),
      });
      // My Tasks may now include/exclude this task.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not save task — ${error.message}`, 'error');
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string; permitId: number }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('bp_delete_permit_task', { p_id: id });
      if (error) throw error;
    },
    onSuccess: (_v, { permitId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitTaskTree(tenantId, permitId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not delete task — ${error.message}`, 'error');
    },
  });
}

export function useSetTaskAssignees() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    void,
    Error,
    { taskId: string; assignees: string[]; permitId: number }
  >({
    mutationFn: async ({ taskId, assignees }) => {
      const { error } = await supabase.rpc('bp_set_task_assignees', {
        p_task_id: taskId,
        p_assignees: assignees,
      });
      if (error) throw error;
    },
    onSuccess: (_v, { permitId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.permitTaskTree(tenantId, permitId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
    },
    onError: (error) => {
      pushToast(`Could not update assignees — ${error.message}`, 'error');
    },
  });
}

/** Resolve the caller's display name (the string that matches permits.da /
 *  permits.ent_lead) from the team_members roster by matching the auth email.
 *  Returns '' when no roster row matches. */
export function resolveUserName(
  email: string | null | undefined,
  members: { name: string; email: string | null }[],
): string {
  if (!email) return '';
  const hit = members.find(
    (m) => (m.email ?? '').trim().toLowerCase() === email.trim().toLowerCase(),
  );
  return hit?.name ?? '';
}
