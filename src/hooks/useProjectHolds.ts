import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { holdKind, type ProjectHold } from '../lib/database.types';

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
          'id, tenant_id, project_id, reason, note, hold_start, hold_end, kind, created_by, created_at, updated_at',
        )
        .eq('project_id', projectId as string)
        .order('hold_start', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectHold[];
    },
  });
}

/** The OPEN row from a holds list, of either kind, or null. A project has at
 *  most one (DB partial unique index). Callers that care which kind it is read
 *  `holdKind(row)`; callers that only care "is this project parked" don't. */
export function activeHold(holds: ProjectHold[] | undefined): ProjectHold | null {
  return holds?.find((h) => h.hold_end === null) ?? null;
}

/** fix-262: the open row ONLY when it is a hold (project still ACTIVE). */
export function activeHoldOnly(
  holds: ProjectHold[] | undefined,
): ProjectHold | null {
  const row = activeHold(holds);
  return row && holdKind(row) === 'hold' ? row : null;
}

/** fix-262: the open row ONLY when it is a cancel (project NOT active). */
export function activeCancel(
  holds: ProjectHold[] | undefined,
): ProjectHold | null {
  const row = activeHold(holds);
  return row && holdKind(row) === 'cancelled' ? row : null;
}

// fix-170 (On-Hold Phase 2): aggregate read path. Holds are rare (a handful per
// tenant), so the dashboard / estimator-learning / projection surfaces fetch ALL
// of the tenant's holds once and index them by project. Shares the project_holds
// bare prefix so a hold open/lift/edit invalidates this live.
export function useAllProjectHolds() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectHold[]>({
    queryKey: queryKeys.allProjectHolds(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_holds')
        .select(
          'id, tenant_id, project_id, reason, note, hold_start, hold_end, kind, created_by, created_at, updated_at',
        )
        .order('hold_start', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectHold[];
    },
  });
}

/** Index holds by project_id (all holds, active + closed). */
export function holdsByProjectId(
  holds: ProjectHold[] | undefined,
): Map<string, ProjectHold[]> {
  const m = new Map<string, ProjectHold[]>();
  for (const h of holds ?? []) {
    const list = m.get(h.project_id) ?? [];
    list.push(h);
    m.set(h.project_id, list);
  }
  return m;
}

/** Set of project ids that currently have an ACTIVE (open) HOLD.
 *
 *  fix-262: this is now hold-ONLY. A cancelled project is not "on hold" — it is
 *  no longer active — so it must not light up the hold badge or the Hold filter.
 *  Use {@link cancelledProjectIds} for the cancelled set. */
export function activeHoldProjectIds(
  holds: ProjectHold[] | undefined,
): Set<string> {
  const s = new Set<string>();
  for (const h of holds ?? []) {
    if (h.hold_end === null && holdKind(h) === 'hold') s.add(h.project_id);
  }
  return s;
}

/** fix-262: set of project ids that are currently CANCELLED (open cancel row).
 *  Drives the Project List "not active" composition, the cancelled badge, and
 *  the draw-schedule block's terminal treatment. */
export function cancelledProjectIds(
  holds: ProjectHold[] | undefined,
): Set<string> {
  const s = new Set<string>();
  for (const h of holds ?? []) {
    if (h.hold_end === null && holdKind(h) === 'cancelled') s.add(h.project_id);
  }
  return s;
}

/** fix-262: project_id → its open CANCEL row, so a surface can show the reason
 *  and the cancelled DATE from the one bulk fetch. */
export function cancelByProjectId(
  holds: ProjectHold[] | undefined,
): Map<string, ProjectHold> {
  const m = new Map<string, ProjectHold>();
  for (const h of holds ?? []) {
    if (h.hold_end === null && holdKind(h) === 'cancelled') m.set(h.project_id, h);
  }
  return m;
}

/** fix-178: map project_id → its ACTIVE hold (the open row). Lets the dashboard
 *  / project-list badge show the hold reason from the one bulk holds fetch
 *  (useAllProjectHolds) without a per-project query. */
export function activeHoldByProjectId(
  holds: ProjectHold[] | undefined,
): Map<string, ProjectHold> {
  const m = new Map<string, ProjectHold>();
  for (const h of holds ?? []) {
    // fix-262: hold-kind only — see activeHoldProjectIds.
    if (h.hold_end === null && holdKind(h) === 'hold') m.set(h.project_id, h);
  }
  return m;
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

export interface SetProjectCancelInput {
  projectId: string;
  reason: string;
  note?: string | null;
  cancelDate?: string | null;
}

/** fix-262: CANCEL a project — "the step after hold, but before delete".
 *
 *  Server-side this also sweeps every Open / In Progress task on the project to
 *  'Cancelled', recording each task's prior state so the restore is exact.
 *  Resolved tasks are deliberately untouched. Invalidating the task caches here
 *  is what makes My Tasks / the permit bar drop them without a reload. */
export function useSetProjectCancel() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<ProjectHold, Error, SetProjectCancelInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_set_project_cancel', {
        p_tenant_id: tenantId,
        p_project_id: input.projectId,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_cancel_date: input.cancelDate ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectHold[])[0];
      if (!row) throw new Error('Cancel returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHoldsAll });
      // The sweep rewrote permit_tasks — refresh every task surface.
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      pushToast('Project cancelled', 'success');
    },
    onError: (error) => {
      pushToast(`Could not cancel — ${error.message}`, 'error');
    },
  });
}

export interface RestoreProjectInput {
  projectId: string;
  restoreDate?: string | null;
}

/** fix-262: "bring this back" — the reverse of {@link useSetProjectCancel}.
 *  Closes the cancel row and returns every swept task to EXACTLY its prior
 *  state. Modelled on lift-hold but semantically distinct, with its own audit
 *  action (project_restored). */
export function useRestoreProject() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<ProjectHold, Error, RestoreProjectInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_restore_project', {
        p_tenant_id: tenantId,
        p_project_id: input.projectId,
        p_restore_date: input.restoreDate ?? null,
      });
      if (error) throw error;
      const row = (data as ProjectHold[])[0];
      if (!row) throw new Error('Restore returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectHoldsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.permitTasksAll });
      pushToast('Project brought back', 'success');
    },
    onError: (error) => {
      pushToast(`Could not bring back — ${error.message}`, 'error');
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
