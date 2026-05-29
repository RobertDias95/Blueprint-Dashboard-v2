import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveStage } from '../../lib/permitStage';
import {
  getHighlightedMilestone,
  isMilestoneHighlighted,
  type HighlightTarget,
} from '../../lib/permitHelpers';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import { usePermitTasks } from '../../hooks/usePermitTasks';
import {
  useUpsertPermitCycle,
  type CyclePatch,
  type DateField,
} from '../../hooks/useUpsertPermitCycle';
import { useDeletePermitCycle } from '../../hooks/useDeletePermitCycle';
// fix-70: v1-parity task system — discipline buckets, multi-assign, subtasks,
// status workflow. Replaces the old single-assignee TasksPanel.
import {
  usePermitTaskTree,
  useUpsertTask,
  useDeleteTask,
  useSetTaskAssignees,
} from '../../hooks/useTaskTree';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import type {
  Permit,
  PermitCycle,
  PermitWithCycles,
  Project,
  Stage,
  TaskNode,
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
  const stage = effectiveStage(permit, cycles);
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
        <TasksPanel permitId={permit.id} />
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
  // Drop the transient overlay when the viewed cycle changes. React's
  // "adjust state during render" pattern (https://react.dev/learn/you-might-
  // not-need-an-effect#adjusting-some-state-when-a-prop-changes) — avoids an
  // effect + the cascading-render it would cost.
  const [overlayViewIdx, setOverlayViewIdx] = useState(viewIdx);
  if (overlayViewIdx !== viewIdx) {
    setOverlayViewIdx(viewIdx);
    setDraftOverlay(null);
  }
  function handleDraftChange(milestone: HighlightTarget, value: string) {
    setDraftOverlay({ milestone, value });
  }
  function handleDraftClear(milestone: HighlightTarget) {
    setDraftOverlay((prev) =>
      prev && isMilestoneHighlighted(prev.milestone, milestone) ? null : prev,
    );
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
      })
      .catch(() => {
        lastCommittedRef.current = prev;
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
      data-testid={testid}
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
        // fix-25-DD: local-only on change. Calendar nav arrows /
        // intermediate keystrokes only update the visible value;
        // no mutation fires until blur or Enter.
        // fix-35 Bug 3: also report the draft to the parent so the highlight
        // snaps now — this is a visual overlay only, still no mutation.
        onChange={(e) => {
          setDraft(e.target.value);
          // fix-73: any user edit marks the draft dirty, gating the
          // value-prop-sync effect so an OCC refetch can't wipe it.
          setDirty(true);
          if (milestone) onDraftChange?.(milestone, e.target.value);
        }}
        onBlur={() => {
          tryCommit(draft);
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
const STATUS_OPTS = ['Open', 'In Progress', 'Resolved'] as const;

function TasksPanel({ permitId }: { permitId: number }) {
  const treeQ = usePermitTaskTree(permitId);
  const team = useTeamMembers();
  const memberNames = useMemo(
    () => team.all.map((m) => m.name).sort((a, b) => a.localeCompare(b)),
    [team.all],
  );
  const tasks = treeQ.data ?? [];

  return (
    <div className="flex flex-col" data-testid="pd-v2-tasks-panel">
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
            permitId={permitId}
            tasks={tasks.filter((t) => t.discipline === d.key)}
            memberNames={memberNames}
            borderLeft={d.key === 'arch'}
          />
        ))}
      </div>
    </div>
  );
}

function DisciplineColumn({
  discipline,
  title,
  accent,
  permitId,
  tasks,
  memberNames,
  borderLeft,
}: {
  discipline: 'arch' | 'ent';
  title: string;
  accent: string;
  permitId: number;
  tasks: TaskNode[];
  memberNames: string[];
  borderLeft?: boolean;
}) {
  const upsert = useUpsertTask();
  const [draft, setDraft] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);

  const active = tasks.filter((t) => t.status !== 'Resolved');
  const done = tasks.filter((t) => t.status === 'Resolved');

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    upsert.mutate({ permitId, bucket: discipline, text, status: 'Open' });
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
            <TaskItem task={t} permitId={permitId} memberNames={memberNames} />
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
          placeholder={`Add ${title} task…`}
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
          style={{ background: accent, color: '#fff' }}
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
  memberNames,
  isSubtask,
}: {
  task: TaskNode;
  permitId: number;
  memberNames: string[];
  isSubtask?: boolean;
}) {
  const upsert = useUpsertTask();
  const remove = useDeleteTask();
  const setAssignees = useSetTaskAssignees();
  const [textDraft, setTextDraft] = useState(task.text);
  const [addingSub, setAddingSub] = useState(false);
  const [subDraft, setSubDraft] = useState('');
  const resolved = task.status === 'Resolved';

  // The RPC does a full UPDATE, so always send the task's current values and
  // override only the field(s) that changed.
  function save(
    patch: Partial<{
      bucket: 'arch' | 'ent';
      text: string;
      status: 'Open' | 'In Progress' | 'Resolved';
      startDate: string | null;
      targetDate: string | null;
    }>,
  ) {
    upsert.mutate({
      id: task.id,
      permitId,
      parentTaskId: task.parent_task_id,
      bucket: task.discipline,
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
    upsert.mutate({
      permitId,
      parentTaskId: task.id,
      bucket: task.discipline,
      text: t,
      status: 'Open',
    });
    setSubDraft('');
    setAddingSub(false);
  }
  function removeAssignee(name: string) {
    setAssignees.mutate({
      taskId: task.id,
      permitId,
      assignees: task.co_assignees.filter((a) => a !== name),
    });
  }
  function addAssignee(name: string) {
    if (!name || task.co_assignees.includes(name)) return;
    setAssignees.mutate({
      taskId: task.id,
      permitId,
      assignees: [...task.co_assignees, name],
    });
  }

  const available = memberNames.filter((n) => !task.co_assignees.includes(n));

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
            onChange={(e) => save({ bucket: e.target.value as 'arch' | 'ent' })}
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
          {STATUS_OPTS.map((s) => (
            <option key={s} value={s}>
              {s}
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
      {/* assignees: derived primary (read-only) + removable co-assignee chips */}
      <div
        className="flex flex-wrap items-center gap-1 text-[10px]"
        style={{ color: 'var(--color-muted)' }}
      >
        {task.primary_assignee && (
          <span
            className="px-1.5 py-0.5 rounded font-bold"
            style={{ background: 'var(--color-s2)', color: 'var(--color-text)' }}
            title="Primary (derived from the permit's DA / ENT lead)"
            data-testid={`task-primary-${task.id}`}
          >
            {task.primary_assignee}
          </span>
        )}
        {task.co_assignees.map((name) => (
          <span
            key={name}
            className="px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
            data-testid={`task-assignee-${task.id}-${name}`}
          >
            {name}
            <button
              type="button"
              onClick={() => removeAssignee(name)}
              style={{
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                color: 'var(--color-dim)',
              }}
              title={`Remove ${name}`}
              data-testid={`task-unassign-${task.id}-${name}`}
            >
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => {
            addAssignee(e.target.value);
            e.currentTarget.value = '';
          }}
          className="text-[10px] px-1 py-0.5 border rounded outline-none"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-muted)',
          }}
          data-testid={`task-assign-${task.id}`}
          disabled={available.length === 0}
        >
          <option value="">+ Assign</option>
          {available.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {/* dates + subtask affordance */}
      <div
        className="flex flex-wrap items-center gap-2 text-[10px]"
        style={{ color: 'var(--color-muted)' }}
      >
        <label className="inline-flex items-center gap-1">
          Start
          <input
            type="date"
            value={task.start_date ?? ''}
            onChange={(e) => save({ startDate: e.target.value || null })}
            className="text-[10px] px-1 py-0.5 border rounded outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid={`task-start-${task.id}`}
          />
        </label>
        <label className="inline-flex items-center gap-1">
          Target
          <input
            type="date"
            value={task.target_date ?? ''}
            onChange={(e) => save({ targetDate: e.target.value || null })}
            className="text-[10px] px-1 py-0.5 border rounded outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            data-testid={`task-target-${task.id}`}
          />
        </label>
        <span data-testid={`task-done-${task.id}`}>
          Done: {task.done_at ? task.done_at.slice(0, 10) : '—'}
        </span>
        {!isSubtask && (
          <button
            type="button"
            onClick={() => setAddingSub((v) => !v)}
            className="cursor-pointer underline"
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
