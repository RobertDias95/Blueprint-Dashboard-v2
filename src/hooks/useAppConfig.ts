import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: read all app_config rows for the active tenant. The shape is a
// tenant-scoped JSONB key/value store; the hook returns a Map<key, value>
// for ergonomic per-key lookup. Specific keys (productTypeOptions,
// projectTagOptions, holdReasonOptions, etc.) are read by component code via the
// same Map. (fix-232: the canonical product-type key is 'productTypeOptions';
// the legacy 'productTypes' key is orphaned — no reader — and can be deleted.)

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
 * `productTypeOptions`, `projectTagOptions`, `holdReasonOptions`, etc. as JSONB
 * string arrays. Returns [] when the key is missing or shape is wrong. */
export function readAppConfigStringArray(
  map: Map<string, unknown>,
  key: string,
): string[] {
  const v = map.get(key);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

// fix-197: readConsultantTypes + the ConsultantType interface were removed —
// the app_config.consultantTypes path had zero live readers after fix-196
// (external team consolidated onto the projects.external_team blob), so the
// editor that wrote it (the Settings → Consultants tab) was dropped too.
