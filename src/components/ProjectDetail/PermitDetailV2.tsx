import { useMemo, useState } from 'react';
import { effectiveStage } from '../../lib/permitStage';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { usePermitTasks } from '../../hooks/usePermitTasks';
import {
  useUpsertPermitCycle,
  type CyclePatch,
  type DateField,
} from '../../hooks/useUpsertPermitCycle';
import { useDeletePermitCycle } from '../../hooks/useDeletePermitCycle';
import {
  useUpsertPermitTask,
  type TaskPatch,
} from '../../hooks/useUpsertPermitTask';
import { useDeletePermitTask } from '../../hooks/useDeletePermitTask';
import type {
  Permit,
  PermitCycle,
  PermitTask,
  PermitWithCycles,
  Project,
  Stage,
} from '../../lib/database.types';
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

const STAGE_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

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
  const stage = effectiveStage(permit, cycles);
  // Q9.5.f-fix-6 C: derive the permit's current phase + which cycle index
  // contains it. Drives both the initial viewed-cycle tab AND the date-
  // strip cell highlight.
  const currentPhase = useMemo(
    () => deriveCurrentPhase(permit, cycles),
    [permit, cycles],
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
  // D&E vs Permitting stage tab. v1 only shows 2 tabs.
  const [activeStage, setActiveStage] = useState<'de' | 'pm'>(
    stage === 'de' ? 'de' : 'pm',
  );

  return (
    <div className="flex flex-col gap-0 bg-surface" data-testid="permit-detail-v2">
      <HeaderStrip permit={permit} stage={stage} />
      <CycleTabBar
        cycles={cycles}
        viewIdx={viewCycleIdx}
        onSelect={setViewCycleIdx}
      />
      <SeattleIntakeRow permit={permit} juris={project?.juris ?? null} />
      <DateStrip
        permit={permit}
        cycles={cycles}
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
          activeStage={activeStage}
          onChangeStage={setActiveStage}
        />
        <Sidebar permit={permit} cycles={cycles} />
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
    updateMutation.mutate({
      permitId: permit.id,
      projectId: permit.project_id,
      expectedUpdatedAt: permit.updated_at,
      patch: { intake_date: normalized } as Partial<Permit>,
      fieldLabel: 'Seattle Intake',
    });
  }

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
      <span className="text-[9px] text-muted">
        Scheduled intake with Seattle portal — syncs to Intake Tracker
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
  // Always show Design + Cycle 1. Hide trailing empty cycles after that
  // (v1 :3132 — hide ≥cy2 empties unless they're the viewed one).
  // Q9.5.f-fix-6 A: tab labels and idx come straight from cycle_index now
  // — no `i + 1` math, so cycle_index=0 placeholders that snuck in or non-
  // contiguous indices after a delete display correctly.
  const visible = useMemo(() => {
    const out: { idx: number; label: string; empty: boolean }[] = [
      { idx: 0, label: 'Design', empty: false },
    ];
    cycles.forEach((c) => {
      const realIdx = c.cycle_index;
      const empty =
        !c.submitted && !c.city_target && !c.corr_issued && !c.resubmitted;
      if (realIdx > 1 && empty && viewIdx !== realIdx) return;
      out.push({ idx: realIdx, label: `Cycle ${realIdx}`, empty });
    });
    return out;
  }, [cycles, viewIdx]);

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

// ============================================================
// Date strip: cycle-aware grid of editable date cells
// ============================================================

function DateStrip({
  permit,
  cycles,
  viewIdx,
  currentPhase,
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
  viewIdx: number;
  currentPhase: CurrentPhaseResult;
}) {
  // Q9.5.f-fix-6 C: highlight predicate. A cell is "current" when the
  // permit's derived phase points at it AND the user is viewing the same
  // cycle (or Design for permit-level design dates). Approval / Actual
  // are permit-level — they show inside whichever review cycle is viewed,
  // so we highlight them as long as the permit is in that phase, no
  // cycle-index check needed.
  const isCurrent = (cellPhase: CurrentPhase): boolean => {
    if (currentPhase.phase !== cellPhase) return false;
    if (cellPhase === 'actual_issue' || cellPhase === 'approval') return true;
    if (currentPhase.cycleIndex === null) return viewIdx === 0;
    return viewIdx === currentPhase.cycleIndex;
  };
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

  if (viewIdx === 0) {
    // Q9.5.f-fix-8 A: Design tab now shows the journey from project kickoff
    // to official intake (GO → Target Submit → Initial Submit → Intake
    // Accepted). DD Start/End dropped from this view — they live on the
    // permit schema for legacy data + ledger consumption, but no longer
    // clutter the day-to-day Design workflow. Once intake_accepted is set,
    // the user moves on to Cycle 1 view for review tracking.
    const cycle1 = cycles.find((c) => c.cycle_index === 1) ?? null;
    async function commitCycle1Field(field: DateField, next: string) {
      const normalized = next || null;
      if (cycle1) {
        await upsertCycle.mutateAsync({
          op: 'update',
          permitId: permit.id,
          projectId: permit.project_id,
          cycle: cycle1,
          patch: { [field]: normalized } as CyclePatch,
        });
        return;
      }
      // No cycle 1 yet — first edit creates it.
      if (!normalized) return; // don't auto-create on a blur-clear with no data
      await upsertCycle.mutateAsync({
        op: 'insert',
        permitId: permit.id,
        projectId: permit.project_id,
        cycleIndex: 1,
        patch: { [field]: normalized } as CyclePatch,
      });
    }
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
          value={permit.go_date}
          highlighted={isCurrent('go')}
          onCommit={(v) => commitPermit('go_date', v || null, permit.go_date, 'GO Date')}
        />
        <DateCell
          label="Target Submit"
          accentColor="var(--color-de)"
          value={permit.target_submit}
          highlighted={isCurrent('target_submit')}
          onCommit={(v) =>
            commitPermit('target_submit', v || null, permit.target_submit, 'Target Submit')
          }
        />
        <DateCell
          label="Initial Submit"
          accentColor="var(--color-pm)"
          value={cycle1?.submitted ?? null}
          highlighted={isCurrent('submitted')}
          onCommit={(v) => commitCycle1Field('submitted', v)}
        />
        <DateCell
          label="Intake Accepted"
          accentColor="var(--color-pm)"
          value={cycle1?.intake_accepted ?? null}
          highlighted={isCurrent('intake_accepted')}
          onCommit={(v) => commitCycle1Field('intake_accepted', v)}
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
        highlighted={isCurrent('submitted')}
        onCommit={(v) => commitCycleField(cycle, 'submitted', v)}
      />
      <DateCell
        label="City Target"
        accentColor="var(--color-pm)"
        value={cycle.city_target}
        highlighted={isCurrent('city_target')}
        onCommit={(v) => commitCycleField(cycle, 'city_target', v)}
      />
      <DateCell
        label="Corr. Issued"
        accentColor="var(--color-co)"
        value={cycle.corr_issued}
        highlighted={isCurrent('corr_issued')}
        onCommit={(v) => commitCycleField(cycle, 'corr_issued', v)}
      />
      <DateCell
        label="Resubmitted"
        accentColor="var(--color-pm)"
        value={cycle.resubmitted}
        highlighted={isCurrent('resubmitted')}
        onCommit={(v) => commitCycleField(cycle, 'resubmitted', v)}
      />
      <DateCell
        label="Approval Date"
        accentColor="var(--color-jv)"
        value={permit.approval_date}
        highlighted={isCurrent('approval')}
        onCommit={(v) =>
          commitPermit(
            'approval_date',
            v || null,
            permit.approval_date,
            'Approval Date',
          )
        }
      />
      <DateCell
        label="Actual Issue"
        accentColor="var(--color-is)"
        value={permit.actual_issue}
        highlighted={isCurrent('actual_issue')}
        onCommit={(v) =>
          commitPermit('actual_issue', v || null, permit.actual_issue, 'Actual Issue')
        }
      />
    </div>
  );
}

function DateCell({
  label,
  value,
  accentColor,
  highlighted,
  onCommit,
}: {
  label: string;
  value: string | null;
  accentColor?: string;
  // Q9.5.f-fix-6 C: when true, this cell is the permit's current phase.
  // Render an inset blue outline + bg tint so the eye lands on it.
  highlighted?: boolean;
  onCommit: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
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
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[8px] font-bold uppercase tracking-wide"
          style={{ color: accentColor ?? 'var(--color-dim)' }}
        >
          {label}
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
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void onCommit(draft)}
        className="text-[11px] px-1.5 py-0.5 border rounded outline-none w-full"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
      />
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
  if (permit.go_date) return { phase: 'go', cycleIndex: null };
  return { phase: null, cycleIndex: null };
}

// ============================================================
// Tasks panel: stage tabs + Entitlements/Architecture split
// ============================================================

const ASSIGNEE_OPTS = ['Entitlements', 'Architecture'] as const;

function TasksPanel({
  permitId,
  activeStage,
  onChangeStage,
}: {
  permitId: number;
  activeStage: 'de' | 'pm';
  onChangeStage: (s: 'de' | 'pm') => void;
}) {
  const tasksQ = usePermitTasks(permitId);
  const upsert = useUpsertPermitTask();
  const remove = useDeletePermitTask();
  const [draft, setDraft] = useState('');
  const [draftAssignee, setDraftAssignee] = useState<(typeof ASSIGNEE_OPTS)[number]>(
    'Entitlements',
  );

  // For v2 fix-5: D&E = bucket 'de'; Permitting = buckets 'pm' OR 'co'
  // (mirrors v1's merging — index.html:4840 maps "Permitting" tab to 'co').
  const tasks = tasksQ.data ?? [];
  const bucketSet =
    activeStage === 'de' ? new Set(['de']) : new Set(['pm', 'co']);
  const visible = tasks.filter((t) => bucketSet.has(t.bucket));
  const ent = visible.filter((t) => (t.assigned_to ?? '') !== 'Architecture');
  const arch = visible.filter((t) => t.assigned_to === 'Architecture');

  const deCount = tasks.filter((t) => t.bucket === 'de');
  const pmCount = tasks.filter((t) => t.bucket === 'pm' || t.bucket === 'co');
  const tabBadge = (list: PermitTask[]) =>
    `${list.filter((t) => t.done || t.completion_status === 'Resolved').length}/${list.length}`;

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    const bucket = activeStage === 'de' ? 'de' : 'co';
    upsert.mutate({
      op: 'insert',
      permitId,
      patch: {
        bucket,
        text,
        completion_status: 'Open',
        stage: bucket,
        assigned_to: draftAssignee,
      },
    });
    setDraft('');
  }

  return (
    <div className="flex flex-col" data-testid="pd-v2-tasks-panel">
      <div
        className="flex border-b"
        style={{ borderBottomColor: 'var(--color-border)' }}
      >
        <StageTab
          label="D&E"
          stage="de"
          active={activeStage === 'de'}
          badge={tabBadge(deCount)}
          onClick={() => onChangeStage('de')}
        />
        <StageTab
          label="Permitting"
          stage="co"
          active={activeStage === 'pm'}
          badge={tabBadge(pmCount)}
          onClick={() => onChangeStage('pm')}
        />
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <TaskColumn
          title="Entitlements"
          accent="var(--color-de)"
          tasks={ent}
          upsert={upsert}
          remove={remove}
          permitId={permitId}
        />
        <TaskColumn
          title="Architecture"
          accent="var(--color-jv)"
          tasks={arch}
          upsert={upsert}
          remove={remove}
          permitId={permitId}
          borderLeft
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder={
            activeStage === 'de' ? 'Add D&E task…' : 'Add permitting task…'
          }
          className="flex-1 text-[11px] px-2 py-1 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          data-testid="pd-v2-task-add-text"
        />
        <select
          value={draftAssignee}
          onChange={(e) =>
            setDraftAssignee(e.target.value as (typeof ASSIGNEE_OPTS)[number])
          }
          className="text-[11px] px-2 py-1 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          data-testid="pd-v2-task-add-assignee"
        >
          {ASSIGNEE_OPTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={upsert.isPending || !draft.trim()}
          className="text-[11px] px-3 py-1 rounded font-bold transition disabled:opacity-50"
          style={{
            background:
              activeStage === 'de' ? 'var(--color-de)' : 'var(--color-co)',
            color: '#fff',
          }}
          data-testid="pd-v2-task-add-btn"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function StageTab({
  label,
  stage,
  active,
  badge,
  onClick,
}: {
  label: string;
  stage: Stage;
  active: boolean;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wide border-r last:border-r-0 cursor-pointer"
      style={{
        borderRightColor: 'var(--color-border)',
        background: active ? STAGE_BG[stage] : 'transparent',
        color: active ? STAGE_FG[stage] : 'var(--color-muted)',
        borderBottom: active ? `2px solid ${STAGE_FG[stage]}` : '2px solid transparent',
      }}
      data-testid={`pd-v2-stage-tab-${stage}`}
    >
      {label}
      <span
        className="ml-1.5 text-[9px] font-mono"
        style={{ opacity: active ? 1 : 0.6 }}
      >
        {badge}
      </span>
    </button>
  );
}

function TaskColumn({
  title,
  accent,
  tasks,
  upsert,
  remove,
  permitId,
  borderLeft,
}: {
  title: string;
  accent: string;
  tasks: PermitTask[];
  upsert: ReturnType<typeof useUpsertPermitTask>;
  remove: ReturnType<typeof useDeletePermitTask>;
  permitId: number;
  borderLeft?: boolean;
}) {
  const active = tasks.filter((t) => !isResolved(t));
  const done = tasks.filter(isResolved);
  const [doneOpen, setDoneOpen] = useState(false);
  return (
    <div
      className="p-3 flex flex-col gap-1.5"
      style={
        borderLeft
          ? { borderLeft: '1px solid var(--color-border)' }
          : undefined
      }
    >
      <div
        className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b"
        style={{ color: accent, borderBottomColor: 'var(--color-border)' }}
      >
        {title}
      </div>
      {active.length === 0 ? (
        <div className="text-[11px] italic" style={{ color: 'var(--color-dim)' }}>
          None assigned
        </div>
      ) : (
        active.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            upsert={upsert}
            remove={remove}
            permitId={permitId}
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
      {doneOpen && (
        <div style={{ opacity: 0.65 }}>
          {done.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              upsert={upsert}
              remove={remove}
              permitId={permitId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  upsert,
  remove,
  permitId,
}: {
  task: PermitTask;
  upsert: ReturnType<typeof useUpsertPermitTask>;
  remove: ReturnType<typeof useDeletePermitTask>;
  permitId: number;
}) {
  const [textDraft, setTextDraft] = useState(task.text);
  const resolved = isResolved(task);

  function patch(p: TaskPatch) {
    upsert.mutate({ op: 'update', permitId, task, patch: p });
  }
  function toggle() {
    if (task.bucket === 'co') {
      patch({ completion_status: resolved ? 'Open' : 'Resolved' });
    } else {
      patch({ done: !task.done });
    }
  }
  function commitText() {
    if (textDraft.trim() === task.text) return;
    patch({ text: textDraft.trim() });
  }

  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        title="Toggle complete"
        className="flex-shrink-0 mt-0.5 rounded border cursor-pointer"
        style={{
          width: 14,
          height: 14,
          background: resolved ? 'var(--color-pm)' : 'transparent',
          borderColor: resolved ? 'var(--color-pm)' : 'var(--color-border)',
          color: '#fff',
          fontSize: 9,
          lineHeight: '12px',
        }}
        data-testid={`pd-v2-task-toggle-${task.id}`}
      >
        {resolved ? '✓' : ''}
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
          opacity: resolved ? 0.6 : 1,
        }}
        data-testid={`pd-v2-task-text-${task.id}`}
      />
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete task "${task.text}"?`))
            remove.mutate({ task, permitId });
        }}
        className="flex-shrink-0 px-1 text-[12px] cursor-pointer"
        style={{ color: 'var(--color-dim)', background: 'transparent', border: 0 }}
        title="Delete task"
      >
        ×
      </button>
    </div>
  );
}

function isResolved(task: PermitTask): boolean {
  if (task.bucket === 'co') return task.completion_status === 'Resolved';
  return !!task.done || task.completion_status === 'Resolved';
}

// ============================================================
// Sidebar: Status strip + Cycle History + Issue Dates
// ============================================================

function Sidebar({
  permit,
  cycles,
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
}) {
  const upsertCycle = useUpsertPermitCycle();
  const removeCycle = useDeletePermitCycle();
  const stage = effectiveStage(permit, cycles);
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
}: {
  permit: PermitWithCycles;
  cycles: PermitCycle[];
  upsertCycle: ReturnType<typeof useUpsertPermitCycle>;
  removeCycle: ReturnType<typeof useDeletePermitCycle>;
}) {
  const visible = cycles.filter(
    (c) =>
      c.submitted || c.city_target || c.corr_issued || c.resubmitted,
  );
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

  function handleAddCycle() {
    const nextIndex = cycles.length
      ? Math.max(...cycles.map((c) => c.cycle_index)) + 1
      : 1;
    upsertCycle.mutate({
      op: 'insert',
      permitId: permit.id,
      projectId: permit.project_id,
      cycleIndex: nextIndex,
      patch: {},
    });
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
        className="w-full px-3 py-2 text-[10px] font-bold border-t cursor-pointer"
        style={{
          borderTopColor: 'var(--color-border)',
          color: 'var(--color-de)',
          background: 'transparent',
        }}
        data-testid="pd-v2-add-cycle"
      >
        + Add cycle
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
