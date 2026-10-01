import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// fix-619 (gap 13): the jurisdiction list every filter and the Library juris
// EDITOR start from is the `jurisdictions` TABLE Settings edits — 19 rows on
// prod — not the 8-name app_config copy nothing edits.

const NINETEEN = [
  'Seattle', 'Bellevue', 'Kirkland', 'Redmond', 'Shoreline', 'Lynnwood', 'Edmonds',
  'Burien', 'Renton', 'Tacoma', 'Everett', 'Bothell', 'Kenmore', 'Mercer Island',
  'Issaquah', 'Sammamish', 'Tukwila', 'SeaTac', 'King County',
];

vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: NINETEEN.map((name, i) => ({ id: i + 1, name })) }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: [{ name: 'Building Permit' }, { name: 'Demolition' }] }),
}));
vi.mock('../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    map: new Map<string, unknown>([
      ['jurisdictions', ['Seattle', 'Bellevue']], // the dead copy — must NOT be read
      ['productTypeOptions', ['Townhome', 'SFR']],
      ['projectTagOptions', ['Corner']],
    ]),
  }),
  readAppConfigStringArray: (map: Map<string, unknown>, key: string) => {
    const v = map.get(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  },
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ ents: [{ name: 'Bobby' }, { name: 'Dana' }] }),
}));

import { useFilterRegistries } from '../hooks/useFilterRegistries';

describe('fix-619: useFilterRegistries', () => {
  it('★★★ jurisdictions are the TABLE — all 19, not the 2-name app_config copy', () => {
    const { result } = renderHook(() => useFilterRegistries());
    expect(result.current.jurisdictions).toEqual(NINETEEN);
    expect(result.current.jurisdictions).toHaveLength(19);
  });

  it('★★ every other list comes from its one Settings home', () => {
    const { result } = renderHook(() => useFilterRegistries());
    expect(result.current.permitTypes).toEqual(['Building Permit', 'Demolition']);
    expect(result.current.productTypes).toEqual(['Townhome', 'SFR']);
    expect(result.current.projectTags).toEqual(['Corner']);
    expect(result.current.entPeople).toEqual(['Bobby', 'Dana']);
    expect(result.current.zones.length).toBeGreaterThan(0);
  });
});
