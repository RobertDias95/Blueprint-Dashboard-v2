import { useMemo } from 'react';
import { effectiveStage } from '../../lib/permitStage';
import { useAllPermitCycleReviewers } from '../../hooks/useAllPermitCycleReviewers';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { usePermitTypeDefaults } from '../../hooks/usePermitTypeDefaults';
import { computeLearnedSchedule, type LearnedEstimate } from '../../lib/scheduleBenchmarks';
import { computeProjectedApproval } from '../../lib/projectedApproval';
import { derivePermitStatus } from '../../lib/permitStatus';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Stage,
} from '../../lib/database.types';
import ReviewerRollupChip from './ReviewerRollupChip';

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
  // fix-31: swap the placeholder "tasks" column for a reviewer rollup
  // chip backed by permit_cycle_reviewers. The hook returns every
  // reviewer row in the tenant scope; we index by permit_id below.
  const reviewersQ = useAllPermitCycleReviewers();
  // Q9.5.f-fix-10: cross-tenant permits + projects feed computeLearnedSchedule
  // for the (type, juris) baseline. Hooks are tenant-scoped via RLS so no
  // extra plumbing needed.
  const allPermitsQ = usePermits();
  const projectsQ = useProjects();
  const typeDefaultsQ = usePermitTypeDefaults();
  const projectsById = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
    [projectsQ.data],
  );
  const reviewersByPermit = useMemo(() => {
    const m = new Map<number, PermitCycleReviewer[]>();
    for (const r of reviewersQ.data ?? []) {
      const list = m.get(r.permit_id) ?? [];
      list.push(r);
      m.set(r.permit_id, list);
    }
    return m;
  }, [reviewersQ.data]);

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
          <col style={{ width: 120 }} />
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
            <Th>Reviewers</Th>
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
              reviewers={reviewersByPermit.get(p.id) ?? []}
              allPermits={allPermitsQ.data ?? []}
              projectsById={projectsById}
              typeDefaultsOverride={typeDefaultsQ.byType}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  permit,
  reviewers,
  allPermits,
  projectsById,
  typeDefaultsOverride,
}: {
  permit: PermitWithCycles;
  reviewers: PermitCycleReviewer[];
  allPermits: PermitWithCycles[];
  projectsById: Map<string, import('../../lib/database.types').Project>;
  typeDefaultsOverride: Map<string, number>;
}) {
  const stage = effectiveStage(permit, permit.permit_cycles ?? []);
  // fix-31: legacy fallback display for permit types whose adapter
  // doesn't yet capture per-reviewer rows (PA / IPR / SPU / Land Use /
  // MBP / Redmond). The scraper still observes a "latest_reviewer"
  // name via extras for those — surface it so the column isn't blank.
  const extrasObj = (permit.extras ?? {}) as Record<string, unknown>;
  const fallbackReviewer =
    typeof extrasObj.latest_reviewer === 'string' &&
    extrasObj.latest_reviewer.trim()
      ? (extrasObj.latest_reviewer as string)
      : null;
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
  const projectGoDate = projectsById.get(permit.project_id)?.go_date ?? null;
  const projectedResult = useMemo(
    () =>
      computeProjectedApproval({
        permit,
        cycles: (permit.permit_cycles ?? [])
          .filter((c) => c.cycle_index !== 0)
          .sort((a, b) => a.cycle_index - b.cycle_index),
        learnedEstimate,
        projectGoDate,
        siblingPermits: siblings,
        siblingCyclesByPermitId,
        siblingLearnedByPermitId,
        targetCycleOverride: cycleOverride,
        typeDefaultsOverride,
        // fix-32: reviewers on this permit feed the corrections-cycle
        // prediction. Already loaded above for the chip rollup — reuse.
        permitReviewers: reviewers,
      }),
    [permit, learnedEstimate, projectGoDate, siblings, siblingCyclesByPermitId, siblingLearnedByPermitId, cycleOverride, typeDefaultsOverride, reviewers],
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
      {/* 2. Reviewers — fix-31 rollup chip (replaces the pre-fix-31
          "tasks" placeholder column). Shows N · approved · corrections
          · in-review for the latest cycle's reviewers; click opens
          a side popover with the full list. Falls back to the legacy
          permits.extras.latest_reviewer single-name display when the
          permit's adapter hasn't done per-reviewer extraction yet. */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <ReviewerRollupChip
          permitId={permit.id}
          rows={reviewers}
          fallbackReviewer={fallbackReviewer}
          permitStatus={permit.status}
        />
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
      {/* 4. Permit Status — fix-25e: derived from cycle state when there's
          any progress, falls back to stored permits.status otherwise. */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px]"
        style={borderL}
        data-testid={`schedule-health-status-${permit.id}`}
      >
        {(() => {
          const status = derivePermitStatus(permit);
          return (
            <div>
              <div className="text-text">{status.label}</div>
              {status.date && (
                <div className="text-[9px] text-dim mt-0.5 font-mono">
                  {fmtDate(status.date)}
                </div>
              )}
            </div>
          );
        })()}
      </td>
      {/* 5. Data Source */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <DataSourceBadge estimate={learnedEstimate} />
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

function DataSourceBadge({ estimate }: { estimate: LearnedEstimate | null }) {
  // fix-25-feat-g-badge: the badge was hardcoded "Default" from the
  // pre-fix-24i era when the learner hadn't shipped yet. Now that the
  // learner runs on every row, branch on whether it produced an
  // estimate — null means we genuinely fell back to defaultDaysForType,
  // non-null means at least one approved permit in this (type, juris)
  // scope (or in the cross-juris pool) is feeding the projection.
  if (!estimate) {
    return (
      <span
        className="text-[8px] font-bold px-2 py-0.5 rounded border"
        style={{
          background: 'var(--color-s2)',
          color: 'var(--color-dim)',
          borderColor: 'var(--color-border)',
        }}
        title="No approved permits available for this type/jurisdiction — using per-type default"
      >
        Default
      </span>
    );
  }
  const crossJurisMark = estimate.isCrossJuris ? ' *' : '';
  return (
    <span
      className="text-[8px] font-bold px-2 py-0.5 rounded border"
      style={{
        background: 'var(--color-pm-bg)',
        color: 'var(--color-pm)',
        borderColor: 'var(--color-pm-border)',
      }}
      title={`${estimate.source} · ${estimate.sampleCount} sample${estimate.sampleCount === 1 ? '' : 's'}${
        estimate.dateRange ? ` (${estimate.dateRange})` : ''
      }`}
    >
      Learned ({estimate.sampleCount}
      {crossJurisMark})
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
