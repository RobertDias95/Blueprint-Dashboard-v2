import { Link, useParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { effectiveStage } from '../lib/permitStage';
import type { PermitCycle, PermitWithCycles, Stage } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';

// Q2: Read-only single-project view. Lists permits with their cycles +
// inline metadata. Q3 will add inline edits; Q4 will add tasks.

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

const STAGE_BADGE: Record<Stage, string> = {
  de: 'bg-de-bg text-de border-de-border',
  pm: 'bg-pm-bg text-pm border-pm-border',
  co: 'bg-co-bg text-co border-co-border',
  ap: 'bg-jv-bg text-jv border-jv-border',
  is: 'bg-is-bg text-is border-is-border',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectsQ = useProjects();
  const permitsQ = usePermitsByProject(id);

  if (projectsQ.error || permitsQ.error) {
    return (
      <QueryError
        title="Project detail failed to load"
        error={projectsQ.error ?? permitsQ.error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }

  const project = projectsQ.data?.find((p) => p.id === id);
  const isLoading = projectsQ.isLoading || permitsQ.isLoading;

  if (!isLoading && !project) {
    return (
      <div className="text-sm text-dim italic px-2 py-12 text-center">
        Project not found.{' '}
        <Link to="/projects" className="text-de underline">
          Back to project list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/projects"
          className="text-[11px] text-muted hover:text-text transition"
        >
          ← Project View
        </Link>
        <h1 className="text-xl font-display font-black text-text mt-1">
          {project?.address ?? '...'}
        </h1>
        <div className="text-[11px] text-muted font-mono mt-1">
          {project?.juris ?? '—'}
          {project?.notes && (
            <span className="ml-2 text-dim">· {project.notes}</span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-xs font-display font-extrabold uppercase tracking-wide text-text mb-3">
          Permits
        </h2>
        {isLoading ? (
          <SkeletonRows count={3} rowClassName="h-24" />
        ) : (permitsQ.data ?? []).length === 0 ? (
          <div className="text-sm text-dim italic px-2 py-6 text-center bg-surface border border-border rounded-xl">
            No permits on this project yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(permitsQ.data ?? []).map((permit) => (
              <PermitDetailRow key={permit.id} permit={permit} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PermitDetailRow({ permit }: { permit: PermitWithCycles }) {
  const cycles = permit.permit_cycles ?? [];
  const stage = effectiveStage(permit, cycles);

  return (
    <article className="bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-display font-bold text-text">
            {permit.type ?? '—'}
            {permit.num && (
              <span className="ml-2 font-mono text-xs text-muted">{permit.num}</span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-1">
            {[permit.ent_lead, permit.da, permit.dual_da, permit.dm]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wide uppercase ${STAGE_BADGE[stage]}`}
        >
          {STAGE_LABEL[stage]}
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 text-[10px]">
        <Field label="Target Submit" value={permit.target_submit} />
        <Field label="DD Start" value={permit.dd_start} />
        <Field label="Approval" value={permit.approval_date} />
        <Field label="Issued" value={permit.actual_issue} />
      </div>

      {cycles.length > 0 && <CycleTable cycles={cycles} />}
    </article>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-dim uppercase tracking-wide text-[9px]">{label}</div>
      <div className="font-mono text-text mt-0.5">{value || '—'}</div>
    </div>
  );
}

function CycleTable({ cycles }: { cycles: PermitCycle[] }) {
  const sorted = [...cycles].sort((a, b) => a.cycle_index - b.cycle_index);
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="text-[10px] text-dim uppercase tracking-wide mb-2">
        Cycles
      </div>
      <table className="w-full text-[10px]">
        <thead className="text-dim">
          <tr>
            <th className="text-left font-normal pb-1">#</th>
            <th className="text-left font-normal pb-1">Submitted</th>
            <th className="text-left font-normal pb-1">City Target</th>
            <th className="text-left font-normal pb-1">Corr. Out</th>
            <th className="text-left font-normal pb-1">Resubmitted</th>
            <th className="text-left font-normal pb-1">Intake Acc.</th>
          </tr>
        </thead>
        <tbody className="font-mono text-text">
          {sorted.map((c) => (
            <tr key={c.id} className="border-t border-border/50">
              <td className="py-1">{c.cycle_index}</td>
              <td className="py-1">{c.submitted ?? '—'}</td>
              <td className="py-1">{c.city_target ?? '—'}</td>
              <td className="py-1">{c.corr_issued ?? '—'}</td>
              <td className="py-1">{c.resubmitted ?? '—'}</td>
              <td className="py-1">{c.intake_accepted ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
