import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// fix-23f: builder catalog autocomplete. Powers the Builder/Owner panel
// on the New Project wizard and Project Settings modal so partial input
// in ANY of (name, company, email, phone) surfaces existing builders
// the user can pick to fill all four fields at once.
//
// Query shape (ILIKE OR across all four columns) so typing "Boyd" in the
// Name field still matches a builder whose name is "Boyd Livek" AND a
// builder whose company contains "Boyd". The query is symmetric across
// fields — the autocomplete behavior is identical regardless of which
// field the user is typing in.
//
// 22 builders in prod today; limit 20 is plenty of headroom. Bumping the
// limit later is trivial.

const DEBOUNCE_MS = 175;
const SEARCH_LIMIT = 20;

/** Generic debounce — delays propagating `value` by `delay` ms. Used to
 *  avoid one Supabase round-trip per keystroke. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

/** Escape a string for use inside a PostgREST `ilike` value. PostgREST
 *  treats `%` and `_` as wildcards; users typing a literal email
 *  (something_else@x.com) shouldn't match every `_`-containing builder. */
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1');
}

export function useBuilderSearch(query: string): {
  data: Builder[];
  isLoading: boolean;
} {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const trimmed = query.trim();
  const debouncedQuery = useDebounced(trimmed, DEBOUNCE_MS);
  // Short-circuit empty (or whitespace-only) queries — no DB call, instant
  // empty result so the parent dropdown stays closed.
  const enabled = !!tenantId && debouncedQuery.length > 0;

  const q = useQuery<Builder[]>({
    // Cache key is per-tenant + per-query so switching tenants or queries
    // doesn't surface stale rows. We don't list a bare prefix here because
    // realtime invalidation isn't needed for an ephemeral autocomplete.
    queryKey: ['builders_search', tenantId ?? '', debouncedQuery],
    enabled,
    queryFn: async () => {
      const needle = `%${escapeLike(debouncedQuery)}%`;
      const { data, error } = await supabase
        .from('builders')
        .select('id, name, company, email, phone, notes, active')
        .or(
          `name.ilike.${needle},company.ilike.${needle},email.ilike.${needle},phone.ilike.${needle}`,
        )
        .order('name', { ascending: true })
        .limit(SEARCH_LIMIT);
      if (error) throw error;
      return (data ?? []) as Builder[];
    },
    // Keep stale results visible while a new query loads — feels snappier
    // than flashing an empty list between keystrokes.
    placeholderData: (prev) => prev,
  });

  return {
    data: enabled ? (q.data ?? []) : [],
    isLoading: q.isLoading || (enabled && trimmed !== debouncedQuery),
  };
}
