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

/** Escape a string for use inside a PostgREST `ilike` value embedded in
 *  an `.or()` filter expression. PostgREST recognises `*` and `%` as
 *  wildcards in `ilike` values — but using `%` inside `.or()` is fragile:
 *  supabase-js url-encodes the value as `%25`, and intermediate URL
 *  parsers / proxies have been known to mis-handle the double-encode
 *  (resulting in the query silently matching nothing — exactly Bobby's
 *  fix-24c "boyd" symptom). `*` sidesteps that entire class of bugs.
 *  We escape `\`, `%`, `_`, and `*` so any of those literals the user
 *  typed are matched verbatim rather than acting as wildcards. */
function escapeLike(s: string): string {
  return s.replace(/([\\%_*])/g, '\\$1');
}

/** fix-96-a: wrap a value for use inside a PostgREST `.or()` filter.
 *  PostgREST uses commas as the OR-clause separator inside `.or()`, so a
 *  raw needle containing a comma (Bobby's "JMS Homes, INC" search) gets
 *  parsed as a new clause boundary — the server responds with
 *  "failed to parse logic tree (...)". PostgREST's escape hatch is the
 *  double-quoted value form: anything between `"..."` is treated as a
 *  literal value regardless of commas / parens / spaces / dots. Embedded
 *  double quotes are escaped by doubling (`"` → `""`), per the
 *  PostgREST URL-syntax spec. */
function quoteForOr(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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
      // fix-24c: `*` not `%` — PostgREST's URL-safe wildcard. See
      // escapeLike for the rationale. Bobby smoked "boyd" against a row
      // we'd confirmed in prod (Boyd Lybeck, tenant 00000…001, active)
      // and got nothing; API logs showed no /rest/v1/builders requests
      // landed correctly. Switching to `*` produces a URL with no raw
      // `%` chars in the filter value at all, which removes the
      // suspected mis-encoding path entirely.
      const needle = `*${escapeLike(debouncedQuery)}*`;
      // fix-96-a: quote the needle so a literal comma in the search
      // term (e.g. "JMS Homes, INC") isn't mis-parsed as an OR-clause
      // boundary. quoteForOr also escapes embedded " by doubling.
      const v = quoteForOr(needle);
      const { data, error } = await supabase
        .from('builders')
        .select('id, name, company, email, phone, address, notes, active')
        .or(`name.ilike.${v},company.ilike.${v},email.ilike.${v},phone.ilike.${v}`)
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
