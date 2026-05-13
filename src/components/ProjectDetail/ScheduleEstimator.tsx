import { useMemo } from 'react';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import {
  computeLearnedSchedule,
  type LearnedEstimate,
} from '../../lib/scheduleBenchmarks';
import {
  computeProjectedApproval,
  type ProjectedApprovalResult,
} from '../../lib/projectedApproval';
import type { PermitCycle, PermitWithCycles } from '../../lib/database.types';

// Q9.5.f-fix-11 C: Schedule Estimator widget. Read-only port of v1's
// buildScheduleEstimator (index.html:4544-4660). Renders inside the
// PermitDetailV2 sidebar between Cycle History and Issue Dates. Shows:
//   - The headline estimated approval (same value as Estimated Approval
//     on the schedule health table)
//   - Per-round projected dates (corr issued + resubmitted for each
//     cycle the walk targets), with visual cue when sourced from real
//     cycle data vs derived
//   - ULS anchor block when permit.type === 'ULS' (BP anchor, cy1 resub,
//     target submit, est approval)
//   - Note about the projection source (target cycle reached / holistic
//     shortcut taken / ULS path)
//
// Override-edit deferred — read-only first pass per Bobby's request.

interface Props {
  permit: PermitWithCycles;
}

export default function ScheduleEstimator({ permit }: Props) {
  const allPermitsQ = usePermits();
  const projectsQ = useProjects();
  const updatePermit = useUpdatePermit();

  // Q9.5.f-fix-16 B: read the manual override (if any) from extras.
  const extras = (permit.extras ?? {}) as Record<string, unknown>;
  const rawOverride = extras.scheduleCycleOverride;
  const cycleOverride =
    typeof rawOverride === 'number' && rawOverride >= 1 && rawOverride <= 4
      ? rawOverride
      : null;
  const projectsById = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
    [projectsQ.data],
  );
  const allPermits = allPermitsQ.data ?? [];

  const siblings = useMemo(
    () => allPermits.filter((p) => p.project_id === permit.project_id),
    [allPermits, permit.project_id],
  );
  const siblingCyclesByPermitId = useMemo(() => {
    const m = new Map<number, PermitCycle[]>();
    for (const s of siblings) m.set(s.id, s.permit_cycles ?? []);
    return m;
  }, [siblings]);

  const projectJuris = projectsById.get(permit.project_id)?.juris ?? '';

  const learnedEstimate = useMemo(() => {
    if (!permit.type || !projectJuris) return null;
    return computeLearnedSchedule(
      allPermits,
      permit.type,
      projectJuris,
      projectsById,
    );
  }, [allPermits, permit.type, projectJuris, projectsById]);

  const siblingLearnedByPermitId = useMemo(() => {
    const m = new Map<number, LearnedEstimate | null>();
    for (const s of siblings) {
      if (!s.type || !projectJuris) {
        m.set(s.id, null);
        continue;
      }
      m.set(
        s.id,
        computeLearnedSchedule(allPermits, s.type, projectJuris, projectsById),
      );
    }
    return m;
  }, [siblings, allPermits, projectJuris, projectsById]);

  const result: ProjectedApprovalResult = useMemo(
    () =>
      computeProjectedApproval({
        permit,
        cycles: (permit.permit_cycles ?? [])
          .filter((c) => c.cycle_index !== 0)
          .sort((a, b) => a.cycle_index - b.cycle_index),
        learnedEstimate,
        siblingPermits: siblings,
        siblingCyclesByPermitId,
        siblingLearnedByPermitId,
        targetCycleOverride: cycleOverride,
      }),
    [permit, learnedEstimate, siblings, siblingCyclesByPermitId, siblingLearnedByPermitId, cycleOverride],
  );

  function adjustOverride(delta: number) {
    if (!permit.updated_at) return;
    // Base = current effective target. If user has no override yet, start
    // from learner's pick (result.targetCycle), then bump.
    const base = cycleOverride ?? result.targetCycle ?? 1;
    const next = Math.max(1, Math.min(4, base + delta));
    if (next === cycleOverride) return;
    const nextExtras = { ...extras, scheduleCycleOverride: next };
    updatePermit.mutate({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { extras: nextExtras },
      fieldLabel: 'scheduleCycleOverride',
    });
  }

  function clearOverride() {
    if (!permit.updated_at || cycleOverride === null) return;
    const nextExtras = { ...extras };
    delete (nextExtras as Record<string, unknown>).scheduleCycleOverride;
    updatePermit.mutate({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { extras: nextExtras },
      fieldLabel: 'scheduleCycleOverride',
    });
  }

  const cycles = (permit.permit_cycles ?? [])
    .filter((c) => c.cycle_index !== 0)
    .sort((a, b) => a.cycle_index - b.cycle_index);

  return (
    <div
      className="border rounded-lg overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
      data-testid="pd-v2-schedule-estimator"
    >
      <div
        className="px-3 py-1.5 border-b text-[10px] font-bold uppercase tracking-wide flex items-center justify-between gap-2"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span>Schedule Estimator</span>
        {result.targetCycle !== undefined && result.targetCycle > 0 && (
          <CycleAdjuster
            current={result.targetCycle}
            overridden={cycleOverride !== null}
            disabled={updatePermit.isPending || !permit.updated_at}
            onDec={() => adjustOverride(-1)}
            onInc={() => adjustOverride(+1)}
            onClear={clearOverride}
          />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <HeadlineProjection result={result} />
        {result.targetCycle === 0 && result.ulsAnchors && (
          <UlsAnchorBlock anchors={result.ulsAnchors} />
        )}
        {result.targetCycle !== undefined && result.targetCycle > 1 && (
          <PerRoundBlock result={result} cycles={cycles} />
        )}
        <SourceNote result={result} />
      </div>
    </div>
  );
}

function HeadlineProjection({ result }: { result: ProjectedApprovalResult }) {
  const label = result.isActual
    ? 'Actual / Approved'
    : result.isProjected
      ? 'Estimated Approval'
      : 'Projection';
  const color = result.isActual ? 'var(--color-is)' : 'var(--color-pm)';
  return (
    <div>
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
      </div>
      <div
        className="text-sm font-mono font-bold mt-0.5"
        style={{ color }}
      >
        {result.projection ?? '—'}
      </div>
    </div>
  );
}

function UlsAnchorBlock({
  anchors,
}: {
  anchors: NonNullable<ProjectedApprovalResult['ulsAnchors']>;
}) {
  return (
    <div
      className="p-2 rounded border text-[10px] flex flex-col gap-1"
      style={{
        background: 'var(--color-de-bg)',
        borderColor: 'var(--color-de-border)',
      }}
    >
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-de)' }}
      >
        ULS — BP Anchor Path
      </div>
      <AnchorRow label="BP Issue Anchor" value={anchors.bpIssueAnchor} />
      <AnchorRow label="BP Cy1 Resubmit" value={anchors.cy1Resub} />
      <AnchorRow label="ULS Target Submit" value={anchors.targetSubmit} />
      <AnchorRow label="+ 120-day lag" value={anchors.estApproval} />
    </div>
  );
}

function AnchorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--color-text)' }}>
        {value || '—'}
      </span>
    </div>
  );
}

function PerRoundBlock({
  result,
  cycles,
}: {
  result: ProjectedApprovalResult;
  cycles: PermitCycle[];
}) {
  const target = result.targetCycle ?? 0;
  if (target <= 1 || !result.rounds) return null;
  const rounds = result.rounds;
  const items: { label: string; date: string | undefined; isReal: boolean }[] = [];
  for (let i = 1; i < target; i++) {
    const ciKey = `corrIssued${i}` as keyof typeof rounds;
    const rsKey = `resubmitted${i}` as keyof typeof rounds;
    const ciDate = rounds[ciKey];
    const rsDate = rounds[rsKey];
    const realCycle = cycles.find((c) => c.cycle_index === i);
    items.push({
      label: `Cy${i} Corr. Issued`,
      date: ciDate,
      isReal: !!realCycle?.corr_issued,
    });
    items.push({
      label: `Cy${i} Resubmitted`,
      date: rsDate,
      isReal: !!realCycle?.resubmitted,
    });
  }
  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        Per-Round Walk (Target: Cycle {target})
      </div>
      {items.map((it) => (
        <div
          key={it.label}
          className="flex items-baseline justify-between gap-2"
        >
          <span style={{ color: 'var(--color-muted)' }}>
            {it.label}
            {it.isReal && (
              <span
                className="ml-1 text-[8px] font-bold"
                style={{ color: 'var(--color-pm)' }}
                title="From real cycle data"
              >
                ✓
              </span>
            )}
          </span>
          <span
            className="font-mono"
            style={{
              color: it.isReal ? 'var(--color-pm)' : 'var(--color-text)',
              fontStyle: it.isReal ? 'normal' : 'italic',
            }}
          >
            {it.date ?? '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function CycleAdjuster({
  current,
  overridden,
  disabled,
  onDec,
  onInc,
  onClear,
}: {
  current: number;
  overridden: boolean;
  disabled: boolean;
  onDec: () => void;
  onInc: () => void;
  onClear: () => void;
}) {
  return (
    <span className="flex items-center gap-1 normal-case tracking-normal">
      <button
        type="button"
        onClick={onDec}
        disabled={disabled || current <= 1}
        className="w-4 h-4 rounded border text-[10px] font-bold flex items-center justify-center disabled:opacity-30"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
        title="Project one fewer cycle"
      >
        −
      </button>
      <span
        className="text-[10px] font-mono font-bold w-4 text-center"
        style={{
          color: overridden ? 'var(--color-pm)' : 'var(--color-text)',
        }}
        title={overridden ? 'Manual override — click ✕ to clear' : 'Learner pick'}
      >
        {current}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={disabled || current >= 4}
        className="w-4 h-4 rounded border text-[10px] font-bold flex items-center justify-center disabled:opacity-30"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
        title="Project one more cycle"
      >
        +
      </button>
      {overridden && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="w-4 h-4 text-[10px] flex items-center justify-center disabled:opacity-30"
          style={{ color: 'var(--color-dim)' }}
          title="Clear override"
        >
          ✕
        </button>
      )}
    </span>
  );
}

function SourceNote({ result }: { result: ProjectedApprovalResult }) {
  if (result.isActual) return null;
  if (!result.isProjected) {
    return (
      <div
        className="text-[9px] italic"
        style={{ color: 'var(--color-dim)' }}
      >
        Not enough data to project — set GO date, target submit, or cycle 1
        submitted to seed the estimator.
      </div>
    );
  }
  if (result.targetCycle === 0) {
    return (
      <div
        className="text-[9px] italic"
        style={{ color: 'var(--color-dim)' }}
      >
        ULS anchored to sibling Building Permit's expected issue + 120 days.
      </div>
    );
  }
  if (result.targetCycle === 1) {
    return (
      <div
        className="text-[9px] italic"
        style={{ color: 'var(--color-dim)' }}
      >
        Holistic projection — learner expects approval in the first review
        with no corrections.
      </div>
    );
  }
  return (
    <div
      className="text-[9px] italic"
      style={{ color: 'var(--color-dim)' }}
    >
      Walked {(result.targetCycle ?? 1) - 1} correction round
      {result.targetCycle === 2 ? '' : 's'} + final review buffer. Italic
      values are derived; ✓ marks real cycle data.
    </div>
  );
}
