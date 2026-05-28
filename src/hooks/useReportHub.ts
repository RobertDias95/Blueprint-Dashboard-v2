import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { ReportHubPayload } from '../lib/database.types';

// fix-68: Reports hub (Settings -> Reporting) data hooks.
//
//   useReportHub()                — list categories + saved reports
//   useUpsertReportCategory()     — create / rename / move / reposition a folder
//   useDeleteReportCategory()     — delete a folder (children reparent to root)
//   useUpsertSavedReport()        — edit a report's metadata (P2: name/desc/
//                                   category/position; never kind/builtin/spec)
//   useDeleteSavedReport()        — delete a custom report (builtins raise)
//
// All RPCs are tenant-scoped server-side. Mutations invalidate the hub query
// so the tree refreshes after a change.

export function useReportHub() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ReportHubPayload>({
    queryKey: queryKeys.reportHub(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_list_report_hub');
      if (error) throw error;
      return (data ?? { categories: [], reports: [] }) as ReportHubPayload;
    },
    staleTime: 30 * 1000,
  });
}

// --- Category mutations -----------------------------------------------------

export interface UpsertCategoryInput {
  /** null to create; an id to rename / move / reposition. */
  id?: string | null;
  parentId?: string | null;
  name: string;
  position?: number;
}

export function useUpsertReportCategory() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<string, Error, UpsertCategoryInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_report_category', {
        p_id: input.id ?? null,
        p_parent_id: input.parentId ?? null,
        p_name: input.name,
        p_position: input.position ?? 0,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reportHub(tenantId) });
    },
    onError: (error) => {
      pushToast(`Could not save category — ${error.message}`, 'error');
    },
  });
}

export function useDeleteReportCategory() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('bp_delete_report_category', {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reportHub(tenantId) });
    },
    onError: (error) => {
      pushToast(`Could not delete category — ${error.message}`, 'error');
    },
  });
}

// --- Saved-report mutations -------------------------------------------------

export interface UpsertSavedReportInput {
  /** null to create (Phase 3); an id to edit metadata. */
  id?: string | null;
  categoryId?: string | null;
  name: string;
  description?: string;
  position?: number;
}

export function useUpsertSavedReport() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<string, Error, UpsertSavedReportInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_upsert_saved_report', {
        p_id: input.id ?? null,
        p_category_id: input.categoryId ?? null,
        p_name: input.name,
        p_description: input.description ?? '',
        p_position: input.position ?? 0,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reportHub(tenantId) });
    },
    onError: (error) => {
      pushToast(`Could not save report — ${error.message}`, 'error');
    },
  });
}

export function useDeleteSavedReport() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('bp_delete_saved_report', {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reportHub(tenantId) });
    },
    onError: (error) => {
      pushToast(`Could not delete report — ${error.message}`, 'error');
    },
  });
}
