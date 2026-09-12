import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-532 §C (P-247) — WHICH PROJECTS ARE SHOWING AN ARCHIVED SET
// ===========================================================================
//
// The Library lists projects, not sets, so it needs the flag at the grain it
// renders: a set of project ids. Measured on prod 2026-09-12 — **69 rows across
// 60 projects**, out of 415 current sets.
//
// ★★ ONE QUERY FOR THE WHOLE SCREEN, not one per row. `usePlanOfRecordSets` is
//    per-project and the Library draws up to 220 of them; 220 subscriptions to
//    answer one boolean each is the shape fix-434 measured at 1.1 MB an
//    invalidation.
//
// ★★★ AND IT SELECTS TWO COLUMNS. §C: *"do not add it to a hook's explicit
//     select without checking the view exposes it — fix-523's `42703` cost a
//     ticket."* Checked: `information_schema.columns` has
//     `is_archived_fallback` on `project_plan_of_record_sets`, and
//     `usePlanOfRecordSets` has selected it since fix-506. This is a narrower
//     read of a column that is already proven to exist.

const SELECT_COLUMNS = 'project_id,is_archived_fallback';

/**
 * Project ids with at least one archived-fallback set.
 *
 * ★ A project is marked when ANY of its sets is a fallback, because the Library
 *   row is the project — and "one of this project's drawings is superseded" is
 *   the fact a person scanning the list needs. Which one it is belongs on the
 *   project's own card, where the set is named.
 *
 * ★★ The indexer runs once a day, so a long `staleTime` is honest: re-asking on
 *    every filter change would be asking a question whose answer cannot have
 *    changed.
 */
export function useArchivedFallbackProjects() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Set<string>>({
    queryKey: ['archivedFallbackProjects', tenantId ?? ''],
    enabled: !!tenantId,
    staleTime: 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_plan_of_record_sets')
        .select(SELECT_COLUMNS)
        .eq('is_archived_fallback', true);
      if (error) throw error;
      const out = new Set<string>();
      for (const row of (data ?? []) as Array<{ project_id: string }>) {
        out.add(row.project_id);
      }
      return out;
    },
  });
}
