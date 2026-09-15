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

// ═══════════════════════════════════════════════════════════════════════
// ★★★ fix-559 §A (P-218) — `useProjectNotes` IS GONE WITH `NotesPanel`
// ═══════════════════════════════════════════════════════════════════════
//
// It had exactly one consumer — the permit/project notes panel §A removed —
// so it goes with it rather than lingering as a reader for a surface that no
// longer exists.
//
// ★★★ THE REST OF THIS FILE STAYS, AND THAT IS NOT AN OVERSIGHT. The brief
//     said *"remove the component and its hook"*; grepping the hook rather than
//     the heading (which is what it asked for) found **three more consumers
//     that are not note-taking surfaces at all**:
//
//       useAllNotes                → Weekly Updates report (fix-notes-3) — the
//                                    report IS the notes, grouped
//       useAddNote / useUpdateNote → Weekly Updates + the Weekly DA report's
//                                    editable note box (fix-notes-4)
//       useProjectNoteSearchIndex  → Project View's note-body search
//
//     Deleting them would delete two reports and a search filter, which Bobby's
//     ruling does not ask for. **§B's staged delete of the 107 rows leaves all
//     three rendering empty** — that consequence is stated in the PR and in the
//     migration header, because it is the thing to decide before applying it,
//     not after.

interface NoteSearchRow {
  project_id: string;
  body: string;
}

export function useProjectNoteSearchIndex() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Map<string, string>>({
    queryKey: queryKeys.projectNoteSearch(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_project_note_search_index');
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as NoteSearchRow[]) {
        const prev = map.get(row.project_id);
        map.set(row.project_id, prev ? `${prev} ${row.body}` : row.body);
      }
      return map;
    },
  });
}

// fix-notes-3: tenant-wide bulk read for the Weekly Updates report (all
// projects' notes in ONE round trip via bp_list_all_notes — a per-project
// fan-out would be one query per project). Same public.notes single source;
// the report groups client-side. Keyed under the notes prefix so a write
// through the hooks below (or a realtime notes change) refreshes it too.
export function useAllNotes() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Note[]>({
    queryKey: queryKeys.allNotes(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_all_notes');
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
  // fix-notes-4: resolves to the new note's id so an editor bound to
  // "the newest active note" (Weekly DA Update's per-permit box) can keep
  // updating the note it just created instead of creating duplicates.
  return useMutation<string, Error, AddNoteInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('notes')
        .insert({
          project_id: input.projectId,
          permit_id: input.permitId ?? null,
          body: input.body,
        })
        .select('id')
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => {
      // fix-notes-3: invalidate the whole notes prefix (single source), so a
      // write from ANY surface — permit NotesPanel, Project Overview, or the
      // Weekly Updates report — refreshes every mounted notes query.
      queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
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
    onSuccess: () => {
      // fix-notes-3: invalidate the whole notes prefix (single source), so a
      // write from ANY surface — permit NotesPanel, Project Overview, or the
      // Weekly Updates report — refreshes every mounted notes query.
      queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    },
    onError: (error) => {
      pushToast(`Could not save note — ${error.message}`, 'error');
    },
  });
}
