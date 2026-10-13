import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { readAppConfigStringArray, useAppConfig } from './useAppConfig';
import { DEFAULT_WHATS_NEW_AREAS } from '../lib/whatsNew';

// ===========================================================================
// ★★★ fix-657 (P-342) — the guide's data: the area list and the smart search
// ===========================================================================
//
// ★ A separate module from useWhatsNew on purpose: the entries/reads hooks are
//   mocked whole in the fix-350/387 tests, and adding exports there would make
//   every one of those mocks silently return `undefined` for them.

/** The areas, from app_config `whatsNewAreas` (seeded by the fix-657
 *  migration). Before it loads, or if it is ever emptied, the same eleven
 *  defaults — so Browse never renders an empty grid. */
export function useWhatsNewAreas(): string[] {
  const { map } = useAppConfig();
  return useMemo(() => {
    const list = readAppConfigStringArray(map, 'whatsNewAreas');
    return list.length > 0 ? list : [...DEFAULT_WHATS_NEW_AREAS];
  }, [map]);
}

/** A value that settles `ms` after the last change — the search box types
 *  freely and the RPC runs once the typing stops. */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface WhatsNewHit {
  id: string;
  rank: number;
  /** Matches wrapped in « » — see lib/whatsNew `snippetParts`. */
  snippet: string;
}

/** The minimum query worth sending: two characters. */
export const MIN_SEARCH_CHARS = 2;

/**
 * ★★ bp_search_whats_new — ranked ids + a highlighted snippet. Keyed under the
 * entries prefix, so the realtime invalidation that refreshes the entries (an
 * admin edits one) refreshes the results too.
 */
export function useWhatsNewSearch(rawQuery: string) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useDebouncedValue(rawQuery.trim(), 250);
  const enabled = !!tenantId && q.length >= MIN_SEARCH_CHARS;
  const query = useQuery<WhatsNewHit[]>({
    queryKey: [...queryKeys.whatsNewEntriesAll, 'search', tenantId ?? '', q],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_search_whats_new', { q });
      if (error) throw error;
      return ((data ?? []) as WhatsNewHit[]).map((h) => ({
        id: h.id,
        rank: Number(h.rank),
        snippet: h.snippet ?? '',
      }));
    },
  });
  return {
    ...query,
    /** The query the results belong to (debounced). */
    settledQuery: q,
    /** True while the user is still typing ahead of the last search. */
    pending: rawQuery.trim() !== q || (enabled && query.isFetching),
    active: rawQuery.trim().length >= MIN_SEARCH_CHARS,
  };
}
