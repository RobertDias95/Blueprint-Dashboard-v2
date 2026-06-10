import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import type { TargetSubmitFormula } from '../lib/database.types';

// fix-154: per-type × per-jurisdiction target_submit offset overrides. Reads
// the tenant's rows via bp_list_target_submit_formulas (Base first per type).
// The server engine (bp_learn_target_submit_days → bp_target_submit_offset)
// does the authoritative resolution at derivation time; this client copy backs
// the Settings editor + an "effective offset" preview that resolves the same
// way (per-juris row → Base row → null).

export interface TargetSubmitFormulasResult {
  formulas: TargetSubmitFormula[];
  /** `${type}||${jurisdiction ?? ''}` → row, for O(1) lookup. */
  byScope: Map<string, TargetSubmitFormula>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function formulaScopeKey(
  type: string,
  jurisdiction: string | null,
): string {
  return `${type}||${jurisdiction ?? ''}`;
}

/** Resolve the effective offset for (type, jurisdiction): the per-juris row if
 *  one exists, else the type's Base row, else null. Mirrors the SQL resolver
 *  bp_target_submit_offset exactly. */
export function resolveTargetSubmitOffset(
  byScope: Map<string, TargetSubmitFormula>,
  type: string,
  jurisdiction: string | null,
): number | null {
  if (jurisdiction) {
    const override = byScope.get(formulaScopeKey(type, jurisdiction));
    if (override) return override.offset_days;
  }
  const base = byScope.get(formulaScopeKey(type, null));
  return base ? base.offset_days : null;
}

export function useTargetSubmitFormulas(): TargetSubmitFormulasResult {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<TargetSubmitFormula[]>({
    queryKey: queryKeys.targetSubmitFormulas(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'bp_list_target_submit_formulas',
      );
      if (error) throw error;
      return (data ?? []) as TargetSubmitFormula[];
    },
  });

  const formulas = useMemo(() => q.data ?? [], [q.data]);
  const byScope = useMemo(() => {
    const map = new Map<string, TargetSubmitFormula>();
    for (const f of formulas) {
      map.set(formulaScopeKey(f.type, f.jurisdiction), f);
    }
    return map;
  }, [formulas]);

  return {
    formulas,
    byScope,
    isLoading: q.isLoading,
    error: (q.error as Error | null) ?? null,
    refetch: () => {
      q.refetch();
    },
  };
}
