import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { pushToast } from '../stores/toastStore';

// fix-67: write/update a permit's persistent report note via the
// bp_upsert_report_note RPC. Returns the new updated_at.
//
// Intentionally does NOT invalidate the weekly-report query on success.
// The note editor is a debounced textarea (saves ~500ms after typing
// stops); invalidating would refetch the whole report mid-session and the
// in-render snapshot sync could clobber in-flight keystrokes if a save and
// a resume-typing overlap. The local draft is the source of truth while
// editing; the server value reconciles on the next natural refetch (week /
// filter change, manual refresh, or remount). The RPC's tenant guard makes
// a cross-tenant write impossible (it raises if the permit isn't in the
// caller's tenant).

export interface UpsertReportNoteInput {
  permitId: number;
  body: string;
}

export function useUpsertReportNote() {
  return useMutation<string, Error, UpsertReportNoteInput>({
    mutationFn: async ({ permitId, body }) => {
      const { data, error } = await supabase.rpc('bp_upsert_report_note', {
        p_permit_id: permitId,
        p_body: body,
      });
      if (error) throw error;
      // RPC returns a single timestamptz (the new updated_at).
      return (data ?? new Date().toISOString()) as string;
    },
    onError: (error) => {
      pushToast(`Could not save note — ${error.message}`, 'error');
    },
  });
}
