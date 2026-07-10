import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { effectiveStage } from '../../lib/permitStage';
import {
  intakeTargetGapDays,
  isIntakeTargetGapFlagged,
} from '../../lib/intakeHelpers';
import { queryKeys } from '../../lib/queryKeys';
import { useAuthStore } from '../../stores/authStore';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../../lib/permitHelpers';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { usePermitTasks } from '../../hooks/usePermitTasks';
import { useAllPermitCycleReviewers } from '../../hooks/useAllPermitCycleReviewers';
import {
  useUpsertPermitCycle,
  type CyclePatch,
  type DateField,
} from '../../hooks/useUpsertPermitCycle';
import { useDeletePermitCycle } from '../../hooks/useDeletePermitCycle';
import {
  CYCLE_MAX_DATE,
  CYCLE_MIN_DATE,
  validateCycleChain,
  validateYearRange,
  type CycleChainField,
} from '../../lib/cycleDateValidation';
// fix-70: v1-parity task system — discipline buckets, multi-assign, subtasks,
// status workflow. Replaces the old single-assignee TasksPanel.
import {
  usePermitTaskTree,
  useUpsertTask,
  useDeleteTask,
  useSetTaskAssignees,
} from '../../hooks/useTaskTree';
import { useTeamMembers, activeMemberNamesOf } from '../../hooks/useTeamMembers';
import { useDmDaGroups } from '../../hooks/useDmDaGroups';
import { findDmForDa } from '../wizard/dmRouting';
import {
  resolvePrimaryAssignee,
  type ResolutionContext,
  type PrimaryResolutionContext,
} from '../../lib/taskTeam';
import CoAssigneeEditor from '../CoAssigneeEditor';
import PrimaryAssigneeEditor from '../PrimaryAssigneeEditor';
import TaskDateField from '../TaskDateField';
import {
  nextCheckboxStatus,
  checkboxVisual,
  TASK_STATUS_OPTIONS,
} from '../../lib/taskStatus';
import type {
  Permit,
  PermitCycle,
  PermitWithCycles,
  Project,
  Stage,
  TaskNode,
} from '../../lib/database.types';
import { WAITING_ON_OPTIONS } from '../../lib/database.types';
import { useProjectExternalTeamBlob } from '../../hooks/useProjectExternalTeamBlob';
import BotBadge from '../shared/BotBadge';
import PendingScrapeChip from '../shared/PendingScrapeChip';
import { STAGE_LABEL } from '../../lib/stageLabel';
import { LandUsePhaseBadge } from './LandUsePhaseBadge';
import ScheduleEstimator from './ScheduleEstimator';

// Q9.5.e-fix-5: PermitDetailV2 rebuilds the v2 permit edit panel to match
// v1's _renderPermitDetail at index.html:4787. Visual blocks (top→bottom):
//   1. Header strip: stage badge + stage override select + status text input
//   2. Cycle tab bar: Design + Cycle 1 + Cycle 2 … (switches the date strip view)
//   3. Date strip: cycle-aware grid of editable date inputs
//        - Design: GO / Target Submit / DD Start / DD End / Intake Accepted
//        - Cycle N: Submitted / City Target / Corr. Issued / Resubmitted /
//                   Approval Date / Actual Issue
//   4. Body grid (left tasks / right sidebar 320px):
//        - Left: stage tabs (D&E / Permitting) + Entitlements + Architecture
//          task columns + Add row
//        - Right: status strip (Corr Round + Corrections) + Cycle History +
//          Issue Dates (ACQ Target / Approval / Actual)
//
// v2 simplifications vs v1:
//   - Schedule Estimator widget omitted (heavy, out of fix-5 scope)
//   - "▶ NOW" active-cell highlight not ported (visual flourish)
//   - Add Cycle / Delete Cycle handled by existing Cycles section (unchanged)

// fix-105: STAGE_LABEL is the shared map from src/lib/stageLabel.ts.
// The bg / dot / border-tint maps below stay local — they're per-surface
// styling concerns, not the stage → display-noun mapping.

const STAGE_BG: Record<Stage, string> = {
  de: 'var(--color-de-bg)',
  pm: 'var(--color-pm-bg)',
  co: 'var(--color-co-bg)',
  ap: 'var(--color-jv-bg)',
  is: 'var(--color-is-bg)',
};

const STAGE_FG: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

const STAGE_BORDER: Record<Stage, string> = {
  de: 'var(--color-de-border)',
  pm: 'var(--color-pm-border)',
  co: 'var(--color-co-border)',
  ap: 'var(--color-jv-border)',
  is: 'var(--color-is-border)',
};

const STAGE_OVERRIDE_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'de', label: 'D&E' },
  { value: 'pm', label: 'Permitting' },
  { value: 'co', label: 'Corrections' },
  { value: 'ap', label: 'Approved' },
  { value: 'is', label: 'Issued' },
];

interface Props {
  permit: PermitWithCycles;
  /** Q9.5.f-fix-8 B: parent passes the joined project so we can render
   *  juris-conditional UI (Seattle Intake row) without a second hook
   *  lookup inside this component. */
  project?: Project | null;
}

export default function PermitDetailV2({ permit, project }: Props) {
  // Q9.5.f-fix-6 A: drop cycle_index=0 rows. v2's review cycles start at 1;
  // index 0 is a legacy design-phase placeholder that should never surface
  // in the user-visible cycle list. (Production data was cleaned today —
  // 79 polluted cy0 rows had submitted=NULL'd — but the filter stays as a
  // belt-and-suspenders in case any sneak back via scraper or import.)
  const cycles = useMemo(
    () =>
      [...(permit.permit_cycles ?? [])]
        .filter((c) => c.cycle_index !== 0)
        .sort((a, b) => a.cycle_index - b.cycle_index),
    [permit.permit_cycles],
  );
  // fix-26: Design strip now reads/writes cycle_index = 0 (the design slot)
  // per Bobby's V1 model. Cycle 0 is the design phase; cycles 1+ are review
  // cycles. Pre-fix-26 frontends wrote Design data to cycle 1, so legacy
  // permits may have cycle 0 empty + cycle 1 with design-shape data — the
  // Design strip falls back to displaying cycle 1's submitted/intake when
  // cycle 0 lacks those fields. Writes always go to cycle 0 (lazy-creating
  // it if absent).
  const designCycle = useMemo(
    () =>
      (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0) ?? null,
    [permit.permit_cycles],
  );
  // fix-188: compute the stage with the CANONICAL inputs — the permit's FULL
  // cycles (incl. the design cycle 0) AND its reviewer rows — so the detail
  // pane's stage badge agrees with the Permits sidebar (fix-104) + Schedule
  // Health, both of which pass reviewers into effectiveStage. Pre-fix this used
  // effectiveStage(permit, cycles) with cycle 0 filtered out AND no reviewers,
  // so for an MPB (Pending/Applied) permit it fell through to computeStage and
  // could read "Corrections" off a cycle's corr_issued while an in-progress
  // reviewer should keep it under review — disagreeing with the other surfaces.
  const reviewersQ = useAllPermitCycleReviewers();
  const permitReviewers = useMemo(
    () => (reviewersQ.data ?? []).filter((r) => r.permit_id === permit.id),
    [reviewersQ.data, permit.id],
  );
  const stage = effectiveStage(
    permit,
    permit.permit_cycles ?? [],
    permitReviewers,
  );
  // Q9.5.f-fix-6 C: derive the permit's current phase + which cycle index
  // contains it. Drives both the initial viewed-cycle tab AND the date-
  // strip cell highlight.
  const currentPhase = useMemo(
    () => deriveCurrentPhase(permit, cycles, project?.go_date),
    [permit, cycles, project?.go_date],
  );
  // Cycle tab state. Index 0 = "Design" virtual tab (permit-level dates).
  // Real review cycles use their cycle_index value (1+) directly — no
  // array-position arithmetic, so non-contiguous indices (e.g. after a
  // cycle delete) display correctly.
  const [viewCycleIdx, setViewCycleIdx] = useState<number>(() => {
    if (currentPhase.cycleIndex !== null) return currentPhase.cycleIndex;
    if (stage === 'de') return 0;
    return cycles[cycles.length - 1]?.cycle_index ?? 0;
  });
  // fix-25d sub-issue 3 → fix-35 → fix-38: auto-advance the viewed cycle to
  // the NEWEST cycle whenever its index grows. Covers BOTH snap transitions:
  //   - intake_accepted on c0 → snap creates c1 → advance to c1
  //   - resubmitted on cN  → snap creates c(N+1) → advance to c(N+1)
  //
  // fix-35 had narrowed this to ONLY c0→c1 to stop the cluster-A calendar-
  // arrow explosion on 3056 PAR/Pre-Sub (rapid per-increment onChange commits
  // → snap → advance → write to the new cycle → repeat, 11 cycles in ~10s).
  // That guard is no longer needed: fix-25-DD made DateCell commit on
  // blur/Enter ONLY, so the cycles array grows solely on a DELIBERATE commit,
  // never on raw calendar navigation. The advance is driven by the cache
  // growing after a committed snap — not by keystrokes — so re-widening to all
  // cycles is safe. (Commit MUST stay blur/Enter-only; see DateCell.)
  //
  // prevNewestIdxRef is initialised to the mounted newest, and the component
  // is keyed by permit.id (remounts per permit), so a permit that loads
  // mid-stream at c3 does NOT auto-advance on mount — only an in-session
  // growth fires the bump.
  const prevNewestIdxRef = useRef<number | null>(
    cycles.length > 0 ? cycles[cycles.length - 1]?.cycle_index ?? null : null,
  );
  useEffect(() => {
    const newestIdx =
      cycles.length > 0
        ? cycles[cycles.length - 1]?.cycle_index ?? null
        : null;
    const prevNewest = prevNewestIdxRef.current;
    if (newestIdx !== null && newestIdx > (prevNewest ?? -1)) {
      setViewCycleIdx(newestIdx);
    }
    prevNewestIdxRef.current = newestIdx;
  }, [cycles]);

  return (
    <div className="flex flex-col gap-0 bg-surface" data-testid="permit-detail-v2">
      <HeaderStrip permit={permit} stage={stage} />
      <CycleTabBar
        cycles={cycles}
        viewIdx={viewCycleIdx}
        onSelect={setViewCycleIdx}
      />
      <EmptyCycleHint
        permit={permit}
        cycles={cycles}
        viewIdx={viewCycleIdx}
        onAfterDelete={(prevIdx) => setViewCycleIdx(prevIdx)}
      />
      <SeattleIntakeRow permit={permit} juris={project?.juris ?? null} />
      <DateStrip
        permit={permit}
        project={project}
        cycles={cycles}
        designCycle={designCycle}
        viewIdx={viewCycleIdx}
        currentPhase={currentPhase}
      />
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 320px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <TasksPanel
          permitId={permit.id}
          projectId={permit.project_id}
          // fix-224: the permit's DA lets each task resolve co-assignee role
          // tokens (design_associate / design_manager via dm_da_groups) to the
          // actual person for display.
          permitDa={permit.da}
          // fix-228: ent_lead + schematic designers complete the PRIMARY-owner
          // resolution context (Entitlements → ent_lead, Schematic Team →
          // schematic designer) so the primary selector resolves fully.
          permitEntLead={permit.ent_lead}
          projectSchematicDesigners={project?.schematic_designer ?? []}
          // fix-123: drive the D&E/Permitting phase tabs from c0 intake_accepted
          // (was c0.submitted pre-fix-123 — Bobby's spec calls out
          // intake_accepted as the v1 phase boundary). null → D&E,
          // non-null → Permitting; null↔non-null transitions auto-snap
          // even after a manual user toggle. Also threaded: whether ANY
          // active review cycle (cycle_index >= 1) is in corrections (no
          // resubmitted yet after a corr_issued), so the Permitting-phase
          // Add input can show "Add correction…" per Bobby's screenshot 1.
          c0IntakeAccepted={designCycle?.intake_accepted ?? null}
          inCorrections={cycles.some(
            (c) => c.cycle_index >= 1 && c.corr_issued && !c.resubmitted,
          )}
        />
        <Sidebar
          permit={permit}
          cycles={cycles}
          stage={stage}
          viewIdx={viewCycleIdx}
          onSelectCycle={setViewCycleIdx}
        />
      </div>
    </div>
  );
}

// ============================================================
// Header strip: stage badge + stage override select + status input
// ============================================================

function HeaderStrip({
  permit,
  stage,
}: {
  permit: PermitWithCycles;
  stage: Stage;
}) {
  const updateMutation = useUpdatePermit();
  const occMissing = !permit.updated_at;
  const [statusDraft, setStatusDraft] = useState(permit.status ?? '');

  async function commitField<K extends keyof Permit>(
    field: K,
    next: Permit[K],
    original: Permit[K],
    label: string,
  ) {
    if (!permit.updated_at) return;
    if (next === original) return;
    await updateMutation.mutateAsync({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { [field]: next } as Partial<Permit>,
      fieldLabel: label,
    });
  }

  const typeLabel =
    permit.type === 'Building Permit' && permit.nickname
      ? `${permit.type} — ${permit.nickname}`
      : permit.type ?? '—';

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border-b"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid="pd-v2-header"
    >
      <span
        className="text-[11px] font-bold px-2.5 py-1 rounded border whitespace-nowrap"
        style={{
          background: STAGE_BG[stage],
          color: STAGE_FG[stage],
          borderColor: STAGE_BORDER[stage],
        }}
      >
        {typeLabel}
      </span>
      <select
        value={permit.stage_override ?? ''}
        onChange={(e) =>
          void commitField(
            'stage_override',
            e.target.value === '' ? null : e.target.value,
            permit.stage_override,
            'Stage',
          )
        }
        disabled={occMissing || updateMutation.isPending}
        className="text-[11px] px-2 py-1 border rounded outline-none disabled:opacity-50"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-testid="pd-v2-stage-override"
      >
        {STAGE_OVERRIDE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === '' ? `Auto (${STAGE_LABEL[stage]})` : o.label}
          </option>
        ))}
      </select>
      {/* fix-169: land-use phase badge — only renders for *-LU permits. */}
      <LandUsePhaseBadge permit={permit} />
      <input
        type="text"
        value={statusDraft}
        placeholder="Status / notes…"
        onChange={(e) => setStatusDraft(e.target.value)}
        onBlur={() =>
          commitField('status', statusDraft || null, permit.status, 'Status')
        }
        disabled={occMissing}
        className="flex-1 min-w-0 text-[11px] px-2 py-1 border rounded outline-none disabled:opacity-50"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-testid="pd-v2-status"
      />
      {permit.num && (
        <span
          className="text-[10px] font-mono px-2 py-1 rounded border"
          style={{
            color: 'var(--color-muted)',
            borderColor: 'var(--color-border)',
            background: 'var(--color-s2)',
          }}
        >
          {permit.num}
        </span>
      )}
      {/* fix-159: pending-portal-change chip — surfaces when the scraper's
          manual-edit guard has been blocking a known portal status change. */}
      <PendingScrapeChip extras={permit.extras} permitId={permit.id} />
    </div>
  );
}

// ============================================================
// Q9.5.f-fix-8 B: Seattle intake row. Only renders for Building Permit
// or Demolition permits at Seattle juris (mirrors v1:3219-3228). Edits
// write to permits.intake_date — independent of cycle 1's submitted /
// intake_accepted (production data confirms the two diverge in ~85% of
// cases; v1 keeps them separate too).
// ============================================================

function SeattleIntakeRow({
  permit,
  juris,
}: {
  permit: PermitWithCycles;
  juris: string | null;
}) {
  const updateMutation = useUpdatePermit();
  const queryClient = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const [draft, setDraft] = useState(permit.intake_date ?? '');
  if (juris !== 'Seattle') return null;
  if (permit.type !== 'Building Permit' && permit.type !== 'Demolition') {
    return null;
  }
  const occMissing = !permit.updated_at;

  function commit() {
    if (!permit.updated_at) return;
    const normalized = draft || null;
    if (normalized === (permit.intake_date ?? null)) return;
    updateMutation.mutate(
      {
        permitId: permit.id,
        projectId: permit.project_id,
        expectedUpdatedAt: permit.updated_at,
        patch: { intake_date: normalized } as Partial<Permit>,
        fieldLabel: 'Seattle Intake',
      },
      {
        // fix-199: the permits trigger maintains this permit's intake_records
        // slot — refresh the tracker so it reflects the new/cleared slot.
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.intakeRecords(tenantId),
          }),
      },
    );
  }

  // fix-199: surface target_submit beside the intake date + flag a large gap so
  // a slot scheduled too far from the planned submission stands out.
  const gap = intakeTargetGapDays(permit.intake_date, permit.target_submit);
  const gapFlagged = isIntakeTargetGapFlagged(gap);

  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-1.5 border-b"
      style={{
        borderBottomColor: 'var(--color-border)',
        background: 'rgba(59,130,246,0.04)',
      }}
      data-testid="pd-v2-seattle-intake"
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
        style={{ color: '#3b82f6' }}
      >
        📅 Seattle Intake
      </span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        disabled={occMissing}
        className="text-[11px] px-2 py-0.5 border rounded outline-none disabled:opacity-50"
        style={{
          borderColor: 'rgba(59,130,246,0.35)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-testid="pd-v2-seattle-intake-input"
      />
      {/* fix-199: target submit + gap flag for discrepancy spotting. */}
      {permit.target_submit && (
        <span
          className="text-[9px] whitespace-nowrap"
          style={{ color: gapFlagged ? 'var(--color-co)' : 'var(--color-muted)' }}
          title={
            gap !== null
              ? `Intake is ${gap >= 0 ? gap : -gap} day${Math.abs(gap) === 1 ? '' : 's'} ${gap >= 0 ? 'after' : 'before'} target submit`
              : 'Target submit'
          }
          data-testid="pd-v2-seattle-intake-target"
        >
          {gapFlagged && '⚠ '}
          Target: {permit.target_submit}
          {gap !== null && (
            <span className="font-mono">
              {' '}
              ({gap >= 0 ? '+' : ''}
              {gap}d)
            </span>
          )}
        </span>
      )}
      <span className="text-[9px] text-muted">
        Scheduled intake with Seattle portal — synced to the Intake Tracker
      </span>
    </div>
  );
}

// ============================================================
// Cycle tab bar: Design + Cycle 1 + Cycle 2 …
// ============================================================

function CycleTabBar({
  cycles,
  viewIdx,
  onSelect,
}: {
  cycles: PermitCycle[];
  viewIdx: number;
  onSelect: (idx: number) => void;
}) {
  // fix-109: render EVERY cycle row, regardless of whether its fields
  // are populated. Pre-fix-109 the bar hid trailing empty cycles when
  // they weren't being viewed (a v1 carry-over rule from index.html
  // :3132), so a freshly-created cycle disappeared from the tabs the
  // moment viewIdx moved off it. Bobby's 6505 21st Ave NW repro:
  // 5 successive "Add Cycle" clicks → 5 phantom empty cycles, all
  // invisible because each one was hidden by the filter the moment
  // the next one was created. Smart Add Cycle (fix-109 part A) now
  // pre-fills the new cycle's submitted from the previous cycle's
  // resubmitted/corr_issued so trailing empties are rare; on the
  // chance one DOES exist, the empty-cycle hint row below the bar
  // surfaces a Delete affordance instead of silently hiding it.
  //
  // Q9.5.f-fix-6 A: tab labels and idx come straight from cycle_index
  // — no `i + 1` math, so non-contiguous indices (e.g. after a delete)
  // display correctly.
  const visible = useMemo(() => {
    const out: { idx: number; label: string; empty: boolean }[] = [
      { idx: 0, label: 'Design', empty: false },
    ];
    cycles.forEach((c) => {
      const empty =
        !c.submitted && !c.city_target && !c.corr_issued && !c.resubmitted;
      out.push({ idx: c.cycle_index, label: `Cycle ${c.cycle_index}`, empty });
    });
    return out;
  }, [cycles]);

  return (
    <div
      className="flex items-center gap-1 px-3 py-1.5 border-b"
      style={{
        background: 'var(--color-s2)',
        borderBottomColor: 'var(--color-border)',
        flexWrap: 'wrap',
      }}
      data-testid="pd-v2-cycle-tabs"
    >
      <span
        className="text-[9px] uppercase tracking-wide mr-1"
        style={{ color: 'var(--color-dim)' }}
      >
        Viewing:
      </span>
      {visible.map((t) => {
        const isActive = t.idx === viewIdx;
        return (
          <button
            key={t.idx}
            type="button"
            onClick={() => onSelect(t.idx)}
            className="text-[10px] px-2 py-0.5 rounded border whitespace-nowrap"
            style={{
              borderColor: isActive ? 'var(--color-de)' : 'var(--color-border)',
              background: isActive ? 'var(--color-de-bg)' : 'transparent',
              color: isActive ? 'var(--color-de)' : 'var(--color-muted)',
              cursor: 'pointer',
            }}
            data-testid={`pd-v2-cycle-tab-${t.idx}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// fix-109 (part C): empty-cycle hint + Delete affordance. Renders only
// when the user is viewing a review cycle (cycle_index > 0) whose
// fields are all null. That's the orphan-cleanup case Bobby's 6505
// permit hit: 5 phantom empty cycles created by repeat Add Cycle
// clicks pre-fix. With smart Add Cycle (part A) seeding new cycles
// with a submitted date, the hint should rarely surface; when it
// does, the Delete button removes the row cleanly without forcing
// the user into the sidebar widget's per-cycle × control.
function EmptyCycleHint({
  permit,
  cycles,
  viewIdx,
  onAfterDelete,
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
  viewIdx: number;
  /** Called after the cycle is deleted. The argument is the cycle_index
   *  the parent should switch the view to (the previous cycle, or 0 if
   *  none exists). */
  onAfterDelete: (prevIdx: number) => void;
}) {
  const removeCycle = useDeletePermitCycle();
  if (viewIdx <= 0) return null;
  const cycle = cycles.find((c) => c.cycle_index === viewIdx);
  if (!cycle) return null;
  const isEmpty =
    !cycle.submitted &&
    !cycle.city_target &&
    !cycle.corr_issued &&
    !cycle.resubmitted &&
    !cycle.intake_accepted;
  if (!isEmpty) return null;
  // Drop back to the cycle BEFORE this one, defaulting to Design (0)
  // when this was the only review cycle.
  const previousIdx = cycles
    .map((c) => c.cycle_index)
    .filter((idx) => idx < viewIdx)
    .reduce<number>((acc, idx) => (idx > acc ? idx : acc), 0);

  function handleDelete() {
    if (
      !window.confirm(
        `Delete this empty cycle? This can't be undone.`,
      )
    ) {
      return;
    }
    removeCycle.mutate(
      { cycle: cycle!, permitId: permit.id, projectId: permit.project_id },
      {
        onSuccess: () => onAfterDelete(previousIdx),
      },
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-1.5 border-b"
      style={{
        background: 'var(--color-co-bg)',
        borderBottomColor: 'var(--color-border)',
      }}
      data-testid={`pd-v2-empty-cycle-hint-${viewIdx}`}
    >
      <span className="text-[10px]" style={{ color: 'var(--color-co)' }}>
        Cycle {viewIdx} has no dates yet. Fill in Submitted on the strip
        below — or delete this cycle if it was added by mistake.
      </span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={removeCycle.isPending}
        className="text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer disabled:opacity-50"
        style={{
          borderColor: 'var(--color-co-border)',
          color: 'var(--color-co)',
          background: 'transparent',
        }}
        data-testid={`pd-v2-empty-cycle-delete-${viewIdx}`}
      >
        Delete empty cycle
      </button>
    </div>
  );
}

// ============================================================
// Date strip: cycle-aware grid of editable date cells
// ============================================================

// fix-35 Bug 3: a single in-flight DateCell draft (local, uncommitted).
// The chain-position highlight is a pure function of committed permit data,
// so before fix-35 it couldn't move until blur committed. We re-run the same
// rule against a permit copy with the draft injected, so the highlight snaps
// the instant a date is picked — without firing any mutation.
type DraftOverlay = { milestone: HighlightTarget; value: string };

function applyDraftOverlay(
  permit: PermitWithCycles,
  overlay: DraftOverlay | null,
): PermitWithCycles {
  if (!overlay) return permit;
  const { milestone, value } = overlay;
  const v = value || null;
  if (milestone.kind === 'permit') {
    return { ...permit, [milestone.key]: v };
  }
  const cycles = permit.permit_cycles ?? [];
  let found = false;
  const next = cycles.map((c) => {
    if (c.cycle_index === milestone.cycleIndex) {
      found = true;
      return { ...c, [milestone.key]: v };
    }
    return c;
  });
  if (!found) {
    // Target cycle isn't in the cache yet (e.g. design cycle 0 lazy-create on
    // a brand-new permit). getHighlightedMilestone only reads cycle_index +
    // the chain keys, so a minimal synthetic row is a safe cast.
    next.push({
      cycle_index: milestone.cycleIndex,
      [milestone.key]: v,
    } as unknown as PermitCycle);
  }
  return { ...permit, permit_cycles: next };
}

/** fix-97: only these four fields participate in the chronology chain.
 *  city_target (the city's scheduled review date) is NOT part of the
 *  chain — fix-89's server check excludes it deliberately. permit-level
 *  fields (target_submit, approval_date, actual_issue) get year-range
 *  validation but no chain. */
const CHAIN_FIELDS: readonly CycleChainField[] = [
  'submitted',
  'intake_accepted',
  'corr_issued',
  'resubmitted',
] as const;

function isChainField(key: string): key is CycleChainField {
  return (CHAIN_FIELDS as readonly string[]).includes(key);
}

function DateStrip({
  permit,
  project,
  cycles,
  designCycle,
  viewIdx,
  currentPhase,
}: {
  permit: PermitWithCycles;
  /** fix-22 Mig 3: GO Date renders from project.go_date as read-only. */
  project?: Project | null;
  /** Review cycles only (cycle_index >= 1), sorted ascending. */
  cycles: PermitCycle[];
  /** fix-26: design slot (cycle_index = 0). Null when absent (legacy
   *  pre-fix-24f permits or freshly-wiped state); the Design strip falls
   *  back to displaying cycle 1's design-shape data in that case. */
  designCycle: PermitCycle | null;
  viewIdx: number;
  currentPhase: CurrentPhaseResult;
}) {
  // fix-23c B → fix-26: status-bar highlight follows the chain-position
  // rule in permitHelpers. Design strip cells anchor at the design cycle
  // (cycle_index=0); the highlight helper's firstIdx logic picks the
  // lowest cycle_index for the chain start, so when cycle 0 exists it
  // becomes the design chain anchor; otherwise the lowest-index review
  // cycle is treated as design (legacy permits).
  //
  // currentPhase is kept around for the cycle-tab initial-selection logic
  // (DrawScheduleGrid + a few legacy callers still want it).
  void currentPhase;
  // fix-35 Bug 3: optimistic, mutation-free highlight overlay. DateCell reports
  // its in-flight draft here; the highlight reads the draft, then clears back to
  // committed on blur (mutation fires there) or on cycle-tab switch.
  const [draftOverlay, setDraftOverlay] = useState<DraftOverlay | null>(null);
  // fix-97: per-field drafts for the visible row, used to compute live
  // chain-chronology errors (submitted ≤ intake_accepted ≤ corr_issued ≤
  // resubmitted). draftOverlay tracks only the most recent change (for
  // highlight purposes) — for the chain check we need every in-flight
  // value at once so red borders update reactively across cells. Keyed
  // by the chain field name; reset when viewIdx changes (each cycle row
  // owns its own chain). The draftOverlay rule is preserved separately
  // so the highlight system keeps its existing semantics.
  const [chainDrafts, setChainDrafts] = useState<
    Partial<Record<CycleChainField, string>>
  >({});
  // Drop the transient overlay when the viewed cycle changes. React's
  // "adjust state during render" pattern (https://react.dev/learn/you-might-
  // not-need-an-effect#adjusting-some-state-when-a-prop-changes) — avoids an
  // effect + the cascading-render it would cost.
  const [overlayViewIdx, setOverlayViewIdx] = useState(viewIdx);
  if (overlayViewIdx !== viewIdx) {
    setOverlayViewIdx(viewIdx);
    setDraftOverlay(null);
    setChainDrafts({});
  }
  function handleDraftChange(milestone: HighlightTarget, value: string) {
    setDraftOverlay({ milestone, value });
    // fix-97: record the draft on the chain map too, but only for the
    // four chain fields on the currently-viewed cycle row. permit-level
    // milestones (target_submit, approval_date, actual_issue) and
    // city_target don't participate in the chronology check.
    if (
      milestone.kind === 'cycle' &&
      milestone.cycleIndex === viewIdx &&
      isChainField(milestone.key)
    ) {
      const key = milestone.key;
      setChainDrafts((prev) => ({ ...prev, [key]: value }));
    }
  }
  function handleDraftClear(milestone: HighlightTarget) {
    setDraftOverlay((prev) =>
      prev && isMilestoneHighlighted(prev.milestone, milestone) ? null : prev,
    );
    // Don't clear chainDrafts on blur — the cell's committed value
    // flows back through the value prop and overrides the draft in
    // chainErrorsFor. Clearing here would race a server-rejected commit
    // (chainDrafts[field] gone → red border gone, but the value never
    // saved).  Keep the draft until viewIdx changes.
  }
  const highlightTarget = useMemo(
    () => getHighlightedMilestone(applyDraftOverlay(permit, draftOverlay)),
    [permit, draftOverlay],
  );
  const updateMutation = useUpdatePermit();
  const upsertCycle = useUpsertPermitCycle();

  async function commitPermit<K extends keyof Permit>(
    field: K,
    next: Permit[K],
    original: Permit[K],
    label: string,
  ) {
    if (!permit.updated_at) return;
    if (next === original) return;
    await updateMutation.mutateAsync({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { [field]: next } as Partial<Permit>,
      fieldLabel: label,
    });
  }

  async function commitCycleField(cycle: PermitCycle, field: DateField, next: string) {
    await upsertCycle.mutateAsync({
      op: 'update',
      permitId: permit.id,
      projectId: permit.project_id,
      cycle,
      patch: { [field]: next || null } as CyclePatch,
    });
  }

  /** fix-97: chain errors for a single cycle row, overlaying the
   *  per-field draft on top of the committed values. Returns a map
   *  keyed by the chain field. Empty map means the row is clean. */
  function chainErrorsFor(source: PermitCycle | null | undefined) {
    return validateCycleChain({
      submitted: chainDrafts.submitted ?? source?.submitted ?? null,
      intake_accepted:
        chainDrafts.intake_accepted ?? source?.intake_accepted ?? null,
      corr_issued:
        chainDrafts.corr_issued ?? source?.corr_issued ?? null,
      resubmitted:
        chainDrafts.resubmitted ?? source?.resubmitted ?? null,
    });
  }

  if (viewIdx === 0) {
    // Q9.5.f-fix-8 A → fix-26: Design tab shows GO → Target Submit →
    // Initial Submit → Intake Accepted, all bound to the DESIGN CYCLE
    // (cycle_index = 0) per Bobby's V1 model. Pre-fix-26 frontends wrote
    // Design data to cycle 1; legacy permits where cycle 0 lacks design
    // fields fall back to displaying cycle 1's submitted/intake_accepted
    // (read-only fallback; new writes always target cycle 0).
    //
    // Once cycle 0.intake_accepted is set, bp_upsert_permit_cycle_row's
    // fix-25a-b snap creates cycle 1 with submitted = c0.intake (the
    // design → first-review transition). The auto-advance effect in
    // PermitDetailV2 then moves the view to Cycle 1.
    const firstReviewCycle = cycles[0] ?? null;
    // Legacy display fallback: cycle 0 lacks design fields, but cycle 1
    // has them — render cycle 1's values in the Design strip until the
    // fix-26 data migration moves them to cycle 0.
    const designDataMissing =
      !designCycle ||
      (designCycle.submitted == null && designCycle.intake_accepted == null);
    const legacyShim =
      designDataMissing &&
      firstReviewCycle &&
      (firstReviewCycle.submitted != null ||
        firstReviewCycle.intake_accepted != null)
        ? firstReviewCycle
        : null;
    // Prefer legacyShim when designCycle exists but lacks the design
    // fields (post-fix-24f cycle 0 placeholder, pre-fix-26 data still on
    // cycle 1). Falling through to designCycle would render blank cells
    // while cycle 1 still has the user's data.
    const designDisplaySource = legacyShim ?? designCycle;
    // Highlight identity for Design cells: anchor at the chain's
    // firstIdx (the lowest cycle_index in the permit) — matches the
    // getHighlightedMilestone rule. When cycle 0 exists, that's 0;
    // legacy permits without cycle 0 use the lowest review-cycle index.
    const designHighlightCycleIdx =
      designCycle?.cycle_index ?? firstReviewCycle?.cycle_index ?? 0;
    async function commitDesignField(field: DateField, next: string) {
      const normalized = next || null;
      if (designCycle) {
        await upsertCycle.mutateAsync({
          op: 'update',
          permitId: permit.id,
          projectId: permit.project_id,
          cycle: designCycle,
          patch: { [field]: normalized } as CyclePatch,
        });
        return;
      }
      // No cycle 0 exists yet — first edit lazy-creates it. Don't
      // auto-create on a blur-clear with no data.
      if (!normalized) return;
      await upsertCycle.mutateAsync({
        op: 'insert',
        permitId: permit.id,
        projectId: permit.project_id,
        cycleIndex: 0,
        patch: { [field]: normalized } as CyclePatch,
      });
    }
    // fix-97: per-field chain errors for the visible design row. The
    // chain check runs against the display source (legacyShim or cycle 0)
    // overlaid with any in-flight drafts. Only submitted + intake_accepted
    // participate on the design row (corr_issued / resubmitted don't
    // render here), but chainErrorsFor still gets the full proposed
    // row so the pair check fires correctly.
    const designErrors = chainErrorsFor(designDisplaySource);
    return (
      <div
        className="grid border-b"
        style={{
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1px',
          background: 'var(--color-border)',
          borderBottomColor: 'var(--color-border)',
        }}
        data-testid="pd-v2-date-strip-design"
      >
        <DateCell
          label="GO"
          value={project?.go_date ?? null}
          /** fix-23c B: GO is no longer in the highlight chain — Bobby's
           *  rule starts at target_submit. */
          highlighted={false}
          /** fix-22 Mig 3: go_date is project-level now; GO cell here is
           *  read-only display. Edit via Project Settings → GO Date. */
          onCommit={() => {}}
          readOnly
          testid="pd-cell-go"
        />
        <DateCell
          label="Target Submit"
          accentColor="var(--color-de)"
          value={permit.target_submit}
          highlighted={isMilestoneHighlighted(highlightTarget, {
            kind: 'permit',
            key: 'target_submit',
          })}
          milestone={{ kind: 'permit', key: 'target_submit' }}
          onDraftChange={handleDraftChange}
          onDraftClear={handleDraftClear}
          onCommit={(v) =>
            commitPermit('target_submit', v || null, permit.target_submit, 'Target Submit')
          }
          testid="pd-cell-target_submit"
        />
        <DateCell
          label="Initial Submit"
          accentColor="var(--color-pm)"
          value={designDisplaySource?.submitted ?? null}
          highlighted={isMilestoneHighlighted(highlightTarget, {
            kind: 'cycle',
            cycleIndex: designHighlightCycleIdx,
            key: 'submitted',
          })}
          milestone={{
            kind: 'cycle',
            cycleIndex: designHighlightCycleIdx,
            key: 'submitted',
          }}
          onDraftChange={handleDraftChange}
          onDraftClear={handleDraftClear}
          onCommit={(v) => commitDesignField('submitted', v)}
          localError={designErrors.submitted ?? null}
          testid="pd-cell-design-submitted"
        />
        <DateCell
          label="Intake Accepted"
          accentColor="var(--color-pm)"
          value={designDisplaySource?.intake_accepted ?? null}
          highlighted={isMilestoneHighlighted(highlightTarget, {
            kind: 'cycle',
            cycleIndex: designHighlightCycleIdx,
            key: 'intake_accepted',
          })}
          milestone={{
            kind: 'cycle',
            cycleIndex: designHighlightCycleIdx,
            key: 'intake_accepted',
          }}
          onDraftChange={handleDraftChange}
          onDraftClear={handleDraftClear}
          onCommit={(v) => commitDesignField('intake_accepted', v)}
          // fix-75: snap cycle 1 the moment a valid intake_accepted lands.
          commitOnChange
          localError={designErrors.intake_accepted ?? null}
          testid="pd-cell-design-intake_accepted"
        />
      </div>
    );
  }

  // Review cycle N≥1 — look up by actual cycle_index (not array position).
  // Handles non-contiguous indices left by deletes.
  const cycle = cycles.find((c) => c.cycle_index === viewIdx);
  if (!cycle) {
    return (
      <div
        className="px-4 py-2 text-[11px] italic border-b"
        style={{
          color: 'var(--color-dim)',
          borderBottomColor: 'var(--color-border)',
          background: 'var(--color-s2)',
        }}
      >
        Cycle {viewIdx} hasn't been created yet. Use the Cycles section below to add one.
      </div>
    );
  }

  // fix-97: per-field chain errors for the visible review cycle row,
  // overlaying any in-flight drafts on the committed cycle. The four
  // chain fields (submitted, intake_accepted, corr_issued, resubmitted)
  // pair-check; city_target stays unchecked (not in fix-89's chain).
  const cycleErrors = chainErrorsFor(cycle);
  return (
    <div
      className="grid border-b"
      style={{
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '1px',
        background: 'var(--color-border)',
        borderBottomColor: 'var(--color-border)',
      }}
      data-testid={`pd-v2-date-strip-cycle-${viewIdx}`}
    >
      <DateCell
        label="Submitted"
        value={cycle.submitted}
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'cycle',
          cycleIndex: viewIdx,
          key: 'submitted',
        })}
        milestone={{ kind: 'cycle', cycleIndex: viewIdx, key: 'submitted' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) => commitCycleField(cycle, 'submitted', v)}
        localError={cycleErrors.submitted ?? null}
        testid={`pd-cell-cycle${viewIdx}-submitted`}
      />
      <DateCell
        label="City Target"
        accentColor="var(--color-pm)"
        value={cycle.city_target}
        /** fix-24c: city_target IS now a candidate in the latest-by-date
         *  rule (fix-23c had excluded it). When the city's scheduled
         *  review date is the most recent populated milestone, this cell
         *  lights up. */
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'cycle',
          cycleIndex: viewIdx,
          key: 'city_target',
        })}
        milestone={{ kind: 'cycle', cycleIndex: viewIdx, key: 'city_target' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) => commitCycleField(cycle, 'city_target', v)}
        testid={`pd-cell-cycle${viewIdx}-city_target`}
      />
      <DateCell
        label="Corr. Issued"
        accentColor="var(--color-co)"
        value={cycle.corr_issued}
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'cycle',
          cycleIndex: viewIdx,
          key: 'corr_issued',
        })}
        milestone={{ kind: 'cycle', cycleIndex: viewIdx, key: 'corr_issued' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) => commitCycleField(cycle, 'corr_issued', v)}
        localError={cycleErrors.corr_issued ?? null}
        testid={`pd-cell-cycle${viewIdx}-corr_issued`}
      />
      <DateCell
        label="Resubmitted"
        accentColor="var(--color-pm)"
        value={cycle.resubmitted}
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'cycle',
          cycleIndex: viewIdx,
          key: 'resubmitted',
        })}
        milestone={{ kind: 'cycle', cycleIndex: viewIdx, key: 'resubmitted' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) => commitCycleField(cycle, 'resubmitted', v)}
        localError={cycleErrors.resubmitted ?? null}
        // fix-75: snap cycle N+1 the moment a valid resubmitted lands.
        commitOnChange
        testid={`pd-cell-cycle${viewIdx}-resubmitted`}
      />
      <DateCell
        label="Approval Date"
        accentColor="var(--color-jv)"
        value={permit.approval_date}
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'permit',
          key: 'approval_date',
        })}
        milestone={{ kind: 'permit', key: 'approval_date' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) =>
          commitPermit(
            'approval_date',
            v || null,
            permit.approval_date,
            'Approval Date',
          )
        }
        testid="pd-cell-approval_date"
      />
      <DateCell
        label="Actual Issue"
        accentColor="var(--color-is)"
        value={permit.actual_issue}
        highlighted={isMilestoneHighlighted(highlightTarget, {
          kind: 'permit',
          key: 'actual_issue',
        })}
        milestone={{ kind: 'permit', key: 'actual_issue' }}
        onDraftChange={handleDraftChange}
        onDraftClear={handleDraftClear}
        onCommit={(v) =>
          commitPermit('actual_issue', v || null, permit.actual_issue, 'Actual Issue')
        }
        testid="pd-cell-actual_issue"
      />
    </div>
  );
}

/** fix-75: strict YYYY-MM-DD shape + parseable-date check. type=date inputs
 *  produce a 10-char ISO string only once a real date is chosen, so this is a
 *  reliable gate for "we have a fireable value". Used by the auto-commit path
 *  on intake_accepted / resubmitted to drive the server-side snap without
 *  waiting for blur. */
function isValidIsoDate(s: string): boolean {
  if (s.length !== 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(s + 'T12:00:00Z').getTime());
}

function DateCell({
  label,
  value,
  accentColor,
  highlighted,
  milestone,
  onDraftChange,
  onDraftClear,
  onCommit,
  readOnly,
  commitOnChange,
  localError,
  testid,
}: {
  label: string;
  value: string | null;
  accentColor?: string;
  // Q9.5.f-fix-6 C: when true, this cell is the permit's current phase.
  // Render an inset blue outline + bg tint so the eye lands on it.
  highlighted?: boolean;
  /** fix-35 Bug 3: this cell's chain-position identity. When set together
   *  with onDraftChange, picking a date reports a local draft so the parent's
   *  highlight snaps immediately — no mutation until blur/Enter. */
  milestone?: HighlightTarget;
  onDraftChange?: (milestone: HighlightTarget, value: string) => void;
  onDraftClear?: (milestone: HighlightTarget) => void;
  onCommit: (next: string) => void | Promise<void>;
  /** fix-22 Mig 3: GO cell now reads project.go_date as read-only — edits
   *  happen in Project Settings. */
  readOnly?: boolean;
  /** fix-75: opt-in commit-on-change for cells whose mutation drives a
   *  server-side snap (intake_accepted creates cycle N+1, resubmitted snaps
   *  cycle N→N+1 once we have a valid date). Cells without a snap keep the
   *  default blur/Enter-only commit because calendar-arrow nav (fix-25-DD)
   *  fires onChange per step. The auto-commit is gated on a strict
   *  YYYY-MM-DD shape so a partial keystroke doesn't fire mid-edit; onBlur
   *  stays as the safety net for paste-and-click cases. */
  commitOnChange?: boolean;
  /** fix-97: parent-supplied chain-validation message. When non-null the
   *  cell paints red + renders the message inline + blocks tryCommit so a
   *  chronology violation never reaches bp_upsert_permit_cycle_row.
   *  Year-range typos are caught inside tryCommit using
   *  validateYearRange so the cell is self-defending even without a
   *  parent that wires the chain check. */
  localError?: string | null;
  /** fix-23c: cells expose a stable testid so the highlight-rule
   *  integration test can find them by name regardless of where they
   *  live in the design vs cycle-N strips. */
  testid?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  // fix-73: dirty flag preserves the user's typed value across an OCC retry.
  // The mutation's onError fires invalidateQueries → refetch → the parent's
  // value prop refreshes (often back to the pre-edit value). Without this
  // flag, the prop-sync effect below would overwrite `draft` and Bobby would
  // lose what he typed, forcing a second click per field. dirty stays true
  // while the user has unsaved typing; cleared on a successful commit (or on
  // a blur that turned out to be a no-op).
  const [dirty, setDirty] = useState(false);
  // fix-25d sub-issue 1 added commit-on-change to fix a 10-15s
  // "highlight lag" on type=date pickers.
  //
  // fix-25-DD reverts that: commit-on-change caused calendar
  // navigation arrows (which fire onChange on each step) to trigger
  // a server roundtrip + snap RPC per click. On 3056 48th Ave SW
  // PAR/Pre-Sub that produced 11 cycles in a backward chain when
  // Bobby walked the date picker back month-by-month. The original
  // highlight lag is now handled by fix-25d-residual's optimistic
  // cache merge (snap row lands on the same render pass as the
  // mutation resolution) — commit-on-change is no longer needed for
  // responsive highlighting.
  //
  // Commit triggers post-DD: onBlur (clicking away) + Enter key
  // (explicit submit). tryCommit dedupes via the ref so blur after
  // Enter doesn't double-commit.
  const lastCommittedRef = useRef(value ?? '');
  // fix-75: did the last commit-on-change attempt fail? When true, an
  // explicit blur (user clicking away or hitting Enter) should retry — even
  // if the draft is still a valid date that matches what we tried to commit.
  // This preserves fix-26a's "retry after sibling correction" workflow.
  // Resets to false on a successful commit.
  const lastCommitFailedRef = useRef(false);
  // fix-86: state mirror of lastCommitFailedRef that drives the red border +
  // "✕" mark. Bobby's 4563 34th Ave W Demo permit: a server-side validation
  // rejection (intake_accepted < submitted) painted the cell red, but typing
  // a fresh value didn't reset the visual — saving the new value still felt
  // like a stuck-in-error retry. Refs alone don't re-render, so we keep this
  // boolean state in lockstep with the ref: both set true on .catch, both
  // cleared on success OR on the first onChange whose value differs from
  // lastRejectedValueRef.
  const [errored, setErrored] = useState(false);
  // fix-97: year-range error message derived from the current draft.
  // Updates as the user types so the inline message + red border fire
  // before they even blur — matches the brief's "reactive" UX. Holds
  // the user-facing string (e.g. "Year must be between 2020 and 2030")
  // or null when the value is empty / in range.
  const yearError = useMemo(() => validateYearRange(draft), [draft]);
  // fix-86: the exact value the last failed commit attempted. When the user
  // types something different, we wipe the errored flag immediately so the
  // input goes neutral and the next save isn't carrying baggage.
  const lastRejectedValueRef = useRef<string | null>(null);
  // fix-83: 500ms debounce on the commit-on-change path. Calendar-arrow nav
  // (and the type=date stepper) fires onChange with a full valid YYYY-MM-DD
  // at every step, which used to spawn one mutation per click and — under
  // race conditions on the IF NOT EXISTS snap branch — one phantom cycle 1
  // row per click (Bobby's 4903 S Greenway incident: 6 cycles from 6 arrow
  // taps). The debounce coalesces a burst of valid-date changes into one
  // save with the LAST date. Blur bypasses the timer so the user-explicit
  // "commit now" signal is never delayed. Backend defense-in-depth lives
  // in fix_83_cycle_snap_idempotency.sql (UNIQUE + ON CONFLICT).
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any armed timer on unmount so a debounced commit can't fire after
  // the cell is gone (e.g. user switches permits during the 500ms window).
  useEffect(() => {
    return () => {
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, []);
  // fix-24c: when the value prop updates after our initial mount (cycles
  // load async, parent refetches after a save, user switches cycle tabs),
  // pull the new value into our draft. Without this, useState(value)
  // captures only the first render's value and the cell silently shows
  // stale (often blank) data forever. Bobby's test 678 hit this on the
  // Design strip when cycles arrived a tick after the permit row.
  //
  // fix-73: gate the sync on `!dirty`. If the user has typed but not yet
  // (successfully) committed, preserve their draft — otherwise an OCC-driven
  // refetch wipes the input mid-edit (see [[feedback-react-usestate-init-once-footgun]]).
  // lastCommittedRef still advances so the dedupe inside tryCommit compares
  // against the latest server truth.
  //
  // react-hooks/set-state-in-effect flags this as a cascading-render
  // risk but the value-prop sync is the entire point — refactoring to
  // `key={value}` on the parent would force unmount/remount and lose
  // focus mid-edit. Keep the effect; disable the rule on the setDraft
  // line itself (the rule fires on the setState call, not the effect).
  useEffect(() => {
    const incoming = value ?? '';
    lastCommittedRef.current = incoming;
    if (dirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(incoming);
  }, [value, dirty]);
  function tryCommit(next: string) {
    if (readOnly) return;
    if (next === lastCommittedRef.current) {
      // Blur with no change → input is in sync with committed; nothing dirty.
      setDirty(false);
      return;
    }
    // fix-97: refuse to fire the mutation when the local guards reject
    // the value. Year-range is self-contained; localError comes from
    // the parent's chain-validation pass (DateStrip). Either way we
    // paint red + leave the typed value in the input + leave dirty=true
    // so the user sees their entry waiting for correction.
    if (validateYearRange(next) !== null || localError) {
      lastCommitFailedRef.current = true;
      lastRejectedValueRef.current = next;
      setErrored(true);
      return;
    }
    // fix-26a: capture prev so we can restore the ref if the mutation
    // rejects (e.g., RPC validation: intake_accepted < submitted). Without
    // restoring, re-typing the same value after correcting the sibling
    // field gets deduped away — Bobby's "couldn't delete or correct" symptom.
    const prev = lastCommittedRef.current;
    lastCommittedRef.current = next;
    // The mutation hook already pushes an error toast via its onError
    // (useUpsertPermitCycle). We just swallow the rejection here so it
    // doesn't bubble to the runtime as "Uncaught (in promise)" + reset
    // the ref so user can retry.
    // fix-73: clear `dirty` on success so the next prop-sync (e.g. fresh
    // cycle data) flows through; KEEP `dirty` on rejection so an OCC retry
    // doesn't blank what the user typed.
    void Promise.resolve(onCommit(next))
      .then(() => {
        setDirty(false);
        // fix-75: a clean success clears the failure flag.
        lastCommitFailedRef.current = false;
        // fix-86: success also clears the rejected-value pointer + errored
        // visual, in case the user typed a fresh value that worked.
        lastRejectedValueRef.current = null;
        setErrored(false);
      })
      .catch(() => {
        lastCommittedRef.current = prev;
        // fix-75: mark that the next explicit blur should retry instead of
        // being swallowed by the safety-net (the auto-commit attempt failed,
        // so blur is the user's explicit "try again" signal).
        lastCommitFailedRef.current = true;
        // fix-86: remember the exact value that just failed; onChange uses
        // this to wipe the errored visual the moment the user types something
        // different. Also drive the red border via state so React re-renders.
        lastRejectedValueRef.current = next;
        setErrored(true);
      });
  }
  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-1 relative"
      style={{
        background: highlighted
          ? 'var(--color-de-bg)'
          : 'var(--color-surface)',
        outline: highlighted ? '2px solid var(--color-de)' : undefined,
        outlineOffset: highlighted ? '-2px' : undefined,
        transition: 'background 0.15s',
      }}
      // fix-23c B: every cell carries data-highlighted so tests can
      // assert "exactly one cell has data-highlighted='true'" without
      // depending on inline styles.
      data-highlighted={highlighted ? 'true' : 'false'}
      // fix-76: data-dirty exposes the fix-73 draft-preservation state. A
      // typed-but-not-yet-committed value (including an OCC retry the user
      // hasn't re-saved) renders an amber bottom border + a "•" marker so the
      // user can tell at a glance that what they see isn't saved yet. The
      // visual disappears the moment a commit succeeds (fix-73 sets
      // dirty=false in .then). Bobby's "I thought it saved" gap.
      data-dirty={dirty ? 'true' : 'false'}
      // fix-86: data-errored exposes the post-rejection visual state
      // (set in tryCommit's .catch). Cleared on success OR on retype
      // (onChange below). Distinct from data-dirty: dirty=true means
      // "user typed; not saved yet" (amber); errored=true means "last
      // save was rejected by validation" (red). Both can be true; the
      // red borders out-rank amber visually.
      data-errored={errored ? 'true' : 'false'}
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[8px] font-bold uppercase tracking-wide"
          style={{ color: accentColor ?? 'var(--color-dim)' }}
        >
          {label}
          {dirty && (
            <span
              // fix-76: tiny "uncommitted" marker next to the label.
              style={{ color: 'var(--color-co)', marginLeft: 4 }}
              title="Unsaved change"
              data-testid={testid ? `${testid}-dirty-mark` : undefined}
            >
              •
            </span>
          )}
        </span>
        {highlighted && (
          <span
            className="text-[7px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--color-de)' }}
            title="Permit is currently in this phase"
          >
            ▶ NOW
          </span>
        )}
      </div>
      <input
        type="date"
        // fix-97: native date inputs accept any year (including 0020).
        // min+max prompts a browser-level rejection on out-of-range
        // entries before the value ever reaches our state. Belt-and-
        // suspenders with the tryCommit year check below.
        min={CYCLE_MIN_DATE}
        max={CYCLE_MAX_DATE}
        value={draft}
        // fix-25-DD: local-only on change. Calendar nav arrows /
        // intermediate keystrokes only update the visible value;
        // no mutation fires until blur or Enter.
        // fix-35 Bug 3: also report the draft to the parent so the highlight
        // snaps now — this is a visual overlay only, still no mutation.
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          // fix-73: any user edit marks the draft dirty, gating the
          // value-prop-sync effect so an OCC refetch can't wipe it.
          setDirty(true);
          // fix-86: clear the errored visual the moment the user types a
          // value different from the one that was just rejected. Without
          // this, the cell stays painted red even though the new value has
          // never been tried — feels like the field is "stuck in error".
          // Also clear lastCommitFailedRef so the fix-75 blur-retry path
          // doesn't fire on what's effectively a fresh edit.
          if (
            lastRejectedValueRef.current !== null &&
            next !== lastRejectedValueRef.current
          ) {
            lastRejectedValueRef.current = null;
            lastCommitFailedRef.current = false;
            setErrored(false);
          }
          if (milestone) onDraftChange?.(milestone, next);
          // fix-75: when this cell drives a server-side snap (intake_accepted,
          // resubmitted), commit AS SOON AS we have a valid YYYY-MM-DD so the
          // snap RPC fires without waiting for blur. The strict shape check
          // means partial keystrokes / calendar mid-nav still don't fire (the
          // type=date input only writes a 10-char value once a real date is
          // chosen). tryCommit dedupes against lastCommittedRef so a no-op
          // re-fire is free.
          if (commitOnChange && isValidIsoDate(next)) {
            // fix-83: debounce commits driven by onChange. Calendar-arrow
            // spam fires one onChange per step; without this, 6 arrow taps
            // could spawn 6 racing snap inserts. The timer is cleared on
            // each new keystroke and on blur (where we want to fire now).
            if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
            commitTimerRef.current = setTimeout(() => {
              commitTimerRef.current = null;
              tryCommit(next);
            }, 500);
          }
        }}
        onBlur={() => {
          // fix-75: for commit-on-change cells, onChange already fired the
          // commit on any valid YYYY-MM-DD — so blur is normally a no-op. Two
          // exceptions:
          //   * draft isn't a valid ISO date → safety-net commit for the
          //     paste-a-partial-then-click case.
          //   * the last commit-on-change attempt failed → blur is the user's
          //     explicit retry signal (fix-26a "sibling corrected, try again").
          // Otherwise skip so the closure-stale draft can't re-fire the commit.
          // fix-83: a pending debounced commit means we have a fresh valid
          // date that hasn't been saved yet — fire it now so blur is never
          // a wait-500ms-then-save experience. Clear the timer first so the
          // setTimeout callback can't double-fire.
          if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
            tryCommit(draft);
          } else if (
            !commitOnChange ||
            !isValidIsoDate(draft) ||
            lastCommitFailedRef.current
          ) {
            tryCommit(draft);
          }
          // The committed value flows back through the value prop; drop the
          // overlay so the highlight reads committed data again.
          if (milestone) onDraftClear?.(milestone);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Trigger the blur path so commit + dedupe stay in one place.
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        disabled={readOnly}
        title={readOnly ? 'Edit GO Date in Project Settings' : undefined}
        className="text-[11px] px-1.5 py-0.5 border rounded outline-none w-full disabled:opacity-70 disabled:cursor-not-allowed"
        style={{
          // fix-76: amber accent on the input border when dirty — the user can
          // see at a glance that the value displayed is uncommitted draft.
          // Clears the moment the save resolves (dirty=false).
          // fix-86: red border out-ranks amber when the last save was
          // rejected (server-side validation). Cleared on retype OR
          // on a successful save.
          // fix-97: chain-validation errors (localError) and year-range
          // typos (yearError) also paint red — both block commit, so
          // surfacing them with the same visual as a server rejection
          // teaches the user they need to fix the value before save.
          borderColor:
            errored || localError || yearError
              ? '#dc2626'
              : dirty
                ? 'var(--color-co)'
                : 'var(--color-border)',
          borderWidth:
            errored || dirty || localError || yearError ? 2 : 1,
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-local-error={localError || yearError ? 'true' : 'false'}
      />
      {/* fix-97: inline validation message. yearError takes priority
          (it's an input-shape error — the value can't be saved at all),
          then chain (localError). Both share the same red typography
          so the user sees a single source of truth per cell. */}
      {(yearError || localError) && (
        <span
          className="text-[9px] leading-tight"
          style={{ color: '#dc2626' }}
          data-testid={testid ? `${testid}-error` : undefined}
        >
          {yearError || localError}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Q9.5.f-fix-6 C: current-phase derivation. Mirrors v1's date-strip
// precedence: most-advanced state wins, scanned latest-cycle-first.
// Returns the phase identifier + the cycle_index that contains it (or
// null when the phase lives at the permit/design level).
// ============================================================

type CurrentPhase =
  | 'go'
  | 'target_submit'
  | 'dd_start'
  | 'dd_end'
  | 'submitted'
  | 'intake_accepted'
  | 'city_target'
  | 'corr_issued'
  | 'resubmitted'
  | 'approval'
  | 'actual_issue';

interface CurrentPhaseResult {
  phase: CurrentPhase | null;
  cycleIndex: number | null;
}

function deriveCurrentPhase(
  permit: PermitWithCycles,
  cycles: PermitCycle[],
  /** fix-22 Mig 3: GO date moved permits → projects. Caller passes the
   *  project's go_date as the design-phase fallback anchor. */
  projectGoDate?: string | null,
): CurrentPhaseResult {
  // Highest cycle_index in the data — used as the "latest cycle" for
  // approval / actual_issue (which live at permit level but visually pair
  // with the most recent review cycle).
  const latestIdx =
    cycles.length === 0 ? null : cycles[cycles.length - 1].cycle_index;
  if (permit.actual_issue) {
    return { phase: 'actual_issue', cycleIndex: latestIdx };
  }
  if (permit.approval_date) {
    return { phase: 'approval', cycleIndex: latestIdx };
  }
  // Scan cycles from latest to earliest — first non-empty field wins.
  for (let i = cycles.length - 1; i >= 0; i--) {
    const c = cycles[i];
    if (c.resubmitted) return { phase: 'resubmitted', cycleIndex: c.cycle_index };
    if (c.corr_issued) return { phase: 'corr_issued', cycleIndex: c.cycle_index };
    if (c.submitted && c.city_target) {
      return { phase: 'city_target', cycleIndex: c.cycle_index };
    }
    // Q9.5.f-fix-8 A: intake_accepted falls between submitted and
    // city_target — once the city accepts intake, the permit is queued
    // for review but no city target is set yet.
    if (c.submitted && c.intake_accepted) {
      return { phase: 'intake_accepted', cycleIndex: c.cycle_index };
    }
    if (c.submitted) return { phase: 'submitted', cycleIndex: c.cycle_index };
  }
  // Design phase fallbacks.
  if (permit.dd_end) return { phase: 'dd_end', cycleIndex: null };
  if (permit.dd_start) return { phase: 'dd_start', cycleIndex: null };
  if (permit.target_submit) return { phase: 'target_submit', cycleIndex: null };
  if (projectGoDate) return { phase: 'go', cycleIndex: null };
  return { phase: null, cycleIndex: null };
}

// ============================================================
// Tasks panel (fix-70): discipline buckets + multi-assign + subtasks + status
// ============================================================
//
// Two columns by discipline (Entitlements | Architecture). The PRIMARY
// assignee is derived server-side (arch -> permit.da, ent -> permit.ent_lead)
// and shown read-only; co-assignees are explicit chips a user adds/removes. A
// task can be flipped between disciplines (moves columns), grow one level of
// subtasks, and cycle status Open -> In Progress -> Resolved (Resolved
// auto-stamps the Done date server-side).

const DISCIPLINES = [
  { key: 'ent' as const, label: 'Entitlements', accent: 'var(--color-de)' },
  { key: 'arch' as const, label: 'Architecture', accent: 'var(--color-jv)' },
];
function TasksPanel({
  permitId,
  projectId,
  permitDa,
  permitEntLead,
  projectSchematicDesigners,
  c0IntakeAccepted,
  inCorrections,
}: {
  permitId: number;
  /** fix-149: threaded down to TaskItem so the Waiting On chip can resolve
   *  the project's External Team firm for the picked discipline. */
  projectId: string;
  /** fix-224: the permit's DA — threaded to TaskItem for co-assignee role-token
   *  resolution (design_associate / design_manager). */
  permitDa: string | null;
  /** fix-228: the permit's ent lead + the project's schematic designers —
   *  complete the PRIMARY-owner resolution context threaded to each TaskItem. */
  permitEntLead: string | null;
  projectSchematicDesigners: string[];
  /** fix-123: cycle 0 intake_accepted. Drives the initial active phase
   *  (null → D&E, non-null → Permitting) AND the null↔non-null transition
   *  auto-snap. Was `defaultBucket: 'de' | 'pm'` pre-fix-123 (derived
   *  from c0.submitted, not intake_accepted). */
  c0IntakeAccepted: string | null;
  /** fix-123: whether the permit currently has an open corrections cycle
   *  (any review cycle with corr_issued but no resubmitted). When true,
   *  the Permitting-phase Add input shows "Add correction…" instead of
   *  the generic "Add permitting task…" — matches Bobby's screenshot 1. */
  inCorrections: boolean;
}) {
  const treeQ = usePermitTaskTree(permitId);
  const team = useTeamMembers();
  // fix-233: the assignee pickers offer CURRENT team members only (active +
  // non-former) — departed staff never appear as selectable options.
  const memberNames = useMemo(
    () => activeMemberNamesOf(team.all),
    [team.all],
  );
  // Stable reference so the bucket-totals + visible memos below don't churn
  // when treeQ.data is undefined (the `?? []` literal is a fresh array per
  // render without this wrapper).
  const tasks = useMemo(() => treeQ.data ?? [], [treeQ.data]);

  // fix-79 / fix-123: D&E / Permitting phase tabs. Clicking a tab swaps the
  // active phase; the columns below filter to that phase's tasks and the
  // "+ Add task" input lands new rows with bucket=activePhase.
  const [activeBucket, setActiveBucket] = useState<'de' | 'pm'>(
    c0IntakeAccepted ? 'pm' : 'de',
  );

  // fix-123: auto-snap on the c0.intake_accepted null↔non-null transition.
  // Strictly gated by the transition itself (not "every render") so a user
  // who manually toggled to D&E on a post-intake permit STAYS on D&E until
  // intake_accepted actually changes. Bobby's v1 behavior — see PR brief.
  const prevC0IntakeRef = useRef<string | null>(c0IntakeAccepted);
  useEffect(() => {
    const prev = prevC0IntakeRef.current;
    const curr = c0IntakeAccepted;
    const wasNull = prev === null;
    const isNull = curr === null;
    if (wasNull && !isNull) setActiveBucket('pm');
    else if (!wasNull && isNull) setActiveBucket('de');
    prevC0IntakeRef.current = curr;
  }, [c0IntakeAccepted]);

  const bucketTotals = useMemo(() => {
    // fix-123: chip shows {done}/{total} per Bobby's spec. Pre-fix-123 this
    // was {open}/{total} — the resolved-count framing matches the v1
    // "you've completed N of M" mental model better.
    const counters: Record<'de' | 'pm', { done: number; total: number }> = {
      de: { done: 0, total: 0 },
      pm: { done: 0, total: 0 },
    };
    for (const t of tasks) {
      const b = t.bucket;
      if (b !== 'de' && b !== 'pm') continue;
      counters[b].total += 1;
      if (t.status === 'Resolved') counters[b].done += 1;
    }
    return counters;
  }, [tasks]);

  const visible = useMemo(
    () => tasks.filter((t) => t.bucket === activeBucket),
    [tasks, activeBucket],
  );

  // fix-123: phase color drives BOTH the active phase tab background AND
  // the Add task button on each discipline column. D&E = --color-de
  // (blue); Permitting = --color-co (orange — Bobby's screenshots show
  // orange for the v1 Permitting tab, not the v2 --color-pm green).
  const phaseAccent =
    activeBucket === 'de' ? 'var(--color-de)' : 'var(--color-co)';

  return (
    <div className="flex flex-col" data-testid="pd-v2-tasks-panel">
      <BucketBars
        active={activeBucket}
        totals={bucketTotals}
        onSelect={setActiveBucket}
      />
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {DISCIPLINES.map((d) => (
          <DisciplineColumn
            key={d.key}
            discipline={d.key}
            title={d.label}
            accent={d.accent}
            phaseAccent={phaseAccent}
            permitId={permitId}
            projectId={projectId}
            permitDa={permitDa}
            permitEntLead={permitEntLead}
            projectSchematicDesigners={projectSchematicDesigners}
            activeBucket={activeBucket}
            inCorrections={inCorrections}
            tasks={visible.filter((t) => t.discipline === d.key)}
            memberNames={memberNames}
            borderLeft={d.key === 'arch'}
          />
        ))}
      </div>
    </div>
  );
}

/** fix-79 / fix-123: D&E / Permitting phase tabs. Bobby's v1 hierarchy:
 *  active tab = SOLID phase color background, white bold text; inactive
 *  tab = washed (light) phase-color background, muted text. Same size for
 *  both so the only visual cue is color. Permitting uses --color-co
 *  (orange) — Bobby's v1 used orange for Permitting, not --color-pm green.
 *  Count chip shows {done}/{total}, also a fix-123 spec call (was
 *  {open}/{total} pre-fix-123). */
function BucketBars({
  active,
  totals,
  onSelect,
}: {
  active: 'de' | 'pm';
  totals: Record<'de' | 'pm', { done: number; total: number }>;
  onSelect: (b: 'de' | 'pm') => void;
}) {
  const BARS = [
    {
      key: 'de' as const,
      label: 'D&E',
      accent: 'var(--color-de)',
      washedBg: 'var(--color-de-bg)',
    },
    {
      key: 'pm' as const,
      label: 'Permitting',
      accent: 'var(--color-co)',
      washedBg: 'var(--color-co-bg)',
    },
  ];
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '1fr 1fr',
        borderBottom: '1px solid var(--color-border)',
      }}
      data-testid="pd-v2-task-bucket-bars"
    >
      {BARS.map((b) => {
        const isActive = active === b.key;
        const { done, total } = totals[b.key];
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => onSelect(b.key)}
            className="px-4 py-2.5 text-center cursor-pointer transition-colors"
            style={{
              background: isActive ? b.accent : b.washedBg,
              color: isActive ? '#fff' : 'var(--color-muted)',
              fontWeight: isActive ? 800 : 600,
              borderRight:
                b.key === 'de' ? '1px solid var(--color-border)' : undefined,
            }}
            data-testid={`pd-v2-task-bucket-bar-${b.key}`}
            data-active={isActive ? 'true' : 'false'}
            aria-pressed={isActive}
          >
            <span className="text-[12px] uppercase tracking-wide">
              {b.label}
            </span>
            <span
              className="ml-2 text-[10px] font-mono"
              data-testid={`pd-v2-task-bucket-count-${b.key}`}
            >
              {done}/{total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DisciplineColumn({
  discipline,
  title,
  accent,
  phaseAccent,
  permitId,
  projectId,
  permitDa,
  permitEntLead,
  projectSchematicDesigners,
  activeBucket,
  inCorrections,
  tasks,
  memberNames,
  borderLeft,
}: {
  discipline: 'arch' | 'ent';
  title: string;
  accent: string;
  /** fix-224: permit DA for co-assignee role-token resolution. */
  permitDa: string | null;
  /** fix-228: ent lead + schematic designers for PRIMARY-owner resolution. */
  permitEntLead: string | null;
  projectSchematicDesigners: string[];
  /** fix-123: phase color (blue for de, orange for pm) used by the Add
   *  task button. The discipline color (`accent`) still owns the column
   *  header so the two axes stay visually distinct. */
  phaseAccent: string;
  permitId: number;
  /** fix-149: passed to each TaskItem for the Waiting On firm lookup. */
  projectId: string;
  /** fix-79: the lifecycle bucket the user is viewing. New tasks created from
   *  the "+ Add task" input land in this bucket. */
  activeBucket: 'de' | 'pm';
  /** fix-123: drives the Add input placeholder copy when activeBucket='pm'
   *  ("Add correction…" vs "Add permitting task…"). */
  inCorrections: boolean;
  tasks: TaskNode[];
  memberNames: string[];
  borderLeft?: boolean;
}) {
  const upsert = useUpsertTask();
  const [draft, setDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);

  // fix-156: priority tasks (incl. corr_issued auto-tasks, which set
  // priority=true) bubble to the top of the column — parity with My Tasks'
  // priority sort. Stable otherwise: the RPC already orders by sort_order,
  // created_at, and V8's sort is stable, so equal-priority rows keep that order.
  const active = tasks
    .filter((t) => t.status !== 'Resolved')
    .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  const done = tasks.filter((t) => t.status === 'Resolved');

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    // fix-79: pass the renamed `discipline` arg + the explicit lifecycle
    // `bucket` so a task added while viewing Permitting lands in Permitting
    // rather than getting the trigger's c0.submitted default.
    upsert.mutate({
      permitId,
      discipline,
      bucket: activeBucket,
      text,
      status: 'Open',
    });
    setDraft('');
  }

  return (
    <div
      className="p-3 flex flex-col gap-1.5"
      style={
        borderLeft ? { borderLeft: '1px solid var(--color-border)' } : undefined
      }
      data-testid={`pd-v2-task-col-${discipline}`}
    >
      <div
        className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b"
        style={{ color: accent, borderBottomColor: 'var(--color-border)' }}
      >
        {title}
      </div>
      {active.length === 0 ? (
        <div
          className="text-[11px] italic"
          style={{ color: 'var(--color-dim)' }}
        >
          None assigned
        </div>
      ) : (
        active.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            permitId={permitId}
            projectId={projectId}
            permitDa={permitDa}
            permitEntLead={permitEntLead}
            projectSchematicDesigners={projectSchematicDesigners}
            memberNames={memberNames}
          />
        ))
      )}
      {done.length > 0 && (
        <button
          type="button"
          onClick={() => setDoneOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-1 mt-2 rounded border cursor-pointer text-left"
          style={{
            background: 'var(--color-s2)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-muted)',
          }}
        >
          <span style={{ fontSize: 9 }}>{doneOpen ? '▼' : '▶'}</span>
          <span style={{ fontSize: 10 }}>Completed ({done.length})</span>
        </button>
      )}
      {doneOpen &&
        done.map((t) => (
          <div key={t.id} style={{ opacity: 0.65 }}>
            <TaskItem
              task={t}
              permitId={permitId}
              projectId={projectId}
              permitDa={permitDa}
              permitEntLead={permitEntLead}
              projectSchematicDesigners={projectSchematicDesigners}
              memberNames={memberNames}
            />
          </div>
        ))}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          // fix-123: phase-driven placeholder copy (mirrors v1). The
          // column position + header still conveys discipline; the
          // placeholder now signals the LIFECYCLE PHASE the new task
          // will land in. Permitting + open corrections cycle → "Add
          // correction…" (screenshot 1); plain Permitting → "Add
          // permitting task…"; D&E → "Add D&E task…" (screenshot 2).
          placeholder={
            activeBucket === 'de'
              ? 'Add D&E task…'
              : inCorrections
                ? 'Add correction…'
                : 'Add permitting task…'
          }
          className="flex-1 text-[11px] px-2 py-1 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          data-testid={`pd-v2-task-add-${discipline}`}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="text-[11px] px-3 py-1 rounded font-bold transition disabled:opacity-50"
          // fix-123: Add button takes the PHASE color (blue/orange), not
          // the discipline color (was `accent` / discipline-blue or
          // discipline-purple pre-fix-123). Bobby's screenshots show the
          // button matching the active phase tab, not the column header.
          style={{ background: phaseAccent, color: '#fff' }}
          data-testid={`pd-v2-task-add-btn-${discipline}`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function TaskItem({
  task,
  permitId,
  projectId,
  permitDa,
  permitEntLead,
  projectSchematicDesigners,
  memberNames,
  isSubtask,
}: {
  task: TaskNode;
  permitId: number;
  /** fix-149: resolves the project's External Team firm for the Waiting On
   *  discipline (sub-label on the chip). */
  projectId: string;
  /** fix-224: permit DA for co-assignee role-token resolution. */
  permitDa: string | null;
  /** fix-228: ent lead + schematic designers for PRIMARY-owner resolution. */
  permitEntLead: string | null;
  projectSchematicDesigners: string[];
  memberNames: string[];
  isSubtask?: boolean;
}) {
  const upsert = useUpsertTask();
  const remove = useDeleteTask();
  const setAssignees = useSetTaskAssignees();
  const dmRows = useDmDaGroups().rows;
  // fix-224: resolve co-assignee role tokens (design_associate / design_manager /
  // schematic_designer) to the actual person for THIS permit, shared with My
  // Tasks via taskTeam.
  const assigneeCtx: ResolutionContext = {
    da: permitDa,
    dm: findDmForDa(permitDa ?? '', dmRows),
    schematicDesigners: projectSchematicDesigners,
  };
  // fix-228: the PRIMARY-owner resolution context (adds ent lead) + the resolved
  // primary person (default = the DA). Shared taxonomy with My Tasks.
  const primaryCtx: PrimaryResolutionContext = {
    da: permitDa,
    entLead: permitEntLead,
    dm: findDmForDa(permitDa ?? '', dmRows),
    schematicDesigners: projectSchematicDesigners,
  };
  const primaryPerson = resolvePrimaryAssignee(task.assigned_to, primaryCtx, task.discipline);
  // fix-149 / fix-190d: External Team firm assigned for each discipline on this
  // project — resolved from projects.external_team (the store the editor writes),
  // the single source My Tasks → Waiting also reads.
  const externalTeam = useProjectExternalTeamBlob(projectId);
  const [textDraft, setTextDraft] = useState(task.text);
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState('');
  const resolved = task.status === 'Resolved';

  // The RPC does a full UPDATE, so always send the task's current values and
  // override only the field(s) that changed.
  function save(
    patch: Partial<{
      discipline: 'arch' | 'ent';
      text: string;
      status: 'Open' | 'In Progress' | 'Resolved';
      startDate: string | null;
      targetDate: string | null;
      // fix-149: Waiting On uses the 3-state nullable contract — set waitingOn
      // to a discipline, or clearWaitingOn=true to NULL it. Other unsent
      // nullable fields (assignedTo/dueDate/notes…) stay "leave unchanged".
      waitingOn: string | null;
      clearWaitingOn: boolean;
      // fix-228: the PRIMARY owner (team key / role / person) written to
      // assigned_to. Absent → "leave unchanged".
      assignedTo: string;
    }>,
  ) {
    upsert.mutate({
      id: task.id,
      permitId,
      parentTaskId: task.parent_task_id,
      // fix-79: pass the renamed discipline + preserve the existing bucket
      // (edits don't move tasks between D&E and Permitting; the user moves
      // them by toggling the BucketBars + re-creating, intentionally).
      discipline: task.discipline,
      bucket: task.bucket,
      text: task.text,
      status: task.status,
      startDate: task.start_date,
      targetDate: task.target_date,
      sortOrder: task.sort_order,
      ...patch,
    });
  }

  function commitText() {
    const t = textDraft.trim();
    if (!t || t === task.text) return;
    save({ text: t });
  }
  function addSubtask() {
    const t = subDraft.trim();
    if (!t) return;
    // fix-79: subtasks inherit the parent's bucket.
    upsert.mutate({
      permitId,
      parentTaskId: task.id,
      discipline: task.discipline,
      bucket: task.bucket,
      text: t,
      status: 'Open',
    });
    setSubDraft('');
    setAddingSub(false);
  }
  // fix-149: firm assigned for this task's Waiting On discipline (sub-label).
  const waitingOnFirm = externalTeam.resolve(task.waiting_on);

  return (
    <div
      className="flex flex-col gap-1 py-1"
      style={
        isSubtask
          ? { paddingLeft: 16, borderLeft: '2px solid var(--color-border)' }
          : undefined
      }
      data-testid={`task-row-${task.id}`}
    >
      <div className="flex items-start gap-1.5">
        {task.is_auto_generated && (
          <span className="mt-0.5">
            <BotBadge taskId={task.id} event={task.auto_event} />
          </span>
        )}
        {/* fix-235: click-to-advance checkbox — Open → In Progress → Resolved,
            forward-only (Resolved is terminal; reopen via the Status dropdown).
            Shares transition rules with My Tasks via taskStatus.ts. */}
        <button
          type="button"
          onClick={() => {
            const next = nextCheckboxStatus(task.status);
            if (next) save({ status: next });
          }}
          disabled={checkboxVisual(task.status) === 'checked' || upsert.isPending}
          title={
            checkboxVisual(task.status) === 'checked'
              ? 'Resolved — use the status dropdown to reopen'
              : 'Click to advance: Open → In Progress → Resolved'
          }
          className="flex-shrink-0 mt-0.5 rounded-sm border"
          style={{
            width: 13,
            height: 13,
            background:
              checkboxVisual(task.status) === 'checked'
                ? 'var(--color-pm)'
                : checkboxVisual(task.status) === 'partial'
                  ? 'var(--color-de)'
                  : 'transparent',
            borderColor:
              checkboxVisual(task.status) === 'checked'
                ? 'var(--color-pm)'
                : 'var(--color-border)',
            color: '#fff',
            fontSize: 9,
            lineHeight: '11px',
            cursor:
              checkboxVisual(task.status) === 'checked' ? 'default' : 'pointer',
          }}
          data-testid={`task-check-${task.id}`}
          data-status-visual={checkboxVisual(task.status)}
        >
          {checkboxVisual(task.status) === 'checked' ? '✓' : ''}
        </button>
        <input
          type="text"
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="flex-1 min-w-0 text-[11px] bg-transparent border-0 outline-none"
          style={{
            color: 'var(--color-text)',
            textDecoration: resolved ? 'line-through' : 'none',
            opacity: resolved ? 0.65 : 1,
          }}
          data-testid={`task-text-${task.id}`}
        />
        {!isSubtask && (
          <select
            value={task.discipline}
            onChange={(e) =>
              save({ discipline: e.target.value as 'arch' | 'ent' })
            }
            title="Discipline"
            className="text-[10px] px-1 py-0.5 border rounded outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid={`task-bucket-${task.id}`}
          >
            <option value="ent">ENT</option>
            <option value="arch">Arch</option>
          </select>
        )}
        <select
          value={task.status}
          onChange={(e) =>
            save({ status: e.target.value as 'Open' | 'In Progress' | 'Resolved' })
          }
          title="Status"
          className="text-[10px] px-1 py-0.5 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          data-testid={`task-status-${task.id}`}
        >
          {TASK_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete task "${task.text}"?`))
              remove.mutate({ id: task.id, permitId });
          }}
          className="flex-shrink-0 px-1 text-[12px] cursor-pointer"
          style={{
            color: 'var(--color-dim)',
            background: 'transparent',
            border: 0,
          }}
          title="Delete task"
          data-testid={`task-delete-${task.id}`}
        >
          ×
        </button>
      </div>
      {/* fix-228/229 line (b): the primary control leads (owner is understood
          from position — no "Primary" label) + a light "Co" label before the
          co-assignee chips (fix-224 shared editor; a co-assignee equal to the
          primary is de-duped). */}
      <div
        className="flex flex-wrap items-center gap-1.5 text-[10px]"
        style={{ color: 'var(--color-muted)' }}
      >
        <PrimaryAssigneeEditor
          value={task.assigned_to}
          discipline={task.discipline}
          ctx={primaryCtx}
          memberNames={memberNames}
          disabled={upsert.isPending}
          onChange={(next) => save({ assignedTo: next })}
          testIdPrefix={`pb-${task.id}`}
        />
        <span
          className="uppercase tracking-wide ml-1"
          style={{ color: 'var(--color-dim)' }}
        >
          Co
        </span>
        <CoAssigneeEditor
          values={task.co_assignees}
          ctx={assigneeCtx}
          memberNames={memberNames}
          primaryPerson={primaryPerson}
          onChange={(next) =>
            setAssignees.mutate({ taskId: task.id, permitId, assignees: next })
          }
          testIdPrefix={`pb-${task.id}`}
        />
      </div>
      {/* fix-229 line (c): one calm, muted meta line — Start / Target /
          Waiting-On / Done, with "+ subtask" pushed to the right. */}
      <div
        className="flex flex-wrap items-center gap-2 text-[10px]"
        style={{ color: 'var(--color-muted)' }}
      >
        <span className="inline-flex items-center gap-1">
          <span style={{ color: 'var(--color-dim)' }}>Start</span>
          <TaskDateField
            value={task.start_date}
            onChange={(v) => save({ startDate: v })}
            disabled={upsert.isPending}
            ariaLabel="Start date"
            testId={`task-start-${task.id}`}
          />
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ color: 'var(--color-dim)' }}>Target</span>
          <TaskDateField
            value={task.target_date}
            onChange={(v) => save({ targetDate: v })}
            disabled={upsert.isPending}
            ariaLabel="Target date"
            testId={`task-target-${task.id}`}
          />
        </span>
        {/* fix-229: Waiting-On — ONE consistent inline control whether set or
            empty (a single select), with the resolved firm as a muted suffix. */}
        <span className="inline-flex items-center gap-1">
          <span style={{ color: 'var(--color-dim)' }}>Waiting</span>
          <select
            value={task.waiting_on ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') save({ waitingOn: null, clearWaitingOn: true });
              else save({ waitingOn: v });
            }}
            className="text-[10px] px-1 py-0.5 border rounded outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: task.waiting_on ? 'var(--color-text)' : 'var(--color-dim)',
            }}
            title="Waiting on (external discipline)"
            aria-label="Waiting on"
            data-testid={`task-waiting-on-${task.id}`}
          >
            <option value="">—</option>
            {WAITING_ON_OPTIONS.map((d) => (
              <option
                key={d}
                value={d}
                data-testid={`task-waiting-on-${task.id}-option-${d}`}
              >
                {d}
              </option>
            ))}
          </select>
          {task.waiting_on && waitingOnFirm && (
            <span
              style={{ color: 'var(--color-dim)' }}
              data-testid={`task-waiting-on-${task.id}-firm`}
            >
              → {waitingOnFirm}
            </span>
          )}
        </span>
        <span data-testid={`task-done-${task.id}`}>
          Done: {task.done_at ? task.done_at.slice(0, 10) : '—'}
        </span>
        {!isSubtask && (
          <button
            type="button"
            onClick={() => setAddingSub((v) => !v)}
            className="cursor-pointer underline ml-auto"
            style={{ background: 'transparent', border: 0, color: 'var(--color-de)' }}
            data-testid={`task-add-subtask-${task.id}`}
          >
            + subtask
          </button>
        )}
      </div>
      {addingSub && !isSubtask && (
        <div className="flex items-center gap-2" style={{ paddingLeft: 16 }}>
          <input
            type="text"
            value={subDraft}
            onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSubtask();
            }}
            placeholder="Subtask…"
            className="flex-1 text-[11px] px-2 py-1 border rounded outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid={`task-subtask-input-${task.id}`}
          />
          <button
            type="button"
            onClick={addSubtask}
            disabled={!subDraft.trim()}
            className="text-[11px] px-2 py-1 rounded font-bold disabled:opacity-50"
            style={{ background: 'var(--color-de)', color: '#fff' }}
            data-testid={`task-subtask-add-${task.id}`}
          >
            Add
          </button>
        </div>
      )}
      {(task.subtasks ?? []).map((s) => (
        <TaskItem
          key={s.id}
          task={s}
          permitId={permitId}
          projectId={projectId}
          permitDa={permitDa}
          permitEntLead={permitEntLead}
          projectSchematicDesigners={projectSchematicDesigners}
          memberNames={memberNames}
          isSubtask
        />
      ))}
    </div>
  );
}

// ============================================================
// Sidebar: Status strip + Cycle History + Issue Dates
// ============================================================

function Sidebar({
  permit,
  cycles,
  stage,
  viewIdx,
  onSelectCycle,
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
  /** fix-188: the canonical (reviewer-aware) stage computed once by the parent.
   *  Pre-fix the Sidebar recomputed effectiveStage(permit, cycles) WITHOUT
   *  reviewers, which could disagree with the header badge + the other
   *  surfaces. Only used here for the Corr. Round card's accent color. */
  stage: Stage;
  /** fix-109: the currently viewed cycle (Design=0 or review=1+). The
   *  smart Add Cycle inside CycleHistory derives the new cycle's
   *  submitted date from THIS cycle, and the parent's view auto-
   *  switches to the freshly created cycle. */
  viewIdx: number;
  onSelectCycle: (idx: number) => void;
}) {
  const upsertCycle = useUpsertPermitCycle();
  const removeCycle = useDeletePermitCycle();
  const corrRounds = cycles.filter((c) => c.corr_issued).length;
  // Corrections counts come from permit_tasks via usePermitTasks. Read once.
  const tasksQ = usePermitTasks(permit.id);
  const coTasks = (tasksQ.data ?? []).filter((t) => t.bucket === 'co');
  const corrOpen = coTasks.filter((t) => t.completion_status === 'Open').length;
  const corrRes = coTasks.filter((t) => t.completion_status === 'Resolved').length;
  const corrTotal = coTasks.length;

  return (
    <aside
      className="p-3 flex flex-col gap-3 overflow-y-auto"
      style={{
        background: 'var(--color-bg)',
        borderLeft: '1px solid var(--color-border)',
      }}
      data-testid="pd-v2-sidebar"
    >
      {/* Status strip */}
      <div className="grid grid-cols-2 gap-2">
        <StatusCard
          label="Corr. Round"
          value={corrRounds === 0 ? '—' : String(corrRounds)}
          sub={
            corrRounds === 0
              ? 'No corrections yet'
              : corrRounds === 1
                ? 'Round 1'
                : `Round ${corrRounds}`
          }
          fg={STAGE_FG[stage]}
          bg="var(--color-s2)"
          border="var(--color-border)"
        />
        <StatusCard
          label="Corrections"
          value={String(corrTotal)}
          sub={`${corrRes} resolved · ${corrOpen} open`}
          fg="var(--color-co)"
          bg="var(--color-co-bg)"
          border="var(--color-co-border)"
        />
      </div>

      {/* Cycle History */}
      <SidebarWidget title={`Cycle History${corrRounds > 0 ? ` · ${corrRounds} round${corrRounds === 1 ? '' : 's'}` : ''}`}>
        <CycleHistory
          permit={permit}
          cycles={cycles}
          upsertCycle={upsertCycle}
          removeCycle={removeCycle}
          viewIdx={viewIdx}
          onSelectCycle={onSelectCycle}
        />
      </SidebarWidget>

      {/* Q9.5.f-fix-11: Schedule Estimator — sits between Cycle History
          and Issue Dates per v1 :4845. Pulls cross-tenant data via hooks
          internally, no extra prop drilling needed. */}
      <ScheduleEstimator permit={permit} />

      {/* Issue Dates */}
      <SidebarWidget title="Issue Dates">
        <IssueDates permit={permit} />
      </SidebarWidget>
    </aside>
  );
}

function StatusCard({
  label,
  value,
  sub,
  fg,
  bg,
  border,
}: {
  label: string;
  value: string;
  sub: string;
  fg: string;
  bg: string;
  border: string;
}) {
  return (
    <div
      className="rounded-lg p-2 text-center border"
      style={{ background: bg, borderColor: border }}
    >
      <div
        className="text-[8px] uppercase tracking-wide font-bold"
        style={{ color: fg, opacity: 0.7 }}
      >
        {label}
      </div>
      <div
        className="font-extrabold leading-none mt-1"
        style={{ fontSize: 24, color: fg }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[9px]"
        style={{ color: 'var(--color-muted)' }}
      >
        {sub}
      </div>
    </div>
  );
}

function SidebarWidget({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border bg-surface overflow-hidden"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div
        className="px-3 py-1.5 border-b text-[10px] font-extrabold uppercase tracking-wide"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function CycleHistory({
  permit,
  cycles,
  upsertCycle,
  removeCycle,
  viewIdx,
  onSelectCycle,
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
  upsertCycle: ReturnType<typeof useUpsertPermitCycle>;
  removeCycle: ReturnType<typeof useDeletePermitCycle>;
  /** fix-109: the currently viewed cycle; used to source the new
   *  cycle's submitted date in smart Add Cycle and to advance the
   *  view to the freshly created cycle after the RPC resolves. */
  viewIdx: number;
  onSelectCycle: (idx: number) => void;
}) {
  const visible = cycles.filter(
    (c) =>
      c.submitted || c.city_target || c.corr_issued || c.resubmitted,
  );

  // fix-109 (smart Add Cycle): the "source" cycle the new submitted
  // date comes from. Prefer the cycle the user is currently viewing —
  // that's where their attention is, and resubmitted/corr_issued there
  // is the chronological seed for the next cycle. When the user is on
  // Design (viewIdx=0), fall back to the latest review cycle so the
  // button still works after a cycle 1 fills in. When there are no
  // review cycles at all (and viewIdx=0), the button stays disabled
  // and the user adds cycle 1 by setting Initial Submit on Design,
  // which fires the snap via the existing fix-25a-b path.
  const sourceCycle =
    cycles.find((c) => c.cycle_index === viewIdx) ??
    (cycles.length > 0 ? cycles[cycles.length - 1] : null);
  const seedDate = sourceCycle?.resubmitted ?? sourceCycle?.corr_issued ?? null;
  const seedFromCorrIssued =
    !!sourceCycle &&
    !sourceCycle.resubmitted &&
    !!sourceCycle.corr_issued;
  const addDisabledReason = !sourceCycle
    ? 'No review cycles yet — set Initial Submit on Design to start.'
    : !seedDate
      ? 'Set Resubmitted on this cycle before adding the next one.'
      : null;

  if (visible.length === 0) {
    return (
      <div
        className="px-3 py-3 text-[11px] italic text-center"
        style={{ color: 'var(--color-dim)' }}
      >
        No review cycles yet. Set a "Submitted" date on Cycle 1 to start.
      </div>
    );
  }

  async function handleAddCycle() {
    if (addDisabledReason || !seedDate) return;
    const nextIndex = cycles.length
      ? Math.max(...cycles.map((c) => c.cycle_index)) + 1
      : 1;
    // fix-109: write the seeded submitted date alongside the new
    // cycle_index. This sidesteps the rare bp_upsert_permit_cycle_row
    // auto-snap failure (Bobby's 6505 21st Ave NW: cycle 1 resubmitted
    // saved but cycle 2 never created) by making the user-initiated
    // path explicit + pre-filled instead of relying on the server-side
    // snap to fire on the previous cycle's resubmitted edit.
    await upsertCycle.mutateAsync({
      op: 'insert',
      permitId: permit.id,
      projectId: permit.project_id,
      cycleIndex: nextIndex,
      patch: { submitted: seedDate },
    });
    // Switch the view to the freshly created cycle so the user lands
    // on it. The auto-advance useEffect in PermitDetailV2 also catches
    // this on the next render, but the explicit call is immediate +
    // covers cache-timing edge cases.
    onSelectCycle(nextIndex);
  }

  function handleDelete(cycle: PermitCycle) {
    if (!window.confirm(`Delete Cycle ${cycle.cycle_index}? This removes all its dates.`)) return;
    removeCycle.mutate({ cycle, permitId: permit.id, projectId: permit.project_id });
  }

  return (
    <div className="max-h-[280px] overflow-y-auto">
      {visible.map((c) => {
        const dur = computeReviewDuration(c, permit);
        return (
          <div
            key={c.id}
            className="px-3 py-2 border-b flex flex-col gap-1"
            style={{ borderBottomColor: 'var(--color-border)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-bold"
                style={{ color: 'var(--color-text)' }}
              >
                Cycle {c.cycle_index}
                {c.cycle_index === 1
                  ? ': First Review'
                  : `: Round ${c.cycle_index - 1}`}
              </span>
              <div className="flex items-center gap-2">
                {dur && (
                  <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>
                    {dur}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(c)}
                  title="Delete cycle"
                  className="text-[12px] cursor-pointer leading-none"
                  style={{ color: 'var(--color-dim)', background: 'transparent', border: 0, padding: 0 }}
                >
                  ×
                </button>
              </div>
            </div>
            {c.submitted && (
              <CycleHistRow label="submitted" value={c.submitted} color="var(--color-de)" />
            )}
            {c.corr_issued && (
              <CycleHistRow label="corr. issued" value={c.corr_issued} color="var(--color-co)" />
            )}
            {c.resubmitted && (
              <CycleHistRow label="resubmitted" value={c.resubmitted} color="var(--color-pm)" />
            )}
          </div>
        );
      })}
      {permit.actual_issue && (
        <div
          className="px-3 py-2 border-b"
          style={{
            background: 'var(--color-pm-bg)',
            borderBottomColor: 'var(--color-border)',
          }}
        >
          <CycleHistRow
            label="permit issued"
            value={`${permit.actual_issue} ✓`}
            color="var(--color-is)"
          />
        </div>
      )}
      <button
        type="button"
        onClick={handleAddCycle}
        disabled={!!addDisabledReason || upsertCycle.isPending}
        title={addDisabledReason ?? undefined}
        className="w-full px-3 py-2 text-[10px] font-bold border-t cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          borderTopColor: 'var(--color-border)',
          color: addDisabledReason ? 'var(--color-dim)' : 'var(--color-de)',
          background: 'transparent',
        }}
        data-testid="pd-v2-add-cycle"
      >
        + Add cycle
        {seedDate && (
          <span
            className="text-[9px] font-normal block mt-0.5"
            style={{ color: 'var(--color-dim)' }}
            data-testid="pd-v2-add-cycle-seed"
          >
            {seedFromCorrIssued
              ? `Pre-filled from corrections date (${seedDate}) — adjust if your team resubmitted on a different day.`
              : `Pre-filled submitted = ${seedDate}`}
          </span>
        )}
      </button>
    </div>
  );
}

function CycleHistRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span style={{ color: 'var(--color-dim)' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

function computeReviewDuration(c: PermitCycle, permit: Permit): string | null {
  if (c.submitted && c.corr_issued) {
    const days = Math.round(
      (new Date(c.corr_issued + 'T12:00:00').getTime() -
        new Date(c.submitted + 'T12:00:00').getTime()) /
        86400000,
    );
    return `${days}d review`;
  }
  if (c.submitted && permit.actual_issue && !c.corr_issued) {
    const days = Math.round(
      (new Date(permit.actual_issue + 'T12:00:00').getTime() -
        new Date(c.submitted + 'T12:00:00').getTime()) /
        86400000,
    );
    return `${days}d → issued`;
  }
  return null;
}

function IssueDates({ permit }: { permit: PermitWithCycles }) {
  const updateMutation = useUpdatePermit();
  const occMissing = !permit.updated_at;

  async function commit<K extends keyof Permit>(
    field: K,
    next: Permit[K],
    original: Permit[K],
    label: string,
  ) {
    if (!permit.updated_at) return;
    if (next === original) return;
    await updateMutation.mutateAsync({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { [field]: next } as Partial<Permit>,
      fieldLabel: label,
    });
  }

  const variance =
    permit.expected_issue && permit.actual_issue
      ? Math.round(
          (new Date(permit.actual_issue + 'T12:00:00').getTime() -
            new Date(permit.expected_issue + 'T12:00:00').getTime()) /
            86400000,
        )
      : null;

  // fix-52: builder-side wait = (actual_issue ?? today) − approval_date. This
  // is the BUILDER's clock (time between city approval and the builder pulling
  // the permit), NOT team/city review time — the team clock already stops at
  // approval_date. Ongoing until actual_issue is set. `today` is captured once
  // (useMemo) to keep render pure, matching the codebase's today idiom
  // (IntakeTracker / ScheduleBenchmarks).
  const today = useMemo(() => new Date(), []);
  const builderWait = permit.approval_date
    ? Math.round(
        ((permit.actual_issue
          ? new Date(permit.actual_issue + 'T12:00:00').getTime()
          : today.getTime()) -
          new Date(permit.approval_date + 'T12:00:00').getTime()) /
          86400000,
      )
    : null;

  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      <IssueDateField
        label="ACQ Target Date"
        labelColor="var(--color-dim)"
        value={permit.expected_issue}
        disabled={occMissing}
        onCommit={(v) =>
          commit('expected_issue', v || null, permit.expected_issue, 'ACQ Target')
        }
      />
      <IssueDateField
        label="Approval Date"
        labelColor="var(--color-pm)"
        sub="(city approved)"
        value={permit.approval_date}
        accent
        accentBg="var(--color-jv-bg)"
        accentBorder="var(--color-jv)"
        accentFg="var(--color-jv)"
        disabled={occMissing}
        onCommit={(v) =>
          commit('approval_date', v || null, permit.approval_date, 'Approval Date')
        }
      />
      <IssueDateField
        label="Actual Issue"
        labelColor={permit.actual_issue ? 'var(--color-is)' : 'var(--color-dim)'}
        sub="(builder pulls)"
        value={permit.actual_issue}
        accent
        accentBg={permit.actual_issue ? '#0a2a1e' : 'var(--color-bg)'}
        accentBorder={permit.actual_issue ? '#166534' : 'var(--color-border)'}
        accentFg={permit.actual_issue ? 'var(--color-is)' : 'var(--color-text)'}
        disabled={occMissing}
        onCommit={(v) =>
          commit('actual_issue', v || null, permit.actual_issue, 'Actual Issue')
        }
      />
      {variance !== null && (
        <div
          className="text-[10px] font-bold"
          style={{ color: variance <= 0 ? 'var(--color-pm)' : '#dc2626' }}
        >
          {Math.abs(variance)}d {variance <= 0 ? 'ahead of' : 'behind'} expected
        </div>
      )}
      {/* fix-52: builder-side wait (approval → issued/today). Labeled as the
          builder's clock so it isn't mistaken for team/city review time. */}
      {builderWait !== null && builderWait >= 0 && (
        <div className="text-[10px] text-dim" data-testid="pd-builder-wait">
          <span className="font-bold text-text">{builderWait}d</span> builder
          wait{permit.actual_issue ? '' : ' (ongoing)'} · since approval
        </div>
      )}
    </div>
  );
}

function IssueDateField({
  label,
  labelColor,
  sub,
  value,
  accent,
  accentBg,
  accentBorder,
  accentFg,
  disabled,
  onCommit,
}: {
  label: string;
  labelColor: string;
  sub?: string;
  value: string | null;
  accent?: boolean;
  accentBg?: string;
  accentBorder?: string;
  accentFg?: string;
  disabled: boolean;
  onCommit: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  // fix-39 Track B: sync the prop into the draft when `value` changes after
  // mount (commit merge, refetch, scraper overwrite). Without this the Issue
  // Dates field froze at its mount-time value — it lacked the value→draft sync
  // DateCell got in fix-24c, so a saved approval_date could show stale or,
  // after a null refetch, blank.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value ?? '');
  }, [value]);
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[9px] uppercase tracking-wide font-bold"
        style={{ color: labelColor }}
      >
        {label}
        {sub && (
          <span className="ml-1 font-normal" style={{ color: 'var(--color-dim)' }}>
            {sub}
          </span>
        )}
      </span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void onCommit(draft)}
        disabled={disabled}
        className="text-[11px] px-2 py-1 border rounded outline-none disabled:opacity-50"
        style={{
          background: accent ? accentBg : 'var(--color-bg)',
          borderColor: accent ? accentBorder : 'var(--color-border)',
          color: accent ? accentFg : 'var(--color-text)',
        }}
      />
    </div>
  );
}
