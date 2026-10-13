import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

// ★★ fix-659 (census 32): "is the builder this project is LINKED to still
// active?" Pickers hide deactivated builders, but a project's own builder stays
// visible and selected even after it is deactivated — marked "(inactive)" so
// nobody mistakes it for a live choice. That mark needs the linked row's flag,
// which no picker query returns (they filter the row out).
//
// ★ Its own module on purpose: whole-module mocks of `useBuilderSearch` would
//   turn a new export there into `undefined` (fix-415's trap).

export interface LinkedBuilder {
  id: string;
  name: string | null;
  active: boolean;
}

export function useBuilderById(id: string | null | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<LinkedBuilder | null>({
    queryKey: ['builders_by_id', tenantId ?? '', id ?? ''],
    enabled: !!tenantId && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builders')
        .select('id, name, active')
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id as string,
        name: (data.name as string | null) ?? null,
        active: data.active !== false,
      };
    },
  });
}

/** True only when the linked row is KNOWN to be deactivated — loading or a
 *  missing row is not "inactive". */
export function isLinkedBuilderInactive(b: LinkedBuilder | null | undefined): boolean {
  return !!b && !b.active;
}
