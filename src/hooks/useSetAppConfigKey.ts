import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: bp_set_app_config_key — single-key JSONB upsert. Used for
// productTypeOptions, projectTagOptions, consultantTypes (Q7.3.d),
// wizQuestions, etc. The full value is replaced per call; clients build
// the new array locally and pass it in. Server uses ON CONFLICT (key)
// DO UPDATE.

export interface SetAppConfigKeyInput {
  key: string;
  value: unknown;
}

interface Row {
  out_key: string;
  out_value: unknown;
  updated_at: string;
}

export function useSetAppConfigKey() {
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  return useMutation<Row, Error, SetAppConfigKeyInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('bp_set_app_config_key', {
        p_key: input.key,
        p_value: input.value,
      });
      if (error) throw error;
      const row = (data as Row[])[0];
      if (!row) throw new Error('Set returned no row');
      return row;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appConfig(tenantId) });
      pushToast(`Saved ${humanizeKey(input.key)}`, 'success');
    },
    onError: (error, input) => {
      pushToast(
        `Could not save ${humanizeKey(input.key)} — ${error.message}`,
        'error',
      );
    },
  });
}

function humanizeKey(key: string): string {
  switch (key) {
    // fix-92: align with the key actually consumed by the wizard +
    // Library filter (see migrations/fix_91_product_types_array.sql).
    case 'productTypeOptions':
      return 'product types';
    case 'projectTagOptions':
      return 'project tags';
    case 'consultantTypes':
      return 'consultants';
    case 'learnThresholds':
      return 'learning thresholds';
    default:
      return key;
  }
}
