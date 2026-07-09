import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { ProjectDaHandoff } from '../lib/database.types';

// fix-225: DA project handoff (Phase 1 — ownership-only reassign). Reads the
// handoff ledger (drives undo + the "shared" marker) and wraps the two
// admin-only RPCs. RLS scopes reads to the caller's tenant.
//
// TOLERANT of a pre-migration prod: the project_da_handoffs table + the RPCs
// only exist after fix_225 is applied. Reads swallow the "relation does not
// exist" error and return empty, so the app never breaks before the migration
// lands (the marker/history just stay empty).

const MISSING_TABLE = '42P01'; // undefined_table

/** Handoff history for one project (most recent first). */
export function useProjectDaHandoffs(projectId: string | null) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectDaHandoff[]>({
    queryKey: queryKeys.projectDaHandoffs(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_da_handoffs')
        .select('id, project_id, from_da, to_da, effective_date, note, created_at')
        .eq('project_id', projectId as string)
        .order('created_at', { ascending: false });
      if (error) {
        if (error.code === MISSING_TABLE) return [];
        throw error;
      }
      return (data ?? []) as ProjectDaHandoff[];
    },
  });
}

/** The set of project_ids in the tenant that have at least one handoff — drives
 *  the "shared" marker on the draw-schedule board. */
export function useProjectsWithHandoffs() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<string[]>({
    queryKey: queryKeys.projectDaHandoffsSet(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_da_handoffs')
        .select('project_id');
      if (error) {
        if (error.code === MISSING_TABLE) return [];
        throw error;
      }
      return [...new Set((data ?? []).map((r) => r.project_id as string))];
    },
  });
  return { ...q, projectIds: new Set(q.data ?? []) };
}

function invalidateAfterHandoff(qc: ReturnType<typeof useQueryClient>) {
  // A reassign touches projects + permits + tasks + the handoff ledger. The
  // board (draw_schedule) is intentionally NOT changed, but its cache is cheap
  // to refresh alongside. Use the bare prefixes ("invalidate the lot").
  qc.invalidateQueries({ queryKey: queryKeys.projectsAll });
  qc.invalidateQueries({ queryKey: queryKeys.permitsAll });
  qc.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
  qc.invalidateQueries({ queryKey: queryKeys.drawScheduleAll });
  qc.invalidateQueries({ queryKey: queryKeys.projectDaHandoffsAll });
}

export interface ReassignProjectDaInput {
  projectId: string;
  toDa: string;
  effectiveDate?: string | null;
  note?: string | null;
}

export function useReassignProjectDa() {
  const qc = useQueryClient();
  return useMutation<ProjectDaHandoff, Error, ReassignProjectDaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_reassign_project_da', {
        p_project_id: input.projectId,
        p_to_da: input.toDa,
        p_effective_date: input.effectiveDate ?? null,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectDaHandoff[])[0];
      if (!row) throw new Error('Reassign returned no row');
      return row;
    },
    onSuccess: (row) => {
      invalidateAfterHandoff(qc);
      pushToast(
        `Reassigned to ${row.to_da}${row.from_da ? ` (was ${row.from_da})` : ''} — board unchanged`,
        'success',
      );
    },
    onError: (error) => {
      pushToast(`Could not reassign DA — ${error.message}`, 'error');
    },
  });
}

export function useUndoProjectDaReassign() {
  const qc = useQueryClient();
  return useMutation<void, Error, { handoffId: string }>({
    mutationFn: async ({ handoffId }) => {
      const { error } = await supabase.rpc('bp_undo_project_da_reassign', {
        p_handoff_id: handoffId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAfterHandoff(qc);
      pushToast('Reassignment undone — prior owner restored', 'success');
    },
    onError: (error) => {
      pushToast(`Could not undo reassignment — ${error.message}`, 'error');
    },
  });
}
