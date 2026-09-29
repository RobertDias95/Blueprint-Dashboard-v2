import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
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
// ★★★ fix-570 (P-275): THERE IS NO LONGER A WRITE PATH. `useAddNote` and
//     `useUpdateNote` were the app's ONLY writers of `public.notes` — measured
//     on prod 2026-09-29: no RPC and no trigger inserts a row — and both are
//     deleted below. The four `notes` triggers survive untouched; each only
//     decorates a write, so with nothing writing they never fire.

// ═════════════════════════════════════════════════════════════════════
// ★★★ THE WRITERS ARE GONE — fix-570 (P-275), THE LAST OF THE 09-15 RULING
// ═════════════════════════════════════════════════════════════════════
//
// Bobby, 2026-09-15: *"remove the permit level note, we only need a tasks
// level note."* fix-559 removed three mounts, fix-569 the fourth, and a
// hook-scoped grep found a fifth — the Weekly Updates report's own add/edit
// surface, built editable on purpose by fix-notes-3. fix-570 removes it, and
// with it the last two writers in the app.
//
// ★★★ SO `useAddNote` AND `useUpdateNote` ARE DELETED, NOT LEFT UNMOUNTED.
//     P-275 is literally *"one permit-level note WRITER survives"* — and an
//     exported mutation hook with no call site IS that writer, still standing.
//     **Three sweeps in a row have ended with "the hook grep found one more"**
//     (fix-559 → fix-569 → fix-570). Deleting them ends the sequence rather
//     than handing the next one something to find.
//
// ⚠️ THE TWO READERS STAY, AND THE BRIEF PROTECTS THEM BY NAME (*"do not
//    delete … the hooks the readers still use"*):
//
//      useAllNotes                → the Weekly Updates report (fix-notes-3)
//      useProjectNoteSearchIndex  → Project View's note-body search
//
// ★★ BOTH NOW RETURN NOTHING, FOR EVER, AND THAT IS THE CORRECT OUTCOME.
//    `public.notes` holds 0 rows and has held 0 since fix-559 emptied it —
//    `max(created_at)` is NULL, so not one row has been written since. 107 sit
//    in the `notes_deleted_fix559` backup and all 107 are in the General
//    channel. The report says this on its face rather than rendering a blank.
//
// ⛔ AND THE READERS ARE NOT RE-POINTED at chat or at task notes. That is a
//    product decision nobody has made, and the weekly DA revision is where it
//    gets made — Bobby: *"we will revise the weekly da concept in the
//    future."* A revision is not a retirement.

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
