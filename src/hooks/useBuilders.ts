import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import type { Builder } from '../lib/database.types';

// Q9.5.e-fix-3: builders catalog. Read-only list (active builders only) plus
// a `useUpsertBuilder` mutation for the "Create new" path in the Builder/
// Owner cell. The fix-3 migration adds projects.builder_id FK so v2 can
// reference an existing builders row instead of duplicating fields per
// project.

export function useBuilders() {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<Builder[]>({
    queryKey: queryKeys.builders(tenantId ?? ''),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('builders')
        .select('id, name, company, email, phone, notes, active')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Builder[];
    },
  });
}

export interface UpsertBuilderInput {
  /** Omit `id` to insert; include `id` to update. */
  id?: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
}

export function useUpsertBuilder() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';

  return useMutation<Builder, Error, UpsertBuilderInput>({
    mutationFn: async (input) => {
      const payload = {
        name: input.name,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('builders')
          .update(payload)
          .eq('id', input.id)
          .select('*')
          .single();
        if (error) throw error;
        return data as Builder;
      }
      const { data, error } = await supabase
        .from('builders')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;
      return data as Builder;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.builders(tenantId) });
      pushToast('Saved builder', 'success');
    },

    onError: (error) => {
      pushToast(`Could not save builder — ${error.message}`, 'error');
    },
  });
}
