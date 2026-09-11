import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import OriginLink from '../components/OriginLink';
import { RETIRED_PALETTE, retiredHatch } from '../lib/retiredState';
import { displayAddress } from '../lib/displayAddress';
import { previousTarget } from '../lib/previousOrigin';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import type {
  PermitWithCycles,
  Project,
  RedesignTrigger,
} from '../lib/database.types';
import { REDESIGN_TRIGGER_LABELS } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesPanel from '../components/ProjectDetail/NotesPanel';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
// ★ fix-506 §G (P-140): the tabbed modal that replaces the overview's inline
//   editors. Project Settings stays for Address / Jurisdiction / permits /
//   ★★★ fix-514 §A: …and that hand-off is gone. Project Details owns every
//   field; see the note at the top of ProjectDetailsModal.
import ProjectDetailsModal from '../components/ProjectDetail/ProjectDetailsModal';
import {
  PARAM_DATA,
  PARAM_DATA_FOCUS,
  isProjectDataTab,
  type ProjectDataTab,
} from '../lib/projectDataTabs';
import { ProjectHoldBadge } from '../components/ProjectDetail/ProjectHold';
import DeleteProjectDialog from '../components/ProjectDetail/DeleteProjectDialog';
import DeleteRedesignDialog from '../components/ProjectDetail/DeleteRedesignDialog';
import EditRedesignModal from '../components/ProjectDetail/EditRedesignModal';
import NewProjectWizard from '../components/NewProjectWizard';
import ReassignDaModal from '../components/ProjectDetail/ReassignDaModal';
import { useIsTenantAdmin } from '../hooks/useIsTenantAdmin';
import { useProjectDaHandoffs } from '../hooks/useProjectDaHandoffs';
import {
  makeRedesignWizardState,
  type WizardState,
} from '../components/wizard/wizardState';
import {
  useProjectRedesigns,
  useProjectRedesignsWithPermits,
  type RedesignWithPermits,
} from '../hooks/useProjectRedesigns';

// Q3 + Q4: Single-project view. Q3 wired editable permit-level fields. Q4
// adds editable cycles (5 date columns + add/delete) and a tasks section
// per permit (3 buckets: de/pm/co + add/delete). All writes are row-level
// OCC via the bp_upsert_*_row / bp_delete_*_row RPCs.
//
// Q9.5.e: layout rewrite to v1 §4.2.1 parity. Top strip = 4-column
// header (DD Phase / Project / Team / Builder). Body splits into:
//   - Schedule Health summary table (5 cols this phase; full 8 in polish)
//   - Permits sidebar (200px) on the left + selected-permit detail pane
//     (flex) on the right. Existing PermitDetailRow inline edits reused
//     intact inside the right pane.
// Notes + Documents footer below.
//
// Q9.5.e-fix-5: permit edit panel moved to PermitDetailV2 (separate file).
// The inline PermitDetailRow + helpers were removed; per-stage label / badge /
// override option constants moved with them.

/**
 * ★★ fix-466 §6 — A MALFORMED ID IN THE URL SAYS SO IN ENGLISH, ON THIS ROUTE.
 *
 * `/project/null` used to reach the database, which rejected it with *"invalid
 * input syntax for type uuid"* — Postgres's words, shown to Bobby verbatim. The
 * three links that could produce that URL are fixed at source (fix-466,
 * TaskDetailEditor), so this is the second line of defence for any OTHER way of
 * arriving here: a typo, a stale bookmark, a link written later.
 *
 * ★★★ THE CHECK GATES THE QUERY, IT DOES NOT GATE THE PAGE — and that
 * distinction is the whole of this change. `projects.id` is a uuid column, so a
 * value that cannot be a uuid can only ever produce a database error; skipping
 * the permit fetch for it means **the malformed question is never asked**.
 * Whether the page then renders is decided the way it always was — by whether
 * the id matches a project in the already-cached list, which cannot throw.
 *
 * ★ WHY NOT SIMPLY REFUSE A NON-UUID OUTRIGHT: this repo's own fixtures use
 *   ids like `p-23e` and `p1`. The app has never depended on the format, and
 *   turning a rendering decision into a format assertion would break thirty
 *   tests to buy nothing — the id still has to match a real project either way.
 *
 * ★ DELIBERATELY NARROW. This is not a general error-message pass: it is one
 *   route's one parameter.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  // ★ Could this string be a project id at all? Only a uuid can.
  const couldBeAProjectId = id !== undefined && UUID_RE.test(id);
  const projectsQ = useProjects();
  // ★ Pass `undefined` for a value that cannot be an id: the hook's `enabled`
  //   guard then never issues the request, so Postgres is never handed "null".
  //   Hooks cannot be skipped conditionally — the guard goes in the ARGUMENT.
  const permitsQ = usePermitsByProject(couldBeAProjectId ? id : undefined);

  if (projectsQ.error || permitsQ.error) {
    return (
      <QueryError
        title="Project detail failed to load"
        error={projectsQ.error ?? permitsQ.error}
        onRetry={() => {
          projectsQ.refetch();
          permitsQ.refetch();
        }}
      />
    );
  }

  const project = projectsQ.data?.find((p) => p.id === id);
  const isLoading = projectsQ.isLoading || permitsQ.isLoading;

  if (!isLoading && !project) {
    // ★★ TWO DIFFERENT FAILURES, AND THEY MUST STAY DIFFERENT. "That project is
    //    gone" and "what you typed cannot be a project id" send the reader to
    //    different next actions, and only the second one was ever showing
    //    Postgres's error message instead of a sentence.
    if (!couldBeAProjectId) {
      return (
        <div
          className="text-sm px-2 py-12 text-center"
          style={{ color: 'var(--color-muted)' }}
          data-testid="project-detail-bad-id"
        >
          That project link is not valid — <code>{String(id)}</code> is not a
          project id.{' '}
          <Link to="/projects" className="text-de underline">
            Back to project list
          </Link>
        </div>
      );
    }
    return (
      <div className="text-sm text-dim italic px-2 py-12 text-center">
        Project not found.{' '}
        <Link to="/projects" className="text-de underline">
          Back to project list
        </Link>
      </div>
    );
  }

  if (isLoading || !project) {
    return <SkeletonRows count={6} rowClassName="h-16" />;
  }
  const permits = permitsQ.data ?? [];
  return <ProjectDetailBody project={project} permits={permits} />;
}

function ProjectDetailBody({
  project,
  permits,
}: {
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number];
  permits: PermitWithCycles[];
}) {
  // fix-126: full projects list is already cached by the page-level
  // useProjects call; re-issuing it here is free under React Query's
  // dedupe + lets the "Redesign of [original]" badge + the
  // "Redesigns (N)" subsection look up siblings without prop drilling.
  const projectsQ = useProjects();
  const allProjects = projectsQ.data ?? [];
  // ★★★ fix-524 §D — HAS THIS PROJECT BEEN SUPERSEDED, AND BY WHAT.
  //
  //     Derived, never stored: a project is redesigned away when another
  //     non-archived project names it in `redesign_of_project_id`. The same
  //     rule the Draw Schedule block and the Pipeline read, through the same
  //     module — §A: *"put that predicate in exactly one place."*
  //
  // ★ 17 originals on prod (2026-09-11), 0 of them also cancelled. The list is
  //   already cached and already in this component for the `Redesign of` badge,
  //   so this costs one pass.
  // ★ Keyed off `projectsQ.data` rather than the `?? []` alias: the fallback is
  //   a fresh array literal on every render, which would make this memo useless
  //   and add an `exhaustive-deps` warning to the baseline.
  const supersededBy = useMemo(
    () =>
      projectsQ.data?.find(
        (p) => !p.archived && p.redesign_of_project_id === project.id,
      ) ?? null,
    [projectsQ.data, project.id],
  );
  // Building Permit is the canonical anchor for project-level fields
  // (matches v1's `bp = ps.filter(p => p.type === 'Building Permit')[0] || ps[0]`).
  const bp = useMemo(() => {
    return permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  }, [permits]);

  // fix-217: deep-link target permit from ?permit=<id> (My Tasks → "Open in
  // Project View"). Resolves to a real permit id on this project, else null (an
  // absent/invalid param — e.g. a project-level task — falls back to the project
  // overview, the pre-fix behavior).
  const [searchParams, setSearchParams] = useSearchParams();
  const permitParam = searchParams.get('permit');
  // fix-219: resolve the ?permit= value TYPE-ROBUSTLY. permit.id is typed
  // `number` but the URL param is a string, and a strict === against a coerced
  // Number silently misses if the runtime id shape ever differs. Match by
  // String coercion on both sides and return the permit's OWN id (whatever its
  // runtime type) so downstream selection comparisons stay self-consistent.
  const permitParamId = useMemo(() => {
    if (!permitParam) return null;
    const match = permits.find((p) => String(p.id) === String(permitParam));
    return match ? match.id : null;
  }, [permitParam, permits]);

  // Q9.5.e-fix-1: default to project-overview view (null selection)
  // per v1 spatial pattern (index.html:3611). Sidebar click sets a
  // permit; "← Back to overview" link clears back to null.
  const [selectedPermitId, setSelectedPermitId] = useState<number | null>(null);
  // fix-217 → fix-218: apply the deep-link (?permit=) selection when the id
  // RESOLVES to a real permit — NOT merely when the raw param string changes.
  // usePermitsByProject loads async, so on mount `permits` is empty and
  // permitParamId is null; it flips null→<id> on a LATER render with the param
  // string UNCHANGED. fix-217 keyed on the string, so that later resolution never
  // fired and the user stayed on the overview (repro: 548 3rd Ave N, permit 200).
  // We instead remember the param value we've already applied a selection for:
  // apply once when permitParamId is non-null and differs from the applied value.
  // This is the React in-render "adjust state on change" pattern (fix-63/64), not
  // a setState-in-effect (no cascading-render). Applying ONCE per param value
  // preserves a manual "← Back to overview" (we don't re-force it every render);
  // a NEW ?permit= value re-selects; an absent/invalid param never selects
  // (permitParamId null) → overview fallback.
  const [appliedDeepLinkParam, setAppliedDeepLinkParam] = useState<
    string | null
  >(null);
  if (permitParamId !== null && permitParam !== appliedDeepLinkParam) {
    setAppliedDeepLinkParam(permitParam);
    setSelectedPermitId(permitParamId);
  }
  const selectedPermit =
    selectedPermitId !== null
      ? permits.find((p) => p.id === selectedPermitId) ?? null
      : null;

  // fix-217: the permit-detail pane, scrolled into view once the deep-linked
  // permit is selected + rendered (effect runs after commit → ref populated).
  const deepLinkPaneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedPermitId !== null && selectedPermitId === permitParamId) {
      deepLinkPaneRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [selectedPermitId, permitParamId]);
  // Q9.5.f-fix-16 D + E: the Delete confirmation dialog is owned at the page
  // level so every entry point targets the same instance.
  // ★★★ fix-514 §A: `settingsOpen` is GONE with `ProjectSettingsModal`. There
  //     is one project modal now — Project Details — and its tab is in the URL.
  // ★★★ fix-506 §G/§H — PROJECT DATA, AND ITS TAB IS IN THE URL.
  //
  // §H's Library links are `?data=units` / `?data=site`, and fix-362 §2's rule
  // applies: a destination that only works from inside the app is not a
  // destination. Applied ONCE per parameter value with the in-render
  // adjust-on-change pattern (never a setState-in-effect — the React Compiler
  // rejects that form outright, as fix-350 found twice), so somebody can CLOSE
  // the modal and have it stay closed.
  const [dataOpenState, setDataOpenState] = useState<ProjectDataTab | null>(null);
  // ★★★ fix-524 §D — THE FREEZE IS STRUCTURAL, NOT A HIDDEN BUTTON.
  //
  //     *"The original project should be kind of frozen, like a snapshot… if an
  //     edit surface is still reachable on it, the freeze is decorative."*
  //     Removing the ⚙ button would leave TWO other doors open: the permits
  //     table's hover ✎ (fix-517 §E) and `?data=` in the URL, which fix-517
  //     made a deep link. Both route through this one state, so the gate goes
  //     HERE — the modal cannot be opened on a superseded project by any path,
  //     including one somebody bookmarks.
  //
  // ★ The state is still SET by every path that used to set it — the gate is on
  //   the READ, so nothing has to remember to check. A superseded project
  //   resolves `dataOpen` to null no matter what was stored, which is what makes
  //   `?data=permits` on a frozen original render the overview rather than an
  //   editor.
  const dataOpen = supersededBy ? null : dataOpenState;
  const setDataOpen = setDataOpenState;
  const dataParam = searchParams.get(PARAM_DATA);
  const [appliedDataParam, setAppliedDataParam] = useState<string | null>(null);
  if (dataParam === null) {
    if (appliedDataParam !== null) setAppliedDataParam(null);
  } else if (dataParam !== appliedDataParam) {
    setAppliedDataParam(dataParam);
    // ★ An unknown value opens on Site data rather than rendering nothing —
    //   fix-406's lesson: removing a value from a union does not stop a stored
    //   string arriving.
    setDataOpen(isProjectDataTab(dataParam) ? dataParam : 'site');
  }

  function closeProjectData() {
    setDataOpen(null);
    if (searchParams.has(PARAM_DATA)) {
      const next = new URLSearchParams(searchParams);
      next.delete(PARAM_DATA);
      // ★ fix-517 §E: the focus rides with the tab. Leaving it behind would
      //   re-focus a permit the next time the modal opened for any reason.
      next.delete(PARAM_DATA_FOCUS);
      setSearchParams(next, { replace: true });
    }
  }
  /**
   * ★★★ fix-517 §E — WHERE A PERMIT IS EDITED, NOW THAT `QuickEditPermitModal`
   *     IS DELETED.
   *
   * Bobby, 2026-09-10: *"maybe that gets removed and then that just gets put
   * back into project details."* The modal held Permit Type · ENT/DA/CA ·
   * Permit Number · Sub-permit of · Structure Address · Portal URL, and
   * fix-514's Permits tab already held all of those but two — the third time in
   * one week that two editors were found writing one field set
   * (P-207, P-221).
   *
   * ★★ IT GOES THROUGH THE URL, not through local state, so the destination is
   *    linkable and `← Previous` behaves. `?data=permits&focus=<id>` reuses
   *    fix-514 §C's deep link rather than inventing a second one — which is
   *    what §E asks for in as many words.
   */
  function openPermitInProjectDetails(permitId: number) {
    const next = new URLSearchParams(searchParams);
    next.set(PARAM_DATA, 'permits');
    next.set(PARAM_DATA_FOCUS, String(permitId));
    setSearchParams(next);
  }
  const [deleteOpen, setDeleteOpen] = useState(false);
  // fix-126: redesign-wizard state. When non-null the New Project wizard
  // mounts in redesign mode with this seed; Project Details is closed first
  // so the two modals never overlap. The seed embeds the parent project's
  // address suffixed " [Redesign N]" — see makeRedesignWizardState +
  // useProjectRedesigns.
  const [redesignSeed, setRedesignSeed] = useState<WizardState | null>(null);
  // fix-225: DA reassign (ownership handoff) — admin-only modal + shared marker.
  const [reassignOpen, setReassignOpen] = useState(false);
  const isAdmin = useIsTenantAdmin();
  const handoffsQ = useProjectDaHandoffs(project.id);
  const redesignsQ = useProjectRedesigns(project.id);
  // fix-151: redesigns + their permits. Drives the Redesigns sidebar section
  // and the Schedule Health lineage aggregation (parent + all redesign permits
  // → one holistic health computation). Empty for projects with no redesigns,
  // so non-redesign parents behave exactly as before.
  const redesignsWithPermitsQ = useProjectRedesignsWithPermits(project.id);
  const lineagePermits = useMemo<PermitWithCycles[]>(() => {
    const redesignPermits = redesignsWithPermitsQ.data.flatMap((r) => r.permits);
    return redesignPermits.length > 0 ? [...permits, ...redesignPermits] : permits;
  }, [permits, redesignsWithPermitsQ.data]);
  /** ★ fix-517 §E: the focused permit, resolved from the URL the same way
   *  `?permit=` is — by String coercion against the lineage, so an id for a
   *  permit this project does not have focuses nothing rather than throwing. */
  const dataFocusPermitId = useMemo(() => {
    const raw = searchParams.get(PARAM_DATA_FOCUS);
    if (!raw) return null;
    const match = lineagePermits.find((p) => String(p.id) === String(raw));
    return match ? match.id : null;
  }, [searchParams, lineagePermits]);

  // ★★★ fix-517 §A — WHICH REDESIGN A LINEAGE PERMIT BELONGS TO.
  //
  // The deleted rail said this with a heading over a group of cards. The table
  // renders every lineage permit in one list, so the fact moves onto the row —
  // a `↳ Redesign 2` line under the permit type. Without it a redesign's permits
  // would be indistinguishable from the parent's, which is the one thing the
  // band's grouping was carrying that the table did not.
  //
  // ★ The numbering is `useProjectRedesignsWithPermits`'s own order (created_at,
  //   then id), which is what `RedesignGroup`'s label has always used — one
  //   source, so the row and the band can never number a redesign differently.
  const redesignLabelByPermitId = useMemo(() => {
    const m = new Map<number, string>();
    redesignsWithPermitsQ.data.forEach((r, i) => {
      for (const p of r.permits) m.set(p.id, `Redesign ${i + 1}`);
    });
    return m;
  }, [redesignsWithPermitsQ.data]);
  // Keep bp around for the project-overview render even when no permit
  // is explicitly selected — the 4-col header anchors on the BP.
  void bp;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      data-testid="project-detail-page"
    >
      {/* Q9.5.e-fix-1: page chrome matches v1 :751-756 — Search button
          left, centered "Project Overview" title (absolute positioning
          so the buttons don't shift it off-center), Project Settings +
          Delete buttons right. */}
      {/* ★ fix-331 §4: one button. Reassign DA and Delete are inside it. */}
      <ProjectPageChrome
        onSettings={() => setDataOpen('site')}
        projects={allProjects}
        frozen={!!supersededBy}
      />

      {dataOpen && (
        <ProjectDetailsModal
          project={project}
          permits={lineagePermits}
          bp={bp}
          allProjects={allProjects}
          initialTab={dataOpen}
          initialFocusPermitId={dataFocusPermitId}
          onClose={closeProjectData}
          canReassignDa={isAdmin}
          onReassignDa={() => {
            closeProjectData();
            setReassignOpen(true);
          }}
          onDelete={() => {
            closeProjectData();
            setDeleteOpen(true);
          }}
          onSpawnRedesign={() => {
            const seed = makeRedesignWizardState(
              project,
              redesignsQ.count,
              bp?.da ?? null,
            );
            closeProjectData();
            setRedesignSeed(seed);
          }}
        />
      )}
      {redesignSeed && (
        <NewProjectWizard
          open={true}
          onClose={() => setRedesignSeed(null)}
          initialState={redesignSeed}
        />
      )}
      {reassignOpen && (
        <ReassignDaModal
          projectId={project.id}
          projectAddress={project.address}
          currentDa={bp?.da ?? null}
          onClose={() => setReassignOpen(false)}
          onUseRedesign={() => {
            // fix-225: the new-block case is a Redesign — reuse the exact
            // wizard-seed path the Settings modal's "Spawn Redesign" uses.
            setReassignOpen(false);
            setRedesignSeed(
              makeRedesignWizardState(project, redesignsQ.count, bp?.da ?? null),
            );
          }}
        />
      )}
      {deleteOpen && (
        <DeleteProjectDialog
          project={project}
          permitCount={permits.length}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {/* Project address sub-header — centered, larger per v1 :758 */}
      <div className="text-center pt-1 pb-2 flex-shrink-0">
        <div className="text-[15px] font-extrabold text-text">
          {project.address}
        </div>
        <div className="text-[11px] text-muted font-mono mt-0.5">
          {project.juris ?? '—'}
        </div>
        {/* fix-126: top "Redesign of X" badge when this project IS a
            redesign of another. Sits directly under the address so the
            link is obvious. Click navigates to the parent's overview. */}
        {project.redesign_of_project_id && (
          <RedesignOfBadge
            originalId={project.redesign_of_project_id}
            projects={allProjects}
          />
        )}
        {/* ★★★ fix-524 §D — AND THE OTHER DIRECTION, WHICH HAS NEVER EXISTED.
            Bobby: *"maybe there's this button that takes you back and forth
            between the original and the current. But we almost have it
            reversed where we're looking back at the original, and the current
            is not really the primary focus."*

            fix-126 shipped HALF of that switch: a redesign has carried a
            "↗ Redesign of X" badge since then. The original has carried
            nothing — you could walk from the current work to the snapshot and
            not back, which is the wrong way round if the current one is the
            primary focus.

            ★★★ THIS RETIRES [[P-073]] ASK 2 RATHER THAN ANSWERING IT. That ask
            was *"how do we show both at once"* and produced three shapes and an
            unresolvable asymmetry — milestones compare, units supersede, team
            undecided. **You do not show both.** There is no comparison view
            here and none is coming. */}
        {supersededBy && (
          <SupersededBadge successor={supersededBy} />
        )}
        {/* fix-167: "On Hold — <reason>" badge — the answer to "why hasn't
            this issued?". Renders only when an active hold exists. */}
        <ProjectHoldBadge projectId={project.id} />
        {/* fix-225: "shared" marker — this project's work was split across DAs
            via a reassign (ownership handoff), so it isn't solely one DA's. */}
        {handoffsQ.data && handoffsQ.data.length > 0 && (
          <span
            className="inline-block mt-1 ml-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border align-middle"
            style={{
              borderColor: 'var(--color-jv-border)',
              background: 'var(--color-jv-bg)',
              color: 'var(--color-jv)',
            }}
            title={`DA reassigned — work shared (was ${handoffsQ.data[0].from_da ?? 'unassigned'}, now ${handoffsQ.data[0].to_da})`}
            data-testid="pd-shared-badge"
          >
            ✳ Shared
          </span>
        )}
      </div>

      {/* ★★★ fix-517 §A (P-219) — THE PERMITS RAIL IS GONE, AND THE ROW IS
          ONE PILLBOX WIDE.

          Bobby: *"on the left-hand side of Project Overview, we're going to get
          rid of Permits… I think we'll have enough width because we're going to
          get rid of that Permits column on the left-hand side… it would solve a
          lot of our width issues at the top where Design Plan of Record,
          Project Team, that all gets to get a little bit bigger."*

          ★★★ THE SHIPPED RAIL WAS 190px, NOT 240 (§0.1). fix-507 §A had
              already narrowed it. So the row gains **202px** — the rail plus
              its 12px gap — and `lib/overviewCardLayout` carries the arithmetic
              of where that 202 goes. At 1600 ALL of it goes to Team, because
              Plan of Record and Project were both pinned at their floors and
              Team was the only card paying for the rail.

          ★★ THE RAIL WAS THREE BANDS AND ONLY TWO WERE REDUNDANT. Active
             permits and issued permits are rows in the PERMITS table below.
             The REDESIGNS band was not — it is the only place a redesign can
             be renamed or deleted — so it moved here rather than dying, minus
             its permit cards, which the table already renders. */}
      <div className="flex flex-1 gap-3 px-3 pb-3 overflow-hidden min-h-0">
        <div
          className="flex-1 rounded-lg border bg-surface overflow-y-auto min-h-0"
          style={{ borderColor: 'var(--color-border)' }}
          data-testid="pd-right-pillbox"
        >
          {selectedPermitId === null || !selectedPermit ? (
            // No permit selected → project overview content. Stacks
            // vertically inside the right pillbox: 4-col header,
            // Schedule Health table, Notes/Docs footer. All scroll
            // together as one pillbox.
            <div
              className="flex flex-col"
              data-testid="project-overview-pane"
            >
              <ProjectDetailHeader
                project={project}
                permits={permits}
                bp={bp}
                allProjects={allProjects}
              />
              {/* ★★★ fix-517 §A/§D/§E — `SCHEDULE HEALTH` IS NOW `PERMITS (n)`
                  AND IT IS THE PROJECT'S ONLY PERMITS LIST.
                  · fix-151: it computes across the whole LINEAGE (parent + every
                    redesign's permits), which is why the redesigns band below it
                    no longer repeats those permits as cards.
                  · §D: a row click opens the Permit View — the deleted rail
                    row's behaviour, moved rather than reinvented.
                  · §E: the row's hover ✎ opens Project Details → Permits focused
                    on that permit, which is what replaced `QuickEditPermitModal`. */}
              <ScheduleHealthTable
                permits={lineagePermits}
                redesignLabelByPermitId={redesignLabelByPermitId}
                onSelect={setSelectedPermitId}
                onEditPermit={openPermitInProjectDetails}
              />
              {/* ★★ fix-517 §A — THE REDESIGNS BAND, MOVED OUT OF THE RAIL.
                  It is the only surface that can rename or delete a redesign,
                  so deleting the rail without moving it would have removed a
                  control this ticket never mentions. */}
              <RedesignsSection
                parentId={project.id}
                onOpenPermits={() => setDataOpen('permits')}
              />
              {/* fix-277: the fix-276 CorrectionsPanel used to sit here. It made
                  the overview long without answering an overview-level question
                  — a 96-item letter dump is analysis, not orientation. The
                  component, its hook and its helpers all still exist and are
                  still tested; the analysis surface is now the Corrections
                  report in the Reporting hub, which reads across every project
                  instead of one. Re-mount this here only if the ask changes back
                  to per-project browsing. */}
              {/* ★ fix-309 #54: Notes is back under Schedule health, as one
                  long vertical bar. fix-285 had moved it into the header grid
                  to fill the space under DD Phase; fix-309 #55 makes that row
                  a single equal-height band, so there is no longer a hole for
                  Notes to fill and it returns to where it reads best. Same
                  panel, same hook, same data — only the position changed. */}
              <NotesPanel projectId={project.id} variant="card" />
            </div>
          ) : (
            // Permit selected → per-permit widgets stack inside the
            // same right pillbox. The "← Back to overview" button sits
            // at the top of the pillbox content; PermitDetailV2 below
            // contributes HeaderStrip / Cycle tabs / DateStrip /
            // Tasks + Sidebar widgets, all rendered in their natural
            // height. The pillbox's overflow-y-auto handles the scroll.
            <div
              ref={deepLinkPaneRef}
              className="flex flex-col min-h-0"
              data-testid="permit-edit-pane"
            >
              <div
                className="px-3 py-2 border-b flex-shrink-0 flex items-center sticky top-0 z-10"
                style={{
                  background: 'var(--color-s2)',
                  borderBottomColor: 'var(--color-border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedPermitId(null)}
                  className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-surface text-text hover:bg-s3 transition"
                  data-testid="permit-edit-back-overview"
                >
                  ← Back to overview
                </button>
              </div>
              <PermitDetailV2
                key={selectedPermit.id}
                permit={selectedPermit}
                project={project}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// fix-126: "Redesign of [original]" badge shown directly under the
// project address when this project is itself a redesign. Clicking
// navigates to the original project's overview. Falls back to a generic
// "Redesign of (unknown)" label if the parent project isn't in the
// cached list — defensive (FK should always resolve under RLS, but a
// soft-deleted parent or a stale cache shouldn't break the UI).
function RedesignOfBadge({
  originalId,
  projects,
}: {
  originalId: string;
  projects: { id: string; address: string }[];
}) {
  const original = projects.find((p) => p.id === originalId) ?? null;
  return (
    <OriginLink
      to={`/project/${originalId}`}
      className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border hover:opacity-80 transition"
      style={{
        background: 'var(--color-co-bg)',
        color: 'var(--color-co)',
        borderColor: 'var(--color-co-border)',
      }}
      data-testid="pd-redesign-of-badge"
    >
      {/* ★ fix-530 §C: the ORIGINAL never carries the suffix, but the helper is
          used anyway — a surface that strips "only where it matters" is a
          surface that stops stripping the day the data changes. */}
      ↗ Redesign of{' '}
      {original ? displayAddress(original.address) : '(unknown original)'}
    </OriginLink>
  );
}

/**
 * ★★★ fix-524 §D — THE ORIGINAL SAYS PLAINLY THAT IT HAS BEEN SUPERSEDED.
 *
 * ★ It is the retired PURPLE, and it is the same paint the Draw Schedule block
 *   and the legend use — §A's whole point is that a reader learns one texture
 *   and one hue and then recognises them everywhere. `RETIRED_PALETTE` is the
 *   single definition; nothing here picks a colour.
 *
 * ★★ "Superseded by" rather than "Redesigned": on the board the reader is
 *    scanning many projects and wants the EVENT; standing on this page they
 *    want the CONSEQUENCE — that this is not where the work is any more, and
 *    where it went instead.
 */
function SupersededBadge({ successor }: { successor: { id: string; address: string } }) {
  const p = RETIRED_PALETTE.redesigned;
  return (
    <OriginLink
      to={`/project/${successor.id}`}
      className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border hover:opacity-80 transition"
      style={{
        background: retiredHatch('redesigned'),
        color: p.text,
        borderColor: p.border,
      }}
      data-testid="pd-superseded-badge"
    >
      ↻ Superseded by {displayAddress(successor.address)}
    </OriginLink>
  );
}

// Q9.5.e-fix-1: page chrome bar per v1 :751-756. Three-section layout
// using absolute centering on the title so the side buttons can grow
// without shifting the title off-center.
//
// ★★ fix-331 §4: ONE BUTTON, NOT THREE. Reassign DA and Delete both moved
// INSIDE Project Settings. Bobby asked for one control; the two that went are
// the two that are rare and consequential, and the one that stayed is the one
// people actually press.
//
// ★ HOW DELETE STAYS DANGEROUS — the brief asks this to be said out loud:
//
//   1. It is FARTHER AWAY, not closer. It used to be a single click from the
//      page header, one slip away from the Settings button beside it. It is now
//      two deliberate steps: open Settings, scroll to a section titled
//      "Danger zone" at the bottom.
//   2. It still READS destructive — red border, red text, red tint, alone in a
//      red-bordered section that says what deletion takes with it.
//   3. The confirmation is UNCHANGED and it is the real guardrail:
//      DeleteProjectDialog still requires the project's address typed verbatim
//      before the button enables. Folding the entry point in did not soften it.
//   4. It is LAST in the modal and outside the save flow, so nothing about
//      editing a project routes past it.
function ProjectPageChrome({
  onSettings,
  projects,
  frozen,
}: {
  onSettings: () => void;
  /** ★★★ fix-524 §D: this project has been superseded by a redesign, so its own
   *  data is a SNAPSHOT. *"If an edit surface is still reachable on it, the
   *  freeze is decorative."* fix-331 §4 consolidated every project-level edit
   *  onto this one button — Reassign DA and Delete live inside the modal it
   *  opens — so removing it removes the whole surface rather than hiding one
   *  control and leaving three. */
  frozen: boolean;
  /** ★ fix-408: the cached project list, used ONLY to name an origin that is
   *  itself a project — see previousOrigin.projectIdFromPath. */
  projects: { id: string; address: string }[];
}) {
  // ★ Read from router state, which only the click that brought you here can
  //   set. An unrecognised value falls through to the no-origin case.
  // ★★ fix-408: resolved against the CURRENT location too, so an origin equal
  //    to the page you are standing on is declined rather than offering you a
  //    Previous that reloads what you are already looking at.
  const loc = useLocation();
  const previous = previousTarget(loc.state, `${loc.pathname}${loc.search}`, {
    // ★★ fix-408 §6: chaining. A permit chip inside a chat, the "Redesign of"
    //    badge and the Reuse editor all link project → project, and a project's
    //    name is its ADDRESS. The link records only where it was; the address
    //    is looked up here, where the cached list already is.
    labelForProject: (id) => projects.find((p) => p.id === id)?.address ?? null,
  });
  return (
    <div
      className="relative flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid="project-page-chrome"
    >
      {/* ★★★ fix-403 — PREVIOUS, not Search.
          Bobby: *"instead of us having a search button, if there was a go back
          or a previous button."* It returns to the list this project was opened
          FROM, and that list restores its own filters from sessionStorage, so
          the search you were mid-thought in is still there.

          ★★★ fix-408 — FROM EVERY ENTRY PATH, not just two. fix-403 honoured
          Library and Pipeline; every other way in — a notification, a board
          card, a report row, a chat link — read "← Search" and cost you a trip
          through the ribbon. Bobby (register P-041): *"Previous is a site-wide
          smart function."* Every link into a project is an <OriginLink> now and
          the label is that page's own name.

          ★★ With NO origin (deep link, refresh, a link out of Slack) it is
          exactly the button it replaced: "← Search" to /projects. See
          previousOrigin.ts for why that beats both hiding it and guessing.

          ★ `state` carries fix-408 §4's one-shot scroll offset back to the
          origin page; Chrome applies it. It is undefined for a page that was
          not scrolled, so an ordinary return pushes no extra state. */}
      <Link
        to={previous.to}
        state={previous.state}
        className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition no-underline whitespace-nowrap"
        data-testid="project-search-back"
      >
        {previous.label}
      </Link>
      <div
        className="absolute left-0 right-0 text-center pointer-events-none text-xl font-extrabold text-text"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      >
        Project Overview
      </div>
      <div className="flex items-center gap-2">
        {frozen ? (
          // ★★ NOT a disabled button. A disabled ⚙ says *"you may not do this"*,
          //    which invites somebody to go looking for permission; this says
          //    what is true — the project is a snapshot, and the place to edit
          //    is the one that superseded it. fix-523 §B2's ruling, generalised:
          //    do not offer an affordance that cannot work.
          <span
            className="px-3 py-1 rounded-md text-xs font-bold border"
            style={{
              background: retiredHatch('redesigned'),
              color: RETIRED_PALETTE.redesigned.text,
              borderColor: RETIRED_PALETTE.redesigned.border,
            }}
            data-testid="project-frozen-note"
          >
            ↻ Snapshot — read only
          </span>
        ) : (
          <button
            onClick={onSettings}
            className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
            data-testid="project-data-btn"
          >
            ⚙ Project Details
          </button>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// ★★★ fix-517 §A — THE REDESIGNS BAND SURVIVES THE RAIL
// ===========================================================================
//
// The rail had three bands: active permits, redesigns, issued permits. §A
// deletes the rail because *"all of that information is kind of redundant"* —
// and for two of the three bands it is: every one of those permits is a row in
// the PERMITS table, which has computed across the whole lineage since fix-151.
//
// ★★★ THE REDESIGNS BAND IS NOT REDUNDANT, AND THE BRIEF DOES NOT MENTION IT.
//     It is the ONLY surface in the app that can rename or delete a redesign
//     (fix-193's ✎ / ✕), and it is the only place a redesign's trigger and its
//     reuse-of-parent-permits answer are stated. Deleting the rail wholesale
//     would have taken all of that with it, silently. So the band moved onto
//     the overview pane instead, under the table.
//
// ★★ WHAT IT LOST IS ITS PERMIT CARDS, and that is the ticket working. fix-421
//    gave a redesign's permits the full `SidebarRow` treatment so they would
//    read as permits rather than footnotes; the table now gives them the full
//    ROW treatment, in the same list as everything else, with a `↳ Redesign N`
//    line saying whose they are. Rendering them twice on one pane is exactly
//    the redundancy §A exists to remove.
//
// ★★ AND `REDESIGN_CLICK_DEFER_MS` GOES WITH THEM. fix-421 deferred a
//    redesign card's click by 250ms so a double-click could reach Quick Edit
//    before the navigation unmounted the card. §E deletes Quick Edit, so the
//    gesture it was protecting no longer exists and the delay is pure lag.
//    The heading link navigates immediately again.
//
// ★ ORDER: creation date ascending, so "Redesign 1" is the first one Bobby
//   spawned. That is `useProjectRedesignsWithPermits`'s own sort (created_at,
//   then id) and the numbering is the index within it — which is the same map
//   the table's `↳ Redesign N` row line reads, so the two cannot disagree.
function RedesignsSection({
  parentId,
  onOpenPermits,
}: {
  parentId: string;
  /** Where "its permits are in the table above" sends someone who wants to
   *  EDIT one — Project Details → Permits, the surface §E consolidated on. */
  onOpenPermits: () => void;
}) {
  const { data } = useProjectRedesignsWithPermits(parentId);
  // fix-193: per-redesign edit / delete targets (the redesign + its sidebar
  // "Redesign N" label). Null = no dialog open.
  const [editTarget, setEditTarget] = useState<{
    project: Project;
    label: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    project: Project;
    label: string;
  } | null>(null);
  if (data.length === 0) return null;
  return (
    <div
      className="flex-shrink-0 border-b border-border"
      data-testid="project-overview-redesigns-section"
    >
      <div
        className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 border-y"
        style={{
          background: 'var(--color-co-bg)',
          color: 'var(--color-co)',
          borderTopColor: 'var(--color-co-border)',
          borderBottomColor: 'var(--color-co-border)',
        }}
        data-testid="permits-sidebar-redesigns-divider"
      >
        <span aria-hidden="true">↳</span>
        <span>Redesigns ({data.length})</span>
      </div>
      {data.map((r, i) => (
        <RedesignGroup
          key={r.project.id}
          redesign={r}
          label={`Redesign ${i + 1}`}
          onOpenPermits={onOpenPermits}
          onEdit={(label) => setEditTarget({ project: r.project, label })}
          onDelete={(label) => setDeleteTarget({ project: r.project, label })}
        />
      ))}
      {editTarget && (
        <EditRedesignModal
          redesign={editTarget.project}
          label={editTarget.label}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteRedesignDialog
          redesign={deleteTarget.project}
          label={deleteTarget.label}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * ★★★ THE THREE STATES OF `redesign_reuses_original_permit`, SAID OUT LOUD.
 *
 * Prod, 2026-08-27: **12 true · 3 false · 2 null**. Null is not a tidier false —
 * it is "nobody has answered yet", and it is the state Bobby was editing when he
 * found this ticket. fix-151 tested `=== true` and rendered false and null
 * identically (as nothing), which reads as a settled No on a question no one has
 * been asked.
 *
 * ★ `false` deliberately renders NOTHING: "this redesign has its own permits" is
 *   already said by the permits underneath it. Only the two states that are NOT
 *   self-evident get words.
 */
function reuseNote(reuses: boolean | null | undefined): string | null {
  if (reuses === true) return "Reuses parent's permits";
  if (reuses == null) return 'Reuse of parent permits not answered';
  return null;
}

/**
 * ★★★ THE EMPTY STATE, AND IT IS THE MAJORITY CASE.
 *
 * Prod, 2026-08-27: **12 of 17 active redesigns carry no permits at all.** A
 * heading with nothing under it reads as a component that failed to load, which
 * is a worse bug than the one this ticket fixes.
 *
 * ★★ IT IS KEYED OFF THE PERMIT COUNT, NOT OFF THE REUSE FLAG — and in prod
 * today those two happen to select exactly the same 12 rows (every reuse=true
 * redesign has zero permits; every redesign WITH permits answered the question).
 * That coincidence is not a rule: a redesign whose reuse question is unanswered
 * and whose permits have not been created yet is a real state — it is the state
 * a brand-new redesign is in for as long as it takes to add one — and keying off
 * the flag would render it as a bare heading. Zero such rows today; the line has
 * to be right the first time one exists.
 */
function redesignEmptyLine(reuses: boolean | null | undefined): string {
  if (reuses === true) return 'No permits of its own — the parent\'s are reused.';
  if (reuses == null) return 'No permits yet.';
  return 'No permits yet.';
}

function RedesignGroup({
  redesign,
  label,
  onOpenPermits,
  onEdit,
  onDelete,
}: {
  redesign: RedesignWithPermits;
  label: string;
  onOpenPermits: () => void;
  onEdit: (label: string) => void;
  onDelete: (label: string) => void;
}) {
  const trig = redesign.project.redesign_trigger;
  const triggerLabel = trig
    ? REDESIGN_TRIGGER_LABELS[trig as RedesignTrigger] ?? trig
    : null;
  const note = reuseNote(redesign.project.redesign_reuses_original_permit);

  return (
    <div
      className="border-b"
      style={{ borderBottomColor: 'var(--color-border)' }}
      data-testid={`permits-sidebar-redesign-group-${redesign.project.id}`}
    >
      {/* ★ fix-421 SCOPE 2: this is the GROUP HEADING, not the row that stands
          in for the permits. It keeps fix-193's link + edit / delete actions
          and its testids. The buttons stay OUTSIDE the Link (no nested
          interactives).
          ★★ fix-517: the click is no longer DEFERRED. fix-421 delayed it by
             250ms so a double-click could reach Quick Edit before the
             navigation unmounted the card; §E deleted Quick Edit, so the delay
             now protects nothing and the link navigates immediately. */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 hover:bg-s2 transition"
        style={{ background: 'var(--color-s2)' }}
      >
        <OriginLink
          to={`/project/${redesign.project.id}`}
          className="flex-1 min-w-0"
          data-testid={`project-overview-redesign-row-${redesign.project.id}`}
        >
          <span className="text-[11px] font-bold text-text">{label}</span>
          {triggerLabel && (
            <span className="text-[10px] text-dim"> · {triggerLabel}</span>
          )}
        </OriginLink>
        <button
          type="button"
          onClick={() => onEdit(label)}
          className="text-dim hover:text-co text-[11px] leading-none px-1 shrink-0"
          title={`Edit ${label}`}
          data-testid={`project-overview-redesign-edit-${redesign.project.id}`}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => onDelete(label)}
          className="text-dim hover:text-de text-[12px] leading-none px-1 shrink-0"
          title={`Delete ${label}`}
          data-testid={`project-overview-redesign-delete-${redesign.project.id}`}
        >
          ✕
        </button>
      </div>
      {note && (
        <div
          className="px-3 pb-1.5 -mt-0.5 text-[10px] italic text-dim"
          style={{ background: 'var(--color-s2)' }}
          data-testid={`project-overview-redesign-note-${redesign.project.id}`}
        >
          {note}
        </div>
      )}
      {redesign.permits.length === 0 ? (
        <div
          className="px-3 py-2 text-[10px] italic text-dim"
          data-testid={`project-overview-redesign-empty-${redesign.project.id}`}
        >
          {redesignEmptyLine(redesign.project.redesign_reuses_original_permit)}
        </div>
      ) : (
        // ★★★ fix-517 §A — THE CARDS ARE GONE AND THIS LINE SAYS WHERE THEY
        //     WENT. fix-421 rendered each of these permits as a full
        //     `SidebarRow`; every one of them is now a row in the PERMITS table
        //     above, tagged `↳ Redesign N`. A pane that listed them twice is
        //     precisely the redundancy §A is deleting.
        <button
          type="button"
          onClick={onOpenPermits}
          className="w-full text-left px-3 py-2 text-[10px] text-dim hover:text-de hover:bg-s2 transition"
          data-testid={`project-overview-redesign-permits-note-${redesign.project.id}`}
        >
          {redesign.permits.length === 1
            ? '1 permit, in the table above.'
            : `${redesign.permits.length} permits, in the table above.`}{' '}
          <span className="underline">Edit in Project Details →</span>
        </button>
      )}
    </div>
  );
}
