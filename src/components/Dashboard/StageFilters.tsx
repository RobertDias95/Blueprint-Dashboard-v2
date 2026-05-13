import { useMemo } from 'react';
import FilterDropdown from '../FilterDropdown';
import type { Permit } from '../../lib/database.types';

// Q9.5.f Item 2: 4 multi-select filter chips above the dashboard buckets.
// Option lists derived live from the current permit data — distinct
// non-empty values per dimension, alpha-sorted. Empty Set = no filter.
// Per v1 index.html:4949-4951, permits with null on the filtered dimension
// are excluded when any specific value is selected.

export interface DashFilters {
  ent: Set<string>;
  da: Set<string>;
  dm: Set<string>;
  type: Set<string>;
}

export const EMPTY_DASH_FILTERS: DashFilters = {
  ent: new Set(),
  da: new Set(),
  dm: new Set(),
  type: new Set(),
};

interface Props {
  permits: Permit[];
  filters: DashFilters;
  onChange: (next: DashFilters) => void;
}

export default function StageFilters({ permits, filters, onChange }: Props) {
  const options = useMemo(() => {
    const ent = new Set<string>();
    const da = new Set<string>();
    const dm = new Set<string>();
    const type = new Set<string>();
    for (const p of permits) {
      if (p.ent_lead) ent.add(p.ent_lead);
      if (p.da) da.add(p.da);
      if (p.dm) dm.add(p.dm);
      if (p.type) type.add(p.type);
    }
    const toSorted = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b));
    return {
      ent: toSorted(ent),
      da: toSorted(da),
      dm: toSorted(dm),
      type: toSorted(type),
    };
  }, [permits]);

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="dash-filters">
      <FilterDropdown
        label="ENT"
        options={options.ent}
        selected={filters.ent}
        onChange={(next) => onChange({ ...filters, ent: next })}
        testId="dash-filter-ent"
      />
      <FilterDropdown
        label="DA"
        options={options.da}
        selected={filters.da}
        onChange={(next) => onChange({ ...filters, da: next })}
        testId="dash-filter-da"
      />
      <FilterDropdown
        label="DM"
        options={options.dm}
        selected={filters.dm}
        onChange={(next) => onChange({ ...filters, dm: next })}
        testId="dash-filter-dm"
      />
      <FilterDropdown
        label="Type"
        options={options.type}
        selected={filters.type}
        onChange={(next) => onChange({ ...filters, type: next })}
        testId="dash-filter-type"
      />
    </div>
  );
}

/** v1 :4949-4951 semantics — a permit passes when each dimension is
 *  either unfiltered (empty Set) OR contains a value present in the
 *  permit. Permits with null on a filtered dimension are excluded. */
export function permitPassesDashFilters(
  permit: Permit,
  filters: DashFilters,
): boolean {
  if (filters.ent.size > 0 && (!permit.ent_lead || !filters.ent.has(permit.ent_lead))) return false;
  if (filters.da.size > 0 && (!permit.da || !filters.da.has(permit.da))) return false;
  if (filters.dm.size > 0 && (!permit.dm || !filters.dm.has(permit.dm))) return false;
  if (filters.type.size > 0 && (!permit.type || !filters.type.has(permit.type))) return false;
  return true;
}
