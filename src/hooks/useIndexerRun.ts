import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { IndexerRun, IndexerReconciliation } from '../lib/indexerRun';

// ===========================================================================
// ★★ fix-376 — reading fix-373's snapshot, which nothing read before
// ===========================================================================
//
// Grep before this ticket found ZERO references anywhere in src/ to
// `indexer_run`, `indexer_run_current`, `indexer_project_reconciliation`,
// `indexer_reconciliation_current`, `indexer_missing_letter` or
// `indexer_missing_letter_current`. The record existed and nothing showed it.
//
// ★★★ READ-ONLY, AND NOTHING IS RECOMPUTED. The counts come from the snapshot
// — fix-373's numbers are the finer ones, taken with the share in hand — and
// the missing-letter ROWS come from fix-374's live view. Re-deriving either in
// the browser would be a second answer to a question already answered, which is
// the failure fix-372 and fix-336 both spent a ticket removing.

const RUN_COLUMNS =
  'id,started_at,finished_at,seconds,ok,exit_code,error,mode,scope,dry_run,forced,' +
  'reconciliation_written,projects_with_corrections,letters_level,letters_behind,' +
  'no_letters_found,missing_rounds,unmatched_projects';

/**
 * ★ The run BEHIND THE NUMBERS — the most recent one that wrote a
 * reconciliation. Null when the indexer has never run, which is today's state.
 */
export function useIndexerRunCurrent() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<IndexerRun | null>({
    queryKey: queryKeys.indexerRunCurrent(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('indexer_run_current')
        .select(`${RUN_COLUMNS},age_days`)
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as unknown as IndexerRun | undefined) ?? null;
    },
  });
}

/**
 * ★★★ THE LAST ATTEMPT, WHICH IS NOT THE SAME QUERY.
 *
 * `indexer_run_current` is defined `WHERE reconciliation_written`, so a run
 * that was KILLED before writing one never appears in it. Reading only that
 * view would make "the process never returned" indistinguishable from "no run
 * has ever happened" — and telling those two apart is exactly what fix-373 left
 * `ok` three-valued for.
 *
 * ★ So this reads the table itself, newest first, whatever the outcome.
 */
export function useIndexerLastAttempt() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<IndexerRun | null>({
    queryKey: queryKeys.indexerLastAttempt(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('indexer_run')
        .select(RUN_COLUMNS)
        .order('started_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as unknown as IndexerRun | undefined) ?? null;
    },
  });
}

/**
 * ★★ The reconciliation from the current run. Small by construction — one row
 * per project with corrections, which is 70 today — so it is not paged; if it
 * ever approached the PostgREST cap that would itself be the news.
 */
export function useIndexerReconciliation() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<IndexerReconciliation[]>({
    queryKey: queryKeys.indexerReconciliation(tenantId ?? ''),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('indexer_reconciliation_current')
        .select(
          'run_id,project_id,address,juris,status,expected_max_round,' +
            'found_max_cycle,items_found,rounds_behind,project_parked',
        )
        .order('address', { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as IndexerReconciliation[];
    },
  });
}
