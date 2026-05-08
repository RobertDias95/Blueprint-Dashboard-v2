import { Link, useParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { useUpdatePermit } from '../hooks/useUpdatePermit';
import { effectiveStage } from '../lib/permitStage';
import type { Permit, PermitCycle, PermitWithCycles, Stage } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import EditableField from '../components/EditableField';

// Q3: Read + write — single-project view with inline editing for the
// permit-level fields the user listed (target_submit, dd_start, dd_end,
// expected_issue, da, dm, ent_lead, status, stage_override). Each save
// fires a row-level OCC mutation; only the edited permit gets touched.
//
// Cycles + tasks editing waits for Q4 (needs row-level RPCs server-side).

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

const STAGE_OVERRIDE_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'de', label: 'D&E' },
  { value: 'pm', label: 'Permitting' },
  { value: 'co', label: 'Corrections' },
  { value: 'ap', label: 'Approved' },
  { value: 'is', label: 'Issued' },
];

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
  const updateMutation = useUpdatePermit();

  const occToken = permit.updated_at;
  const occMissing = !occToken;

  function makeSaver<K extends keyof Permit>(field: K, label: string) {
    return async (next: string) => {
      if (occMissing || !occToken) return;
      await updateMutation.mutateAsync({
        permitId: permit.id,
        projectId: permit.project_id,
        expectedUpdatedAt: occToken,
        patch: { [field]: next === '' ? null : next } as Partial<Permit>,
        fieldLabel: label,
      });
    };
  }

  // Track which field is currently being saved so we can show the spinner
  // only on that field. Reading mutation.variables tells us what's in flight.
  const inFlight = updateMutation.isPending
    ? Object.keys(updateMutation.variables?.patch ?? {})[0]
    : null;
  const isFieldSaving = (field: keyof Permit) =>
    updateMutation.isPending && inFlight === field;

  return (
    <article className="bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-start gap-3 px-4 py-3 border-b border-border">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-display font-bold text-text">
            {permit.type ?? '—'}
            {permit.num && (
              <span className="ml-2 font-mono text-xs text-muted">
                {permit.num}
              </span>
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

      {occMissing && (
        <div className="px-4 py-2 bg-co-bg/40 border-b border-co-border text-[11px] text-co">
          Editing disabled — this permit has no updated_at token. Refresh and
          try again.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
        <EditableField
          kind="date"
          label="Target Submit"
          value={permit.target_submit}
          saving={isFieldSaving('target_submit')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('target_submit', 'Target Submit')}
          testId={`permit-${permit.id}-target_submit`}
        />
        <EditableField
          kind="date"
          label="DD Start"
          value={permit.dd_start}
          saving={isFieldSaving('dd_start')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('dd_start', 'DD Start')}
          testId={`permit-${permit.id}-dd_start`}
        />
        <EditableField
          kind="date"
          label="DD End"
          value={permit.dd_end}
          saving={isFieldSaving('dd_end')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('dd_end', 'DD End')}
          testId={`permit-${permit.id}-dd_end`}
        />
        <EditableField
          kind="date"
          label="Expected Issue"
          value={permit.expected_issue}
          saving={isFieldSaving('expected_issue')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('expected_issue', 'Expected Issue')}
          testId={`permit-${permit.id}-expected_issue`}
        />

        <EditableField
          kind="text"
          label="DA"
          value={permit.da}
          saving={isFieldSaving('da')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('da', 'DA')}
          testId={`permit-${permit.id}-da`}
        />
        <EditableField
          kind="text"
          label="DM"
          value={permit.dm}
          saving={isFieldSaving('dm')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('dm', 'DM')}
          testId={`permit-${permit.id}-dm`}
        />
        <EditableField
          kind="text"
          label="ENT Lead"
          value={permit.ent_lead}
          saving={isFieldSaving('ent_lead')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('ent_lead', 'ENT Lead')}
          testId={`permit-${permit.id}-ent_lead`}
        />
        <EditableField
          kind="text"
          label="Status"
          value={permit.status}
          saving={isFieldSaving('status')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('status', 'Status')}
          testId={`permit-${permit.id}-status`}
        />

        <EditableField
          kind="select"
          label="Stage Override"
          value={permit.stage_override ?? ''}
          options={STAGE_OVERRIDE_OPTIONS}
          saving={isFieldSaving('stage_override')}
          disabled={occMissing || updateMutation.isPending}
          onSave={makeSaver('stage_override', 'Stage')}
          testId={`permit-${permit.id}-stage_override`}
        />
      </div>

      {cycles.length > 0 && <CycleTable cycles={cycles} />}
    </article>
  );
}

function CycleTable({ cycles }: { cycles: PermitCycle[] }) {
  const sorted = [...cycles].sort((a, b) => a.cycle_index - b.cycle_index);
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="text-[10px] text-dim uppercase tracking-wide mb-2">
        Cycles <span className="opacity-60">(read-only — editing in Q4)</span>
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
