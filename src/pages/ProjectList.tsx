import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { effectiveStage } from '../lib/permitStage';
import type { Project } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';

// Q2: Project View landing — searchable list of every non-archived project,
// with permit count + dominant stage badge. Clicking a row navigates to
// /project/:id. Replicates v1's renderProjectViewLanding (line 1877+).

const STAGE_ORDER = ['de', 'pm', 'co', 'ap', 'is'] as const;
const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

export default function ProjectList() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const [search, setSearch] = useState('');
  const [jurisFilter, setJurisFilter] = useState('');

  const isLoading = projectsQ.isLoading || permitsQ.isLoading;
  const error = projectsQ.error ?? permitsQ.error;

  const rows = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const permits = permitsQ.data ?? [];

    const stageByProject = new Map<string, Map<string, number>>();
    for (const p of permits) {
      const stage = effectiveStage(p, p.permit_cycles ?? []);
      const m = stageByProject.get(p.project_id) ?? new Map();
      m.set(stage, (m.get(stage) ?? 0) + 1);
      stageByProject.set(p.project_id, m);
    }

    const tokens = search.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const matches = (project: Project) => {
      if (jurisFilter && (project.juris ?? '') !== jurisFilter) return false;
      if (!tokens.length) return true;
      const haystack = `${project.address} ${project.juris ?? ''} ${
        project.notes ?? ''
      }`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    };

    return projects.filter(matches).map((project) => {
      const stages = stageByProject.get(project.id) ?? new Map();
      const dominant = STAGE_ORDER.find((s) => stages.has(s));
      const totalPermits = Array.from(stages.values()).reduce(
        (a, b) => a + b,
        0,
      );
      return { project, dominant, totalPermits };
    });
  }, [projectsQ.data, permitsQ.data, search, jurisFilter]);

  const jurisOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projectsQ.data ?? []) if (p.juris) set.add(p.juris);
    return Array.from(set).sort();
  }, [projectsQ.data]);

  if (error) {
    return (
      <QueryError
        title="Project list failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="flex-1 min-w-[220px] max-w-[360px] bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        />
        <select
          value={jurisFilter}
          onChange={(e) => setJurisFilter(e.target.value)}
          className="bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text focus:outline-none focus:border-de"
        >
          <option value="">All jurisdictions</option>
          {jurisOptions.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted font-mono ml-auto">
          {rows.length} project{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <SkeletonRows count={6} rowClassName="h-14" />
      ) : rows.length === 0 ? (
        <div className="text-sm text-dim italic px-2 py-12 text-center">
          No projects match the current filters.
        </div>
      ) : (
        <ul
          className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden"
          data-testid="project-list"
        >
          {rows.map(({ project, dominant, totalPermits }) => (
            <li key={project.id}>
              <Link
                to={`/project/${project.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-s2 transition"
                data-testid="project-list-item"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-display font-bold text-text truncate">
                    {project.address}
                  </div>
                  <div className="text-[10px] text-muted font-mono truncate">
                    {project.juris ?? '—'}
                  </div>
                </div>
                <span className="text-[10px] text-dim font-mono">
                  {totalPermits} permit{totalPermits === 1 ? '' : 's'}
                </span>
                {dominant && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-s2 text-text font-semibold tracking-wide uppercase">
                    {STAGE_LABEL[dominant]}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
