import { useMemo } from 'react';
import { useProjects } from './useProjects';
import {
  asExternalTeamBlob,
  resolveExternalFirm,
  type ExternalTeamBlob,
} from '../lib/externalTeam';

// fix-190d: read a project's external-team firm assignments from the store the
// editor actually writes — projects.external_team — instead of the empty
// normalized project_external_teams/consultant_firms tables. Reuses useProjects
// (already cached app-wide) so there's no extra round trip. Backs the per-task
// Waiting-On firm sub-label; My Tasks → Waiting uses the same resolveExternalFirm.

export function useProjectExternalTeamBlob(projectId: string) {
  const projectsQ = useProjects();
  const blob = useMemo<ExternalTeamBlob | null>(() => {
    const project = (projectsQ.data ?? []).find((p) => p.id === projectId);
    return asExternalTeamBlob(project?.external_team);
  }, [projectsQ.data, projectId]);

  return {
    blob,
    /** Firm working `discipline` on this project, or null. */
    resolve: (discipline: string | null | undefined) =>
      resolveExternalFirm(blob, discipline),
  };
}
