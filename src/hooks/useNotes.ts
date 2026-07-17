import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Note } from '../lib/database.types';

// fix-notes-1: unified Notes log data hooks.
//
// Reads go through bp_list_project_notes (SECURITY DEFINER) because the
// author name lives on profiles, which is read-own-only under RLS — the
// fix-70 bp_list_permit_tasks pattern. ONE query per project returns BOTH
// scopes (holistic + every permit); NotesPanel filters client-side, and the
// future dashboard card / Weekly Updates report can reuse the same cache.
//
// Writes are direct table DML under tenant RLS (the permit_task_assignees
// pattern): the notes_default_tenant trigger stamps tenant_id, notes_author
// stamps created_by from auth.uid(), notes_completed_at syncs completed_at.

export function useProjectNotes(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Note[]>({
    queryKey: queryKeys.notes(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_project_notes', {
        p_project_id: projectId,
      });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
  });
}

export interface AddNoteInput {
  projectId: string;
  /** null/omitted = holistic project note; a permit id = per-permit note. */
  permitId?: number | null;
  body: string;
}

export function useAddNote() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, AddNoteInput>({
    mutationFn: async (input) => {
      const { error } = await supabase.from('notes').insert({
        project_id: input.projectId,
        permit_id: input.permitId ?? null,
        body: input.body,
      });
      if (error) throw error;
    },
    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notes(tenantId, input.projectId),
      });
    },
    onError: (error) => {
      pushToast(`Could not add note — ${error.message}`, 'error');
    },
  });
}

export interface UpdateNoteInput {
  id: string;
  projectId: string;
  body?: string;
  completed?: boolean;
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, UpdateNoteInput>({
    mutationFn: async (input) => {
      const patch: Record<string, unknown> = {};
      if (input.body !== undefined) patch.body = input.body;
      if (input.completed !== undefined) patch.completed = input.completed;
      const { error } = await supabase
        .from('notes')
        .update(patch)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notes(tenantId, input.projectId),
      });
    },
    onError: (error) => {
      pushToast(`Could not save note — ${error.message}`, 'error');
    },
  });
}
