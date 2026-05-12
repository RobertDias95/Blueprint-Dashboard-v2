import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { OCCConflictError, isOCCConflict } from '../lib/occ';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { ProjectDocument } from '../lib/database.types';

// Q9.5.e-fix-3: project_documents read + OCC upsert/delete via the new
// bp_upsert_project_document_row / bp_delete_project_document_row RPCs.
// Pattern mirrors useUpsertPermitCycle.

export function useProjectDocuments(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<ProjectDocument[]>({
    queryKey: queryKeys.projectDocuments(tenantId ?? '', projectId ?? ''),
    enabled: !!tenantId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, project_id, name, url, uploaded_by, uploaded_at, updated_at')
        .eq('project_id', projectId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProjectDocument[];
    },
  });
}

export interface UpsertProjectDocumentInput {
  projectId: string;
  /** Omit `doc` to insert; include to update. */
  doc?: ProjectDocument;
  patch: { name: string; url: string | null };
}

interface RpcRow {
  out_id: string;
  updated_at: string;
  conflict: boolean;
}

export function useUpsertProjectDocument() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<ProjectDocument, Error, UpsertProjectDocumentInput>({
    mutationFn: async (input) => {
      const dataPayload: Record<string, string> = {
        name: input.patch.name,
        url: input.patch.url ?? '',
      };
      if (!input.doc) {
        dataPayload.project_id = input.projectId;
      }
      const { data, error } = await supabase.rpc(
        'bp_upsert_project_document_row',
        {
          p_id: input.doc?.id ?? null,
          p_data: dataPayload,
          p_expected_updated_at: input.doc?.updated_at ?? null,
        },
      );
      if (error) throw error;
      const row = (data as RpcRow[])[0];
      if (!row) throw new Error('Upsert returned no row');
      if (row.conflict) {
        throw new OCCConflictError(0, 'Document');
      }
      return {
        id: row.out_id,
        project_id: input.projectId,
        name: input.patch.name,
        url: input.patch.url,
        uploaded_by: input.doc?.uploaded_by ?? null,
        uploaded_at: input.doc?.uploaded_at ?? row.updated_at,
        updated_at: row.updated_at,
      };
    },

    onSuccess: (_doc, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectDocuments(tenantId, input.projectId),
      });
      pushToast('Saved document', 'success');
    },

    onError: (error, input) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectDocuments(tenantId, input.projectId),
        });
      } else {
        pushToast(`Could not save document — ${error.message}`, 'error');
      }
    },
  });
}

export interface DeleteProjectDocumentInput {
  projectId: string;
  doc: ProjectDocument;
}

interface DeleteRpcRow {
  deleted: boolean;
  conflict: boolean;
  current_updated_at: string | null;
}

export function useDeleteProjectDocument() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<void, Error, DeleteProjectDocumentInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'bp_delete_project_document_row',
        {
          p_id: input.doc.id,
          p_expected_updated_at: input.doc.updated_at,
        },
      );
      if (error) throw error;
      const row = (data as DeleteRpcRow[])[0];
      if (!row || row.conflict) {
        throw new OCCConflictError(0, 'Document');
      }
    },

    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectDocuments(tenantId, input.projectId),
      });
      pushToast('Deleted document', 'success');
    },

    onError: (error, input) => {
      if (isOCCConflict(error)) {
        pushToast(error.message, 'warn');
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectDocuments(tenantId, input.projectId),
        });
      } else {
        pushToast(`Could not delete document — ${error.message}`, 'error');
      }
    },
  });
}
