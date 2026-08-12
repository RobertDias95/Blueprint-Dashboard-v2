import { useMemo } from 'react';
import { useAppConfig } from './useAppConfig';
import { PERMIT_DESCRIPTION_SEED } from '../components/wizard/wizardState';

// fix-288: the short help text under each permit type in wizard Step 2.
//
// It used to be a hardcoded constant in wizardState.ts, so changing a line of
// help text needed a deploy. It now lives in `app_config.permitTypeDescriptions`
// alongside productTypeOptions and the other registries, and the Settings
// permit-type editor writes it.
//
// ★ THE SEED IS A FALLBACK, NOT A MERGE. If the key is missing the wizard falls
// back to the constant wholesale, so help text can never vanish entirely. But a
// key that EXISTS wins outright, including when it is an empty object — merging
// the two would make a description impossible to delete, because the seed would
// keep putting it back.

export const PERMIT_DESCRIPTIONS_KEY = 'permitTypeDescriptions';

/** Read the descriptions map out of an app_config map. Exported for tests and
 *  for callers that already hold the config. */
export function readPermitDescriptions(
  map: Map<string, unknown>,
): Record<string, string> {
  const raw = map.get(PERMIT_DESCRIPTIONS_KEY);
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return PERMIT_DESCRIPTION_SEED;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Non-string values are dropped rather than rendered as "[object Object]".
    if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  return out;
}

/** The live descriptions map. Empty-ish while app_config loads, which renders
 *  as "no description" — the same as a type that has none, and never as an
 *  error: a missing sentence is not something anybody is blocked on. */
export function usePermitDescriptions(): Record<string, string> {
  const cfg = useAppConfig();
  return useMemo(() => readPermitDescriptions(cfg.map), [cfg.map]);
}
