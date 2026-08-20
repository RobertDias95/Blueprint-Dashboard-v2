import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type {
  CorrectionCluster,
  CorrectionClusterItem,
} from '../lib/correctionClusters';

// ===========================================================================
// ★★ fix-372 — reading the recurring corrections
// ===========================================================================
//
// ★ Everything is server-side. The ranking is an aggregate over 3,524 items and
// 5,990 cluster memberships; pulling the corpus to the browser to count it would
// be the fix-189 paging trap with extra steps, and the percentages have to be
// computed against the jurisdiction scope anyway, which is a database question.

/** ★ The jurisdiction scope. `null` is "all", which is a real choice rather than
 *  an absence — Bobby: *"let's look at Seattle, let's look at Bellevue, let's
 *  look at it holistically."* */
export type JurisScope = string | null;

export function useCorrectionClusterRanking(
  juris: JurisScope,
  tier: 'subject' | 'body',
  includeVerbatim: boolean,
) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CorrectionCluster[]>({
    queryKey: queryKeys.correctionClusterRanking(tenantId ?? '', juris, tier, includeVerbatim),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_correction_cluster_ranking', {
        p_juris: juris,
        p_tier: tier,
        p_include_verbatim: includeVerbatim,
      });
      if (error) throw error;
      return (data ?? []) as CorrectionCluster[];
    },
    staleTime: 60_000,
  });
}

/** ★★ The members of one cluster — the verbatim wordings, the projects and the
 *  extracted chips all come from this one read. */
export function useCorrectionClusterDetail(clusterKey: string | null, juris: JurisScope) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<CorrectionClusterItem[]>({
    queryKey: queryKeys.correctionClusterDetail(tenantId ?? '', clusterKey ?? '', juris),
    enabled: !!tenantId && !!clusterKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_correction_cluster_detail', {
        p_cluster_key: clusterKey,
        p_juris: juris,
      });
      if (error) throw error;
      return (data ?? []) as CorrectionClusterItem[];
    },
    staleTime: 60_000,
  });
}

/** ★ The re-index. Derived data only: it never edits a correction_items row and
 *  never touches curation. */
export function useRebuildCorrectionClusters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['rebuild-correction-clusters'],
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('bp_rebuild_correction_clusters');
      if (error) throw error;
      return (data ?? [])[0] as
        | { subject_clusters: number; body_clusters: number; items_clustered: number }
        | undefined;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.correctionClustersAll });
    },
  });
}

/** ★★ The four curation actions, one setter. `fields` is what makes clearing a
 *  note or undoing a merge possible — see the RPC. */
export interface CurationInput {
  clusterKey: string;
  displayName?: string | null;
  fixNote?: string | null;
  mergedIntoKey?: string | null;
  addressedOn?: string | null;
  hidden?: boolean | null;
  fields: string[];
}

export function useSetCorrectionCuration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-correction-curation'],
    mutationFn: async (input: CurationInput) => {
      const { error } = await supabase.rpc('bp_set_correction_curation', {
        p_cluster_key: input.clusterKey,
        p_display_name: input.displayName ?? null,
        p_fix_note: input.fixNote ?? null,
        p_merged_into_key: input.mergedIntoKey ?? null,
        p_addressed_on: input.addressedOn ?? null,
        p_hidden: input.hidden ?? null,
        p_fields: input.fields,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.correctionClustersAll });
    },
  });
}
