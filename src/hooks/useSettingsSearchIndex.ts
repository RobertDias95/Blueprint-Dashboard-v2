// ===========================================================================
// ★★★ fix-611 §D — THE LIVE VALUES BEHIND THE SEARCH
// ===========================================================================
//
// One hook that collects the values inside each block, so `searchSettings` can
// match "Kirkland" to Jurisdictions and "ULS" to Permit Types.
//
// ★★ EVERY SOURCE EXCEPT ONE WAS ALREADY BEING FETCHED by a block on one of the
//    seven categories. The one addition is `usePermitTypes()` — the Permits
//    category fetched it, the Settings page did not, so a search from My account
//    had nothing to match "ULS" against. Same query key, so it is a cache hit the
//    moment you arrive at Permits.
//
// ★ These are all React Query hooks keyed by tenant, so mounting this on the
//   page costs nothing beyond what the open category already asked for; the
//   queries dedupe.
import { useMemo } from 'react';
import { readAppConfigStringArray, useAppConfig } from './useAppConfig';
import { useJurisdictions } from './useJurisdictions';
import { usePermitTypes } from './usePermitTypes';
import { useTeamMembers } from './useTeamMembers';
import { useBuilderRegistry } from './useBuilderRegistry';
import { useExternalTeamDirectory } from './useExternalTeamDirectory';
import { zoneOptions } from '../lib/zoneOptions';
import {
  parkingOptions,
  roofDeckOptions,
  storiesOptions,
} from '../lib/unitVocabulary';
import { waitingOnOptions } from '../lib/waitingOn';
import type { SettingsBlockValues } from '../lib/settingsSearch';

/** ★ Names only, de-duplicated, blanks dropped — a blank would match every query
 *  of length ≥ 2 as `''.includes(q)` is false, but a whitespace-only name would
 *  render an empty highlight, which looks like a bug. */
function clean(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s === '' || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

export function useSettingsSearchIndex(): SettingsBlockValues[] {
  const cfg = useAppConfig();
  const juris = useJurisdictions();
  const types = usePermitTypes();
  const team = useTeamMembers();
  const builders = useBuilderRegistry();
  const firms = useExternalTeamDirectory();

  const cfgMap = cfg.map;
  const jurisRows = juris.data;
  const typeRows = types.data;
  const people = team.all;
  const builderRows = builders.data;
  const firmRows = firms.data;

  return useMemo(() => {
    const index: SettingsBlockValues[] = [
      {
        blockId: 'jurisdictions',
        values: clean((jurisRows ?? []).map((j) => j.name)),
      },
      {
        blockId: 'permit-types',
        values: clean((typeRows ?? []).map((t) => t.name)),
      },
      {
        blockId: 'zones',
        values: clean(zoneOptions(cfgMap)),
      },
      {
        blockId: 'product-types',
        values: clean(readAppConfigStringArray(cfgMap, 'productTypeOptions')),
      },
      {
        blockId: 'project-tags',
        values: clean(readAppConfigStringArray(cfgMap, 'projectTagOptions')),
      },
      {
        blockId: 'hold-and-cancel-reasons',
        values: clean([
          ...readAppConfigStringArray(cfgMap, 'holdReasonOptions'),
          ...readAppConfigStringArray(cfgMap, 'cancelReasonOptions'),
        ]),
      },
      {
        blockId: 'unit-options',
        values: clean([
          ...parkingOptions(cfgMap),
          ...roofDeckOptions(cfgMap),
          ...storiesOptions(cfgMap),
        ]),
      },
      {
        // ★ Both halves of the merged card: the Waiting-On vocabulary and the
        //   consultant firms, so "Emerald" and "Surveyor" both land here.
        blockId: 'waiting-on-and-consultants',
        values: clean([
          ...waitingOnOptions(cfgMap),
          ...(firmRows ?? []).flatMap((f) => [f.name, f.discipline]),
        ]),
      },
      {
        blockId: 'builders-and-owners',
        values: clean(
          (builderRows ?? []).flatMap((b) => [b.name, b.company]),
        ),
      },
    ];

    // ★★ PEOPLE NAMES GO ON EVERY PEOPLE BLOCK, which is deliberate rather than
    //    lazy: in this ticket the roster is still nine separate editors, so
    //    "Gena" genuinely is findable in several of them and the brief's own test
    //    asks for *"'Gena' → People blocks"*, plural. fix-612 collapses these
    //    into one table and this becomes one entry.
    const names = clean(people.map((m) => m.name));
    for (const id of [
      'design-associates',
      'design-managers',
      'entitlement-leads',
      'acquisition-leads',
      'schematic',
      'construction-admin',
      'names-and-emails',
      'departments',
      'agenda-members',
      'former-and-inactive',
    ]) {
      index.push({ blockId: id, values: names });
    }

    return index;
  }, [cfgMap, jurisRows, typeRows, people, builderRows, firmRows]);
}
