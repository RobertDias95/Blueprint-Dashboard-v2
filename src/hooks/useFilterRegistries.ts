import { useMemo } from 'react';
import { useJurisdictions } from './useJurisdictions';
import { usePermitTypes } from './usePermitTypes';
import { useAppConfig, readAppConfigStringArray } from './useAppConfig';
import { useTeamMembers } from './useTeamMembers';
import { zoneOptions } from '../lib/zoneOptions';

// ★ fix-619: the Settings lists every FILTER starts from — one place, so a
//   filter never reaches for a second copy (app_config.jurisdictions,
//   app_config.permitTypes) or a hard-coded array. Feed these to
//   `filterOptions(registry, stored)` (lib/filterOptions).
//
//   jurisdictions  the `jurisdictions` TABLE (Settings → Project lists)
//   permitTypes    the `permit_types` catalogue
//   productTypes   app_config.productTypeOptions
//   projectTags    app_config.projectTagOptions
//   zones          app_config.zoneOptions (via zoneOptions, which owns its default)
//   entPeople      the roster's CURRENT entitlement leads (ent + ent_lead)

export interface FilterRegistries {
  jurisdictions: string[];
  permitTypes: string[];
  productTypes: string[];
  projectTags: string[];
  zones: string[];
  entPeople: string[];
}

export function useFilterRegistries(): FilterRegistries {
  const jurisQ = useJurisdictions();
  const typesQ = usePermitTypes();
  const config = useAppConfig();
  const team = useTeamMembers();
  return useMemo(
    () => ({
      jurisdictions: (jurisQ.data ?? []).map((j) => j.name),
      permitTypes: (typesQ.data ?? []).map((t) => t.name),
      productTypes: readAppConfigStringArray(config.map, 'productTypeOptions'),
      projectTags: readAppConfigStringArray(config.map, 'projectTagOptions'),
      zones: zoneOptions(config.map),
      entPeople: (team.ents ?? []).map((m) => m.name),
    }),
    [jurisQ.data, typesQ.data, config.map, team.ents],
  );
}
