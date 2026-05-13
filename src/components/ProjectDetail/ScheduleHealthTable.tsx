import { useMemo } from 'react';
import { effectiveStage } from '../../lib/permitStage';
import { useAllPermitTasks } from '../../hooks/useAllPermitTasks';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { computeLearnedSchedule } from '../../lib/scheduleBenchmarks';
import { computeProjectedApproval } from '../../lib/projectedApproval';
import type { PermitCycle, PermitTask, PermitWithCycles, Stage } from '../../lib/database.types';

// Q9.5.e-fix-4: 8-column Schedule Health table per v1 §4.2.1 (B) and the
// _healthRow / _healthRowShell render at index.html:3646-3678. Columns:
//   1. Permit Type
//   2. Tasks — % done progress bar (open vs resolved+skipped)
//   3. Stage — colored badge
//   4. Permit Status — free-text from permits.status
//   5. Data Source — Default / Learned badge (v2 always shows Default until
//      the learner state ports — Q7+ backlog)
//   6. Estimated Approval — actual_issue / approval_date / expected_issue
//   7. ACQ Target — placeholder until task #63 unblocks acq target schema
//   8. Schedule Health — bucket based on (projection - target):
//        diff ≤ -1  → "↑ On Track"   (green / --color-pm)
//        diff ≤ 14  → "→ At Risk"     (yellow / --color-co)
//        diff > 14  → "↓ Behind"      (red)
//        either date missing → "→ In Progress" (blue placeholder)
//
// Mirrors v1's `_healthStatusParts` predicate at index.html:3623-3631.

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

const STAGE_TINT: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

interface Props {
  permits: PermitWithCycles[];
}

export default function ScheduleHealthTable({ permits }: Props) {
  const tasksQ = useAllPermitTasks();
  // Q9.5.f-fix-10: cross-tenant permits + projects feed computeLearnedSchedule
  // for the (type, juris) baseline. Hooks are tenant-scoped via RLS so no
  // extra plumbing needed.
  const allPermitsQ = usePermits();
  const projectsQ = useProjects();
  const projectsById = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
    [projectsQ.data],
  );
  const tasksByPermit = useMemo(() => {
    const m = new Map<number, PermitTask[]>();
    for (const t of tasksQ.data ?? []) {
      const list = m.get(t.permit_id) ?? [];
      list.push(t);
      m.set(t.permit_id, list);
    }
    return m;
  }, [tasksQ.data]);

  if (permits.length === 0) {
    return (
      <div className="text-xs text-dim italic px-3 py-3.5">
        No permits on this project. Add one in the Settings modal.
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 border-b border-border bg-surface"
      data-testid="schedule-health-table"
    >
      <div className="text-center pt-1.5 pb-0.5">
        <div className="text-xs font-extrabold text-text uppercase tracking-wider">
          Schedule Health
        </div>
      </div>
      <table className="w-full border-collapse mt-1.5 text-[10px]">
        <colgroup>
          <col style={{ width: 140 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
        </colgroup>
        <thead>
          <tr
            className="border-b-2"
            style={{
              background: 'var(--color-s2)',
              borderBottomColor: 'var(--color-border)',
            }}
          >
            <Th align="left">Permit Type</Th>
            <Th>Tasks</Th>
            <Th>Stage</Th>
            <Th>Permit Status</Th>
            <Th>Data Source</Th>
            <Th>Estimated Approval</Th>
            <Th>ACQ Target</Th>
            <Th>Schedule Health</Th>
          </tr>
        </thead>
        <tbody>
          {permits.map((p) => (
            <Row
              key={p.id}
              permit={p}
              tasks={tasksByPermit.get(p.id) ?? []}
              allPermits={allPermitsQ.data ?? []}
              projectsById={projectsById}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  permit,
  tasks,
  allPermits,
  projectsById,
}: {
  permit: PermitWithCycles;
  tasks: PermitTask[];
  allPermits: PermitWithCycles[];
  projectsById: Map<string, import('../../lib/database.types').Project>;
}) {
  const stage = effectiveStage(permit, permit.permit_cycles ?? []);
  const taskStats = computeTaskStats(tasks);
  // Q9.5.f-fix-10: walk-forward projection per v1 :8068-8092. Learned
  // baseline from cross-tenant (type, juris) approved permits; fallback
  // to SCHEDULE_DEFAULTS when no historical data exists. Real outcomes
  // (actual_issue / approval_date) short-circuit the projection.
  const projectsByIdRef = projectsById;
  const learnedEstimate = useMemo(() => {
    const juris = projectsById.get(permit.project_id)?.juris ?? '';
    if (!permit.type || !juris) return null;
    return computeLearnedSchedule(
      allPermits,
      permit.type,
      juris,
      projectsByIdRef,
    );
  }, [allPermits, permit.type, permit.project_id, projectsByIdRef, projectsById]);
  // Q9.5.f-fix-11: ULS branch needs sibling permits + their cycles +
  // per-permit learned data to compute the BP-anchor formula. Scope to
  // the same project — that's where v1 looks for the BP.
  const siblings = useMemo(
    () => allPermits.filter((p) => p.project_id === permit.project_id),
    [allPermits, permit.project_id],
  );
  const siblingCyclesByPermitId = useMemo(() => {
    const m = new Map<number, PermitCycle[]>();
    for (const s of siblings) m.set(s.id, s.permit_cycles ?? []);
    return m;
  }, [siblings]);
  const siblingLearnedByPermitId = useMemo(() => {
    const m = new Map<number, import('../../lib/scheduleBenchmarks').LearnedEstimate | null>();
    const juris = projectsById.get(permit.project_id)?.juris ?? '';
    for (const s of siblings) {
      if (!s.type || !juris) {
        m.set(s.id, null);
        continue;
      }
      m.set(s.id, computeLearnedSchedule(allPermits, s.type, juris, projectsByIdRef));
    }
    return m;
  }, [siblings, allPermits, permit.project_id, projectsById, projectsByIdRef]);
  // Q9.5.f-fix-17 A: bidirectional cycle override. ScheduleEstimator
  // writes the user's +/- pick to permit.extras.scheduleCycleOverride;
  // this row reads it back so both widgets project the same date.
  const extras = (permit.extras ?? {}) as Record<string, unknown>;
  const rawOverride = extras.scheduleCycleOverride;
  const cycleOverride =
    typeof rawOverride === 'number' && rawOverride >= 1 && rawOverride <= 4
      ? rawOverride
      : null;
  const projectedResult = useMemo(
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
  const projection = projectedResult.projection;
  const isActual = projectedResult.isActual;
  // Q9.5.f-fix-7: wire ACQ Target to permits.expected_issue. v1 writes the
  // team's target issue date here, so v2 reads it. Estimated Approval at
  // :120 already prefers actual_issue/approval_date over expected_issue,
  // so the two columns diverge once a permit is issued — ACQ Target stays
  // as the team's plan; Estimated Approval reflects the actual outcome.
  const acqTarget: string | null = permit.expected_issue ?? null;
  const diff = computeHealthDiff(projection, acqTarget);

  const borderL = { borderLeftColor: 'var(--color-border)' } as const;

  return (
    <tr
      className="border-b last:border-b-0"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid={`schedule-health-row-${permit.id}`}
    >
      {/* 1. Permit Type */}
      <td className="px-3 py-2 align-middle text-[11px] text-text truncate">
        {permit.type ?? '—'}
        {permit.num && (
          <span className="ml-2 text-[9px] text-muted font-mono">
            {permit.num}
          </span>
        )}
      </td>
      {/* 2. Tasks — progress bar */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <TaskProgress stats={taskStats} />
      </td>
      {/* 3. Stage */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: STAGE_TINT[stage] }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </td>
      {/* 4. Permit Status */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px]"
        style={borderL}
      >
        {permit.status ? (
          <span className="text-text">{permit.status}</span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      {/* 5. Data Source */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <DataSourceBadge />
      </td>
      {/* 6. Estimated Approval */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px] font-mono"
        style={borderL}
      >
        {projection ? (
          <div>
            <div className="text-text font-bold">{fmtDate(projection)}</div>
            <div className="text-[9px] text-dim mt-0.5 font-sans">
              {isActual ? 'Actual' : 'Est. Approval'}
            </div>
          </div>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      {/* 7. ACQ Target */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px] font-mono"
        style={borderL}
      >
        {acqTarget ? (
          <span className="text-text font-bold">{fmtDate(acqTarget)}</span>
        ) : (
          <span className="text-dim italic" title="ACQ target — task #63 backlog">
            —
          </span>
        )}
      </td>
      {/* 8. Schedule Health */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <HealthBadge diff={diff} />
      </td>
    </tr>
  );
}

function Th({
  children,
  align = 'center',
}: {
  children: React.ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <th
      className={`px-2 py-1.5 text-[9px] font-extrabold text-text uppercase tracking-wider border-l first:border-l-0 ${
        align === 'left' ? 'text-left' : 'text-center'
      }`}
      style={{ borderLeftColor: 'var(--color-border)' }}
    >
      {children}
    </th>
  );
}

// ============================================================
// Sub-components & helpers
// ============================================================

interface TaskStats {
  total: number;
  done: number;
  percent: number;
}

function computeTaskStats(tasks: PermitTask[]): TaskStats {
  if (tasks.length === 0) return { total: 0, done: 0, percent: 0 };
  let done = 0;
  for (const t of tasks) {
    if (t.done) {
      done++;
      continue;
    }
    if (t.completion_status === 'Resolved' || t.completion_status === 'Skipped') {
      done++;
    }
  }
  return {
    total: tasks.length,
    done,
    percent: Math.round((done / tasks.length) * 100),
  };
}

function TaskProgress({ stats }: { stats: TaskStats }) {
  if (stats.total === 0) {
    return <span className="text-[9px] text-dim italic">no tasks</span>;
  }
  const colored = stats.percent === 100 ? 'var(--color-pm)' : 'var(--color-de)';
  return (
    <div className="flex flex-col gap-0.5 items-center">
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] font-bold text-text">{stats.percent}%</span>
        <span className="text-[8px] text-dim font-mono">
          {stats.done}/{stats.total}
        </span>
      </div>
      <div
        className="w-full h-1 rounded-full overflow-hidden"
        style={{ background: 'var(--color-bg)' }}
      >
        <div
          className="h-full"
          style={{
            width: `${stats.percent}%`,
            background: colored,
            transition: 'width 0.2s',
          }}
        />
      </div>
    </div>
  );
}

function DataSourceBadge() {
  // v2 ships the "Default" branch; the v1 learner state hasn't been ported
  // (Q7+ backlog). Once it does, this component will read learned metadata
  // off the permit (avg cycles, source, sample count) and switch styling.
  return (
    <span
      className="text-[8px] font-bold px-2 py-0.5 rounded border"
      style={{
        background: 'var(--color-s2)',
        color: 'var(--color-dim)',
        borderColor: 'var(--color-border)',
      }}
      title="Default schedule — learner state not yet ported (Q7+ backlog)"
    >
      Default
    </span>
  );
}

interface HealthStatus {
  bg: string;
  fg: string;
  border: string;
  icon: string;
  label: string;
  daysTxt: string;
}

function healthParts(diff: number): HealthStatus {
  // Mirrors v1's _healthStatusParts at index.html:3623-3631.
  if (diff <= -1) {
    return {
      bg: 'rgba(16,185,129,.08)',
      fg: 'var(--color-pm)',
      border: 'var(--color-pm)',
      icon: '↑',
      label: 'On Track',
      daysTxt: `${Math.abs(diff)}d Ahead`,
    };
  }
  if (diff <= 14) {
    return {
      bg: 'rgba(245,158,11,.08)',
      fg: 'var(--color-co)',
      border: 'var(--color-co)',
      icon: '→',
      label: 'At Risk',
      daysTxt: diff === 0 ? 'On Target' : `${diff}d Behind`,
    };
  }
  return {
    bg: 'rgba(248,113,113,.08)',
    fg: '#dc2626',
    border: '#dc2626',
    icon: '↓',
    label: 'Behind',
    daysTxt: `${diff}d Behind`,
  };
}

function HealthBadge({ diff }: { diff: number | null }) {
  if (diff === null) {
    return (
      <span
        className="text-[9px] font-bold px-2 py-0.5 rounded border"
        style={{
          background: 'rgba(59,130,246,.08)',
          color: 'var(--color-pm)',
          borderColor: 'rgba(59,130,246,.3)',
        }}
        title="Schedule Health needs both an ACQ target and a current projection"
      >
        → In Progress
      </span>
    );
  }
  const s = healthParts(diff);
  return (
    <div className="flex flex-col gap-0.5 items-center">
      <span
        className="text-[9px] font-extrabold px-2 py-0.5 rounded border"
        style={{ background: s.bg, color: s.fg, borderColor: s.border }}
      >
        {s.icon} {s.label}
      </span>
      <span className="text-[9px] font-bold" style={{ color: s.fg }}>
        {s.daysTxt}
      </span>
    </div>
  );
}

function computeHealthDiff(
  projection: string | null,
  target: string | null,
): number | null {
  if (!projection || !target) return null;
  const p = new Date(projection + 'T12:00:00').getTime();
  const t = new Date(target + 'T12:00:00').getTime();
  if (Number.isNaN(p) || Number.isNaN(t)) return null;
  return Math.round((p - t) / (24 * 60 * 60 * 1000));
}

function fmtDate(iso: string): string {
  // Match v1's fmtDate convention: "Nov 14, 2025" — short month + day + year
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
