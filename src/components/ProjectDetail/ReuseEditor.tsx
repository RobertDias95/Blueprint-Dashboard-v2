import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { parseUnitTypes } from '../../lib/unitTypeNaming';
import ReuseSourcePicker, {
  type ReuseSource,
} from '../wizard/ReuseSourcePicker';
import type { Project } from '../../lib/database.types';

// fix-216: REUSE provenance + editor on the Project Overview (Proposal cell).
// Parallels the redesign lineage badge. Shows "Reuse of <address>" (links to the
// source) when set, plus a "Reused by N" indicator when OTHER projects were
// templated off this one. Set / change / clear the link later:
//   - SET/CHANGE copies the source's product_types + unit_types via
//     useUpdateProject (copy-once). If this project ALREADY has unit types we
//     confirm first so manual work isn't silently clobbered.
//   - CLEAR removes the LINK only — the current product_types + unit_types stay.
// One field (projects.reused_from_project_id) shared with the wizard + reports;
// no second store.

export default function ReuseEditor({
  project,
  allProjects,
}: {
  project: Project;
  allProjects: Project[];
}) {
  const update = useUpdateProject();
  const [picking, setPicking] = useState(false);

  const source = useMemo(
    () =>
      project.reused_from_project_id
        ? allProjects.find((p) => p.id === project.reused_from_project_id) ??
          null
        : null,
    [allProjects, project.reused_from_project_id],
  );

  // Provenance: projects templated OFF this one.
  const reusedByCount = useMemo(
    () => allProjects.filter((p) => p.reused_from_project_id === project.id).length,
    [allProjects, project.id],
  );

  function applySource(s: ReuseSource) {
    const hasUnits = parseUnitTypes(project.unit_types).length > 0;
    if (
      hasUnits &&
      !confirm(
        `Replace this project's product type + unit types with those from "${s.address}"? Your current units will be overwritten.`,
      )
    ) {
      return; // don't silently clobber — user declined
    }
    update.mutate({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at ?? '',
      patch: {
        reused_from_project_id: s.id,
        product_types: [...s.product_types],
        unit_types: s.unit_types.map((u) => ({ ...u })),
      },
      fieldLabel: 'Reuse source',
    });
    setPicking(false);
  }

  function clearLink() {
    update.mutate({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at ?? '',
      patch: { reused_from_project_id: null },
      fieldLabel: 'Reuse source',
    });
    setPicking(false);
  }

  return (
    <div className="flex flex-col gap-1" data-testid="pd-reuse-editor">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[9px] text-dim min-w-[36px]">Reuse</span>
        {source ? (
          <span
            className="inline-flex items-center gap-1"
            data-testid="pd-reuse-badge"
          >
            <Link
              to={`/project/${source.id}`}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-jv-bg text-jv border-jv-border hover:underline"
              data-testid="pd-reuse-source-link"
              title={`Templated off ${source.address}`}
            >
              ♻ Reuse of {source.address}
            </Link>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="text-[9px] text-dim hover:text-text"
              data-testid="pd-reuse-change"
            >
              change
            </button>
            <button
              type="button"
              onClick={clearLink}
              className="text-[9px] text-dim hover:text-co"
              data-testid="pd-reuse-clear"
            >
              clear
            </button>
          </span>
        ) : project.reused_from_project_id ? (
          // Link set but the source isn't in the loaded list (archived/removed).
          <span
            className="inline-flex items-center gap-1"
            data-testid="pd-reuse-badge"
          >
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-jv-bg text-jv border-jv-border">
              ♻ Reuse (source unavailable)
            </span>
            <button
              type="button"
              onClick={clearLink}
              className="text-[9px] text-dim hover:text-co"
              data-testid="pd-reuse-clear"
            >
              clear
            </button>
          </span>
        ) : picking ? null : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="text-[9px] text-de hover:underline"
            data-testid="pd-reuse-set"
          >
            + Reuse a plan
          </button>
        )}
        {reusedByCount > 0 && (
          <span
            className="text-[9px] text-dim"
            data-testid="pd-reused-by"
            title="Projects templated off this one"
          >
            · reused by {reusedByCount}
          </span>
        )}
      </div>
      {picking && (
        <div data-testid="pd-reuse-picker-wrap">
          <ReuseSourcePicker
            excludeProjectId={project.id}
            onSelect={applySource}
          />
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="text-[9px] text-dim hover:text-text mt-0.5"
            data-testid="pd-reuse-cancel"
          >
            cancel
          </button>
        </div>
      )}
    </div>
  );
}
