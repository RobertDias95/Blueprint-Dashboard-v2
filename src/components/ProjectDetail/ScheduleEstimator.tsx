import { useMemo } from 'react';
import { routeSentence } from '../../lib/estimatorRouteCopy';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { useAllPermitCycleReviewers } from '../../hooks/useAllPermitCycleReviewers';
import { useUpdatePermit } from '../../hooks/useUpdatePermit';
import {
  useAllProjectHolds,
  holdsByProjectId,
} from '../../hooks/useProjectHolds';
import {
  computeLearnedSchedule,
  filterHeldLearningSamples,
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
  // fix-32: per-reviewer state for the corrections-cycle prediction.
  // Tenant-scoped via RLS; we slice to THIS permit below.
  const reviewersQ = useAllPermitCycleReviewers();
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

  // fix-170 (effect E): drop held permits from the learner's training set so a
  // parked turnaround never skews the per-(type,juris) averages. No holds → the
  // same array back (common case unchanged).
  const holdsQ = useAllProjectHolds();
  const learningPermits = useMemo(
    () => filterHeldLearningSamples(allPermits, holdsByProjectId(holdsQ.data)),
    [allPermits, holdsQ.data],
  );

  const siblings = useMemo(
    () => allPermits.filter((p) => p.project_id === permit.project_id),
    [allPermits, permit.project_id],
  );
  const siblingCyclesByPermitId = useMemo(() => {
    const m = new Map<number, PermitCycle[]>();
    for (const s of siblings) m.set(s.id, s.permit_cycles ?? []);
    return m;
  }, [siblings]);

  const project = projectsById.get(permit.project_id);
  const projectJuris = project?.juris ?? '';
  const projectGoDate = project?.go_date ?? null;

  const learnedEstimate = useMemo(() => {
    if (!permit.type || !projectJuris) return null;
    return computeLearnedSchedule(
      learningPermits,
      permit.type,
      projectJuris,
      projectsById,
    );
  }, [learningPermits, permit.type, projectJuris, projectsById]);

  const siblingLearnedByPermitId = useMemo(() => {
    const m = new Map<number, LearnedEstimate | null>();
    for (const s of siblings) {
      if (!s.type || !projectJuris) {
        m.set(s.id, null);
        continue;
      }
      m.set(
        s.id,
        computeLearnedSchedule(learningPermits, s.type, projectJuris, projectsById),
      );
    }
    return m;
  }, [siblings, learningPermits, projectJuris, projectsById]);

  const permitReviewers = useMemo(
    () => (reviewersQ.data ?? []).filter((r) => r.permit_id === permit.id),
    [reviewersQ.data, permit.id],
  );

  // fix-262: the project's holds now go INTO the projection instead of being
  // applied as a display shift afterwards, so this widget, the draw-schedule
  // block and Schedule Health all read the same hold-aware date.
  const permitHolds = useMemo(
    () => holdsByProjectId(holdsQ.data).get(permit.project_id),
    [holdsQ.data, permit.project_id],
  );

  const result: ProjectedApprovalResult = useMemo(
    () =>
      computeProjectedApproval({
        permit,
        holds: permitHolds,
        cycles: (permit.permit_cycles ?? [])
          .filter((c) => c.cycle_index !== 0)
          .sort((a, b) => a.cycle_index - b.cycle_index),
        // fix-53: cycle 0 is filtered out above; pass its intake_accepted so
        // the projection anchors cycle-1 review at intake (matches the learner).
        cycle0IntakeAccepted:
          (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0)
            ?.intake_accepted ?? null,
        learnedEstimate,
        projectGoDate,
        siblingPermits: siblings,
        siblingCyclesByPermitId,
        siblingLearnedByPermitId,
        targetCycleOverride: cycleOverride,
        // fix-32: reviewer-corrections rule feeds into targetCycle.
        permitReviewers,
      }),
    [permit, permitHolds, learnedEstimate, projectGoDate, siblings, siblingCyclesByPermitId, siblingLearnedByPermitId, cycleOverride, permitReviewers],
  );

  /**
   * ★★★ fix-493 §B (P-152) — WHAT THE STEPPER SHOWS ON A SHORTCUT ESTIMATE.
   *
   * On `holistic_learned` the projection's `targetCycle` is **1**, and that 1
   * is a code-path marker: the branch never walks cycles (see
   * lib/projectedApproval). Printing it put a bold **1** directly above
   * fix-491's own footnote saying *"…9 in 10 needed two or more correction
   * rounds"* — the widget contradicting itself in two adjacent lines.
   *
   * ★★ SO IT SHOWS THE LEARNER'S ACTUAL PICK, which is the number the sentence
   *    is about. Bobby, 2026-09-04: show the likely cycle and step from it.
   *
   * ★★★ ONLY ON `holistic_learned`. `holistic_default` has no learner and
   *     therefore no likely cycle — its footnote already says the date is the
   *     per-type default, so the stepper keeps showing `targetCycle` rather
   *     than inventing a cohort that does not exist. Every walk route already
   *     shows the cycle it actually walked to.
   *
   * ★ And once somebody sets an override, `cycleOverride` is the truth on every
   *   route — that is what they asked for.
   */
  const displayedCycle =
    cycleOverride ??
    (result.route === 'holistic_learned'
      ? (result.routeFacts?.mostLikelyCycle ?? result.targetCycle ?? 1)
      : (result.targetCycle ?? 1));

  function adjustOverride(delta: number) {
    if (!permit.updated_at) return;
    // ★★★ fix-493: the base is THE NUMBER ON SCREEN. It used to be
    //     `result.targetCycle`, so on a shortcut estimate the first press
    //     stepped from 1 — moving the visible 3 to 2, backwards, for no reason
    //     a reader could see. A stepper must step from what it is showing.
    const base = displayedCycle;
    const next = Math.max(1, Math.min(8, base + delta));
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

  // fix-170 (effect C) / fix-262: the shift now happens INSIDE
  // computeProjectedApproval (holds are passed in above), so `result.projection`
  // is already hold-aware. This value is only the badge annotation — applying it
  // to the date again here would double-count the hold.
  const heldShiftDays = result.heldShiftDays ?? 0;

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
            current={displayedCycle}
            // ★ fix-493: on a shortcut estimate the number is the learner's
            //   likely cycle, not a walked target — so the control says so.
            hint={
              result.route === 'holistic_learned' && cycleOverride === null
                ? 'Likely approval cycle for this permit type — press to set your own'
                : undefined
            }
            overridden={cycleOverride !== null}
            disabled={updatePermit.isPending || !permit.updated_at}
            onDec={() => adjustOverride(-1)}
            onInc={() => adjustOverride(+1)}
            onClear={clearOverride}
          />
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <HeadlineProjection result={result} shiftDays={heldShiftDays} />
        {result.targetCycle === 0 && result.ulsAnchors && (
          <UlsAnchorBlock anchors={result.ulsAnchors} />
        )}
        {result.targetCycle !== undefined && result.targetCycle > 1 && (
          <PerRoundBlock result={result} cycles={cycles} />
        )}
        <SourceNote
          result={result}
          permitType={permit.type}
          juris={projectJuris}
        />
      </div>
    </div>
  );
}

function HeadlineProjection({
  result,
  shiftDays = 0,
}: {
  result: ProjectedApprovalResult;
  shiftDays?: number;
}) {
  const label = result.isActual
    ? 'Actual / Approved'
    : result.isProjected
      ? 'Estimated Approval'
      : 'Projection';
  const color = result.isActual ? 'var(--color-is)' : 'var(--color-pm)';
  // fix-262: result.projection arrives already hold-shifted from
  // computeProjectedApproval. shiftDays is the annotation only.
  const shifted = result.projection;
  return (
    <div>
      <div
        className="text-[8px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--color-dim)' }}
      >
        {label}
        {shiftDays > 0 && !result.isActual && (
          <span style={{ color: 'var(--color-co)' }}> · +{shiftDays}d on hold</span>
        )}
      </div>
      <div
        className="text-sm font-mono font-bold mt-0.5"
        style={{ color }}
        data-testid="pd-v2-estimate-projection"
      >
        {shifted ?? '—'}
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
      <AnchorRow label="BP Approval Anchor" value={anchors.bpApprovalAnchor} />
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
          {/* ★★★ fix-491 §C — THE NOTE NOW SAYS "GREY DATES ARE PROJECTED",
              SO THE DATES HAD TO BECOME GREY. They were `--color-text` and
              italic, which is to say: the same colour as everything else, and
              a distinction carried entirely by a slant nobody reads as a
              legend. The italic STAYS (two signals beat one); the colour is
              what makes the sentence true. */}
          <span
            className="font-mono"
            style={{
              color: it.isReal ? 'var(--color-pm)' : 'var(--color-muted)',
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
  hint,
  onDec,
  onInc,
  onClear,
}: {
  current: number;
  overridden: boolean;
  disabled: boolean;
  /** ★ fix-493: what this number MEANS on the current route. Supplied only on
   *  a shortcut estimate, where it is the learner's likely cycle rather than a
   *  cycle anything walked to. */
  hint?: string;
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
        // ★★ fix-493: three states, three sentences. An override says so; a
        //    shortcut estimate says what the number is (it is NOT a walked
        //    target); anything else keeps the label it had.
        title={
          overridden
            ? 'Manual override — click ✕ to clear'
            : (hint ?? 'Learner pick')
        }
        aria-label={
          overridden
            ? `Target cycle ${current}, set by hand`
            : (hint ?? `Target cycle ${current}`)
        }
        data-testid="estimator-cycle-current"
      >
        {current}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={disabled || current >= 8}
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

/**
 * ★★★ fix-491 §B/§C (P-117) — THE FOOTNOTE NAMES ITS ROUTE, IN NUMBERS.
 *
 * ---------------------------------------------------------------------------
 * ★★★ WHAT THIS REPLACES, AND WHY IT WAS WRONG RATHER THAN MERELY TERSE
 * ---------------------------------------------------------------------------
 * It used to branch on `result.targetCycle === 1` and print *"Holistic
 * projection — learner expects approval in the first review with no
 * corrections."* On the holistic branch that `1` is a CODE-PATH MARKER — the
 * branch never walks cycles — and the date is `intake + avgIntakeToApproval`,
 * an average that ALREADY CONTAINS the correction rounds of the permits it was
 * drawn from. The learner's real pick for `554 N 75th St`'s cohort is cycle 3;
 * cycle 1 was 0 of 32. **The sentence attributed to the learner a claim the
 * learner never made**, which is exactly what Bobby caught.
 *
 * The other branch read *"Walked N correction rounds + final review buffer.
 * Italic values are derived; ✓ marks real cycle data."* — engineering slang and
 * a glyph used as a word. He read it aloud as *"block two correction rounds…
 * R drive, mark…"*.
 *
 * ★★ SO THE COMPONENT NO LONGER INFERS ANYTHING. `computeProjectedApproval`
 *    reports which branch it took (`result.route`) and the numbers that branch
 *    used (`result.routeFacts`); `routeSentence` turns those into the wording
 *    Bobby approved on 2026-09-04. Nothing here decides what happened.
 *
 * ★★★ §C — 11px REGULAR, MUTED, AND THAT IS A STEP **UP** FROM THE BODY.
 *     The widget's body is `text-[10px]` and its labels `text-[8px]`; this note
 *     was `text-[9px] italic` in `--color-dim`, i.e. the smallest and faintest
 *     thing in a box of small faint things — while being the one sentence
 *     anybody actually reads. Bobby's ruling: *11px regular, muted*. Do not
 *     "normalise" it back down to match its neighbours.
 */
function SourceNote({
  result,
  permitType,
  juris,
}: {
  result: ProjectedApprovalResult;
  permitType?: string | null;
  juris?: string | null;
}) {
  const sentence = routeSentence(result.route, result.routeFacts, {
    type: permitType,
    juris,
  });
  // ★ `actual` returns null — a recorded date explains itself, exactly as
  //   before. So does an unknown route, rather than inventing a sentence.
  if (sentence === null) return null;
  return (
    <div
      className="text-[11px]"
      style={{ color: 'var(--color-muted)', fontStyle: 'normal' }}
      data-testid="estimator-source-note"
      data-route={result.route ?? 'unknown'}
    >
      {sentence}
    </div>
  );
}
