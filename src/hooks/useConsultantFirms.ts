import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import {
  WAITING_ON_OPTIONS,
  type ConsultantFirm,
  type ProjectExternalTeamMember,
  type WaitingOnDiscipline,
} from '../lib/database.types';

// fix-139: Waiting On foundation hooks. Consultant firms catalog (Settings →
// Consultant Firms) + per-project external-team assignments (Project Settings
// → External Team). All access goes through the SECURITY DEFINER RPCs from
// the fix_139 migration; OCC mirrors the useUpsertTeamMember pattern but the
// RPC raises a 'CONCURRENT_UPDATE' exception (translated to OCCConflictError
// here) rather than returning a conflict flag.

/** A supabase RPC error whose message carries the OCC sentinel. */
function isConcurrentUpdate(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.includes('CONCURRENT_UPDATE')
  );
}

// ============================================================
// Consultant firms catalog
// ============================================================

export function useConsultantFirms(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ConsultantFirm[]>({
    queryKey: queryKeys.consultantFirms(tenantId ?? '', includeInactive),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_consultant_firms', {
        p_include_inactive: includeInactive,
      });
      if (error) throw error;
      return (data ?? []) as ConsultantFirm[];
    },
  });
}

export type ConsultantFirmPatch = {
  name?: string;
  discipline?: WaitingOnDiscipline;
  active?: boolean;
  notes?: string | null;
};

export type UpsertConsultantFirmInput =
  | {
      op: 'insert';
      patch: ConsultantFirmPatch & {
        name: string;
        discipline: WaitingOnDiscipline;
      };
    }
  | { op: 'update'; firm: ConsultantFirm; patch: ConsultantFirmPatch };

export function useUpsertConsultantFirm() {
  const queryClient = useQueryClient();
  return useMutation<ConsultantFirm, Error, UpsertConsultantFirmInput>({
    mutationFn: async (input) => {
      const base: ConsultantFirmPatch =
        input.op === 'update' ? input.firm : {};
      const merged = { ...base, ...input.patch };
      const { data, error } = await supabase.rpc('bp_upsert_consultant_firm', {
        p_id: input.op === 'update' ? input.firm.id : null,
        p_name: merged.name ?? '',
        p_discipline: merged.discipline ?? '',
        p_active: merged.active ?? true,
        p_notes: merged.notes ?? null,
        p_expected_updated_at:
          input.op === 'update' ? input.firm.updated_at : null,
      });
      if (error) {
        if (isConcurrentUpdate(error)) {
          throw new OCCConflictError(0, 'Consultant firm');
        }
        throw error;
      }
      const row = (data as ConsultantFirm[])[0];
      if (!row) throw new Error('Upsert returned no row');
      return row;
    },
    onSuccess: () => {
      // Bare prefix invalidates both include-inactive variants + all tenants.
      queryClient.invalidateQueries({ queryKey: queryKeys.consultantFirmsAll });
      pushToast('Saved consultant firm', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.consultantFirmsAll });
      } else {
        pushToast(`Could not save firm — ${error.message}`, 'error');
      }
    },
  });
}

export function useArchiveConsultantFirm() {
  const queryClient = useQueryClient();
  return useMutation<ConsultantFirm, Error, ConsultantFirm>({
    mutationFn: async (firm) => {
      const { data, error } = await supabase.rpc('bp_archive_consultant_firm', {
        p_id: firm.id,
        p_expected_updated_at: firm.updated_at,
      });
      if (error) {
        if (isConcurrentUpdate(error)) {
          throw new OCCConflictError(0, 'Consultant firm');
        }
        throw error;
      }
      const row = (data as ConsultantFirm[])[0];
      if (!row) throw new Error('Archive returned no row');
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consultantFirmsAll });
      pushToast('Archived consultant firm', 'success');
    },
    onError: (error) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({ queryKey: queryKeys.consultantFirmsAll });
      } else {
        pushToast(`Could not archive firm — ${error.message}`, 'error');
      }
    },
  });
}

// ============================================================
// Project external team
// ============================================================

export interface ProjectExternalTeamResult {
  data: ProjectExternalTeamMember[];
  /** All 13 disciplines → the assigned member, or null when unassigned.
   *  The UI renders one row per WAITING_ON_OPTIONS value off this map. */
  byDiscipline: Map<WaitingOnDiscipline, ProjectExternalTeamMember | null>;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useProjectExternalTeam(
  projectId: string,
): ProjectExternalTeamResult {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<ProjectExternalTeamMember[]>({
    queryKey: queryKeys.projectExternalTeam(tenantId ?? '', projectId),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'bp_get_project_external_team',
        { p_project_id: projectId },
      );
      if (error) throw error;
      return (data ?? []) as ProjectExternalTeamMember[];
    },
  });

  const byDiscipline = useMemo(() => {
    const map = new Map<WaitingOnDiscipline, ProjectExternalTeamMember | null>();
    for (const d of WAITING_ON_OPTIONS) map.set(d, null);
    for (const row of q.data ?? []) {
      // Only disciplines in the controlled vocab render; ignore stray rows.
      if (map.has(row.discipline)) map.set(row.discipline, row);
    }
    return map;
  }, [q.data]);

  return {
    data: q.data ?? [],
    byDiscipline,
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}

export interface UpsertProjectExternalTeamMemberInput {
  projectId: string;
  discipline: WaitingOnDiscipline;
  /** null clears the pairing (the RPC DELETEs the row). */
  firmId: string | null;
  /** Optional: the firm's display name, for an accurate optimistic cache. */
  firmName?: string | null;
}

export function useUpsertProjectExternalTeamMember() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<
    ProjectExternalTeamMember | null,
    Error,
    UpsertProjectExternalTeamMemberInput,
    { snapshot: ProjectExternalTeamMember[] | undefined }
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_upsert_project_external_team_member',
        {
          p_project_id: input.projectId,
          p_discipline: input.discipline,
          p_firm_id: input.firmId,
        },
      );
      if (error) throw error;
      const row = (data as ProjectExternalTeamMember[])[0] ?? null;
      return row;
    },
    onMutate: async (input) => {
      const key = queryKeys.projectExternalTeam(tenantId, input.projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot =
        queryClient.getQueryData<ProjectExternalTeamMember[]>(key);
      const rest = (snapshot ?? []).filter(
        (r) => r.discipline !== input.discipline,
      );
      const next =
        input.firmId === null
          ? rest
          : [
              ...rest,
              {
                project_id: input.projectId,
                discipline: input.discipline,
                firm_id: input.firmId,
                firm_name: input.firmName ?? null,
                tenant_id: tenantId,
                updated_at: new Date().toISOString(),
              } satisfies ProjectExternalTeamMember,
            ];
      queryClient.setQueryData<ProjectExternalTeamMember[]>(key, next);
      return { snapshot };
    },
    onError: (error, input, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(
          queryKeys.projectExternalTeam(tenantId, input.projectId),
          context.snapshot,
        );
      }
      pushToast(`Could not update external team — ${error.message}`, 'error');
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectExternalTeam(tenantId, input.projectId),
      });
    },
  });
}
