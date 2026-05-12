import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: read all app_config rows for the active tenant. The shape is a
// tenant-scoped JSONB key/value store; the hook returns a Map<key, value>
// for ergonomic per-key lookup. Specific keys (productTypes, projectTagOptions,
// consultantTypes, etc.) are read by component code via the same Map.

interface Row {
  key: string;
  value: unknown;
}

export function useAppConfig() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  const q = useQuery<Row[]>({
    queryKey: queryKeys.appConfig(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value');
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const map = useMemo(() => {
    const m = new Map<string, unknown>();
    for (const row of q.data ?? []) m.set(row.key, row.value);
    return m;
  }, [q.data]);

  return { ...q, map };
}

/** Helper: safely read an app_config key as a string array. v2 stores
 * `productTypes`, `projectTagOptions`, `permitTypes`, etc. as JSONB string
 * arrays. Returns [] when the key is missing or shape is wrong. */
export function readAppConfigStringArray(
  map: Map<string, unknown>,
  key: string,
): string[] {
  const v = map.get(key);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** Q9.5.e-fix-3: read consultantTypes — JSONB array of `{type, firms[]}`.
 * Used by the Project Detail TeamCell external section. Returns [] when
 * missing or shape-broken. */
export interface ConsultantType {
  type: string;
  firms: string[];
}
export function readConsultantTypes(map: Map<string, unknown>): ConsultantType[] {
  const v = map.get('consultantTypes');
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      type: typeof x.type === 'string' ? x.type : '',
      firms: Array.isArray(x.firms)
        ? x.firms.filter((f): f is string => typeof f === 'string')
        : [],
    }))
    .filter((ct) => ct.type !== '');
}
