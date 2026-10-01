import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { pushToast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';

// Q7.3.a: bp_set_app_config_key — single-key JSONB upsert. Used for
// productTypeOptions, projectTagOptions, wizQuestions, holdReasonOptions, etc.
// The full value is replaced per call; clients build the new array locally and
// pass it in. Server uses ON CONFLICT (key) DO UPDATE. (fix-197: the
// consultantTypes key + its editor were removed — nothing read it.)

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
    meta: { write: 'bp_set_app_config_key' },
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

/**
 * ★★ fix-619 (census gap 25): the WORD a save toast uses for each key, so a
 * person reads "Saved zones", not "Saved zoneOptions". Every key any Settings
 * editor writes through this hook is listed — a test scans the callers and
 * fails on a key with no word. An unlisted key still falls back to itself
 * rather than printing nothing.
 */
export const APP_CONFIG_KEY_LABELS: Readonly<Record<string, string>> = {
  // fix-92: align with the key actually consumed by the wizard +
  // Library filter (see migrations/fix_91_product_types_array.sql).
  productTypeOptions: 'types',
  projectTagOptions: 'project tags',
  holdReasonOptions: 'hold reasons',
  learnThresholds: 'learning thresholds',
  cancelReasonOptions: 'cancel reasons',
  zoneOptions: 'zones',
  permitOwnerOptions: 'permit owners',
  parkingOptions: 'unit parking options',
  roofDeckOptions: 'unit roof deck options',
  storiesOptions: 'unit stories options',
  jurisdictionLinks: 'jurisdiction links',
  permitTypeDescriptions: 'permit type descriptions',
  waitingOnOptions: 'Waiting On list',
  vendorReportRecipients: 'vendor report recipients',
};

export function humanizeKey(key: string): string {
  return APP_CONFIG_KEY_LABELS[key] ?? key;
}
