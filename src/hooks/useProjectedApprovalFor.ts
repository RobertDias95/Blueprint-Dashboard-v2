import { useMemo } from 'react';
import { useAllPermitCycleReviewers } from './useAllPermitCycleReviewers';
import { usePermits } from './usePermits';
import { useProjects } from './useProjects';
import { usePermitTypeDefaults } from './usePermitTypeDefaults';
import { useAllProjectHolds, holdsByProjectId } from './useProjectHolds';
import {
  computeLearnedSchedule,
  filterHeldLearningSamples,
  type LearnedEstimate,
} from '../lib/scheduleBenchmarks';
import {
  computeProjectedApproval,
  type ProjectedApprovalResult,
} from '../lib/projectedApproval';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
} from '../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §B/§I (P-139) — ONE ASSEMBLY OF THE APPROVAL PROJECTION
// ===========================================================================
//
// §I: *"Estimated Approval and the Dates card's Est. approval / Approved must
// agree on every project (shared helper, §B); pin with one test."*
//
// ★★★ `lib/approvalDisplay` SHARES THE LABEL; THIS SHARES THE ANSWER. That
//     helper deliberately takes a `ProjectedApprovalResult` rather than the
//     inputs, because re-assembling a `ProjectedApprovalInput` is ~60 lines of
//     learner, siblings, cycle override, holds and type defaults — and a second
//     copy of THOSE is a second definition of the projection itself, which is
//     the failure §I exists to prevent and a strictly worse one than a second
//     copy of a caption. So the assembly is hoisted here instead of duplicated
//     into the Dates card, and both surfaces call one function.
//
// ★★ IT IS A HOOK AND NOT A PURE FUNCTION because every one of its five inputs
//    is a tenant-wide query. `ScheduleHealthTable` already holds all five;
//    lifting them here costs nothing at runtime (React Query hands back the
//    same cached results) and means the Dates card cannot be handed a subset
//    that quietly projects a different date — the exact shape of the fix-221
//    defect, where two surfaces disagreed about whether a permit was issued.
//
// ★ `computeProjectedApproval` itself is UNTOUCHED — it is on this brief's
//   "must not change" list. This moves the CALL, never the maths.

/**
 * The approval projection for one permit, assembled exactly as Schedule
 * Health's column 6 assembles it.
 *
 * Returns `null` when there is no permit to project — a project with no
 * Building Permit, which the brief rules must print `—` under an unchanged
 * label.
 */
export function useProjectedApprovalFor(
  permit: PermitWithCycles | null | undefined,
): ProjectedApprovalResult | null {
  const reviewersQ = useAllPermitCycleReviewers();
  const allPermitsQ = usePermits();
  const projectsQ = useProjects();
  const typeDefaultsQ = usePermitTypeDefaults();
  const holdsQ = useAllProjectHolds();

  const projectsById = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
    [projectsQ.data],
  );
  const holdsMap = useMemo(() => holdsByProjectId(holdsQ.data), [holdsQ.data]);
  // fix-170 effect E: a held permit is a parked turnaround, so it is dropped
  // from the learner's training set rather than skewing the averages.
  const learningPermits = useMemo(
    () => filterHeldLearningSamples(allPermitsQ.data ?? [], holdsMap),
    [allPermitsQ.data, holdsMap],
  );
  const reviewers = useMemo(() => {
    if (!permit) return [] as PermitCycleReviewer[];
    return (reviewersQ.data ?? []).filter((r) => r.permit_id === permit.id);
  }, [reviewersQ.data, permit]);

  // ★ `?? []` INSIDE the memo, not beside it: a bare fallback array is a NEW
  //   array every render, which makes the memo below re-run every time — the
  //   React Compiler lint rule points straight at it, and it is the same note
  //   `ConsultantBand` carries two files away.
  const allPermitsData = allPermitsQ.data;
  const typeDefaultsOverride = typeDefaultsQ.byType;

  return useMemo(() => {
    if (!permit) return null;
    const allPermits = allPermitsData ?? [];
    const juris = projectsById.get(permit.project_id)?.juris ?? '';
    const learnedEstimate =
      permit.type && juris
        ? computeLearnedSchedule(learningPermits, permit.type, juris, projectsById)
        : null;

    // Q9.5.f-fix-11: the ULS branch needs the sibling permits, their cycles and
    // their learned data to walk the BP anchor. Scoped to the same project —
    // that is where the Building Permit is.
    const siblings = allPermits.filter((p) => p.project_id === permit.project_id);
    const siblingCyclesByPermitId = new Map<number, PermitCycle[]>();
    const siblingLearnedByPermitId = new Map<number, LearnedEstimate | null>();
    for (const s of siblings) {
      siblingCyclesByPermitId.set(s.id, s.permit_cycles ?? []);
      siblingLearnedByPermitId.set(
        s.id,
        s.type && juris
          ? computeLearnedSchedule(learningPermits, s.type, juris, projectsById)
          : null,
      );
    }

    // Q9.5.f-fix-17 A: the estimator writes the user's +/- pick to
    // `extras.scheduleCycleOverride`; reading it back is what keeps both
    // widgets projecting the same date.
    const rawOverride = ((permit.extras ?? {}) as Record<string, unknown>)
      .scheduleCycleOverride;
    const cycleOverride =
      typeof rawOverride === 'number' && rawOverride >= 1 && rawOverride <= 4
        ? rawOverride
        : null;

    return computeProjectedApproval({
      permit,
      // fix-262 (fix-170 effect C): hold-aware projection.
      holds: holdsMap.get(permit.project_id),
      cycles: (permit.permit_cycles ?? [])
        .filter((c) => c.cycle_index !== 0)
        .sort((a, b) => a.cycle_index - b.cycle_index),
      // fix-53: cycle 0 is filtered out above, so its intake_accepted is
      // threaded in separately to anchor cycle-1 review at intake.
      cycle0IntakeAccepted:
        (permit.permit_cycles ?? []).find((c) => c.cycle_index === 0)
          ?.intake_accepted ?? null,
      learnedEstimate,
      projectGoDate: projectsById.get(permit.project_id)?.go_date ?? null,
      siblingPermits: siblings,
      siblingCyclesByPermitId,
      siblingLearnedByPermitId,
      targetCycleOverride: cycleOverride,
      typeDefaultsOverride,
      // fix-32: this permit's reviewers feed the corrections-cycle prediction.
      permitReviewers: reviewers,
    });
  }, [
    permit,
    allPermitsData,
    learningPermits,
    projectsById,
    holdsMap,
    typeDefaultsOverride,
    reviewers,
  ]);
}
