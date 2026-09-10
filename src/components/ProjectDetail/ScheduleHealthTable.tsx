import { useMemo, useState } from 'react';
import { approvalDisplay } from '../../lib/approvalDisplay';
import { effectiveStage } from '../../lib/permitStage';
import { STAGE_LABEL } from '../../lib/stageLabel';
import { isNotSubPermit } from '../../lib/subPermit';
import {
  PERMIT_SORT_FIRST_DIR,
  sortPermitRows,
  type PermitSortDir,
  type PermitSortKey,
  type PermitSortRow,
} from '../../lib/permitTableOrder';
import { useAllPermitCycleReviewers } from '../../hooks/useAllPermitCycleReviewers';
import { usePermits } from '../../hooks/usePermits';
import { useProjects } from '../../hooks/useProjects';
import { usePermitTypeDefaults } from '../../hooks/usePermitTypeDefaults';
import {
  useAllProjectHolds,
  holdsByProjectId,
} from '../../hooks/useProjectHolds';
import { hasActiveHold } from '../../lib/holdOverlap';
// ★ fix-508 §D/§H: the ACQ-target INPUT left this file with fix-63's cell —
//   `useUpdateProjectWithPermits` and `pushToast` went with it, because the
//   only write on this table was that one box.
import {
  TARGET_APPROVAL_DRIVER_LABEL,
  targetApproval,
  type TargetApproval,
} from '../../lib/targetApproval';
import { formatUsDate } from '../../lib/dateUtils';
import {
  computeLearnedSchedule,
  filterHeldLearningSamples,
  type LearnedEstimate,
} from '../../lib/scheduleBenchmarks';
import { computeProjectedApproval } from '../../lib/projectedApproval';
import { derivePermitStatus } from '../../lib/permitStatus';

import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  Stage,
} from '../../lib/database.types';
import ReviewerRollupChip from './ReviewerRollupChip';
import { LandUsePhaseBadge } from './LandUsePhaseBadge';
import InlineErrorBoundary from '../InlineErrorBoundary';

// ===========================================================================
// ★★★ fix-517 §A (P-219) — `SCHEDULE HEALTH` IS NOW `PERMITS`, AND IT IS THE
//     ONLY PERMITS LIST ON THE PROJECT OVERVIEW
// ===========================================================================
//
// Bobby, twice: *"Schedule health section gets renamed to Permits, and then
// Permits on the left-hand side of the screen is gone"*, and again with a
// screenshot of the heading. The left-hand rail (`PermitsSidebar`, deleted
// from `pages/ProjectDetail.tsx`) and this table were showing the same permits
// in two shapes four inches apart — *"all of that information is kind of
// redundant"*.
//
// ★★ THE COUNT SURVIVES AS A STRING. `PERMITS (6)` is the one thing the rail
//    did better than a table, and it keeps doing it — but it now counts THE
//    ROWS BELOW IT. The rail's own header excluded a redesign's permits
//    (they were a separate band with a separate count) while this table has
//    always rendered them, so a count copied across verbatim would have
//    disagreed with the list under it on every project that has a redesign.
//
// Columns (§B) — nine, one more than the eight this table shipped with:
//   1. Permit Type      — plus the STRUCTURE ADDRESS underneath, when there is
//                         one. NOT a column: 80 of 685 permits (11.7%) carry
//                         one, so a column would spend ~160px on every project
//                         to serve one row in eight and render an em dash on
//                         the other seven. Bobby, second pass: *"maybe we don't
//                         need a structure address unless we put one in in the
//                         project's details."*
//   2. Permit Number    — hyperlinked to the city portal. NEW column; it used
//                         to ride along inside the type cell in 9px mono.
//                         26 of 685 permits have no number and 587 of 685 have
//                         a portal URL, so the cell has three states and the
//                         row stays clickable in all three (§B).
//   3. Reviewers        — fix-31 rollup chip.
//   4. Stage            — coloured badge.
//   5. Permit Status    — fix-25e derived, falling back to permits.status.
//   6. Data Source      — Default / Learned(n) / CROSS-JURIS.
//   7. Permit Approval  — actual / approved / projected (fix-508 §H's rename).
//   8. Target Approval  — fix-508 §D, derived and read-only.
//   9. Schedule Health  — bucket on (projection − target):
//        diff ≤ -1  → "↑ On Track"    (green / --color-pm)
//        diff ≤ 14  → "→ At Risk"      (yellow / --color-co)
//        diff > 14  → "↓ Behind"       (red)
//        either date missing → "→ In Progress" (blue placeholder)
//
// fix-104: STAGE_LABEL lives in src/lib/stageLabel.ts because the deleted
// rail's breadcrumb and this table's Stage cell had to read the same words.
// The rail is gone; the module stays where it is — the Pipeline and the
// Library read it too.
// ===========================================================================

const STAGE_TINT: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

/**
 * ★★★ fix-517 §C — EVERY DERIVED VALUE IS COMPUTED ONCE, IN THE PARENT.
 *
 * Before this ticket each `Row` derived its own stage, projection, target and
 * health diff. That was fine for a table that could not be re-ordered. §C makes
 * the headers sortable, and **you cannot sort by a number only the child
 * knows** — so the derivation moved up here and the row became presentational.
 *
 * ★★ WHICH IS ALSO fix-512's RULING, GENERALISED. §A of that ticket made the
 *    badge and the column share ONE `targetApproval` object because *"a cell
 *    that recomputes is a cell that can drift from the number it is being
 *    compared against"*. A sort that recomputed would drift from the cells it
 *    was ordering — the same defect, one level up.
 */
interface PermitRowModel extends PermitSortRow {
  permit: PermitWithCycles;
  reviewers: PermitCycleReviewer[];
  fallbackReviewer: string | null;
  learnedEstimate: LearnedEstimate | null;
  juris: string;
  /** `approvalDisplay`'s word for what the Permit Approval date IS. */
  approvalLabel: string;
  statusDate: string | null;
  statusDetail: string | null;
  target: TargetApproval;
  structAddress: string | null;
  portalUrl: string | null;
  redesignLabel: string | null;
}

interface Props {
  permits: PermitWithCycles[];
  /**
   * ★★★ fix-517 §A — WHOSE PERMIT IS THIS?
   *
   * fix-151 made this table compute across the whole LINEAGE — the parent's
   * permits plus every redesign's — and the deleted rail said which was which
   * with a `Redesigns (n)` band and a heading per redesign. In one flat list
   * that fact has nowhere to live except the row, so it renders as a
   * `↳ Redesign 2` line under the permit type on the rows that have one.
   * Empty map (or omitted) on projects with no redesigns, which is most.
   */
  redesignLabelByPermitId?: Map<number, string>;
  /**
   * ★ fix-517 §D — a row click opens the Permit View, *"exactly as a rail row
   *   does today. That behaviour moves; it is not reinvented."* Optional so a
   *   test (or a future read-only surface) can render the table without one.
   */
  onSelect?: (permitId: number) => void;
  /** ★ fix-517 §E — the row's hover edit affordance. Opens Project Details →
   *  Permits, focused on this permit. */
  onEditPermit?: (permitId: number) => void;
}

export default function ScheduleHealthTable({
  permits,
  redesignLabelByPermitId,
  onSelect,
  onEditPermit,
}: Props) {
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

  // fix-170: all the tenant's holds, indexed by project. Effect D — a project
  // with an ACTIVE hold shows "On Hold" rather than Behind/At Risk. Effect E —
  // held permits are dropped from the learner's training set so a parked
  // turnaround doesn't skew the per-(type,juris) averages.
  const holdsQ = useAllProjectHolds();
  const holdsMap = useMemo(() => holdsByProjectId(holdsQ.data), [holdsQ.data]);
  // fix-170: the badge is masked to "On Hold" when a hold is open. fix-262: the
  // DATE next to it now respects the hold too — before this the column showed an
  // un-shifted Est. Approval beside an "On Hold" badge.
  const projectHolds = holdsMap.get(permits[0]?.project_id ?? '');
  const activeHold = hasActiveHold(projectHolds);
  const learningPermits = useMemo(
    () => filterHeldLearningSamples(allPermitsQ.data ?? [], holdsMap),
    [allPermitsQ.data, holdsMap],
  );

  // fix-194: a sub/child placeholder permit is reviewed under its parent — it
  // has no review schedule of its own, so it never gets a row here.
  const reviewablePermits = useMemo(
    () => permits.filter(isNotSubPermit),
    [permits],
  );

  const allPermits = allPermitsQ.data ?? [];
  const typeDefaultsOverride = typeDefaultsQ.byType;

  // =====================================================================
  // ★★★ THE ROW MODELS — one pass, every derived value, no hooks per row.
  // =====================================================================
  const rowModels = useMemo<PermitRowModel[]>(() => {
    // ★ Siblings were resolved per row before, which re-scanned the whole
    //   tenant's permits once per permit. One grouping pass instead.
    const siblingsByProject = new Map<string, PermitWithCycles[]>();
    for (const p of allPermits) {
      const list = siblingsByProject.get(p.project_id) ?? [];
      list.push(p);
      siblingsByProject.set(p.project_id, list);
    }
    // ★ The learner is keyed on (type, juris) and this table's rows share very
    //   few of those, but a redesign's permits and their parent's do — so one
    //   memo per key rather than one per permit.
    const learnedCache = new Map<string, LearnedEstimate | null>();
    function learnedFor(type: string | null, juris: string) {
      if (!type || !juris) return null;
      const key = `${type}::${juris}`;
      if (!learnedCache.has(key)) {
        learnedCache.set(
          key,
          computeLearnedSchedule(learningPermits, type, juris, projectsById),
        );
      }
      return learnedCache.get(key) ?? null;
    }

    return reviewablePermits.map((permit) => {
      const cycles = permit.permit_cycles ?? [];
      const reviewers = reviewersByPermit.get(permit.id) ?? [];
      const stage = effectiveStage(permit, cycles, reviewers);
      // fix-31: legacy fallback display for permit types whose adapter doesn't
      // yet capture per-reviewer rows (PA / IPR / SPU / Land Use / MBP /
      // Redmond). The scraper still observes a "latest_reviewer" name via
      // extras for those — surface it so the column isn't blank.
      const extrasObj = (permit.extras ?? {}) as Record<string, unknown>;
      const fallbackReviewer =
        typeof extrasObj.latest_reviewer === 'string' &&
        extrasObj.latest_reviewer.trim()
          ? (extrasObj.latest_reviewer as string)
          : null;

      const project: Project | null = projectsById.get(permit.project_id) ?? null;
      const juris = project?.juris ?? '';
      const learnedEstimate = learnedFor(permit.type, juris);

      // Q9.5.f-fix-11: the ULS branch needs sibling permits + their cycles +
      // per-permit learned data to compute the BP-anchor formula. Scope to the
      // same project — that's where v1 looks for the BP.
      const siblings = siblingsByProject.get(permit.project_id) ?? [];
      const siblingCyclesByPermitId = new Map<number, PermitCycle[]>();
      const siblingLearnedByPermitId = new Map<number, LearnedEstimate | null>();
      for (const s of siblings) {
        siblingCyclesByPermitId.set(s.id, s.permit_cycles ?? []);
        siblingLearnedByPermitId.set(s.id, learnedFor(s.type, juris));
      }

      // Q9.5.f-fix-17 A: bidirectional cycle override. ScheduleEstimator writes
      // the user's +/- pick to permit.extras.scheduleCycleOverride; this row
      // reads it back so both widgets project the same date.
      const rawOverride = extrasObj.scheduleCycleOverride;
      const cycleOverride =
        typeof rawOverride === 'number' && rawOverride >= 1 && rawOverride <= 4
          ? rawOverride
          : null;

      const projectedResult = computeProjectedApproval({
        permit,
        // fix-262 (fix-170 effect C): hold-aware projection.
        holds: projectHolds,
        cycles: cycles
          .filter((c) => c.cycle_index !== 0)
          .sort((a, b) => a.cycle_index - b.cycle_index),
        // fix-53: pass cycle 0's intake_accepted (filtered out above) so the
        // projection anchors cycle-1 review at intake (matches the learner).
        cycle0IntakeAccepted:
          cycles.find((c) => c.cycle_index === 0)?.intake_accepted ?? null,
        learnedEstimate,
        projectGoDate: project?.go_date ?? null,
        siblingPermits: siblings,
        siblingCyclesByPermitId,
        siblingLearnedByPermitId,
        targetCycleOverride: cycleOverride,
        typeDefaultsOverride,
        // fix-32: reviewers on this permit feed the corrections-cycle
        // prediction. Already loaded above for the chip rollup — reuse.
        permitReviewers: reviewers,
      });
      // ★★★ fix-506 §I: the label comes from the SHARED helper, so the Dates
      //     card's "Est. approval / Approved" and this column's "Est. Approval
      //     / Actual" can never disagree about which state a permit is in.
      const approval = approvalDisplay(projectedResult, 'scheduleHealth');

      // ★★★ fix-512 §A (P-204) — THE BADGE AND THE COLUMN MEASURE THE SAME
      //     DATE. Until that ticket the badge subtracted `permit.expected_issue`
      //     while the column beside it printed `targetApproval(...)`. Two dates,
      //     one row. `target` is derived ONCE here and handed to both readers.
      const target = targetApproval(project, permit);
      const healthDiff = computeHealthDiff(approval.date, target.date);
      const status = derivePermitStatus(permit, reviewers);

      // ★ The type label carries a Building Permit's nickname, which is the
      //   deleted rail's `displayLabel` — three BPs on one project were
      //   distinguishable there and were not distinguishable here.
      const typeLabel =
        permit.type === 'Building Permit' && permit.nickname
          ? `Building Permit — ${permit.nickname}`
          : permit.type ?? '—';

      // ★★★ fix-517 §0.2 — `projects.permit_order` IS STILL READ. It is the
      //     tiebreak WITHIN a phase, exactly as it was in the rail, so the 13
      //     prod projects that carry a hand-set order keep it.
      const order = Array.isArray(project?.permit_order)
        ? (project.permit_order as number[])
        : [];
      const oi = order.indexOf(permit.id);

      return {
        id: permit.id,
        permit,
        reviewers,
        fallbackReviewer,
        learnedEstimate,
        juris,
        typeLabel,
        num: permit.num ?? null,
        stage,
        statusLabel: status.label,
        statusDate: status.date ?? null,
        statusDetail: status.detail ?? null,
        sourceLabel: learnedEstimate
          ? `Learned (${learnedEstimate.sampleCount})`
          : 'Default',
        approvalIso: approval.date,
        approvalLabel: approval.label,
        target,
        targetIso: target.date,
        healthDiff,
        orderRank: oi === -1 ? Number.MAX_SAFE_INTEGER : oi,
        issuedIso: permit.actual_issue ?? permit.approval_date ?? null,
        structAddress: permit.struct_address ?? null,
        portalUrl: permit.portal_url ?? null,
        redesignLabel: redesignLabelByPermitId?.get(permit.id) ?? null,
      };
    });
  }, [
    reviewablePermits,
    reviewersByPermit,
    allPermits,
    learningPermits,
    projectsById,
    typeDefaultsOverride,
    projectHolds,
    redesignLabelByPermitId,
  ]);

  // ★★★ §C — SORT STATE. `default` is the phase order and is what the table
  //     renders with no click; clicking the active column flips it, and a
  //     third click on the SAME column returns to the default rather than
  //     leaving the reader stranded in an order they cannot undo.
  const [sort, setSort] = useState<{ key: PermitSortKey; dir: PermitSortDir }>({
    key: 'default',
    dir: 'asc',
  });
  function onSort(key: PermitSortKey) {
    setSort((s) => {
      if (s.key !== key) return { key, dir: PERMIT_SORT_FIRST_DIR[key] };
      if (s.dir === PERMIT_SORT_FIRST_DIR[key]) {
        return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key: 'default', dir: 'asc' };
    });
  }
  const sortedRows = useMemo(
    () => sortPermitRows(rowModels, sort.key, sort.dir),
    [rowModels, sort],
  );

  if (reviewablePermits.length === 0) {
    return (
      <div
        className="flex-shrink-0 border-b border-border bg-surface"
        data-testid="schedule-health-table"
      >
        <TableHeading count={0} />
        {/* ★ fix-517 §F sweep — this line said "Add one in the Settings modal",
            which has not existed since fix-514. */}
        <div className="text-xs text-dim italic px-3 py-3.5 text-center">
          No permits on this project. Add one in Project Details → Permits.
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 border-b border-border bg-surface"
      data-testid="schedule-health-table"
    >
      <TableHeading count={reviewablePermits.length} />
      <table className="w-full border-collapse mt-1.5 text-[10px]">
        <colgroup>
          {/* ★ §B: the type column keeps its 140 and the new Permit Number
              column takes 120 of the 202px the rail freed. */}
          <col style={{ width: 150 }} />
          <col style={{ width: 120 }} />
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
            <Th sortKey="type" sort={sort} onSort={onSort} align="left">
              Permit Type
            </Th>
            <Th sortKey="num" sort={sort} onSort={onSort}>
              Permit Number
            </Th>
            {/* ★ Reviewers is NOT sortable. The cell is a rollup chip whose
                own click opens a popover (§D exempts it from the row click for
                the same reason), and "sorted by reviewers" is not a question
                anybody asks of four rows. */}
            <Th>Reviewers</Th>
            <Th sortKey="stage" sort={sort} onSort={onSort}>
              Stage
            </Th>
            <Th sortKey="status" sort={sort} onSort={onSort}>
              Permit Status
            </Th>
            <Th sortKey="source" sort={sort} onSort={onSort}>
              Data Source
            </Th>
            {/* ★★★ fix-508 §H (P-195) — TWO RENAMES, AND THE SECOND IS A
                CONTRACT. `ESTIMATED APPROVAL` → `PERMIT APPROVAL`, because the
                column shows the ACTUAL approval date once the city approves and
                only projects before that. `ACQ TARGET` → `TARGET APPROVAL` —
                **not `Target`** — because it and the Dates card's new row are
                the same fact and two names for one fact is exactly what P-179
                is about. */}
            <Th sortKey="approval" sort={sort} onSort={onSort}>
              Permit Approval
            </Th>
            <Th sortKey="target" sort={sort} onSort={onSort}>
              Target Approval
            </Th>
            <Th sortKey="health" sort={sort} onSort={onSort}>
              Schedule Health
            </Th>
          </tr>
        </thead>
        <tbody data-sort-key={sort.key} data-sort-dir={sort.dir}>
          {sortedRows.map((m) => (
            <Row
              key={m.id}
              model={m}
              activeHold={activeHold}
              onSelect={onSelect}
              onEditPermit={onEditPermit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ★★★ fix-517 §A — `SCHEDULE HEALTH` → `PERMITS (n)`.
 *
 * The heading is its own component so the empty state and the populated table
 * cannot end up with two different titles — which is how `SCHEDULE HEALTH`
 * would have survived this rename in one branch.
 */
function TableHeading({ count }: { count: number }) {
  return (
    <div className="text-center pt-1.5 pb-0.5">
      <div
        className="text-xs font-extrabold text-text uppercase tracking-wider"
        data-testid="permits-table-heading"
      >
        Permits ({count})
      </div>
    </div>
  );
}

function Row({
  model,
  activeHold,
  onSelect,
  onEditPermit,
}: {
  model: PermitRowModel;
  activeHold: boolean;
  onSelect?: (permitId: number) => void;
  onEditPermit?: (permitId: number) => void;
}) {
  const {
    permit,
    reviewers,
    fallbackReviewer,
    learnedEstimate,
    juris,
    typeLabel,
    stage,
    statusLabel,
    statusDate,
    statusDetail,
    approvalIso,
    approvalLabel,
    target,
    healthDiff,
    structAddress,
    portalUrl,
    redesignLabel,
  } = model;
  const borderL = { borderLeftColor: 'var(--color-border)' } as const;

  return (
    // ★★★ fix-517 §D — THE ROW IS THE CONTROL. *"Row click, anywhere except
    //     the hyperlink and the Reviewers cell → the Permit View, exactly as a
    //     rail row does today."* Both exceptions stop propagation at their own
    //     element rather than being special-cased here, so a third exception
    //     is a change to that element and not to this handler.
    //
    // ★★ `group` drives §E's hover affordance. It is a HOVER control, not a
    //    double-click: single-click already opens the Permit View, so
    //    single=view / double=edit is a coin flip, and double-click fights
    //    text selection in a table.
    <tr
      className="border-b last:border-b-0 group cursor-pointer hover:bg-s2"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid={`schedule-health-row-${permit.id}`}
      onClick={onSelect ? () => onSelect(permit.id) : undefined}
    >
      {/* 1. Permit Type — plus the structure address underneath (§B), plus
          fix-169's land-use phase badge, which was the rail's and would
          otherwise have died with it. */}
      <td className="px-3 py-2 align-middle text-[11px] text-text">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-bold"
              title={typeLabel}
              data-testid={`schedule-health-type-${permit.id}`}
            >
              {typeLabel}
            </div>
            {/* ★ fix-517 §A — the redesign this permit belongs to, which the
                deleted rail said with a band heading. */}
            {redesignLabel && (
              <div
                className="text-[9.5px] truncate"
                style={{ color: 'var(--color-co)' }}
                data-testid={`schedule-health-redesign-${permit.id}`}
              >
                ↳ {redesignLabel}
              </div>
            )}
            {/* ★ §B — STRUCTURE ADDRESS IS NOT A COLUMN. 80 of 685 permits
                (11.7%) carry one; it renders under the type on the rows that
                have one, the way the permit number sat under the type in the
                rail. The field stays editable in Project Details → Permits. */}
            {structAddress && (
              <div
                className="text-[9.5px] text-muted truncate"
                title={structAddress}
                data-testid={`schedule-health-addr-${permit.id}`}
              >
                {structAddress}
              </div>
            )}
            <LandUsePhaseBadge permit={permit} />
          </div>
          {/* ★★★ fix-517 §E — THE EDIT AFFORDANCE, AND IT OPENS PROJECT
              DETAILS. `QuickEditPermitModal` is DELETED: it and fix-514's
              Permits tab edited the same six fields, which was the third
              instance of that shape in one week (P-207, P-221). */}
          {onEditPermit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditPermit(permit.id);
              }}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] leading-none px-1 py-0.5 rounded border transition"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-dim)',
              }}
              title="Edit in Project Details"
              aria-label={`Edit ${typeLabel} in Project Details`}
              data-testid={`schedule-health-edit-${permit.id}`}
            >
              {/* ★★★ fix-519 §D (P-232) — THE GLYPH CARRIES THE NAVIGATION.
                  fix-517 §E moved permit editing into Project Details and this
                  control does the right thing — but a bare ✎ is the universal
                  sign for EDIT IN PLACE, and Bobby still had to ask whether the
                  rule had been broken. **When a ruling changes what a control
                  does, the control's SIGN changes with it, or the ruling reads
                  as broken.** The behaviour is untouched; only the promise is.
                  ★ `✎↗` rather than a different icon: the pencil still says
                    "this is where you edit", and the arrow says "not here". */}
              ✎<span className="text-[9px] align-super" aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </td>
      {/* ★★★ 2. Permit Number — §B's new column, and it has THREE states.
          · a number with a portal URL (587 of 685) → a live link;
          · a number without one → plain mono, so it cannot masquerade as a
            broken link;
          · no number at all (26 of 685, mostly NPR records) → an EMPTY cell.
            Bobby: *"some permits we don't get a number for for a while."*
            The row is not hidden and no dead link is rendered — the two
            failures §B names by hand. */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px]"
        style={borderL}
      >
        {permit.num ? (
          portalUrl ? (
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              // ★ §D's first exception. It stops here rather than in the row's
              //   handler so the rule lives on the thing it is about.
              onClick={(e) => e.stopPropagation()}
              className="text-de font-mono hover:underline"
              title="Open city portal"
              data-testid={`schedule-health-portal-${permit.id}`}
            >
              {permit.num} ↗
            </a>
          ) : (
            <span
              className="text-text font-mono"
              title="No portal URL on file"
              data-testid={`schedule-health-num-${permit.id}`}
            >
              {permit.num}
            </span>
          )
        ) : (
          <span
            className="text-dim italic text-[9px]"
            data-testid={`schedule-health-nonum-${permit.id}`}
          >
            No permit # yet
          </span>
        )}
      </td>
      {/* 3. Reviewers — fix-31 rollup chip. Shows N · approved · corrections
          · in-review for the latest cycle's reviewers; click opens a side
          popover with the full list. Falls back to the legacy
          permits.extras.latest_reviewer single-name display when the permit's
          adapter hasn't done per-reviewer extraction yet.
          ★ §D's second exception: the whole CELL swallows the click, because
            the popover trigger is inside a component this table does not own
            and a chip that grew a second control would silently start
            navigating. */}
      <td
        className="px-2 py-2 align-middle text-center border-l"
        style={borderL}
        onClick={(e) => e.stopPropagation()}
        data-testid={`schedule-health-reviewers-${permit.id}`}
      >
        {/* fix-260: blast-radius limiter. This chip renders scraped reviewer
            rows whose shape we don't fully control — a null reviewer_name once
            threw inside Array.sort and took the whole ProjectDetail route down
            (React Router catches route render errors before the app-level
            fix-87 boundary, so the user got its raw error page and nothing was
            logged). Now one unrenderable chip costs one cell, and the incident
            still reaches Settings → Errors. */}
        <InlineErrorBoundary
          label="reviewers"
          testId={`reviewer-chip-error-${permit.id}`}
        >
          <ReviewerRollupChip
            permitId={permit.id}
            rows={reviewers}
            fallbackReviewer={fallbackReviewer}
            permitStatus={permit.status}
            permitType={permit.type}
            // fix-186: follow the permit's CURRENT cycle so the chip doesn't lag a
            // cycle behind once the permit advances past the last cycle that has
            // reviewer rows.
            cycles={permit.permit_cycles ?? []}
          />
        </InlineErrorBoundary>
      </td>
      {/* 4. Stage */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: STAGE_TINT[stage] }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </td>
      {/* 5. Permit Status — fix-25e: derived from cycle state when there's
          any progress, falls back to stored permits.status otherwise. */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px]"
        style={borderL}
        data-testid={`schedule-health-status-${permit.id}`}
      >
        <div>
          <div className="text-text">{statusLabel}</div>
          {statusDate && (
            <div className="text-[9px] text-dim mt-0.5 font-mono">
              {fmtDate(statusDate)}
            </div>
          )}
          {/* fix-52: portal status kept as secondary detail for the
              "Approved — Not Issued" state (ready-vs-held nuance). */}
          {statusDetail && (
            <div className="text-[9px] text-dim mt-0.5">{statusDetail}</div>
          )}
        </div>
      </td>
      {/* 6. Data Source */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <DataSourceBadge
          estimate={learnedEstimate}
          permitType={permit.type ?? ''}
          juris={juris}
        />
      </td>
      {/* 7. Permit Approval */}
      <td
        className="px-2 py-2 align-middle text-center border-l text-[10px] font-mono"
        style={borderL}
      >
        {approvalIso ? (
          <div>
            <div className="text-text font-bold">{fmtDate(approvalIso)}</div>
            <div className="text-[9px] text-dim mt-0.5 font-sans">
              {approvalLabel}
            </div>
          </div>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>
      {/* ★★★ 8. Target Approval — fix-508 §D/§H: DERIVED AND READ-ONLY NOW.
          fix-63 made this cell an inline `<input type="date">` writing
          `permits.expected_issue`, and the blue on the column was that input's
          affordance rather than a colour choice. §D makes Target Approval the
          LATEST of the ACQ date, the closing date and the GO date plus six
          months — so `expected_issue` is one of three candidates, not the
          answer, and a box that edits the answer would be writing a number
          nothing reads.
          ★★★ SO THE INPUT MOVED, IT WAS NOT DELETED: `expected_issue` is the
              ACQ DATE and it is edited in Project Details → Permits, on the
              row it belongs to (fix-514 §G). One surface writes it, every
              surface derives from it.
          ★ And the blue goes with the input, because it was never decoration. */}
      <td
        className="px-2 py-2 align-middle text-center border-l"
        style={borderL}
      >
        <TargetApprovalCell permitId={permit.id} target={target} />
      </td>
      {/* 9. Schedule Health */}
      <td className="px-2 py-2 align-middle text-center border-l" style={borderL}>
        <HealthBadge diff={healthDiff} activeHold={activeHold} />
      </td>
    </tr>
  );
}

// ============================================================
// ★★★ fix-508 §D/§H — TARGET APPROVAL, DERIVED AND READ-ONLY
// ============================================================
//
// fix-63 made this cell an inline `<input type="date">` on `expected_issue`,
// so Acquisitions could retarget from the surface that shows schedule drift
// without opening Project Settings. That was right while the column WAS
// `expected_issue`.
//
// ★★★ §D CHANGES WHAT THE COLUMN IS. Target Approval is the LATEST of the ACQ
//     date, the closing date, and the GO date plus six calendar months —
//     computed in `lib/targetApproval`, printed here and on the Dates card from
//     the same function so the two surfaces cannot disagree.
//
// ★★★ AND AN EDITABLE DERIVED VALUE IS THE DEFECT P-179 NAMES. A box here
//     would write `expected_issue` while the number on screen came from a
//     `max` over three dates — type a date earlier than the closing and the
//     cell would refuse to show what you typed. Two surfaces writing one number
//     by different rules; the input moves to the ACQ date in Project Data,
//     which is the one place it is authored.
//
// ★ THE BLUE GOES WITH IT (§H). It was the input's affordance, never a colour
//   choice, so a read-only cell that kept it would be promising a click.

//
// ★★★ fix-512 §A: IT NO LONGER COMPUTES ITS OWN. The row derives Target
//     Approval once and hands it to both readers — this cell and the health
//     badge — because a cell that recomputes is a cell that can drift from the
//     number it is being compared against, which is precisely P-204.
function TargetApprovalCell({
  permitId,
  target,
}: {
  permitId: number;
  target: TargetApproval;
}) {
  if (!target.date) {
    return (
      <span className="text-dim" data-testid={`schedule-health-target-approval-${permitId}`}>
        —
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-mono font-bold text-text"
      // ★ The DRIVER is in the title, not on the face. Bobby's ruling is that
      //   the Project Overview shows the date and nothing else; this is not the
      //   overview, and a reader comparing drift against a target is the one
      //   person who needs to know which of the three set it.
      title={`Target Approval — the latest of the ACQ date, the closing date, and the GO date plus 6 months. Set here by ${
        TARGET_APPROVAL_DRIVER_LABEL[target.driver ?? 'acq']
      }. Edit the ACQ date in Project Details → Permits.`}
      data-testid={`schedule-health-target-approval-${permitId}`}
      data-driver={target.driver ?? undefined}
    >
      {/* ★★ fix-512 §A: THE CARD'S FORMAT. This printed the raw ISO
          `2027-02-14` while the Dates card three inches away printed
          `02/14/2027` — one fact, two formats, one screen. `formatUsDate` is
          the Dates card's own helper, and it is string surgery on the ISO
          rather than a `Date`, because fix-433's finding is that a bare
          `YYYY-MM-DD` parsed as UTC prints as YESTERDAY west of Greenwich. */}
      {formatUsDate(target.date)}
    </span>
  );
}

/**
 * ★★★ fix-517 §C — SORTABLE HEADERS, AND NO FILTER CHIPS.
 *
 * Urgency is *"one click away, with no new control"*. A header that can sort
 * renders a real `<button>` inside the `<th>` — not a click handler on the cell
 * — so it is reachable by keyboard and announced as a control, and
 * `aria-sort` on the `<th>` says which way the table is currently ordered.
 *
 * ★★ A HEADER WITHOUT A `sortKey` IS STILL A HEADER. `Reviewers` renders as
 *    plain text rather than a disabled button, because a disabled control
 *    invites the reader to wonder what would make it work.
 */
function Th({
  children,
  align = 'center',
  sortKey,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  align?: 'left' | 'center';
  sortKey?: PermitSortKey;
  sort?: { key: PermitSortKey; dir: PermitSortDir };
  onSort?: (key: PermitSortKey) => void;
}) {
  const active = !!sortKey && sort?.key === sortKey;
  const cls = `px-2 py-1.5 text-[9px] font-extrabold text-text uppercase tracking-wider border-l first:border-l-0 ${
    align === 'left' ? 'text-left' : 'text-center'
  }`;
  if (!sortKey || !onSort) {
    return (
      <th className={cls} style={{ borderLeftColor: 'var(--color-border)' }}>
        {children}
      </th>
    );
  }
  return (
    <th
      className={cls}
      style={{ borderLeftColor: 'var(--color-border)' }}
      aria-sort={
        active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      data-sort-key={sortKey}
      data-sort-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`w-full inline-flex items-center gap-1 uppercase tracking-wider font-extrabold text-[9px] cursor-pointer hover:underline ${
          align === 'left' ? 'justify-start' : 'justify-center'
        }`}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: active ? 'var(--color-de)' : 'inherit',
        }}
        data-testid={`permits-sort-${sortKey}`}
      >
        <span>{children}</span>
        {/* ★ The caret renders ONLY on the sorted column. A neutral ↕ on every
            header turns nine columns into nine pieces of noise on a four-row
            table, and the hover underline already says the header is a
            control. */}
        {active && (
          <span aria-hidden="true">{sort?.dir === 'asc' ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  );
}

// ============================================================
// Sub-components & helpers
// ============================================================

function DataSourceBadge({
  estimate,
  permitType,
  juris,
}: {
  estimate: LearnedEstimate | null;
  permitType: string;
  juris: string;
}) {
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
  return (
    <div className="flex flex-col items-center gap-1">
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
        Learned ({estimate.sampleCount})
      </span>
      {/* fix-35 Bug 4: explicit cross-juris badge (was a bare " *" mark).
          Matches BenchmarkCard so the (type, *) fallback is unmistakable. */}
      {estimate.isCrossJuris && (
        <span
          className="text-[8px] font-bold px-2 py-0.5 rounded border"
          style={{
            background: 'rgba(139,92,246,.12)',
            color: '#8b5cf6',
            borderColor: 'rgba(139,92,246,.4)',
          }}
          title={`Based on ${permitType} data from all jurisdictions — no ${juris} ${permitType} samples yet. Will differentiate once ${juris} accumulates approved ${permitType} permits.`}
          data-testid="data-source-crossjuris"
        >
          CROSS-JURIS
        </span>
      )}
    </div>
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

function HealthBadge({
  diff,
  activeHold = false,
}: {
  diff: number | null;
  activeHold?: boolean;
}) {
  // fix-170: an actively-held project is parked — show "On Hold" rather than
  // Behind / At Risk so the schedule-health column doesn't scream red while
  // the project is legitimately paused.
  if (activeHold) {
    return (
      <span
        className="text-[9px] font-bold px-2 py-0.5 rounded border"
        style={{
          background: 'var(--color-co-bg)',
          color: 'var(--color-co)',
          borderColor: 'var(--color-co-border)',
        }}
        data-testid="schedule-health-on-hold"
        title="Project is on hold — schedule health is paused"
      >
        ⏸ On Hold
      </span>
    );
  }
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
