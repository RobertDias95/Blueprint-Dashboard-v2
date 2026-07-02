import {
  groupPermitsByProject,
  holisticOwner,
} from '../../lib/volumeAttribution';
import { parseUnitTypes } from '../../lib/unitTypeNaming';
import type {
  PermitWithCycles,
  Project,
  UnitType,
} from '../../lib/database.types';

// fix-216: pure helpers for the REUSE source picker. Kept in their own module
// (not the component file) so ReuseSourcePicker.tsx only exports a component —
// react-refresh requires component files to export components only. Also lets
// these be unit-tested without a DOM.

export interface ReuseSource {
  id: string;
  address: string;
  juris: string | null;
  zone: string | null;
  lot_width: number | null;
  lot_depth: number | null;
  product_types: string[];
  /** Canonicalized (parseUnitTypes) so copied rows are the shape both editors
   *  read + write — the fix-205/212 rules apply on display + save. */
  unit_types: UnitType[];
  /** The project's primary (holistic) DA — the Building Permit's `da` — via the
   *  SAME volumeAttribution helper reports use, so "search by DA" reconciles. */
  primaryDa: string | null;
}

/** Build the reuse candidate list from the projects + permits caches. Excludes
 *  archived projects. Pure — the component just renders + filters the result. */
export function buildReuseSources(
  projects: Project[],
  permitsByProject: Map<string, PermitWithCycles[]>,
): ReuseSource[] {
  return projects
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      address: p.address,
      juris: p.juris ?? null,
      zone: p.zone ?? null,
      lot_width: p.lot_width ?? null,
      lot_depth: p.lot_depth ?? null,
      product_types: Array.isArray(p.product_types) ? p.product_types : [],
      unit_types: parseUnitTypes(p.unit_types),
      primaryDa: holisticOwner('da', p, permitsByProject.get(p.id) ?? []),
    }));
}

/** Group the flat permits list by project — re-exported thin wrapper so the
 *  component builds the source list in one place. */
export function reuseSourcesFromCaches(
  projects: Project[],
  permits: PermitWithCycles[],
): ReuseSource[] {
  return buildReuseSources(projects, groupPermitsByProject(permits));
}

/** Multi-token AND filter across address / juris / DA / zone / product types.
 *  Blank query returns all. Case-insensitive; tokens split on space + comma. */
export function filterReuseSources(
  sources: ReuseSource[],
  query: string,
): ReuseSource[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length === 0) return sources;
  return sources.filter((s) => {
    const hay = `${s.address} ${s.juris ?? ''} ${s.primaryDa ?? ''} ${
      s.zone ?? ''
    } ${s.product_types.join(' ')}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/** Compact "Seattle · LR2 · 20×30 lot · DA Fisk · SFR" context line. */
export function reuseContextLine(s: ReuseSource): string {
  const parts: string[] = [];
  if (s.juris) parts.push(s.juris);
  if (s.zone) parts.push(s.zone);
  if (s.lot_width != null && s.lot_depth != null) {
    parts.push(`${s.lot_width}×${s.lot_depth} lot`);
  }
  if (s.primaryDa) parts.push(`DA ${s.primaryDa}`);
  if (s.product_types.length > 0) parts.push(s.product_types.join(', '));
  return parts.join(' · ');
}
