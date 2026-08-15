import { useMemo } from 'react';
import FilterDropdown from '../FilterDropdown';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { formerMemberNames } from '../../lib/roster';
import type { Permit } from '../../lib/database.types';

// Q9.5.f Item 2: 4 multi-select filter chips above the dashboard buckets.
// Option lists derived live from the current permit data — distinct
// non-empty values per dimension, alpha-sorted. Empty Set = no filter.
// Per v1 index.html:4949-4951, permits with null on the filtered dimension
// are excluded when any specific value is selected.
//
// ★ fix-321 #79 — THE PEOPLE CHIPS NOW STOP AT THE CURRENT ROSTER. Bobby: "on
// the dashboard view, when I click design associate, it is showing design
// associates who are no longer active and/or employed."
//
// WHY THIS ONE SCREEN WAS THE ODD ONE OUT: every other people-filter in the app
// (Project View, My Tasks) builds its list from team_members and so has always
// stopped at the roster. This one builds its list from the PERMITS on screen, so
// a departed DA reappears for as long as any permit still carries their name —
// which is why Bobby saw it here and nowhere else.
//
// ★ The rows are NOT hidden and the names are NOT scrubbed. A permit assigned to
// Nidhi still shows Nidhi, still sits in its bucket, and is still findable by
// typing "Nidhi" into the search box above — which matches permit.da directly.
// What goes away is being OFFERED her as a filter option. Measured 2026-08-15:
// 9 permits are still assigned to the three departed DAs, 5 of them live — so
// this deliberately leaves work visible under a name nobody can pick, and the
// search box is how you reach it until those permits are reassigned. That
// reassignment is Bobby's call and no part of this ticket.
//
// ★ Only names the roster explicitly RETIRES are dropped. A name that is not in
// team_members at all stays — unknown is not the same as departed, and treating
// it as departed would hide a live person from their own filter.

export interface DashFilters {
  ent: Set<string>;
  da: Set<string>;
  dm: Set<string>;
  type: Set<string>;
}

// eslint-disable-next-line react-refresh/only-export-components
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
  const team = useTeamMembers();
  const departed = useMemo(() => formerMemberNames(team.all), [team.all]);

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
    // People chips only. `type` is not a person and never gets this treatment.
    const toRoster = (s: Set<string>) =>
      Array.from(s)
        .filter((name) => !departed.has(name))
        .sort((a, b) => a.localeCompare(b));
    const toSorted = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b));
    return {
      ent: toRoster(ent),
      da: toRoster(da),
      dm: toRoster(dm),
      type: toSorted(type),
    };
  }, [permits, departed]);

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
// eslint-disable-next-line react-refresh/only-export-components
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
