import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type {
  CustomReportResult,
  ReportBuilderCatalog,
  ReportSpec,
  SavedReportDetail,
} from '../lib/database.types';

// fix-69: report-builder data hooks.
//   useReportBuilderCatalog() — the entity/column catalog (static per deploy)
//   useCustomReport(id)       — run a saved report (any tenant member)
//   usePreviewReportSpec()    — preview an inline spec (builder Preview)
//   useUpsertCustomReportSpec() — create/edit a custom report (admin)

export function useReportBuilderCatalog() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ReportBuilderCatalog>({
    queryKey: queryKeys.reportBuilderCatalog(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'bp_get_report_builder_catalog',
      );
      if (error) throw error;
      return data as ReportBuilderCatalog;
    },
    // Catalog is hardcoded server-side; only changes on deploy.
    staleTime: 60 * 60 * 1000,
  });
}

export function useCustomReport(id: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CustomReportResult>({
    queryKey: queryKeys.customReport(tenantId ?? '', id ?? ''),
    enabled: !!tenantId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_run_saved_report', {
        p_id: id,
      });
      if (error) throw error;
      return data as CustomReportResult;
    },
    staleTime: 30 * 1000,
  });
}

export function useSavedReport(id: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<SavedReportDetail | null>({
    queryKey: ['saved_report_detail', tenantId ?? '', id ?? ''],
    enabled: !!tenantId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_get_saved_report', {
        p_id: id,
      });
      if (error) throw error;
      return (data ?? null) as SavedReportDetail | null;
    },
    staleTime: 30 * 1000,
  });
}

export function usePreviewReportSpec() {
  return useMutation<CustomReportResult, Error, ReportSpec>({
    mutationFn: async (spec) => {
      const { data, error } = await supabase.rpc('bp_preview_report_spec', {
        p_spec: spec,
      });
      if (error) throw error;
      return data as CustomReportResult;
    },
    onError: (error) => {
      pushToast(`Preview failed — ${error.message}`, 'error');
    },
  });
}

export interface UpsertCustomReportSpecInput {
  id?: string | null;
  categoryId?: string | null;
  name: string;
  description?: string;
  position?: number;
  spec: ReportSpec;
}

export function useUpsertCustomReportSpec() {
  return useMutation<string, Error, UpsertCustomReportSpecInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_upsert_custom_report_spec',
        {
          p_id: input.id ?? null,
          p_category_id: input.categoryId ?? null,
          p_name: input.name,
          p_description: input.description ?? '',
          p_position: input.position ?? 0,
          p_spec: input.spec,
        },
      );
      if (error) throw error;
      return data as string;
    },
    onError: (error) => {
      pushToast(`Could not save report — ${error.message}`, 'error');
    },
  });
}
