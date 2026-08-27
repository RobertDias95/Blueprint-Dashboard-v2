import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import OriginLink from '../components/OriginLink';
import {
  currentPaneScroll,
  makeOriginState,
  previousTarget,
  rememberPaneScroll,
} from '../lib/previousOrigin';
import { useProjects } from '../hooks/useProjects';
import { usePermitsByProject } from '../hooks/usePermitsByProject';
import { useAllPermitCycleReviewers } from '../hooks/useAllPermitCycleReviewers';
import { effectiveStage } from '../lib/permitStage';
import { STAGE_LABEL } from '../lib/stageLabel';
import { isSubPermit, subPermitBadgeLabel } from '../lib/subPermit';
import { useUpdateProject } from '../hooks/useUpdateProject';
import type {
  PermitCycle,
  PermitCycleReviewer,
  PermitWithCycles,
  Project,
  RedesignTrigger,
  Stage,
} from '../lib/database.types';
import { REDESIGN_TRIGGER_LABELS } from '../lib/database.types';
import { SkeletonRows } from '../components/Skeleton';
import QueryError from '../components/QueryError';
import ProjectDetailHeader from '../components/ProjectDetail/ProjectDetailHeader';
import ScheduleHealthTable from '../components/ProjectDetail/ScheduleHealthTable';
import NotesPanel from '../components/ProjectDetail/NotesPanel';
import PermitDetailV2 from '../components/ProjectDetail/PermitDetailV2';
import ProjectSettingsModal from '../components/ProjectDetail/ProjectSettingsModal';
import { ProjectHoldBadge } from '../components/ProjectDetail/ProjectHold';
import { LandUsePhaseBadge } from '../components/ProjectDetail/LandUsePhaseBadge';
import DeleteProjectDialog from '../components/ProjectDetail/DeleteProjectDialog';
import DeleteRedesignDialog from '../components/ProjectDetail/DeleteRedesignDialog';
import EditRedesignModal from '../components/ProjectDetail/EditRedesignModal';
import QuickEditPermitModal from '../components/ProjectDetail/QuickEditPermitModal';
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

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectsQ = useProjects();
  const permitsQ = usePermitsByProject(id);

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
  // Building Permit is the canonical anchor for project-level fields
  // (matches v1's `bp = ps.filter(p => p.type === 'Building Permit')[0] || ps[0]`).
  const bp = useMemo(() => {
    return permits.find((p) => p.type === 'Building Permit') ?? permits[0] ?? null;
  }, [permits]);

  // fix-217: deep-link target permit from ?permit=<id> (My Tasks → "Open in
  // Project View"). Resolves to a real permit id on this project, else null (an
  // absent/invalid param — e.g. a project-level task — falls back to the project
  // overview, the pre-fix behavior).
  const [searchParams] = useSearchParams();
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
  // Q9.5.f-fix-16 D + E: Project Settings modal + Delete confirmation
  // dialog are owned at the page level so all four entry points (Settings
  // button / Delete button / future hotkeys) target the same instances.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // fix-126: redesign-wizard state. When non-null the New Project wizard
  // mounts in redesign mode with this seed; settingsOpen is closed first
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
  // Q9.5.f-fix-19: Quick Edit popup opened by double-click on a sidebar row.
  const [quickEditPermitId, setQuickEditPermitId] = useState<number | null>(
    null,
  );
  // ★★★ fix-421: RESOLVED ACROSS THE LINEAGE, not just this project's permits.
  //
  // Double-click-to-quick-edit is a daily gesture for Bobby and the current
  // workaround for the role-cascade defect (P-075). fix-421 gives a redesign's
  // permits the same card every other permit uses, so the same double-click has
  // to reach them — and a redesign permit's `project_id` is the REDESIGN's, so
  // a lookup in `permits` (this project's) returns null and the modal silently
  // never opens. `lineagePermits` is parent + every redesign's permits, which
  // is exactly the set the panel now renders.
  const quickEditPermit =
    quickEditPermitId !== null
      ? lineagePermits.find((p) => p.id === quickEditPermitId) ?? null
      : null;
  // ★★ SIBLINGS STAY SAME-PROJECT. fix-194's "Sub-permit of…" selector writes
  //    `parent_permit_id`, and that marker is enforced same-project app-side —
  //    offering a redesign permit the PARENT's permits as parents would let a
  //    user build a cross-project link the rest of the app does not model.
  const quickEditSiblings = useMemo(
    () =>
      quickEditPermit
        ? lineagePermits.filter((p) => p.project_id === quickEditPermit.project_id)
        : [],
    [lineagePermits, quickEditPermit],
  );
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
        onSettings={() => setSettingsOpen(true)}
        projects={allProjects}
      />

      {settingsOpen && (
        <ProjectSettingsModal
          project={project}
          onClose={() => setSettingsOpen(false)}
          // ★ fix-331 §4: both destructive/ownership actions are handed in as
          // callbacks rather than re-implemented inside the modal, so the page
          // still owns the ONE instance of each dialog — the reason
          // Q9.5.f-fix-16 put them here in the first place. The modal closes
          // itself first so two overlays never stack.
          canReassignDa={isAdmin}
          onReassignDa={() => {
            setSettingsOpen(false);
            setReassignOpen(true);
          }}
          onDelete={() => {
            setSettingsOpen(false);
            setDeleteOpen(true);
          }}
          onSpawnRedesign={() => {
            // fix-126: close the settings modal first so the wizard
            // doesn't overlay it. The seed builds the new wizard state
            // from this project's site facts + auto-suffixes the
            // address so the unique-address constraint is satisfied.
            const seed = makeRedesignWizardState(
              project,
              redesignsQ.count,
              // fix-158: seed the Redesign DD Phase DA with the parent's BP DA.
              bp?.da ?? null,
            );
            setSettingsOpen(false);
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
      {quickEditPermit && (
        <QuickEditPermitModal
          permit={quickEditPermit}
          siblings={quickEditSiblings}
          onClose={() => setQuickEditPermitId(null)}
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

      {/* fix-23e: Two-pillbox body layout. The outer page is bounded
          by `h-full overflow-hidden` (set above on the
          page-root), so vertical growth is impossible regardless of
          how many permits a project has or how tall any single widget
          renders. Inside, two side-by-side pillboxes scroll
          independently:
            • pd-left-pillbox = the permits list (PermitsSidebar)
            • pd-right-pillbox = either the project overview content
              (when no permit is selected) or the per-permit detail
              widgets (when one is). PermitDetailV2's own internal
              flex layout handles the stacking of HeaderStrip / Cycle
              tabs / DateStrip / Tasks / Sidebar widgets; it all
              scrolls as one inside the right pillbox.

          Both pillboxes get rounded-lg border + bg-surface + their
          own overflow-y-auto so the content clips at the pillbox
          edge instead of pushing the outer page down. */}
      <div className="flex flex-1 gap-3 px-3 pb-3 overflow-hidden min-h-0">
        {/* ★★ fix-331 §3: THE CHAT CARD IS GONE FROM THE RAIL. fix-329 put the
            conversation on top of this column and fix-331 moves it into the Team
            card, where Bobby asked for it — "between Internal and External … that
            way your project chat lives in between the two teams and it flows."

            One home for one thread: two entry points is what made it read as a
            bolted-on widget, and it is what the §3 test asserts is over.

            The rail is back to Permits and Redesigns. The wrapper stays — fix-329
            moved the 240px width up here so the column and its children could not
            disagree about it, and that is still worth having with one child. */}
        <div
          className="flex-shrink-0 flex flex-col gap-3 min-h-0"
          style={{ width: 240 }}
          data-testid="pd-left-rail"
        >
          <PermitsSidebar
            permits={permits}
            project={project}
            selectedId={selectedPermit?.id ?? null}
            onSelect={setSelectedPermitId}
            onQuickEdit={setQuickEditPermitId}
          />
        </div>
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
              {/* fix-151: Schedule Health computes across the whole lineage
                  (parent + all redesign permits), not just the parent's. */}
              <ScheduleHealthTable permits={lineagePermits} />
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
      ↗ Redesign of {original ? original.address : '(unknown original)'}
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
}: {
  onSettings: () => void;
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
        <button
          onClick={onSettings}
          className="px-3 py-1 rounded-md text-xs font-bold border border-border bg-s2 text-text hover:bg-s3 transition"
          data-testid="project-settings-btn"
        >
          ⚙ Project Settings
        </button>
      </div>
    </div>
  );
}

// Q9.5.e-fix-4: sidebar redesign per v1 §4.2.1 sidebar parity and
// index.html:3539-3596. Each row shows a stage-tinted dot, permit type
// (Building Permit shows nickname when set), permit # / "No permit # yet",
// stage-appropriate key date with urgency-driven color, and a drag handle.
// Order is persisted as projects.permit_order (number[]). Permits without
// an explicit order are appended after ordered ones, alphabetical fallback.
const STAGE_DOT_COLOR: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

function PermitsSidebar({
  permits,
  project,
  selectedId,
  onSelect,
  onQuickEdit,
}: {
  permits: PermitWithCycles[];
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onQuickEdit: (id: number) => void;
}) {
  const updateProject = useUpdateProject();
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  // fix-104: reviewers feed effectiveStage for MPB / Pending / Applied
  // permits (see fix-54). Pre-fix the sidebar called effectiveStage
  // without reviewers and the row's stage could disagree with the
  // right-hand Schedule Health table — same permit, different label.
  // Index per-permit once at the sidebar level so each SidebarRow
  // grabs its own list cheaply on render.
  const reviewersQ = useAllPermitCycleReviewers();
  const reviewersByPermit = useMemo(() => {
    const m = new Map<number, PermitCycleReviewer[]>();
    for (const r of reviewersQ.data ?? []) {
      const list = m.get(r.permit_id) ?? [];
      list.push(r);
      m.set(r.permit_id, list);
    }
    return m;
  }, [reviewersQ.data]);

  // Sort by project.permit_order; unordered permits drop to the end.
  const order = useMemo(
    () =>
      Array.isArray(project.permit_order) ? project.permit_order : [],
    [project.permit_order],
  );

  // fix-65 (2026-05-27): partition into ACTIVE + ISSUED for the v1 sidebar
  // shape Bobby asked to restore. Active permits stay drag-reorderable
  // (their permit_order persists); issued permits collect at the bottom
  // under a "✓ ISSUED (n)" divider with the --color-is highlight tint and
  // are sorted by actual_issue desc (most recently issued first), static.
  //
  // Classification reuses effectiveStage — the same signal Schedule Health
  // + the row's stage dot already use, so "ISSUED" in the sidebar matches
  // the row's "ISSUED <date>" label without inventing a parallel rule.
  // Pre-fix the partition was inline in the sort comparator (`!!actual_
  // issue`); migrating to effectiveStage also picks up the rare case
  // where a permit has stage_override='is' / terminal portal status but
  // no actual_issue yet.
  // fix-194: index sub/child permits by their parent so each renders nested
  // under its parent row (and never as a standalone active/issued row). A
  // child's "reviewed under <parent #>" label needs the parent's num.
  const childrenByParent = useMemo(() => {
    const m = new Map<number, PermitWithCycles[]>();
    for (const p of permits) {
      if (!isSubPermit(p)) continue;
      const pid = p.parent_permit_id as number;
      const list = m.get(pid) ?? [];
      list.push(p);
      m.set(pid, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.id - b.id);
    return m;
  }, [permits]);
  const numById = useMemo(() => {
    const m = new Map<number, string | null>();
    for (const p of permits) m.set(p.id, p.num);
    return m;
  }, [permits]);

  const { activeSorted, issuedSorted } = useMemo(() => {
    const active: PermitWithCycles[] = [];
    const issued: PermitWithCycles[] = [];
    for (const p of permits) {
      // fix-194: children are rendered nested under their parent, not as their
      // own active/issued row.
      if (isSubPermit(p)) continue;
      // fix-104: pass per-permit reviewers so the active/issued split
      // matches what the row itself + the Schedule Health table see.
      const isIssued =
        effectiveStage(
          p,
          p.permit_cycles ?? [],
          reviewersByPermit.get(p.id) ?? null,
        ) === 'is';
      (isIssued ? issued : active).push(p);
    }
    const byOrder = (a: PermitWithCycles, b: PermitWithCycles) => {
      const oa = order.indexOf(a.id);
      const ob = order.indexOf(b.id);
      const aRank = oa === -1 ? Number.MAX_SAFE_INTEGER : oa;
      const bRank = ob === -1 ? Number.MAX_SAFE_INTEGER : ob;
      if (aRank !== bRank) return aRank - bRank;
      // Fallback: created order (id ascending, since permits.id is identity)
      return a.id - b.id;
    };
    active.sort(byOrder);
    // Issued: most-recently-issued first. Permits with stage='is' but
    // no actual_issue (e.g. stage_override or terminal portal status
    // without a stamped date) fall back to approval_date, then id desc.
    issued.sort((a, b) => {
      const da = a.actual_issue ?? a.approval_date ?? '';
      const db = b.actual_issue ?? b.approval_date ?? '';
      if (da !== db) return db.localeCompare(da);
      return b.id - a.id;
    });
    return { activeSorted: active, issuedSorted: issued };
  }, [permits, order, reviewersByPermit]);

  function commitOrder(nextActiveIds: number[]) {
    if (!project.updated_at) return;
    // Persist the canonical order across BOTH groups so a permit moving
    // back from issued → active (rare — e.g. an actual_issue cleared
    // by fix-actual-issue self-heal) still has a stable position. Active
    // first (user-chosen), issued appended in their current date-desc
    // order (stable across navigations).
    const next = [...nextActiveIds, ...issuedSorted.map((p) => p.id)];
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { permit_order: next },
      fieldLabel: 'Permit order',
    });
  }

  function onDragStart(e: React.DragEvent, permitId: number) {
    e.dataTransfer.setData('text/plain', String(permitId));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, permitId: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== permitId) setDragOverId(permitId);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOverId(null);
  }
  function onDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    setDragOverId(null);
    const src = Number(e.dataTransfer.getData('text/plain'));
    if (!src || src === targetId) return;
    // Reorder operates ONLY within the active group. v1 kept issued
    // permits as a static bottom block; matching that here keeps the
    // "what's done" section from being accidentally re-ordered when
    // a user is shuffling active permits.
    const activeIds = activeSorted.map((p) => p.id);
    const fromIdx = activeIds.indexOf(src);
    const toIdx = activeIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...activeIds];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, src);
    commitOrder(next);
  }

  // fix-23e: PermitsSidebar is the left pillbox. Outer aside has the
  // rounded border + bg-surface; the header stays pinned at top via
  // flex-shrink-0; the permit list claims remaining height and scrolls
  // internally via overflow-y-auto. The aside itself does NOT scroll
  // (overflow-hidden) so the rounded border isn't broken by content
  // overlapping the rounded corners.
  return (
    <aside
      // ★ fix-329: the width moved to the rail wrapper — the chat card above and
      // this list are one column now, and two elements each declaring 240px is
      // how they drift apart.
      className="flex-1 rounded-lg border bg-surface flex flex-col overflow-hidden min-h-0"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="pd-left-pillbox"
    >
      <header
        className="px-3 py-2 border-b flex-shrink-0 flex items-center justify-center"
        style={{
          background: 'var(--color-s2)',
          borderBottomColor: 'var(--color-border)',
        }}
      >
        <span
          className="text-[11px] font-extrabold text-text uppercase tracking-wider"
          data-testid="permits-sidebar-count"
        >
          {/* fix-194: count standalone/parent permits — sub-permit placeholders
              nest under their parent and don't inflate the header count. */}
          Permits ({activeSorted.length + issuedSorted.length})
        </span>
      </header>
      {/* ★★★ fix-421 — THREE BANDS, TOP TO BOTTOM: ACTIVE → REDESIGNS → ISSUED.
          Bobby, 2026-08-26: *"issued should be at the bottom, redesign should be
          above that, and then all the other active and ongoing permits should be
          above that."*

          ★★ ONLY THE ORDER MOVED. The active band, its drag-reorder, the issued
          divider and the nested sub-permits are all exactly as fix-65 / fix-194
          left them — this reads as a three-line diff because that is what it is.
          What changed underneath is inside RedesignsSidebarSection, where the
          bare `PPR · Corrections` lines became real permit cards.

          ★ The "No permits yet." line is still gated on BOTH bands being empty,
          so a project with issued permits and no active ones is unaffected. It
          speaks for THIS project's permits; a redesign's are their own band with
          their own count, which is why the header count is unchanged too. */}
      <div className="flex-1 overflow-y-auto" data-testid="permits-sidebar-list">
        {activeSorted.length === 0 && issuedSorted.length === 0 ? (
          <div className="text-[11px] text-dim italic p-4 text-center">
            No permits yet.
          </div>
        ) : (
          <>
            {/* fix-65: ACTIVE group. Drag-reorder lives here.
                fix-194: each parent renders its sub-permit children nested
                directly beneath it. */}
            {activeSorted.map((p) => (
              <Fragment key={p.id}>
                <SidebarRow
                  permit={p}
                  reviewers={reviewersByPermit.get(p.id) ?? []}
                  selected={p.id === selectedId}
                  dragOver={p.id === dragOverId}
                  draggable
                  onSelect={() => onSelect(p.id)}
                  onQuickEdit={() => onQuickEdit(p.id)}
                  onDragStart={(e) => onDragStart(e, p.id)}
                  onDragOver={(e) => onDragOver(e, p.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, p.id)}
                />
                {(childrenByParent.get(p.id) ?? []).map((c) => (
                  <SidebarRow
                    key={c.id}
                    permit={c}
                    reviewers={[]}
                    selected={c.id === selectedId}
                    dragOver={false}
                    draggable={false}
                    parentNum={numById.get(p.id) ?? null}
                    onSelect={() => onSelect(c.id)}
                    onQuickEdit={() => onQuickEdit(c.id)}
                    onDragStart={() => {}}
                    onDragOver={() => {}}
                    onDragLeave={() => {}}
                    onDrop={() => {}}
                  />
                ))}
              </Fragment>
            ))}
          </>
        )}
        {/* ★ fix-421 BAND 2: redesigns. fix-151 put this at the very bottom of
            the panel; Bobby wants it between the active permits and the issued
            ones, because a redesign is live work and an issued permit is not. */}
        <RedesignsSidebarSection
          parentId={project.id}
          reviewersByPermit={reviewersByPermit}
          onQuickEdit={onQuickEdit}
        />
        {/* fix-65: ✓ ISSUED divider + group. Rendered only when there
            IS at least one issued permit so a fully-active project
            (no issued permits yet) doesn't gain an empty section.
            ★ fix-421 BAND 3 — the bottom, by Bobby's instruction. */}
        {issuedSorted.length > 0 && (
          <>
                <div
                  className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 border-y"
                  style={{
                    background: 'var(--color-is-bg)',
                    color: 'var(--color-is)',
                    borderTopColor: 'var(--color-is-border)',
                    borderBottomColor: 'var(--color-is-border)',
                  }}
                  data-testid="permits-sidebar-issued-divider"
                >
                  <span aria-hidden="true">✓</span>
                  <span>Issued ({issuedSorted.length})</span>
                </div>
                <div
                  style={{ background: 'var(--color-is-bg)' }}
                  data-testid="permits-sidebar-issued-group"
                >
                  {issuedSorted.map((p) => (
                    <Fragment key={p.id}>
                      <SidebarRow
                        permit={p}
                        reviewers={reviewersByPermit.get(p.id) ?? []}
                        selected={p.id === selectedId}
                        // Issued rows aren't part of active drag-reorder
                        // (v1 kept them as a static bottom block).
                        dragOver={false}
                        draggable={false}
                        onSelect={() => onSelect(p.id)}
                        onQuickEdit={() => onQuickEdit(p.id)}
                        onDragStart={() => {}}
                        onDragOver={() => {}}
                        onDragLeave={() => {}}
                        onDrop={() => {}}
                      />
                      {/* fix-194: sub-permit children nested under an issued parent. */}
                      {(childrenByParent.get(p.id) ?? []).map((c) => (
                        <SidebarRow
                          key={c.id}
                          permit={c}
                          reviewers={[]}
                          selected={c.id === selectedId}
                          dragOver={false}
                          draggable={false}
                          parentNum={numById.get(p.id) ?? null}
                          onSelect={() => onSelect(c.id)}
                          onQuickEdit={() => onQuickEdit(c.id)}
                          onDragStart={() => {}}
                          onDragOver={() => {}}
                          onDragLeave={() => {}}
                          onDrop={() => {}}
                        />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </>
            )}
      </div>
    </aside>
  );
}

// ===========================================================================
// ★★★ fix-421 — A REDESIGN'S PERMITS ARE PERMITS
// ===========================================================================
//
// Bobby, 2026-08-26: *"Redesign clearly should show the permits, just like the
// other permits in the permit tab, but just in the category of redesign."*
//
// ★★★ WHAT WAS HERE, AND WHY IT WENT. fix-151 rendered a redesign's permits as
// bare one-line links — `redesignPermitLabel()` produced `PPR · Corrections`
// and nothing else. No stage dot, no permit number, no portal link, no
// structure address, no key date, and **no double-click quick edit**. Against
// the parent's own permits three rows above, wearing the full `SidebarRow`,
// they read as footnotes rather than as permits. They are permits.
//
// ★★ SO `redesignPermitLabel` IS DELETED RATHER THAN KEPT. fix-193 wrote it so
// that a number-less PPR would not read as blank ("PPR · Pre-Submittal · no
// number yet"). `SidebarRow` already answers that: it prints the type, the
// stage breadcrumb, and an italic "No permit # yet" where the number goes. A
// second label function beside a card that already labels itself is exactly the
// drift fix-290 spent a ticket removing from the overview cards.
//
// ★★ AND THE STAGE IS NOW COMPUTED THE SAME WAY EVERYWHERE. fix-151 called
// `effectiveStage(p, cycles, null)` with a hard-coded null for reviewers;
// fix-104 had already established that dropping reviewers makes the sidebar
// disagree with Schedule Health about the same permit. The parent's
// `reviewersByPermit` index covers every permit in the tenant, so it is passed
// straight through and a redesign card reads the same stage as everything else.

// fix-151: the redesigns band of the permits sidebar. Each redesign is a GROUP —
// its own heading (label · trigger, plus edit / delete) with its permits as
// cards beneath it. One hop (useProjectRedesignsWithPermits doesn't recurse).
//
// ★ ORDER: creation date ascending, so "Redesign 1" is the first one Bobby
//   spawned. That is `useProjectRedesignsWithPermits`'s own sort (created_at,
//   then id as a tie-break) and the numbering is the index within it — the
//   label and the position can therefore never disagree.
function RedesignsSidebarSection({
  parentId,
  reviewersByPermit,
  onQuickEdit,
}: {
  parentId: string;
  /** ★ fix-421: the parent panel's per-permit reviewer index, so a redesign
   *  card's stage is computed exactly like every other card's (fix-104). */
  reviewersByPermit: Map<number, PermitCycleReviewer[]>;
  /** ★ fix-421: double-click → Quick Edit Permit, on redesign cards too. */
  onQuickEdit: (id: number) => void;
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
    <div data-testid="project-overview-redesigns-section">
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
          reviewersByPermit={reviewersByPermit}
          onQuickEdit={onQuickEdit}
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

/** How long to wait for a second click before treating the first as a
 *  navigation. The platform double-click threshold is ~500ms but 250 is long
 *  enough for the gesture in practice and short enough not to feel laggy. */
const REDESIGN_CLICK_DEFER_MS = 250;

function RedesignGroup({
  redesign,
  label,
  reviewersByPermit,
  onQuickEdit,
  onEdit,
  onDelete,
}: {
  redesign: RedesignWithPermits;
  label: string;
  reviewersByPermit: Map<number, PermitCycleReviewer[]>;
  onQuickEdit: (id: number) => void;
  onEdit: (label: string) => void;
  onDelete: (label: string) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // ★★★ ONE CARD, TWO GESTURES, AND THEY FIGHT — so the click is DEFERRED.
  //
  // Everywhere else in this panel a single click SELECTS the permit (a local
  // state change) and a double-click opens Quick Edit; the first click of the
  // double is harmless because selecting is idempotent. A redesign card's click
  // NAVIGATES to the redesign's project — fix-151's behaviour, which this ticket
  // is explicitly not allowed to change — and a navigation unmounts the card
  // before `dblclick` can ever fire. Fire-and-forget on the first click means
  // double-click quick edit simply does not exist on these cards.
  //
  // ★★ Bobby uses that gesture daily and it is the current workaround for the
  //    role-cascade defect (P-075), so losing it on the cards this ticket
  //    creates would be a net loss. The single click therefore waits one
  //    double-click interval; a second click cancels the pending navigation and
  //    opens Quick Edit instead. The cost is a ~250ms pause before navigating,
  //    paid ONLY on these cards — the parent's own rows are untouched and
  //    instant, because selecting has nothing to defer.
  function deferNavigate() {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      // ★★ fix-408: carry the origin so "← Previous" comes back HERE, which
      //    the OriginLink this replaces got for free. `makeOriginState` +
      //    `rememberPaneScroll` are exactly what OriginLink does in its own
      //    click handler — called here rather than re-derived, so a programmatic
      //    navigation and a link navigation record the same thing. Reading the
      //    scroll offset in the handler and never in render is fix-408's rule
      //    (a list renders at the top and is clicked after scrolling).
      const origin = makeOriginState(location);
      if (origin) rememberPaneScroll(origin.from, currentPaneScroll());
      navigate(`/project/${redesign.project.id}`, { state: origin });
    }, REDESIGN_CLICK_DEFER_MS);
  }
  function cancelNavigate() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

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
      {/* ★ fix-421 SCOPE 2: this is the GROUP HEADING now, not the row that
          stands in for the permits. It keeps fix-193's link + edit / delete
          actions and its testids; what changed is what sits beneath it. The
          buttons stay OUTSIDE the Link (no nested interactives). */}
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
        redesign.permits.map((permit) => (
          <div
            key={permit.id}
            data-testid={`project-overview-redesign-permit-${permit.id}`}
          >
            {/* ★★★ THE SAME COMPONENT EVERY OTHER PERMIT USES. Stage dot, type ·
                stage breadcrumb, land-use badge, the portal-linked number, the
                structure address and the key date — Bobby asked for "just like
                the other permits in the permit tab" and this is literally that
                component, not a copy of its markup that can drift from it.

                ★ NOT draggable: `permit_order` is a column on THIS project and
                  a redesign's permits are not in it. */}
            <SidebarRow
              permit={permit}
              reviewers={reviewersByPermit.get(permit.id) ?? []}
              selected={false}
              dragOver={false}
              draggable={false}
              onSelect={deferNavigate}
              onQuickEdit={() => {
                cancelNavigate();
                onQuickEdit(permit.id);
              }}
              onDragStart={() => {}}
              onDragOver={() => {}}
              onDragLeave={() => {}}
              onDrop={() => {}}
            />
          </div>
        ))
      )}
    </div>
  );
}

function SidebarRow({
  permit,
  reviewers,
  selected,
  dragOver,
  draggable,
  parentNum,
  onSelect,
  onQuickEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  permit: PermitWithCycles;
  /** fix-194: when this permit is a sub/child, the parent's permit number for
   *  the "reviewed under <parent #>" badge. Undefined for normal rows. */
  parentNum?: string | null;
  /** fix-104: reviewer rows for THIS permit. Threaded into
   *  effectiveStage so the sidebar's stage agrees with the Schedule
   *  Health table (which has always passed reviewers in). Empty
   *  array is fine for permit types that don't carry rollup-driven
   *  status — effectiveStage falls through to the cycle-state path. */
  reviewers: PermitCycleReviewer[];
  selected: boolean;
  dragOver: boolean;
  /** fix-65: issued permits sit in the static bottom group and are not
   *  drag-reorderable. Active permits stay drag-reorderable as before. */
  draggable: boolean;
  onSelect: () => void;
  onQuickEdit: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const cycles = permit.permit_cycles ?? [];
  const stage = effectiveStage(permit, cycles, reviewers);
  const { label: keyLabel, date: keyDate } = pickKeyDate(permit, cycles, stage);
  const displayLabel =
    permit.type === 'Building Permit' && permit.nickname
      ? `Building Permit — ${permit.nickname}`
      : permit.type ?? '—';

  // fix-194: a sub/child permit renders as an indented placeholder — type +
  // permit # + a "Sub-permit · reviewed under <parent #>" badge, NO stage dot /
  // breadcrumb / review timeline (it carries no review state of its own). Still
  // selectable + double-click-editable so the parent link can be cleared.
  if (isSubPermit(permit)) {
    return (
      <div
        onClick={onSelect}
        onDoubleClick={onQuickEdit}
        className="w-full pl-7 pr-3 py-2 border-b cursor-pointer transition flex flex-col gap-0.5"
        style={{
          borderBottomColor: 'var(--color-border)',
          background: selected ? 'var(--color-s3)' : 'transparent',
          borderLeft: '3px solid transparent',
        }}
        data-testid={`permits-sidebar-row-${permit.id}`}
        data-sub-permit="true"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-dim flex-shrink-0 text-[11px] leading-none" aria-hidden="true">
            ↳
          </span>
          <span
            className="text-[11px] truncate flex-1 min-w-0 font-bold text-text"
            data-testid={`permits-sidebar-type-${permit.id}`}
          >
            {displayLabel}
          </span>
        </div>
        <div
          className="text-[9px] text-dim italic truncate pl-[18px]"
          data-testid={`permits-sidebar-subpermit-${permit.id}`}
        >
          {subPermitBadgeLabel(parentNum)}
        </div>
        {permit.num && (
          <div className="text-[10px] truncate pl-[18px]">
            <span className="text-text font-mono" data-testid={`permits-sidebar-num-${permit.id}`}>
              {permit.num}
            </span>
          </div>
        )}
      </div>
    );
  }
  // fix-104: parent stage breadcrumb (e.g. "Building Permit · Permitting")
  // anchors the card on the stage; the sub-event date line below is then
  // clearly subordinate. Pre-fix the card showed only the type on the
  // top line and rendered the dated event in caps below, which read as
  // the primary stage label (the bug Bobby reported on 10431 SE 19th St).
  // The pre-fix urgency-driven date color is gone too — the card's own
  // bg tint / left-border (stage color) already signals stage, and the
  // sub-event line is text-only secondary detail.
  const stageBreadcrumb = STAGE_LABEL[stage];

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDragLeave={draggable ? onDragLeave : undefined}
      onDrop={draggable ? onDrop : undefined}
      onClick={onSelect}
      onDoubleClick={onQuickEdit}
      className="w-full px-3 py-2 border-b cursor-pointer transition flex flex-col gap-1"
      style={{
        borderBottomColor: 'var(--color-border)',
        // Selection / drag-over tints sit on top of the parent group's
        // background tint, so the issued group's --color-is-bg shows
        // through for un-selected, un-hovered issued rows.
        background: dragOver
          ? 'var(--color-de-bg)'
          : selected
            ? 'var(--color-s3)'
            : 'transparent',
        borderLeft: selected
          ? `3px solid var(--color-${stage})`
          : dragOver
            ? '3px solid var(--color-de)'
            : '3px solid transparent',
      }}
      data-testid={`permits-sidebar-row-${permit.id}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="inline-block flex-shrink-0 rounded-full"
          style={{
            width: 7,
            height: 7,
            background: STAGE_DOT_COLOR[stage],
          }}
        />
        {/* fix-104: type · stage breadcrumb. The type stays bold (it's
            still the row's primary identity); the stage gets the muted
            text-dim treatment so the eye reads "Building Permit FIRST,
            currently in Permitting" — not two competing labels. */}
        <span
          className="text-[11px] truncate flex-1 min-w-0"
          data-testid={`permits-sidebar-type-${permit.id}`}
        >
          <span className="font-bold text-text">{displayLabel}</span>
          <span
            className="text-dim font-normal"
            data-testid={`permits-sidebar-stage-${permit.id}`}
          >
            {' · '}
            {stageBreadcrumb}
          </span>
        </span>
        {draggable && (
          <span
            className="text-dim flex-shrink-0 cursor-grab text-[12px] leading-none"
            title="Drag to reorder"
          >
            ⠿
          </span>
        )}
      </div>
      {/* fix-169: land-use phase badge — only for *-LU permits, answers
          "why hasn't this issued?" on the overview. Null for everything else. */}
      <LandUsePhaseBadge permit={permit} />
      <div className="text-[10px] truncate">
        {permit.num ? (
          permit.portal_url ? (
            // fix-35 Bug 1b: restore the portal-link <a> dropped during
            // fix-26→32 (the # had regressed to a blue-styled non-link span).
            // stopPropagation so clicking the # opens the portal without also
            // firing the row's onSelect.
            <a
              href={permit.portal_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-de font-mono hover:underline"
              title="Open city portal"
              data-testid={`permits-sidebar-portal-${permit.id}`}
            >
              {permit.num} ↗
            </a>
          ) : (
            // No portal URL on file: plain (non-blue) mono so it doesn't
            // masquerade as a broken link.
            <span
              className="text-text font-mono"
              title="No portal URL on file"
              data-testid={`permits-sidebar-num-${permit.id}`}
            >
              {permit.num}
            </span>
          )
        ) : (
          <span className="text-dim italic">No permit # yet</span>
        )}
      </div>
      {permit.struct_address && (
        // fix-35 Bug 1a: structure address so multiple BPs on one project
        // are distinguishable.
        <div
          className="text-[10px] text-dim truncate"
          title={permit.struct_address}
          data-testid={`permits-sidebar-addr-${permit.id}`}
        >
          {permit.struct_address}
        </div>
      )}
      {keyDate && (
        // fix-104: sub-event line — lowercase label, normal weight,
        // muted color. No more "CORRECTIONS YYYY-MM-DD" reading like
        // the primary stage; this is now "Corrections: 2026-05-26"
        // in plain secondary text. The label string still comes from
        // pickKeyDate so the precedence (per-stage) is unchanged.
        <div
          className="text-[10px] text-dim font-mono mt-0.5"
          data-testid={`permits-sidebar-sub-event-${permit.id}`}
        >
          {keyLabel}: {keyDate}
        </div>
      )}
    </div>
  );
}

// Stage-appropriate "key date" + short label, mirrors v1's index.html
// :3554-3577 logic.
function pickKeyDate(
  permit: PermitWithCycles,
  cycles: PermitCycle[],
  stage: Stage,
): { label: string; date: string | null } {
  const sortedCycles = [...cycles].sort((a, b) => a.cycle_index - b.cycle_index);
  const c0 = sortedCycles[0];
  const latest = sortedCycles[sortedCycles.length - 1];

  if (stage === 'is') {
    if (permit.actual_issue) return { label: 'Issued', date: permit.actual_issue };
    if (permit.approval_date) return { label: 'Approved', date: permit.approval_date };
  }
  if (stage === 'ap' && permit.approval_date) {
    return { label: 'Approved', date: permit.approval_date };
  }
  if (stage === 'co' && latest) {
    if (latest.corr_issued) return { label: 'Corrections', date: latest.corr_issued };
    if (latest.resubmitted) return { label: 'Resubmitted', date: latest.resubmitted };
    if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  }
  if (stage === 'pm' && latest) {
    if (latest.city_target) return { label: 'City Target', date: latest.city_target };
    if (latest.submitted) return { label: 'Submitted', date: latest.submitted };
    if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  }
  // de stage (or anything fallthrough): submitted on cycle 0, else target_submit
  if (c0?.submitted) return { label: 'Submitted', date: c0.submitted };
  if (permit.target_submit) return { label: 'Target', date: permit.target_submit };
  return { label: 'Target', date: null };
}

