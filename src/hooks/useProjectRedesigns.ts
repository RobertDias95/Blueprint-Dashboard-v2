import { useMemo } from 'react';
import { useProjects } from './useProjects';
import { usePermits } from './usePermits';
import type { PermitWithCycles, Project } from '../lib/database.types';

// fix-126: descendant redesigns of a given project. Used by:
//   - Project Overview's "Redesigns (N)" expandable section
//   - The wizard's [Redesign N] address-suffix counter
//   - The "Spawn Redesign" button's "is one already in flight?" gate
//
// Implemented on top of useProjects (already cached + tenant-scoped via
// RLS) rather than a dedicated query — projects are read-frequent and
// the in-memory filter is cheap. If the project list grows past ~1k rows
// a per-id Supabase query would still be the upgrade path.

export function useProjectRedesigns(parentProjectId: string | null | undefined): {
  redesigns: Project[];
  isLoading: boolean;
  count: number;
} {
  const projectsQ = useProjects();
  const data = projectsQ.data;
  const redesigns = useMemo(() => {
    if (!parentProjectId) return [];
    // Read projectsQ.data inside the memo so the dep array stays on the
    // stable query reference (rather than the per-render `?? []`
    // fallback, which would invalidate every render).
    const all = data ?? [];
    return all
      .filter((p) => p.redesign_of_project_id === parentProjectId)
      .sort((a, b) => {
        // Stable order: created_at ascending so "Redesign #1" is the
        // first one Bobby spawned, not whichever row Postgres returned
        // first. Falls back to id when timestamps tie.
        const aT = a.created_at ?? '';
        const bT = b.created_at ?? '';
        if (aT !== bT) return aT.localeCompare(bT);
        return a.id.localeCompare(b.id);
      });
  }, [data, parentProjectId]);
  return {
    redesigns,
    isLoading: projectsQ.isLoading,
    count: redesigns.length,
  };
}

// fix-151: a redesign + its own permits (empty when reuses_permit=true). Powers
// the Project Overview's Redesigns sidebar section + the Schedule Health lineage
// aggregation.
export interface RedesignWithPermits {
  project: Project;
  /** The redesign's OWN permits (with cycles). Empty for a reuses-permit
   *  redesign, which carries no permits of its own. */
  permits: PermitWithCycles[];
}

/** fix-151: redesigns of a parent project, each paired with its permits. Built
 *  in-memory on the already-cached useProjects + usePermits queries (same
 *  philosophy as useProjectRedesigns) — no extra round trip. One hop: does not
 *  recurse into redesigns-of-redesigns. */
export function useProjectRedesignsWithPermits(
  parentProjectId: string | null | undefined,
): { data: RedesignWithPermits[]; isLoading: boolean } {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const projData = projectsQ.data;
  const permData = permitsQ.data;
  const data = useMemo<RedesignWithPermits[]>(() => {
    if (!parentProjectId) return [];
    const redesigns = (projData ?? [])
      .filter((p) => p.redesign_of_project_id === parentProjectId)
      .sort((a, b) => {
        const aT = a.created_at ?? '';
        const bT = b.created_at ?? '';
        if (aT !== bT) return aT.localeCompare(bT);
        return a.id.localeCompare(b.id);
      });
    if (redesigns.length === 0) return [];
    const byProject = new Map<string, PermitWithCycles[]>();
    for (const r of redesigns) byProject.set(r.id, []);
    for (const p of permData ?? []) {
      const arr = byProject.get(p.project_id);
      if (arr) arr.push(p);
    }
    return redesigns.map((project) => ({
      project,
      permits: byProject.get(project.id) ?? [],
    }));
  }, [projData, permData, parentProjectId]);
  return { data, isLoading: projectsQ.isLoading || permitsQ.isLoading };
}
