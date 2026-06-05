import { useMemo } from 'react';
import { useProjects } from './useProjects';
import type { Project } from '../lib/database.types';

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
