import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { ProjectHold } from '../lib/database.types';

// fix-167: project On-Hold — Phase 1 (data + display only; NO calculation
// effects). A project may have many holds over time; the ACTIVE hold is the
// one with hold_end === null (DB enforces at most one active per project). All
// writes go through the SECURITY DEFINER, tenant-gated RPCs from the fix_167
// migration. Each write invalidates the project_holds bare prefix so the badge
// + history refresh live.

/** All holds for one project, newest first. The active hold (if any) is the
 *  row with `hold_end === null`. */
export function useProjectHolds(projectId: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectHold[]>({
    queryKey: queryKeys.projectHolds(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_holds')
        .select(
          'id, tenant_id, project_id, reason, note, hold_start, hold_end, created_by, created_at, updated_at',
        )
        .eq('project_id', projectId as string)
        .order('hold_start', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectHold[];
    },
  });
}

/** The active hold from a holds list, or null. */
export function activeHold(holds: ProjectHold[] | undefined): ProjectHold | null {
  return holds?.find((h) => h.hold_end === null) ?? null;
}

export interface SetProjectHoldInput {
  projectId: string;
  reason: string;
  note?: string | null;
  holdStart?: string | null;
}

/** Open an active hold on a project (rejected if one is already active). */
export function useSetProjectHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<ProjectHold, Error, SetProjectHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_set_project_hold', {
        p_tenant_id: tenantId,
        p_project_id: input.projectId,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_hold_start: input.holdStart ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectHold[])[0];
      if (!row) throw new Error('Set hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHoldsAll });
      pushToast('Project put on hold', 'success');
    },
    onError: (error) => {
      pushToast(`Could not put on hold — ${error.message}`, 'error');
    },
  });
}

export interface LiftProjectHoldInput {
  projectId: string;
  holdEnd?: string | null;
}

/** Lift the active hold (set hold_end). */
export function useLiftProjectHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<ProjectHold, Error, LiftProjectHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_lift_project_hold', {
        p_tenant_id: tenantId,
        p_project_id: input.projectId,
        p_hold_end: input.holdEnd ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectHold[])[0];
      if (!row) throw new Error('Lift hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHoldsAll });
      pushToast('Hold lifted', 'success');
    },
    onError: (error) => {
      pushToast(`Could not lift hold — ${error.message}`, 'error');
    },
  });
}

export interface UpdateProjectHoldInput {
  holdId: string;
  reason?: string | null;
  note?: string | null;
  holdStart?: string | null;
  holdEnd?: string | null;
}

/** Edit a hold's reason / note / start / end (dates correctable for Phase 2). */
export function useUpdateProjectHold() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<ProjectHold, Error, UpdateProjectHoldInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_update_project_hold', {
        p_tenant_id: tenantId,
        p_hold_id: input.holdId,
        p_reason: input.reason ?? null,
        p_note: input.note ?? null,
        p_hold_start: input.holdStart ?? null,
        p_hold_end: input.holdEnd ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectHold[])[0];
      if (!row) throw new Error('Update hold returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHoldsAll });
      pushToast('Hold updated', 'success');
    },
    onError: (error) => {
      pushToast(`Could not update hold — ${error.message}`, 'error');
    },
  });
}
