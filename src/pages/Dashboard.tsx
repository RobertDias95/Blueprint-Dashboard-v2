import { useCallback, useMemo, useRef, useState } from 'react';
import { useProjects } from '../hooks/useProjects';
import { usePermits } from '../hooks/usePermits';
import { useDrawSchedule } from '../hooks/useDrawSchedule';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { useNumberEntrySweep } from '../hooks/useNumberEntrySweep';
import {
  bucketPermits,
  hideIssuedAtAddress,
  type BucketInput,
} from '../lib/permitStage';
import { cardUrgency } from '../lib/urgencyHelpers';
import {
  useAllProjectHolds,
  activeHoldProjectIds,
  activeHoldByProjectId,
  cancelByProjectId,
  cancelledProjectIds,
} from '../hooks/useProjectHolds';
import { isCancelledProject } from '../lib/projectViewHelpers';
import { structAddressHaystack } from '../lib/structAddressSearch';
import HoldFilter from '../components/shared/HoldFilter';
import {
  passesHoldFilter,
  HOLD_FILTER_DEFAULT,
  type HoldFilterMode,
} from '../lib/holdFilter';
import type {
  DrawScheduleRow,
  Permit,
  PermitCycle,
  PermitCycleReviewer,
  Project,
  ProjectHold,
  Stage,
} from '../lib/database.types';
import AddrGroup from '../components/Dashboard/AddrGroup';
import StageFilters, {
  EMPTY_DASH_FILTERS,
  permitPassesDashFilters,
  type DashFilters,
} from '../components/Dashboard/StageFilters';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import { useScopeMode } from '../hooks/useSelfScope';
import { permitMatchesSelf, projectMatchesSelf } from '../lib/selfScope';
import ScopeToggle from '../components/shared/ScopeToggle';
import { distinctProjectCount } from '../lib/dashboardCounts';
import { useAuthStore } from '../stores/authStore';
import {
  defaultCollapsedKeys,
  loadPipelineCollapsed,
  pipelineGroupKey,
  pipelineSubKey,
  pipelineSubKeyPrefix,
  savePipelineCollapsed,
} from '../lib/pipelinePrefs';
import {
  buildAddressDistribution,
  STAGE_GROUP,
  type StageCount,
} from '../lib/pipelineDistribution';

// Q9.5.e2: cross-bucket interactivity. `DashContext` lifts `highlightedAddress`
// + `openAddresses` to the Dashboard root so toggling open/highlight on one
// .addr-group propagates to every sub-bucket that shows the same address —
// mirrors v1's `toggleProjectExpanded` at index.html:2832 + `highlightProject`
// at :2823.
interface DashContext {
  highlightedAddress: string | null;
  openAddresses: Set<string>;
  toggleAddress: (addr: string) => void;
  /**
   * ★★★ fix-383: send the reader to this project in ONE named bucket.
   *
   * NOT `toggleAddress`. Toggle is the right verb for clicking the row — it
   * opens the address everywhere, or closes it everywhere. It is the WRONG
   * verb for clicking a count: "2 Issued" means "show me those two", and on a
   * project whose Issued group was already open, toggling would CLOSE it —
   * the exact opposite of the click. Bobby named the case: "some people might
   * have the expansions open or closed." Both starting states must land in the
   * same place, so this only ever ADDS to openAddresses.
   */
  revealAddress: (addr: string, stage: Stage) => void;
  /**
   * ★★★ The scroll ticket. fix-1d's rule is that a bucket scrolls ITSELF from
   * its own useEffect, because a parent-imperative scroll fires before the
   * non-active buckets have committed their expanded render and the browser
   * clamps it. So this is not a call — it is STATE the target AddrGroup
   * observes, and the nonce changes on every click so a group that was already
   * open (isOpen never flipped) still re-runs its own scroll effect.
   */
  revealTarget: { address: string; stage: Stage; nonce: number } | null;
  /**
   * ★★ fix-383: address → how many of that project's cards sit in each bucket.
   * Computed once at the root, where every permit is in hand; an AddrGroup only
   * ever receives its OWN bucket's permits and so could never derive this.
   */
  distributionByAddress: Map<string, StageCount[]>;
  setHighlight: (addr: string | null) => void;
  /** fix-178: project_id → active hold, for the on-hold card badge. */
  activeHoldMap: Map<string, ProjectHold>;
  /** fix-262: project_id -> open CANCEL row. Rendered in the same badge slot. */
  cancelMap: Map<string, ProjectHold>;
}

// Q2: Dashboard matrix. Project-keyed render — iterates `projects`, looks
// up permits via project_id, classifies each by effectiveStage, splits the
// D&E column into early/late buckets via the draw_schedule status.
//
// Layout faithfully ports v1 (index.html line 661-745):
//   ROW 1: D&E group (Scheduled & Schematic | DD & Pending Consultants)
//          Permitting group (Under Review | Corrections)
//   ROW 2: Approve + Issued strips (fix-313 #65 renamed the label)
//
// No placeholder permit synthesis — empty projects show in the search list,
// not as a fake card in a matrix slot.

export default function Dashboard() {
  const projectsQ = useProjects();
  const permitsQ = usePermits();
  const drawQ = useDrawSchedule();
  // fix-54: reviewer rows feed the wholistic rollup that overrides the
  // matrix bucket + Project Overview status pill for MPB permits.
  const reviewersQ = useAllPermitCycleReviewers();
  // fix-170 (On-Hold Phase 2, effect D): projects with an ACTIVE hold are not
  // flagged overdue/late on the dashboard. One fetch, indexed to a project-id set.
  const holdsQ = useAllProjectHolds();
  const activeHeld = useMemo(
    () => activeHoldProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  // fix-264: cancelled projects fall OFF the pipeline entirely — Bobby: "no need
  // to see it if it isn't active/nothing being done on it." Same set the Project
  // List's Active toggle uses (fix-262); holds are deliberately not in it.
  const cancelledIds = useMemo(
    () => cancelledProjectIds(holdsQ.data),
    [holdsQ.data],
  );
  // fix-178: project_id -> active hold, for the on-hold badge on each card.
  // fix-262: cancelled projects carry their own badge from the same bulk fetch.
  // fix-264: that badge now only renders on Project List / Project Detail — a
  // cancelled project never reaches a dashboard card. The map stays wired so
  // nothing breaks in the window between the holds fetch and the projects fetch.
  const cancelMap = useMemo(() => cancelByProjectId(holdsQ.data), [holdsQ.data]);
  const activeHoldMap = useMemo(
    () => activeHoldByProjectId(holdsQ.data),
    [holdsQ.data],
  );
  // fix-155: fire the numberless-permit sweep once/day (self-guarded).
  useNumberEntrySweep();
  const [search, setSearch] = useState('');
  // fix-178: three-way hold filter (All / Only holds / Exclude holds). Default
  // 'all'; no persistence (resets each load).
  const [holdMode, setHoldMode] = useState<HoldFilterMode>(HOLD_FILTER_DEFAULT);
  const [filters, setFilters] = useState<DashFilters>(EMPTY_DASH_FILTERS);
  // ★ fix-324: which columns this person has folded, remembered across reloads.
  //
  // ★ SAME MECHANISM AS THE RIBBON (fix-313) — per-user localStorage, read in a
  // LAZY INITIALISER and written in the handler, no effect. An effect that
  // setStates on mount renders one frame of the wrong layout before correcting
  // itself, which the user sees as a flinch; it is also the React Compiler's
  // `set-state-in-effect`.
  //
  // ★ fix-324b — the DEFAULT is register #68: 'Approve and Issue default to
  // COLLAPSED'. fix-324 shipped all four open because that is how the mockup
  // DRAWS them; the mockup illustrates the layout, #68 states the starting
  // state, and the rule wins. It applies only until this person chooses — after
  // that their stored list is the whole answer.
  const collapseUserId = useAuthStore((s) => s.user?.id ?? null);
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(
    () => loadPipelineCollapsed(collapseUserId) ?? defaultCollapsedKeys(),
  );
  const isCollapsed = useCallback(
    (key: string) => collapsedKeys.includes(key),
    [collapsedKeys],
  );
  const toggleCollapsed = useCallback(
    (key: string) => {
      setCollapsedKeys((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key];
        savePipelineCollapsed(collapseUserId, next);
        return next;
      });
    },
    [collapseUserId],
  );
  const [highlightedAddress, setHighlightedAddress] = useState<string | null>(null);
  const [openAddresses, setOpenAddresses] = useState<Set<string>>(new Set());
  // fix-176: role-aware "My work" default, remembered per-user. ent_lead/dm ->
  // permits on projects they lead; da -> permits assigned to them.
  const { mode: scopeMode, setMode: setScopeMode, identity } =
    useScopeMode('dashboard');

  const toggleAddress = useCallback((addr: string) => {
    let didOpen = false;
    setOpenAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
        didOpen = false;
      } else {
        next.add(addr);
        didOpen = true;
      }
      return next;
    });
    // Mirror v1 :2864 — open toggles the highlight to this addr; close clears it.
    setHighlightedAddress((cur) => (cur === addr ? null : addr));
    // Q9.5.f-fix-1d: cross-bucket scroll moved into each AddrGroup's own
    // useEffect (keyed on isOpen). Parent rAF kept dispatching scroll on
    // non-active buckets before their expanded body had contributed to
    // scrollHeight; component-local effect runs at exactly the right
    // moment because it fires after THIS AddrGroup's render commits.
    void didOpen;
  }, []);

  // ★★★ fix-383: the targeted click. Four things happen, in this order:
  //
  //   1. UNFOLD the destination column. Approved and Issued default to
  //      COLLAPSED (fix-324b / #68), so without this the most valuable case —
  //      "one is issued, click it" — would open the address inside a folded
  //      spine and show the reader nothing at all.
  //   2. ENSURE OPEN, never toggle. See revealAddress's doc on DashContext.
  //   3. Highlight it, reusing the one highlight concept the row click uses.
  //   4. Bump the reveal ticket so the target AddrGroup scrolls ITSELF.
  //
  // ★★★ Step 4 is state, not a call. Q9.5.f-fix-1d took ten iterations to
  // learn that a parent-imperative scroll runs before the non-active buckets
  // have committed their expanded render, leaving scrollHeight stale and the
  // assignment silently clamped. Do not turn this back into a parent call.
  const [revealTarget, setRevealTarget] = useState<
    { address: string; stage: Stage; nonce: number } | null
  >(null);
  const revealNonce = useRef(0);

  const revealAddress = useCallback((addr: string, stage: Stage) => {
    const group = STAGE_GROUP[stage];
    setCollapsedKeys((prev) => {
      const next = prev.filter(
        (k) =>
          k !== pipelineGroupKey(group) &&
          !k.startsWith(pipelineSubKeyPrefix(group)),
      );
      if (next.length === prev.length) return prev;
      savePipelineCollapsed(collapseUserId, next);
      return next;
    });
    setOpenAddresses((prev) => {
      if (prev.has(addr)) return prev; // ★ already open stays open
      const next = new Set(prev);
      next.add(addr);
      return next;
    });
    setHighlightedAddress(addr);
    revealNonce.current += 1;
    setRevealTarget({ address: addr, stage, nonce: revealNonce.current });
  }, [collapseUserId]);


  const isLoading = projectsQ.isLoading || permitsQ.isLoading || drawQ.isLoading;
  const error = projectsQ.error ?? permitsQ.error ?? drawQ.error;

  const {
    buckets,
    projectById,
    cyclesByPermit,
    reviewersByPermit,
    distributionByAddress,
  } = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const permits = permitsQ.data ?? [];
    const draw = drawQ.data ?? [];
    const reviewers = reviewersQ.data ?? [];

    const reviewersByPermitId = new Map<number, PermitCycleReviewer[]>();
    for (const r of reviewers) {
      const list = reviewersByPermitId.get(r.permit_id) ?? [];
      list.push(r);
      reviewersByPermitId.set(r.permit_id, list);
    }

    const projectByIdMap = new Map<string, Project>(
      projects.map((p) => [p.id, p]),
    );
    const drawByProjectId = new Map<string, DrawScheduleRow>(
      draw.map((d) => [d.project_id, d]),
    );
    const projectIdToAddress = new Map<string, string>(
      projects.map((p) => [p.id, p.address]),
    );

    // Apply search filter at the project level — matches address, juris,
    // permit DA/DM/lead, permit num. Tokens AND-combine (space or comma).
    // fix-380: also the permits' struct_address — Bobby: "Maybe I don't know
    // the project by the project address, but I know it by the structure
    // address." A project matches when ANY of its permits carries the typed
    // structure address; the match still surfaces the PROJECT, because that
    // is what he is looking for.
    const tokens = search
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    const matchesSearch = (project: Project, projectPermits: Permit[]) => {
      if (!tokens.length) return true;
      const haystack = [
        project.address,
        project.juris ?? '',
        structAddressHaystack(projectPermits),
        ...projectPermits.flatMap((p) => [
          p.da ?? '',
          p.dual_da ?? '',
          p.dm ?? '',
          p.ent_lead ?? '',
          p.permit_owner ?? '',
          p.num ?? '',
          p.type ?? '',
        ]),
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    };

    const permitsByProjectId = new Map<string, BucketInput[]>();
    for (const permit of permits) {
      const list = permitsByProjectId.get(permit.project_id) ?? [];
      list.push({
        permit,
        cycles: permit.permit_cycles ?? [],
        reviewers: reviewersByPermitId.get(permit.id) ?? [],
      });
      permitsByProjectId.set(permit.project_id, list);
    }

    // Project-keyed iteration — every visible permit must belong to a project.
    // Q9.5.f Item 2: per-permit ENT/DA/DM/Type filter on top of the
    // project-level search filter. Empty filter Sets are no-ops; specific
    // values exclude permits whose dimension is null per v1 :4949-4951.
    // fix-176: "My work" scope. For a project-scope user (ent_lead/dm) keep a
    // project's permits only when they lead that project; for a permit-scope
    // user (da) keep only the permits assigned to them. mode!=='mine' or an
    // unmapped user (name=null) is a no-op.
    const selfName = scopeMode === 'mine' ? identity.name : null;
    const selfScope = identity.scope;
    const filteredInputs: BucketInput[] = [];
    for (const project of projects) {
      // fix-264: a CANCELLED project is off the pipeline unconditionally — no
      // cards, and (because every bucket header counts the permits that survive
      // this loop) no contribution to the "N proj · M" badges either. There is
      // deliberately no "show cancelled" control here: the Project List's Active
      // toggle is the one place you go to find an inactive project and bring it
      // back. A project on HOLD is untouched — it is still active work.
      if (isCancelledProject(project.id, cancelledIds)) continue;
      const projectPermits = permitsByProjectId.get(project.id) ?? [];
      if (!matchesSearch(project, projectPermits.map((b) => b.permit))) continue;
      // fix-178: hold filter is project-level (a permit is held iff its project
      // is). Drop the whole project's permits when it fails the hold filter.
      if (!passesHoldFilter(activeHeld.has(project.id), holdMode)) continue;
      if (selfName && selfScope === 'project' && !projectMatchesSelf(project, selfName)) {
        continue;
      }
      for (const b of projectPermits) {
        if (!permitPassesDashFilters(b.permit, filters)) continue;
        if (selfName && selfScope === 'permit' && !permitMatchesSelf(b.permit, selfName)) {
          continue;
        }
        filteredInputs.push(b);
      }
    }

    const hide = hideIssuedAtAddress(filteredInputs, projectIdToAddress);
    const visible = filteredInputs.filter((b) => !hide.has(b.permit.id));
    const bucketed = bucketPermits(visible, drawByProjectId);

    // ★★ fix-383: computed ONCE here, where every permit is already in hand and
    // already bucketed — not re-derived inside each AddrGroup, which can only
    // see its own bucket's permits and so could never count the others.
    // Counting the BUCKETS (rather than re-deriving a stage per permit) is what
    // makes each pill a click target that is guaranteed to find a card; see
    // src/lib/pipelineDistribution.ts.
    const distributionByAddress = buildAddressDistribution(
      bucketed,
      projectIdToAddress,
    );

    // Q9.5.c: per-permit cycle index for urgency lookups. Reuses the
    // same shape `bucketPermits` consumed so we don't re-walk permits.
    const cyclesByPermit = new Map<number, PermitCycle[]>();
    for (const b of visible) {
      cyclesByPermit.set(b.permit.id, b.cycles);
    }

    return {
      buckets: bucketed,
      projectById: projectByIdMap,
      cyclesByPermit,
      reviewersByPermit: reviewersByPermitId,
      distributionByAddress,
    };
  }, [
    projectsQ.data,
    permitsQ.data,
    drawQ.data,
    reviewersQ.data,
    search,
    filters,
    scopeMode,
    identity.name,
    identity.scope,
    holdMode,
    activeHeld,
    cancelledIds,
  ]);

  const dashCtx: DashContext = useMemo(
    () => ({
      highlightedAddress,
      openAddresses,
      toggleAddress,
      revealAddress,
      revealTarget,
      distributionByAddress,
      setHighlight: setHighlightedAddress,
      activeHoldMap,
      cancelMap,
    }),
    [
      highlightedAddress,
      openAddresses,
      toggleAddress,
      revealAddress,
      revealTarget,
      distributionByAddress,
      activeHoldMap,
      cancelMap,
    ],
  );

  if (error) {
    return (
      <QueryError
        title="Dashboard data failed to load"
        error={error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
          drawQ.refetch();
        }}
      />
    );
  }

  return (
    // ★ fix-324: the page is a FIXED-HEIGHT column now, not a stack that grows.
    // `height: 100%` fills the shell's <main> (fix-313 made that the only scroll
    // container), the title and filter rows are flex-none, and the column row
    // below takes the rest. Nothing here can push the page taller than the
    // viewport, which is what makes "the page never scrolls, the lists do" true
    // rather than aspirational. Same shape fix-318 gave My Board.
    <div
      className="h-full flex flex-col gap-3"
      data-testid="pipeline-page"
    >
      {/* ★ fix-313 #63: the landing page is called PIPELINE. Display only —
          the route stays /dashboard, the same discipline as fix-310. Bobby:
          "My Board, Pipeline, Project Overview — so the only one that gets
          renamed is the landing page." Project View and Project Overview keep
          their names. */}
      <h1
        className="font-display font-bold text-text flex-none"
        style={{ fontSize: 20, letterSpacing: '-.01em' }}
        data-testid="pipeline-title"
      >
        Pipeline
      </h1>
      <div className="flex items-center gap-3 flex-wrap flex-none">
        <ScopeToggle
          mode={scopeMode}
          onChange={setScopeMode}
          name={identity.name}
          testid="dashboard-scope"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address, DA, ENT, juris, num... (space or comma = AND)"
          className="flex-1 min-w-[220px] max-w-[360px] bg-bg border border-border rounded-md px-3 py-1.5 text-xs font-display text-text placeholder:text-dim focus:outline-none focus:border-de"
        />
        {/* Q9.5.f Item 2: filter dropdowns inline with search bar */}
        <StageFilters
          permits={permitsQ.data ?? []}
          filters={filters}
          onChange={setFilters}
        />
        {/* fix-178: three-way hold filter */}
        <HoldFilter mode={holdMode} onChange={setHoldMode} testid="dashboard-hold-filter" />
      </div>
      {/* ★ fix-313 #61: "+ Add New Project" lived here. It moved into the
          ribbon, pinned above the collapse row, where it is reachable from
          every screen instead of only this one. Removed here rather than left
          alongside so there is exactly ONE entry point that can drift. Same
          component, same permissions — Chrome owns the open state now. */}

      {/* ★ fix-324 #66–#69: FOUR SIBLINGS IN ONE ROW, not two stacked grids.
          Design & Engineering · Permitting · Approved · Issued.

          ★★ SIBLINGS IS THE WHOLE POINT. The first attempt nested Approved and
          Issued inside a shared 300px rail; collapsed, they kept that width and
          each owned half the height — short and wide. Bobby: "we want approved
          and issued to look like permitting, vertical top to bottom of the
          screen." A column only folds to a full-height spine if it is a DIRECT
          CHILD of this row, so nesting them again would re-create the bug this
          ticket exists to remove.

          ★ The row is `flex-1 min-h-0`: it takes the height the page has left
          and no more, so the lists inside sub-columns scroll and the PAGE never
          does — the rule fix-313 set for the shell and fix-318 for the board. */}
      <div
        className="flex-1 min-h-0 flex gap-3"
        data-testid="pipeline-columns"
      >
        <PipelineGroup
          groupKey="de"
          title="Design & Engineering"
          accent="de"
          totalCount={buckets.deEarly.length + buckets.deLate.length}
          headerCountTestId="dash-group-count-de"
          loading={isLoading}
          subBuckets={[
            {
              title: 'Scheduled & Schematic',
              dotColor: '#5a84c0',
              permits: buckets.deEarly,
              keyDateLabel: 'Target Submit',
              getKeyDate: (p) => p.target_submit,
            },
            {
              title: 'DD & Pending Consultants',
              dotColor: '#02267e',
              permits: buckets.deLate,
              keyDateLabel: 'Target Submit',
              getKeyDate: (p) => p.target_submit,
            },
          ]}
          stage="de"
          projectById={projectById}
          cyclesByPermit={cyclesByPermit}
          reviewersByPermit={reviewersByPermit}
          activeHeld={activeHeld}
          ctx={dashCtx}
          collapsed={isCollapsed(pipelineGroupKey('de'))}
          onToggle={() => toggleCollapsed(pipelineGroupKey('de'))}
          isSubCollapsed={(t) => isCollapsed(pipelineSubKey('de', t))}
          onToggleSub={(t) => toggleCollapsed(pipelineSubKey('de', t))}
        />
        <PipelineGroup
          groupKey="pm"
          title="Permitting"
          accent="pm"
          totalCount={buckets.pm.length + buckets.co.length}
          headerCountTestId="dash-group-count-pm"
          loading={isLoading}
          subBuckets={[
            {
              title: 'Under Review',
              dotColor: '#5cb8b2',
              permits: buckets.pm,
              keyDateLabel: 'City Target',
              getKeyDate: getMostRecentCityTarget(permitsQ.data ?? []),
              // Q9.5.c: 'pm' urgency uses the latest city_target across cycles.
              urgencyStage: 'pm',
            },
            {
              title: 'Corrections',
              dotColor: '#d97706',
              permits: buckets.co,
              keyDateLabel: 'Corrections Out',
              getKeyDate: getMostRecentCorrIssued(permitsQ.data ?? []),
              // Corrections sub-bucket evaluates urgency under 'co' rules
              // (business-days-since open corr_issued), even though the
              // parent group's accent is pm.
              urgencyStage: 'co',
            },
          ]}
          stage="pm"
          projectById={projectById}
          cyclesByPermit={cyclesByPermit}
          reviewersByPermit={reviewersByPermit}
          activeHeld={activeHeld}
          ctx={dashCtx}
          collapsed={isCollapsed(pipelineGroupKey('pm'))}
          onToggle={() => toggleCollapsed(pipelineGroupKey('pm'))}
          isSubCollapsed={(t) => isCollapsed(pipelineSubKey('pm', t))}
          onToggleSub={(t) => toggleCollapsed(pipelineSubKey('pm', t))}
        />
        {/* ★ fix-324 §4 (was fix-323): "Approve" → "Approved". Display only —
            the stage code is still `ap`, the route, the testids and the
            sub-column's own wording are untouched. `src/lib/stageLabel.ts`
            has read `ap: 'Approved'` all along, so this title was the single
            place disagreeing with the codebase's own vocabulary. */}
        <PipelineGroup
          groupKey="ap"
          title="Approved"
          accent="jv"
          narrow
          totalCount={buckets.ap.length}
          headerCountTestId="dash-strip-projcount-ap"
          loading={isLoading}
          subBuckets={[
            {
              title: 'approved, pending issue',
              dotColor: '#7c5cd6',
              permits: buckets.ap,
              keyDateLabel: 'Approved',
              getKeyDate: (p) => p.approval_date,
            },
          ]}
          stage="ap"
          projectById={projectById}
          cyclesByPermit={cyclesByPermit}
          reviewersByPermit={reviewersByPermit}
          activeHeld={activeHeld}
          ctx={dashCtx}
          collapsed={isCollapsed(pipelineGroupKey('ap'))}
          onToggle={() => toggleCollapsed(pipelineGroupKey('ap'))}
          isSubCollapsed={(t) => isCollapsed(pipelineSubKey('ap', t))}
          onToggleSub={(t) => toggleCollapsed(pipelineSubKey('ap', t))}
        />
        <PipelineGroup
          groupKey="is"
          title="Issued"
          accent="is"
          narrow
          totalCount={buckets.is.length}
          headerCountTestId="dash-strip-projcount-is"
          loading={isLoading}
          subBuckets={[
            {
              title: 'active issued permits at this address',
              dotColor: '#0e93b8',
              permits: buckets.is,
              keyDateLabel: 'Issued',
              getKeyDate: (p) => p.actual_issue,
            },
          ]}
          stage="is"
          projectById={projectById}
          cyclesByPermit={cyclesByPermit}
          reviewersByPermit={reviewersByPermit}
          activeHeld={activeHeld}
          ctx={dashCtx}
          collapsed={isCollapsed(pipelineGroupKey('is'))}
          onToggle={() => toggleCollapsed(pipelineGroupKey('is'))}
          isSubCollapsed={(t) => isCollapsed(pipelineSubKey('is', t))}
          onToggleSub={(t) => toggleCollapsed(pipelineSubKey('is', t))}
        />
      </div>
    </div>
  );
}

interface SubBucket {
  title: string;
  dotColor: string;
  permits: Permit[];
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  /** Q9.5.c: optional override for urgency math when the sub-bucket's
   *  urgency stage differs from the group's parent stage (e.g., the
   *  Corrections sub-bucket inside the Permitting group uses 'co'
   *  predicates). Defaults to the parent group's `stage`. */
  urgencyStage?: Stage;
}

interface PipelineGroupProps {
  /** Stage code — the key collapse state is stored under, and the one thing
   *  here that must not change when a TITLE does. */
  groupKey: 'de' | 'pm' | 'ap' | 'is';
  title: string;
  accent: 'de' | 'pm' | 'jv' | 'is';
  totalCount: number;
  /** The testid the "N proj ·" badge carried BEFORE this ticket, passed in so
   *  the layout change does not rename a single one. */
  headerCountTestId: string;
  loading: boolean;
  subBuckets: SubBucket[];
  /** ★ Approved and Issued are narrower OPEN than the two working groups —
   *  they are for glancing at, not working in. Folded, they are identical to
   *  every other spine. */
  narrow?: boolean;
  stage: Stage;
  projectById: Map<string, Project>;
  cyclesByPermit: Map<number, PermitCycle[]>;
  reviewersByPermit: Map<number, PermitCycleReviewer[]>;
  /** fix-170: project ids with an active hold — suppress urgency colors. */
  activeHeld: Set<string>;
  ctx: DashContext;
  collapsed: boolean;
  onToggle: () => void;
  isSubCollapsed: (subTitle: string) => boolean;
  onToggleSub: (subTitle: string) => void;
}

// Q9.5.c: header backgrounds use the stage-bg tint per v1 §4.6.a.
// Tints are intentionally LIGHT so the count text stays readable.
// fix-324: ONE map for all four columns. The two working groups and the two
// bottom strips used to keep separate copies of the same idea, which is how
// they drifted into two different components in the first place.
const STAGE_HEADER_BG: Record<'de' | 'pm' | 'jv' | 'is', string> = {
  de: 'var(--color-de-bg)',
  pm: 'var(--color-pm-bg)',
  jv: 'var(--color-jv-bg)',
  is: 'var(--color-is-bg)',
};
const STAGE_HEADER_BORDER: Record<'de' | 'pm' | 'jv' | 'is', string> = {
  de: 'var(--color-de-border)',
  pm: 'var(--color-pm-border)',
  jv: 'var(--color-jv-border)',
  is: 'var(--color-is-border)',
};

// ★ fix-327 #2: the collapse affordance palette. Deliberately the SAME values
// fix-320 gave the ribbon chip — one app, one way of saying "this folds".
// Literals rather than tokens for the same reason they are literals there: the
// tint belongs to the control, not to a semantic palette that could be retuned
// for something else entirely.
const COLLAPSE_CHIP_BG = '#eef4ff';
const COLLAPSE_CHIP_BORDER = '#c7dbfe';
const COLLAPSE_CHIP_TEXT = '#2563eb';

/** Folded widths, from Pipeline_RightRail_Mockup.html. */
const GROUP_SPINE_W = 44;
const GROUP_NARROW_W = 264;
const SUB_SPINE_W = 38;

/**
 * ★ fix-324 — ONE COLUMN OF THE PIPELINE, at either level of folding.
 *
 * This replaces StageGroup (the two working columns) and BottomStrip (two
 * horizontal strips that opened downward). They were two components rendering
 * the same idea with different furniture, and that is exactly why Approved and
 * Issued could not behave like Permitting: a strip has no spine to fold to.
 *
 * ★★ FOLDED MEANS 44px WIDE **AND** FULL HEIGHT. Both halves matter. The first
 * attempt got the width right and still failed, because the two were nested in
 * a shared 300px rail where each owned half the height — short and wide. Bobby:
 * "we want approved and issued to look like permitting, vertical top to bottom
 * of the screen." A section that is a direct flex CHILD of the row can be
 * `flex: 0 0 44px` and full height at once; a nested one cannot. That is the
 * whole trick, and it is why the four are siblings.
 *
 * Sub-columns fold the same way, independently, to a 38px spine — folding
 * Corrections leaves Under Review holding the width with its list intact. That
 * is the control an entitlements person uses daily.
 */
function PipelineGroup({
  groupKey,
  title,
  accent,
  totalCount,
  headerCountTestId,
  loading,
  subBuckets,
  narrow = false,
  stage,
  projectById,
  cyclesByPermit,
  reviewersByPermit,
  activeHeld,
  ctx,
  collapsed,
  onToggle,
  isSubCollapsed,
  onToggleSub,
}: PipelineGroupProps) {
  const projects = distinctProjectCount(subBuckets.flatMap((s) => s.permits));
  return (
    <section
      className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col min-h-0 min-w-0"
      style={{
        flex: collapsed
          ? '0 0 ' + GROUP_SPINE_W + 'px'
          : narrow
            ? '0 0 ' + GROUP_NARROW_W + 'px'
            : '1 1 0%',
        transition: 'flex .22s ease',
      }}
      data-testid={'pipeline-group-' + groupKey}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-narrow={narrow ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Open ' + title : 'Fold ' + title}
        className={
          'flex items-center gap-2 text-left ' +
          (collapsed
            ? 'flex-col h-full justify-start py-3.5 px-0 flex-1 min-h-0'
            : 'px-4 py-3 border-b flex-none')
        }
        style={{
          background: STAGE_HEADER_BG[accent],
          borderBottomColor: collapsed ? undefined : STAGE_HEADER_BORDER[accent],
        }}
        data-testid={'pipeline-group-toggle-' + groupKey}
      >
        <span
          className="text-xs font-display font-extrabold uppercase tracking-wide text-text whitespace-nowrap"
          style={
            collapsed
              ? // ★ The spine's title reads bottom-to-top — the mockup's
                // `writing-mode: vertical-rl`. It is what makes 44px legible
                // instead of a stack of single letters.
                { writingMode: 'vertical-rl', marginTop: 12, letterSpacing: '.13em' }
              : { flex: '1 1 auto' }
          }
        >
          {title}
        </span>
        {/* The project badge is the one thing a spine drops — there is no room
            for it, and the permit total below is the number people scan for. */}
        {!collapsed && (
          <span
            className="text-[10px] font-display font-bold text-dim mr-1"
            title={projects + ' projects · ' + totalCount + ' permits'}
            data-testid={headerCountTestId}
          >
            {projects} proj ·
          </span>
        )}
        <span
          className="font-display font-black text-text"
          style={collapsed ? { fontSize: 16, marginTop: 12 } : { fontSize: 24 }}
        >
          {totalCount}
        </span>
        {/* ★ fix-327 #2 — THE CONTROL THAT SAYS THIS FOLDS.
            Bobby: "on the D&E bucket and permitting bucket, adding a collapse
            button so people know it collapses."

            ★★ THE SAME DEFECT fix-320 FIXED ON THE RIBBON, and the same
            reasoning: a control with no border, no background and no icon does
            not read as a control. fix-324 made the whole header clickable and
            nothing said so — "the whole header is clickable" is not
            discoverability, it is a secret.

            ★ IT IS AN AFFORDANCE, NOT A SECOND CONTROL. It renders as a SPAN
            inside the header button rather than a nested <button>, which would
            be invalid HTML and would give one action two hit targets that can
            disagree. Clicking it hits the header, because it is part of the
            header. The whole header stays clickable exactly as before.

            ★ NO MOTION on the chip itself — the pulse was rejected in fix-320
            and that decision stands. The glyph rotates on state change (a
            transform, not an animation), which is the same thing every other
            fold in this app does. */}
        <span
          aria-hidden
          data-testid={'pipeline-group-collapse-' + groupKey}
          className="flex items-center justify-center flex-none"
          style={{
            marginLeft: collapsed ? 0 : 8,
            marginTop: collapsed ? 12 : 0,
            color: COLLAPSE_CHIP_TEXT,
            background: COLLAPSE_CHIP_BG,
            border: '1px solid ' + COLLAPSE_CHIP_BORDER,
            borderRadius: 6,
            padding: '2px 5px',
            fontSize: 9,
            lineHeight: 1,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              transition: 'transform .15s',
              transform: collapsed ? undefined : 'rotate(90deg)',
            }}
          >
            ▶
          </span>
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-1 min-h-0 divide-x divide-border">
          {subBuckets.map((sub) => {
            const subStage: Stage = sub.urgencyStage ?? stage;
            const subCollapsed = isSubCollapsed(sub.title);
            return (
              <div
                key={sub.title}
                className="flex flex-col min-h-0 min-w-0"
                style={{
                  flex: subCollapsed ? '0 0 ' + SUB_SPINE_W + 'px' : '1 1 0%',
                  transition: 'flex .22s ease',
                }}
                data-testid={'pipeline-sub-' + sub.title}
                data-collapsed={subCollapsed ? 'true' : 'false'}
              >
                <button
                  type="button"
                  onClick={() => onToggleSub(sub.title)}
                  aria-expanded={!subCollapsed}
                  title={subCollapsed ? 'Open ' + sub.title : 'Fold ' + sub.title}
                  className={
                    'flex items-center gap-2 text-left hover:bg-s2 transition ' +
                    (subCollapsed
                      ? 'flex-col h-full justify-start py-2.5 px-0 flex-1 min-h-0'
                      : 'px-3 py-2 flex-none border-b border-border')
                  }
                  data-testid={'pipeline-sub-toggle-' + sub.title}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-none"
                    style={{ background: sub.dotColor }}
                  />
                  <span
                    className="text-[11px] font-display font-bold text-text whitespace-nowrap"
                    style={
                      subCollapsed
                        ? { writingMode: 'vertical-rl', marginTop: 8 }
                        : { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }
                    }
                  >
                    {sub.title}
                  </span>
                  {/* ★ THE COUNT STAYS ON A FOLDED SPINE. Folding a column must
                      not hide how much is in it — that is the difference
                      between putting something away and losing it. The
                      "N proj ·" prefix is what drops; the number is the thing
                      people are folding around. */}
                  {!subCollapsed && (
                    <span
                      className="text-[10px] font-display font-bold text-dim"
                      title={
                        distinctProjectCount(sub.permits) +
                        ' projects · ' +
                        sub.permits.length +
                        ' permits'
                      }
                      data-testid={'dash-subbucket-projcount-' + sub.title}
                    >
                      {distinctProjectCount(sub.permits)} proj ·
                    </span>
                  )}
                  <span
                    className="text-xs font-display font-black text-text"
                    style={subCollapsed ? { marginTop: 8 } : undefined}
                    data-testid={'pipeline-sub-count-' + sub.title}
                  >
                    {sub.permits.length}
                  </span>
                  {/* ★ fix-327 #2 — THE SUB-COLUMNS GET A QUIETER AFFORDANCE, and
                      the brief asked me to decide and say why.

                      A chip on each of the four sub-headers as well as the four
                      group headers is eight tinted controls on one screen, in
                      headers ~100px wide that already carry a dot, a title, a
                      project count and a total. The chip's job is to TEACH that
                      these panels fold; once the group header has taught it, the
                      sub-header only has to CONFIRM it, and a bare chevron in the
                      dim colour does that without competing with the counts
                      Bobby actually scans.

                      Same glyph, same rotation, no tint — quieter by one step,
                      which is the difference between an affordance and clutter. */}
                  <span
                    aria-hidden
                    data-testid={'pipeline-sub-collapse-' + sub.title}
                    className="text-dim flex-none"
                    style={{
                      fontSize: 8,
                      marginLeft: subCollapsed ? 0 : 4,
                      marginTop: subCollapsed ? 8 : 0,
                      display: 'inline-block',
                      transition: 'transform .15s',
                      transform: subCollapsed ? undefined : 'rotate(90deg)',
                    }}
                  >
                    ▶
                  </span>
                </button>
                {!subCollapsed && (
                  // ★ THE ONLY SCROLLER ON THE PAGE. The page is a fixed-height
                  // column now, so overflow lives here — no `calc(100vh - 220px)`
                  // guess, which was the old way and drifted every time the
                  // furniture above it changed height.
                  <div
                    className="flex-1 min-h-0 overflow-y-auto p-2"
                    data-scroll-bucket="true"
                  >
                    {loading ? (
                      <SkeletonRows count={2} rowClassName="h-16" />
                    ) : sub.permits.length === 0 ? (
                      <div className="text-[11px] text-dim italic px-2 py-3">
                        No permits
                      </div>
                    ) : (
                      <SubBucketGroups
                        permits={sub.permits}
                        stage={subStage}
                        cyclesByPermit={cyclesByPermit}
                        reviewersByPermit={reviewersByPermit}
                        projectById={projectById}
                        activeHeld={activeHeld}
                        keyDateLabel={sub.keyDateLabel}
                        getKeyDate={sub.getKeyDate}
                        ctx={ctx}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


// Q9.5.f Item 1: DashSummary removed — counts already render in each
// bucket header, the inline summary string near the search bar was
// redundant.

// Helpers for permitting column key dates — pull most-recent cycle field
// across all cycles attached to that permit.
function getMostRecentCityTarget(permits: Permit[]) {
  const cycles = new Map<number, { city_target: string | null }[]>();
  for (const p of permits) {
    const ps = p as Permit & { permit_cycles?: { city_target: string | null }[] };
    cycles.set(ps.id, ps.permit_cycles ?? []);
  }
  return (p: Permit) => mostRecent(cycles.get(p.id) ?? [], (c) => c.city_target);
}

function getMostRecentCorrIssued(permits: Permit[]) {
  const cycles = new Map<number, { corr_issued: string | null }[]>();
  for (const p of permits) {
    const ps = p as Permit & { permit_cycles?: { corr_issued: string | null }[] };
    cycles.set(ps.id, ps.permit_cycles ?? []);
  }
  return (p: Permit) => mostRecent(cycles.get(p.id) ?? [], (c) => c.corr_issued);
}

function mostRecent<T>(rows: T[], pick: (row: T) => string | null): string | null {
  const dates = rows.map(pick).filter((d): d is string => Boolean(d)).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// Q9.5.e2-fix: scroll every bucket container that holds a matching addr-group
// so the just-opened card is in view. Mirrors v1 toggleProjectExpanded
// :2849-2860 — independent per-container scroll, smooth, with an 8px buffer
// so the card doesn't snap flush to the top edge.
// Q9.5.f-fix-1d: scrollAddrIntoView removed — cross-bucket scroll now
// runs from each AddrGroup's own useEffect (src/components/Dashboard/
// AddrGroup.tsx), guaranteeing the measurement happens after that
// component's expanded body has committed to scrollHeight.

// Q9.5.e2: group permits in a sub-bucket by project address, then render one
// AddrGroup per address. Addresses sort by worst-urgency-first so red groups
// surface to the top — mirrors v1's :2686-2707 sort logic at the group level.
interface SubBucketGroupsProps {
  permits: Permit[];
  stage: Stage;
  cyclesByPermit: Map<number, PermitCycle[]>;
  reviewersByPermit: Map<number, PermitCycleReviewer[]>;
  projectById: Map<string, Project>;
  activeHeld: Set<string>;
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  ctx: DashContext;
}

function SubBucketGroups({
  permits,
  stage,
  cyclesByPermit,
  reviewersByPermit,
  projectById,
  activeHeld,
  keyDateLabel,
  getKeyDate,
  ctx,
}: SubBucketGroupsProps) {
  const groups = useMemo(() => {
    const byAddr = new Map<string, Permit[]>();
    for (const p of permits) {
      const project = projectById.get(p.project_id);
      const addr = project?.address ?? p.struct_address ?? '—';
      const list = byAddr.get(addr) ?? [];
      list.push(p);
      byAddr.set(addr, list);
    }
    // Compute worst-urgency per group for sort + render
    const entries: {
      address: string;
      juris: string | null;
      projectId: string;
      permits: Permit[];
      urgency: ReturnType<typeof cardUrgency>;
    }[] = [];
    for (const [addr, ps] of byAddr) {
      const inputs = ps.map((p) => ({
        permit: p,
        cycles: cyclesByPermit.get(p.id) ?? [],
      }));
      const first = ps[0];
      // fix-170: a held project's card is never urgency-colored.
      const held = activeHeld.has(first.project_id);
      const u = cardUrgency(inputs, stage, undefined, held);
      const project = projectById.get(first.project_id);
      entries.push({
        address: addr,
        juris: project?.juris ?? null,
        projectId: first.project_id,
        permits: ps,
        urgency: u,
      });
    }
    // Red → Yellow → OK; within same urgency, alpha by address.
    const urgRank = { red: 0, yellow: 1, ok: 2 } as const;
    entries.sort((a, b) => {
      const ra = urgRank[a.urgency];
      const rb = urgRank[b.urgency];
      if (ra !== rb) return ra - rb;
      return a.address.localeCompare(b.address);
    });
    return entries;
  }, [permits, projectById, cyclesByPermit, stage, activeHeld]);

  return (
    <>
      {groups.map((g) => (
        <AddrGroup
          key={g.address}
          address={g.address}
          juris={g.juris}
          projectId={g.projectId}
          permits={g.permits}
          stage={stage}
          cyclesByPermit={cyclesByPermit}
          reviewersByPermit={reviewersByPermit}
          cardUrgency={g.urgency}
          activeHold={activeHeld.has(g.projectId)}
          hold={
            ctx.cancelMap.get(g.projectId) ??
            ctx.activeHoldMap.get(g.projectId) ??
            null
          }
          keyDateLabel={keyDateLabel}
          getKeyDate={getKeyDate}
          isOpen={ctx.openAddresses.has(g.address)}
          isHighlighted={ctx.highlightedAddress === g.address}
          // ★★ fix-383: the whole project's spread, not this bucket's slice.
          distribution={ctx.distributionByAddress.get(g.address)}
          onCountClick={(s) => ctx.revealAddress(g.address, s)}
          // ★★★ The ticket this group watches. 0 unless THIS (address, stage)
          // is the click's target — and it changes on every click, so a group
          // that was already open still re-runs its own scroll effect.
          revealNonce={
            ctx.revealTarget &&
            ctx.revealTarget.address === g.address &&
            ctx.revealTarget.stage === stage
              ? ctx.revealTarget.nonce
              : 0
          }
          onToggle={() => ctx.toggleAddress(g.address)}
          onHover={() => ctx.setHighlight(g.address)}
          onLeave={() =>
            ctx.setHighlight(
              ctx.openAddresses.has(g.address) ? g.address : null,
            )
          }
        />
      ))}
    </>
  );
}
