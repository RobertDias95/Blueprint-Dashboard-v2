import type { PermitWithCycles, Project, Stage } from './database.types';
import type { TeamRoleSelection } from './teamPerformance';
import { worstStage } from './libraryHelpers';

// fix-131 / fix-226: the per-associate drill-in project list. Extracted from
// ReportsTeamDetail so the pure row-builder can be unit-tested without pulling
// the whole page (and so the page keeps to component-only exports for fast
// refresh). buildRows lists every project the associate is credited on — plus,
// for the DA role, any project handed off to/from them (fix-226 co-credit),
// flagged shared with ✳.

export function roleField(role: TeamRoleSelection): 'da' | 'dm' | 'ent_lead' {
  if (role === 'da') return 'da';
  if (role === 'dm') return 'dm';
  return 'ent_lead';
}

export interface ProjectListRow {
  projectId: string;
  address: string;
  juris: string;
  types: string[];
  stage: Stage;
  goDate: string | null;
  targetSubmit: string | null;
  approvalDate: string | null;
  isRedesign: boolean;
  // fix-226: the project carries a DA handoff — co-credited (shared) between
  // this DA and another. Flagged with ✳ in the list, mirroring the fix-225
  // board/header marker. Only ever true on the DA drill-in.
  isShared: boolean;
}

export function buildRows(
  name: string,
  role: TeamRoleSelection,
  permits: PermitWithCycles[],
  projects: Project[],
  // fix-226: DA co-credit map. When set (DA role), handed-off projects where this
  // DA is a from_da/to_da are included even though permits.da no longer names
  // them, and every handed-off project row is flagged shared.
  coCredit?: Map<string, Set<string>>,
): ProjectListRow[] {
  const field = roleField(role);
  const projectsById = new Map<string, Project>();
  for (const p of projects) projectsById.set(p.id, p);

  // Group the associate's permits by project. The associate may have
  // multiple permits at a single project (BP + Demo, etc.), so accumulate.
  const byProjectId = new Map<string, PermitWithCycles[]>();
  for (const permit of permits) {
    const credited = (permit[field] ?? '').trim() === name;
    if (!credited) continue;
    const list = byProjectId.get(permit.project_id) ?? [];
    list.push(permit);
    byProjectId.set(permit.project_id, list);
  }

  // fix-226: pull in handed-off projects this DA co-owns but no longer appears on
  // (the from_da after a reassign). Their permit list is the project's full set.
  const daCoCredit = role === 'da' ? coCredit : undefined;
  if (daCoCredit) {
    const allByProject = new Map<string, PermitWithCycles[]>();
    for (const permit of permits) {
      const list = allByProject.get(permit.project_id) ?? [];
      list.push(permit);
      allByProject.set(permit.project_id, list);
    }
    for (const [projectId, das] of daCoCredit) {
      if (!das.has(name) || byProjectId.has(projectId)) continue;
      byProjectId.set(projectId, allByProject.get(projectId) ?? []);
    }
  }

  const rows: ProjectListRow[] = [];
  for (const [projectId, projectPermits] of byProjectId) {
    const project = projectsById.get(projectId);
    if (!project) continue;
    const types = Array.from(
      new Set(projectPermits.map((p) => p.type).filter((t): t is string => !!t)),
    ).sort();
    const stage = worstStage(projectPermits);
    const maxDate = (dates: (string | null | undefined)[]): string | null => {
      const valid = dates.filter(
        (d): d is string => typeof d === 'string' && d.trim() !== '',
      );
      if (valid.length === 0) return null;
      return valid.sort()[valid.length - 1];
    };
    rows.push({
      projectId,
      address: project.address,
      juris: project.juris ?? '',
      types,
      stage,
      goDate: project.go_date ?? null,
      targetSubmit: maxDate(projectPermits.map((p) => p.target_submit)),
      approvalDate: maxDate(projectPermits.map((p) => p.approval_date)),
      isRedesign: !!project.redesign_of_project_id,
      isShared: !!daCoCredit?.has(projectId),
    });
  }
  return rows;
}
