import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  Builder,
  PermitWithCycles,
  Project,
  UnitType,
} from '../../lib/database.types';
import type { WaitingOnDiscipline } from '../../lib/database.types';
import {
  asExternalTeamBlob,
  directoryFirmNamesForDiscipline,
  type ExternalTeamBlob,
} from '../../lib/externalTeam';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useExternalTeamShowRules } from '../../hooks/useExternalTeamShowRules';
import { useExternalTeamDirectory } from '../../hooks/useExternalTeamDirectory';
import ExternalFirmSelect from './ExternalFirmSelect';
import {
  nextUnitTypeLabel,
  parseUnitTypes,
  resolveUnitLabel,
  resolveUnitTypesForSave,
} from '../../lib/unitTypeNaming';
import { snapToMonday, addDays } from '../../lib/dateUtils';
import ReuseRedesignDdEditor from './ReuseRedesignDdEditor';
import ReuseEditor from './ReuseEditor';
import {
  useSetBpDdDates,
  type ProjectOverlapConflict,
  type NpOverlapConflict,
} from '../../hooks/useSetBpDdDates';
import { useResolveDaOverlap } from '../../hooks/useResolveDaOverlap';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { useUpdateProjectWithPermits } from '../../hooks/useUpdateProjectWithPermits';
import { pushToast } from '../../stores/toastStore';
import OverlapPrompt from '../OverlapPrompt';
import NpWarningPrompt from '../NpWarningPrompt';
import BuilderAutocompleteField from '../builder/BuilderAutocompleteField';

// Q9.5.e: 4-column header top strip per v1 §4.2.1. Left card holds an
// inner 3-column grid (DD Phase 0.75fr / Project 1.5fr / Team 1.75fr)
// inside a single bordered container with var(--color-s2) background.
// Right panel is a 240px fixed-width Builder/Owner card.
//
// fix-22 Migration 3 sweep: the 11 physical fields (zone/alley/lot/units/
// unit_types/parking/product_types/project_tags/go_date) plus the 4 new
// builder fields moved permits → projects. This file now reads them off
// the joined project and writes them via useUpdateProject. Per-permit
// fields that intentionally stayed on permits (ent_lead, dm, da, dual_da,
// architect, kickoff_date, dd_start, dd_end) still flow through
// useUpdatePermit on the BP anchor.

interface Props {
  project: Project;
  permits: PermitWithCycles[];
  /** When set, edits operate against this permit (the Building Permit
   *  by default). Mirrors v1's pattern of using the BP as the
   *  project-level anchor for permit-scoped fields. */
  bp: PermitWithCycles | null;
  /** fix-126: full project list (cached) so the Proposal-section
   *  "Redesigns (N)" subsection can list this project's children
   *  without prop drilling all the way to ProjectCell. Defaulted in the
   *  component so legacy callers that don't pass it (none in v2 today,
   *  but defensive) render the header exactly as before. */
  allProjects?: Project[];
}

export default function ProjectDetailHeader({
  project,
  permits,
  bp,
  allProjects = [],
}: Props) {
  return (
    <div
      className="flex border-b border-border"
      data-testid="project-detail-header"
    >
      <div
        className="flex-1 px-4 pt-2 pb-2"
        style={{ background: 'var(--color-s2)' }}
      >
        <div
          className="grid border rounded-lg overflow-hidden bg-surface"
          style={{
            gridTemplateColumns: '0.75fr 1.5fr 1.75fr',
            borderColor: 'var(--color-border)',
          }}
        >
          <DDPhaseCell project={project} bp={bp} permits={permits} />
          <ProjectCell project={project} bp={bp} allProjects={allProjects} />
          <TeamCell project={project} bp={bp} permits={permits} />
        </div>
      </div>
      <BuilderOwnerCell project={project} />
    </div>
  );
}

// ============================================================
// DD Phase cell — GO date (read-only, project-level) + DD Start/End
// (editable, permit-level) + Duration
// ============================================================

/** fix-148: project-level Closing date, inline-editable. Moved out of the
 *  overcrowded Project Site cell into DD Phase (closing kicks off the design
 *  phase, and DD Phase has the room). Renders at the top of all three DD Phase
 *  states. Writes projects.closing_date via useUpdateProject (OCC). */
function ClosingRow({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const [draft, setDraft] = useState<string>(project.closing_date ?? '');
  async function commit(next: string | null) {
    if (!project.updated_at) return;
    if (next === (project.closing_date ?? null)) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { closing_date: next } as Partial<Project>,
      fieldLabel: 'Closing Date',
    });
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-dim w-12 flex-shrink-0">Closing</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim();
          void commit(t === '' ? null : t);
        }}
        disabled={occMissing}
        className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
        }}
        data-testid="project-overview-closing"
      />
    </div>
  );
}

function DDPhaseCell({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  if (!bp) {
    // fix-145: a reuse-redesign has no BP permit but DOES carry a draw_schedule
    // lane (fix-144). Render the inline lane editor instead of the dead
    // "No building permit" placeholder so DA / dates / status stay editable.
    // fix-148: Closing date renders above whichever editor mounts.
    if (project.redesign_of_project_id && project.redesign_reuses_original_permit) {
      return (
        <CellShell title="DD Phase" rightBorder>
          <div className="flex flex-col gap-1.5">
            <ClosingRow project={project} />
            <ReuseRedesignDdEditor project={project} />
          </div>
        </CellShell>
      );
    }
    return (
      <CellShell title="DD Phase" rightBorder>
        <div className="flex flex-col gap-1.5">
          <ClosingRow project={project} />
          <div className="text-[11px] text-dim">No building permit</div>
        </div>
      </CellShell>
    );
  }
  return <DDPhaseEditor project={project} bp={bp} permits={permits} />;
}

/** fix-25h: a conflict response from bp_set_bp_dd_dates carries enough
 *  context to drive either the OverlapPrompt (project overlap → Push Down
 *  via bp_resolve_da_overlap) or the NpWarningPrompt (NP overlap → retry
 *  setBpDdDates with forceNp=true). We snapshot everything we need at
 *  the moment the conflict comes back so the prompt's confirm callback
 *  can fire without re-reading state that may have changed. */
interface PendingDdOverlap {
  kind: 'project';
  proposedStartWeek: string;
  proposedEndWeek: string;
  conflicts: ProjectOverlapConflict[];
  drawScheduleUpdatedAt: string;
  daAssigned: string;
  scheduleStatus: string | null;
  anchorAddress: string;
}
interface PendingDdNpWarning {
  kind: 'np';
  ddStart: string;
  ddEnd: string;
  bpUpdatedAt: string;
  conflicts: NpOverlapConflict[];
  daAssigned: string;
  anchorAddress: string;
}

function DDPhaseEditor({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles;
  permits: PermitWithCycles[];
}) {
  // Local-controlled inputs to avoid one-save-per-keystroke. Fires
  // update on blur if the value changed.
  //
  // fix-23a: dd_start/dd_end commits route through useSetBpDdDates so the
  // RPC can cascade target_submit (+14d) across sibling permits AND
  // mirror the dates onto draw_schedule.start_week/end_week.
  //
  // fix-25h: the RPC now overlap-checks the proposed weeks against other
  // projects + NP blocks on the same DA before writing. Project conflicts
  // open OverlapPrompt → Push Down via bp_resolve_da_overlap; NP conflicts
  // open NpWarningPrompt → "Save anyway" retries with forceNp=true.
  const setBpDdDates = useSetBpDdDates();
  const resolveOverlap = useResolveDaOverlap();
  const drawScheduleQ = useDrawSchedule();
  // fix-220: DD dates mirror onto the draw_schedule lane (bp_set_bp_dd_dates),
  // an admin-only mutation. Non-admins see the DD fields read-only.
  const canEdit = useIsTenantAdmin();
  const occMissing = !bp.updated_at;
  const [startDraft, setStartDraft] = useState(bp.dd_start ?? '');
  const [endDraft, setEndDraft] = useState(bp.dd_end ?? '');
  const [pendingOverlap, setPendingOverlap] = useState<PendingDdOverlap | null>(
    null,
  );
  const [pendingNp, setPendingNp] = useState<PendingDdNpWarning | null>(null);
  const dur = computeDuration(startDraft || null, endDraft || null);
  // fix-22 Mig 3: GO date is project-level now.
  const goDisplay = formatGoDate(project.go_date);

  // fix-66: Target Submit anchor. Strictly the project's Building Permit
  // (lowest id when there are several), NOT the page-level `bp` fallback —
  // that one degrades to permits[0] when no BP exists, but Target Submit
  // must render "—"/disabled in that case per spec. Independent of the DD
  // start/end anchor above.
  const targetSubmitBp = useMemo(() => {
    const bps = permits.filter((p) => p.type === 'Building Permit');
    if (bps.length === 0) return null;
    return bps.reduce((lo, p) => (p.id < lo.id ? p : lo));
  }, [permits]);

  /** Look up this project's draw_schedule row from the query cache. Used
   *  to capture da_assigned + status when opening the OverlapPrompt — the
   *  RPC returns the OCC token + proposed weeks, but Push Down also needs
   *  da_assigned + status to write the anchor's new schedule row. */
  const drawRow = useMemo(
    () =>
      drawScheduleQ.data?.find((r) => r.project_id === bp.project_id) ?? null,
    [drawScheduleQ.data, bp.project_id],
  );

  /** Commit DD dates. The RPC accepts (a) both filled, (b) both null
   *  (clear), but rejects partial-null. */
  async function commitDd(opts: { forceNp?: boolean } = {}) {
    if (!canEdit) return; // fix-220: admin-only draw_schedule write
    if (!bp.updated_at) return;
    const rawStart = startDraft.trim() || null;
    const rawEnd = endDraft.trim() || null;
    // Mid-state: one filled, one empty. Hold off until the user finishes.
    if ((rawStart === null) !== (rawEnd === null)) return;
    // fix-141: Monday-align before sending (the picker stays unrestricted; the
    // snap is silent). dd_start forward-snaps to the next Monday — Bobby's
    // locked direction, and the field the Draw Schedule grid keys lanes off, so
    // a non-Monday here is what made 6605's lane invisible. dd_end becomes the
    // Friday of its own end-week (end-week Monday + 4), preserving the Monday+4
    // convention no matter which weekday the user picked. Clear mode (both
    // null) passes straight through. bp_set_bp_dd_dates re-date_trunc's these,
    // so a Monday in is a no-op there — the client just makes it forward.
    const startNorm = snapToMonday(rawStart, 'forward');
    let endNorm = rawEnd === null ? null : addDays(snapToMonday(rawEnd, 'back'), 4);
    // Never let the snapped end fall before the snapped start (tiny same-week
    // spans) — collapse to the Friday of the start week.
    if (startNorm && endNorm && endNorm < startNorm) {
      endNorm = addDays(startNorm, 4);
    }
    // No-op when the snapped values match what's stored AND not retrying.
    if (
      !opts.forceNp &&
      startNorm === (bp.dd_start ?? null) &&
      endNorm === (bp.dd_end ?? null)
    ) {
      return;
    }
    try {
      const result = await setBpDdDates.mutateAsync({
        projectId: bp.project_id,
        ddStart: startNorm,
        ddEnd: endNorm,
        expectedUpdatedAt: bp.updated_at,
        forceNp: opts.forceNp ?? false,
      });
      if (result.overlapKind === 'project') {
        if (
          !drawRow ||
          !drawRow.da_assigned ||
          !result.drawScheduleUpdatedAt ||
          !result.proposedStartWeek ||
          !result.proposedEndWeek
        ) {
          // Missing context to drive Push Down — fall through silently.
          return;
        }
        setPendingOverlap({
          kind: 'project',
          proposedStartWeek: result.proposedStartWeek,
          proposedEndWeek: result.proposedEndWeek,
          conflicts: result.overlapConflicts as ProjectOverlapConflict[],
          drawScheduleUpdatedAt: result.drawScheduleUpdatedAt,
          daAssigned: drawRow.da_assigned,
          scheduleStatus: drawRow.status,
          anchorAddress: project.address,
        });
      } else if (result.overlapKind === 'np') {
        if (!startNorm || !endNorm || !drawRow?.da_assigned) return;
        setPendingNp({
          kind: 'np',
          ddStart: startNorm,
          ddEnd: endNorm,
          bpUpdatedAt: bp.updated_at,
          conflicts: result.overlapConflicts as NpOverlapConflict[],
          daAssigned: drawRow.da_assigned,
          anchorAddress: project.address,
        });
      }
    } catch {
      // Toasts surfaced inside the hook; swallow so input blur doesn't crash.
    }
  }

  async function confirmPushDown() {
    if (!pendingOverlap) return;
    try {
      await resolveOverlap.mutateAsync({
        anchorProjectId: bp.project_id,
        expectedUpdatedAt: pendingOverlap.drawScheduleUpdatedAt,
        daAssigned: pendingOverlap.daAssigned,
        startWeek: pendingOverlap.proposedStartWeek,
        endWeek: pendingOverlap.proposedEndWeek,
        scheduleStatus: pendingOverlap.scheduleStatus,
      });
      setPendingOverlap(null);
    } catch {
      // Toasts surfaced inside useResolveDaOverlap.
    }
  }

  async function confirmNpSaveAnyway() {
    if (!pendingNp) return;
    setPendingNp(null);
    await commitDd({ forceNp: true });
  }

  return (
    <>
      <CellShell title="DD Phase" rightBorder>
        <div className="flex flex-col gap-1.5">
          {/* fix-148: Closing date (moved from Project Site) sits at the top. */}
          <ClosingRow project={project} />
          <PhaseRow
            label="GO Date"
            value={goDisplay}
            dashed
            title="GO date is set on the Project Settings page"
          />
          {/* fix-66: BP-anchored Target Submit, editable in place. Sits
              between GO Date and Start, matching the Start/End input
              rhythm. */}
          <TargetSubmitRow project={project} bp={targetSubmitBp} />
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-dim w-12 flex-shrink-0">Start</span>
            <input
              type="date"
              value={startDraft}
              onChange={(e) => setStartDraft(e.target.value)}
              onBlur={() => void commitDd()}
              disabled={occMissing || !canEdit}
              className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
              data-testid="pd-bp-dd_start"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-dim w-12 flex-shrink-0">End</span>
            <input
              type="date"
              value={endDraft}
              onChange={(e) => setEndDraft(e.target.value)}
              onBlur={() => void commitDd()}
              disabled={occMissing || !canEdit}
              className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
              data-testid="pd-bp-dd_end"
            />
          </div>
          {dur && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-dim w-12 flex-shrink-0">
                Duration
              </span>
              <span className="text-[11px] font-bold text-text">{dur}</span>
            </div>
          )}
        </div>
      </CellShell>
      {pendingOverlap && (
        <OverlapPrompt
          anchorAddress={pendingOverlap.anchorAddress}
          conflictingAddresses={pendingOverlap.conflicts.map((c) => c.address)}
          conflictCount={pendingOverlap.conflicts.length}
          onCancel={() => setPendingOverlap(null)}
          onConfirm={() => void confirmPushDown()}
          pending={resolveOverlap.isPending}
        />
      )}
      {pendingNp && (
        <NpWarningPrompt
          anchorAddress={pendingNp.anchorAddress}
          daName={pendingNp.daAssigned}
          conflicts={pendingNp.conflicts.map((c) => ({
            id: c.id,
            type: c.type,
            label: c.label,
            startWeek: c.start_week,
            endWeek: c.end_week,
          }))}
          onCancel={() => setPendingNp(null)}
          onConfirm={() => void confirmNpSaveAnyway()}
          pending={setBpDdDates.isPending}
        />
      )}
    </>
  );
}

// ============================================================
// fix-66: Target Submit row — BP-anchored, inline-editable.
//
// Mirrors fix-63's AcqTargetCell (ScheduleHealthTable): own local draft +
// mutation, React 19 in-render snapshot to stay synced when the prop moves
// (BP swap OR save→invalidate→refetch), conflict toast that preserves the
// typed value. Writes target_submit via useUpdateProjectWithPermits; the
// DB trigger sets target_submit_is_manual, so we never send that flag.
// ============================================================

function TargetSubmitRow({
  project,
  bp,
}: {
  project: Project;
  /** The project's Building Permit anchor (lowest id), or null when the
   *  project has no BP — in which case the row renders disabled "—". */
  bp: PermitWithCycles | null;
}) {
  const stored = bp?.target_submit ?? '';
  const [draft, setDraft] = useState(stored);
  // React 19 in-render setState pattern (matches AcqTargetCell). useState
  // only seeds once; track a {bpId, value} snapshot and reset the draft
  // synchronously when either moves — a BP swap (rare) or a save-success
  // refetch (same bp, fresh target_submit). bpId uses -1 as the
  // no-BP sentinel so a project gaining/losing its BP also resyncs.
  const bpId = bp?.id ?? -1;
  const [snapshot, setSnapshot] = useState<{ id: number; value: string }>({
    id: bpId,
    value: stored,
  });
  if (snapshot.id !== bpId || snapshot.value !== stored) {
    setSnapshot({ id: bpId, value: stored });
    setDraft(stored);
  }

  const mut = useUpdateProjectWithPermits();
  // Need both OCC tokens. bp null → no anchor; project.updated_at missing →
  // project query hasn't landed. Either disables the input.
  const occMissing = !bp || !bp.updated_at || !project.updated_at;

  async function commit() {
    if (!bp || !bp.updated_at || !project.updated_at) return;
    const next = draft.trim() || null;
    const current = bp.target_submit ?? null;
    if (next === current) return;
    try {
      const result = await mut.mutateAsync({
        projectId: project.id,
        projectExpectedUpdatedAt: project.updated_at,
        // Empty patch — only the permit row is written. The RPC skips the
        // project UPDATE when p_project_patch is `{}`.
        projectPatch: {},
        permitUpserts: [
          {
            id: bp.id,
            expected_updated_at: bp.updated_at,
            // RPC casts NULLIF(elem->>'target_submit','')::date, so null
            // clears the column. The bp_trg_set_target_submit_manual_flag
            // trigger sets target_submit_is_manual on this write — we do
            // NOT pass it.
            target_submit: next,
          },
        ],
        permitDeletes: [],
      });
      if (result.conflict) {
        // out_conflict_kind is 'permit' here (the BP's updated_at moved).
        // Whole edit rolled back atomically — surface the reload prompt and
        // keep `draft` as-typed so the user doesn't lose input. Same copy
        // as fix-62/63 + the ProjectSettings modal.
        pushToast(
          'This project was modified elsewhere — reload and retry.',
          'warn',
        );
        return;
      }
      // onSuccess invalidates the permit queries → fresh bp.target_submit +
      // updated_at land next render; the snapshot block resyncs the draft.
    } catch {
      // hook-level onError already toasted.
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Commit directly — blur()→onBlur is flaky in jsdom and a redundant
      // onBlur is a no-op (commit short-circuits when next === current).
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(stored);
      e.currentTarget.blur();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[9px] text-dim w-12 flex-shrink-0"
        title="Target Submit — projected submit date (project anchor)"
      >
        Target
      </span>
      {bp ? (
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
          disabled={occMissing || mut.isPending}
          className="text-[11px] font-semibold px-1.5 py-0.5 border rounded outline-none flex-1 disabled:opacity-50"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          title="Target Submit (projected submit date, anchored on the Building Permit)"
          data-testid="pd-target-submit"
          aria-label="Target Submit"
        />
      ) : (
        <span
          className="text-[11px] text-dim flex-1"
          title="No Building Permit to anchor Target Submit"
          data-testid="pd-target-submit-empty"
        >
          —
        </span>
      )}
    </div>
  );
}

// ============================================================
// Project cell — Proposal (units/type/unit_types/tags) + Site (zone/
// lot/alley/parking). All values read from projects.*, all writes via
// useUpdateProject post-Mig 3.
// ============================================================

function ProjectCell({
  project,
  bp,
  allProjects,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  allProjects: Project[];
}) {
  void bp;
  // fix-91: product_types is an array. A project can carry multiple
  // (SFR + Attached Units + Cottages on the same parcel). Render each
  // as a chip. Empty array → "Type" row is hidden.
  const productTypes = Array.isArray(project.product_types)
    ? project.product_types
    : [];
  const tags = Array.isArray(project.project_tags)
    ? (project.project_tags as string[])
    : [];
  // fix-126: children of this project (descendant redesigns), sorted by
  // created_at ascending so "Redesign #1" is the first one spawned.
  // Filtered in-place from the already-cached projects list.
  const childRedesigns = useMemo(() => {
    return allProjects
      .filter((p) => p.redesign_of_project_id === project.id)
      .sort((a, b) => {
        const aT = a.created_at ?? '';
        const bT = b.created_at ?? '';
        if (aT !== bT) return aT.localeCompare(bT);
        return a.id.localeCompare(b.id);
      });
  }, [allProjects, project.id]);
  const [redesignsOpen, setRedesignsOpen] = useState(false);

  return (
    <CellShell title="Project" rightBorder>
      <div
        className="grid border rounded-md overflow-hidden"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Proposal */}
        <div
          className="p-2 border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Proposal
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-dim min-w-[36px]">Units</span>
              {project.units != null && project.units > 0 ? (
                <span className="text-sm font-extrabold text-text">
                  {project.units}
                </span>
              ) : (
                // fix-88: Bobby spotted 2724 Walnut Ave SW (and 1 other)
                // saved without a unit count — the wizard pre-fix-88
                // didn't gate this. The badge makes the gap visible at a
                // glance so the team can backfill the value via Project
                // Settings (NULL and 0 both flag — 0 isn't a real unit
                // count for any project type we handle).
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-co-bg text-co border-co-border"
                  title="This project was saved without a unit count. Open Project Settings to add one."
                  data-testid="units-missing-badge"
                >
                  ⚠ missing
                </span>
              )}
            </div>
            {productTypes.length > 0 && (
              <div
                className="flex items-baseline gap-1.5"
                data-testid="pd-product-types"
              >
                <span className="text-[9px] text-dim min-w-[36px]">Type</span>
                <div className="flex flex-wrap gap-1">
                  {productTypes.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-de-bg text-de border-de-border"
                      data-testid={`pd-product-type-${t}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* fix-216: Reuse provenance badge + set/change/clear editor.
                Parallel to the Redesigns section; one field shared with the
                wizard + reports. */}
            <ReuseEditor project={project} allProjects={allProjects} />
            {/* Unit Dimensions section. fix-22 Mig 3: unit_types lives on
                projects now, writes via useUpdateProject. */}
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px] pt-0.5">
                Units
              </span>
              <div className="flex-1 min-w-0">
                <UnitDimensions project={project} />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px]">Tags</span>
              <div className="flex flex-wrap gap-0.5">
                {tags.length === 0 ? (
                  <span className="text-[9px] text-dim italic">none</span>
                ) : (
                  tags.map((t) => (
                    <span
                      key={t}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded border"
                      style={{
                        background: 'var(--color-de-bg)',
                        color: 'var(--color-de)',
                        borderColor: 'var(--color-de-border)',
                      }}
                    >
                      {t}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* fix-126: expandable Redesigns (N) subsection. Hidden
                entirely when zero descendants exist (empty state is
                noise). Collapsed by default — caret toggles open. */}
            {childRedesigns.length > 0 && (
              <div
                className="mt-1 pt-1 border-t"
                style={{ borderTopColor: 'var(--color-border)' }}
                data-testid="pd-redesigns-section"
              >
                <button
                  type="button"
                  onClick={() => setRedesignsOpen((v) => !v)}
                  className="flex items-center gap-1 text-[10px] font-bold text-co hover:opacity-80 transition"
                  aria-expanded={redesignsOpen}
                  data-testid="pd-redesigns-toggle"
                >
                  <span className="font-mono">
                    {redesignsOpen ? '▾' : '▸'}
                  </span>
                  Redesigns ({childRedesigns.length})
                </button>
                {redesignsOpen && (
                  <ul
                    className="mt-1 flex flex-col gap-0.5"
                    data-testid="pd-redesigns-list"
                  >
                    {childRedesigns.map((r, i) => (
                      <li
                        key={r.id}
                        data-testid={`pd-redesign-row-${r.id}`}
                        className="flex items-baseline justify-between gap-2 text-[10px]"
                      >
                        <Link
                          to={`/project/${r.id}`}
                          className="font-display font-bold text-de hover:underline truncate"
                        >
                          Redesign #{i + 1}
                        </Link>
                        <span className="text-dim font-mono truncate">
                          {r.redesign_trigger ?? '—'}
                          {r.redesign_reuses_original_permit === true
                            ? ' · reuse'
                            : r.redesign_reuses_original_permit === false
                              ? ' · new permits'
                              : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Site — fix-22 Mig 3: zone/alley/lot/parking moved to projects;
            writes via useUpdateProject. */}
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            Site
          </div>
          <SiteEditor project={project} />
        </div>
      </div>
    </CellShell>
  );
}

// ============================================================
// Team cell — Internal (ENT/DA/DM/ACQ) + External
// ============================================================

function TeamCell({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  // fix-22 Mig 3: project-level entitlement_lead is the default; bp.ent_lead
  // overrides per-permit (Bobby's PAR/SDOT/ECA pattern). Display the BP
  // override when present, else fall back to project-level default.
  const ent = bp?.ent_lead ?? project.entitlement_lead ?? null;
  const da = bp?.da ?? null;
  const dm = bp?.dm ?? project.design_manager ?? null;
  void permits;

  return (
    <CellShell title="Team">
      <div
        className="grid border rounded-md overflow-hidden"
        style={{
          gridTemplateColumns: '1fr 1fr',
          borderColor: 'var(--color-border)',
        }}
      >
        <div
          className="p-2 border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1">
            Internal
          </div>
          <div className="flex flex-col gap-1">
            <TeamRow label="ENT" value={ent} />
            <TeamRow label="DA" value={da} />
            <TeamRow label="DM" value={dm} />
            <TeamRow label="ACQ" value={project.acq_lead ?? '—'} />
          </div>
        </div>
        <div className="p-2">
          <div className="text-[9px] font-extrabold text-text uppercase tracking-wider mb-1.5">
            External
          </div>
          <ExternalTeamEditor project={project} />
        </div>
      </div>
    </CellShell>
  );
}

// Q9.5.e-fix-3 / fix-190d / fix-195 / fix-196: External team editor on the
// Project Overview. Reads/writes the projects.external_team BLOB (the single
// source — My Tasks → Waiting + the Settings panel use the same store), keyed by
// the canonical WAITING_ON_OPTIONS disciplines (survey term = "Surveyor"). Each
// edit writes the full external_team JSON back via useUpdateProject (OCC).
//
// fix-196: applies the SHARED show-rules (useExternalTeamShowRules) so this
// editor and the Settings panel can't drift — common four always shown; other
// disciplines only when assigned or surfaced via "+ Add discipline"; empty-state
// CTA when nothing assigned. fix-227: the firm field is a DROPDOWN sourced from
// the central External Team directory (shared ExternalFirmSelect), same as the
// Settings panel; picking still writes the blob, "+ Add new firm…" also inserts
// into the directory. Existing free-text blob firms not in the directory show.
function ExternalTeamEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const directoryQ = useExternalTeamDirectory();
  const external = useMemo<ExternalTeamBlob>(
    () => asExternalTeamBlob(project.external_team) ?? {},
    [project.external_team],
  );
  const directory = directoryQ.data ?? [];
  const { shownDisciplines, addableDisciplines, noneAssigned, addDiscipline } =
    useExternalTeamShowRules(external);
  const occMissing = !project.updated_at;

  async function writeFirm(discipline: WaitingOnDiscipline, firm: string) {
    if (!project.updated_at) return;
    const t = firm.trim();
    const prev = (external[discipline] ?? '').trim();
    if (t === prev) return; // no-op
    const next: ExternalTeamBlob = { ...external };
    if (t) next[discipline] = t;
    else delete next[discipline];
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { external_team: next },
      fieldLabel: `${discipline} consultant`,
    });
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="pd-ext-section">
      {/* fix-196: empty-state reminder — most projects need at least a
          surveyor / structural / arborist. */}
      {noneAssigned && (
        <div
          className="text-[8px] leading-tight rounded border px-1.5 py-1"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-co)',
          }}
          data-testid="pd-ext-empty-cta"
        >
          No external team yet — add a Surveyor / Structural / Arborist below.
        </div>
      )}

      {shownDisciplines.map((discipline) => {
        const saved = external[discipline] ?? '';
        return (
          <div
            key={discipline}
            className="flex flex-col gap-0.5"
            data-testid={`pd-ext-row-${discipline}`}
          >
            <span className="text-[8px] font-bold text-dim uppercase tracking-wide">
              {discipline}
            </span>
            <ExternalFirmSelect
              discipline={discipline}
              value={saved}
              firms={directoryFirmNamesForDiscipline(directory, discipline)}
              disabled={occMissing || updateMutation.isPending}
              variant="compact"
              testIdBase={`pd-ext-${discipline.toLowerCase()}`}
              onCommit={(firm) => void writeFirm(discipline, firm)}
            />
          </div>
        );
      })}

      {/* fix-196: surface an as-yet-unshown discipline. */}
      {addableDisciplines.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const d = e.target.value as WaitingOnDiscipline;
            if (d) addDiscipline(d);
          }}
          className="text-[9px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer text-dim"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-ext-add-discipline"
        >
          <option value="">+ Add discipline…</option>
          {addableDisciplines.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ============================================================
// Builder / Owner cell — fix-24d: BuilderAutocompleteField on all 4
// fields (Owner / Business / Email / Cell). Typing surfaces matching
// catalog entries; picking one calls fillFromBuilder which sets all
// four siblings and fires ONE save with the full patch (avoids the
// 4-saves-per-pick race you'd get from blurring each input in
// sequence). Typing without picking still commits-on-blur as before
// and the auto-promote in useUpdateProject (fix-24b) puts the typed
// name into the catalog.
//
// Pre-history: fix-22 Mig 6+7 moved the 4 builder fields permits →
// projects; this cell wrote them as plain inputs until fix-24d wired
// the autocomplete here to match the wizard's Step 1 panel and the
// Project Settings modal.
// ============================================================

function BuilderOwnerCell({ project }: { project: Project }) {
  const updateProject = useUpdateProject();
  const occMissing = !project.updated_at;

  const [name, setName] = useState(project.builder_name ?? '');
  const [company, setCompany] = useState(project.builder_company ?? '');
  const [email, setEmail] = useState(project.builder_email ?? '');
  const [phone, setPhone] = useState(project.builder_phone ?? '');
  // fix-175: owner LLC address (denormalized project cache) + per-project POC.
  const [address, setAddress] = useState(project.builder_address ?? '');
  const [pocName, setPocName] = useState(project.poc_name ?? '');
  const [pocEmail, setPocEmail] = useState(project.poc_email ?? '');

  async function commit<K extends keyof Project>(
    field: K,
    next: string,
    original: string | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    const trimmed = next.trim();
    const normalized: string | null = trimmed === '' ? null : trimmed;
    if (normalized === (original ?? null)) return;
    await updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { [field]: normalized } as Partial<Project>,
      fieldLabel: label,
    });
  }

  /** fix-24d: user picked an existing builder from the autocomplete
   *  menu. Mirror the modal's pattern — fill all four local states,
   *  then fire ONE save carrying the full patch so OCC sees a single
   *  atomic write instead of four racing per-field commits. */
  function fillFromBuilder(b: Builder) {
    const nextName = b.name ?? '';
    const nextCompany = b.company ?? '';
    const nextEmail = b.email ?? '';
    const nextPhone = b.phone ?? '';
    // fix-175: the entity address travels on pick; POC is per-project and is
    // intentionally left untouched.
    const nextAddress = b.address ?? '';
    setName(nextName);
    setCompany(nextCompany);
    setEmail(nextEmail);
    setPhone(nextPhone);
    setAddress(nextAddress);
    if (!project.updated_at) return;
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: {
        builder_name: nextName || null,
        builder_company: nextCompany || null,
        builder_email: nextEmail || null,
        builder_phone: nextPhone || null,
        builder_address: nextAddress || null,
      },
      fieldLabel: 'Builder',
    });
  }

  const labelStyle =
    'text-[8px] font-bold text-dim uppercase tracking-wide';
  const inputClass =
    'text-[12px] font-bold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 disabled:opacity-50';
  const inputStyle = { borderBottomColor: 'var(--color-border)' };
  const emailInputClass = `${inputClass} font-semibold`;
  const emailInputStyle = { ...inputStyle, color: 'var(--color-de)' };

  return (
    <div
      className="flex-shrink-0 px-4 py-2 border-l flex flex-col gap-1.5"
      style={{
        width: 240,
        borderLeftColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid="pd-builder-cell"
    >
      <div className="text-[10px] font-extrabold text-text uppercase tracking-wider">
        Builder / Owner
      </div>
      <div>
        <span className={labelStyle}>Owner</span>
        <BuilderAutocompleteField
          field="name"
          label="Builder Name"
          value={name}
          onChange={setName}
          onSelectBuilder={fillFromBuilder}
          onBlur={() => commit('builder_name', name, project.builder_name, 'Builder Name')}
          placeholder="Full name"
          disabled={occMissing}
          inputClassName={inputClass}
          inputStyle={inputStyle}
          testid="pd-builder-name"
        />
      </div>
      <div>
        <span className={labelStyle}>Business</span>
        <BuilderAutocompleteField
          field="company"
          label="Builder Company"
          value={company}
          onChange={setCompany}
          onSelectBuilder={fillFromBuilder}
          onBlur={() => commit('builder_company', company, project.builder_company, 'Builder Company')}
          placeholder="Company"
          disabled={occMissing}
          inputClassName={inputClass}
          inputStyle={inputStyle}
          testid="pd-builder-company"
        />
      </div>
      <div>
        <span className={labelStyle}>Email</span>
        <BuilderAutocompleteField
          field="email"
          label="Builder Email"
          value={email}
          onChange={setEmail}
          onSelectBuilder={fillFromBuilder}
          onBlur={() => commit('builder_email', email, project.builder_email, 'Builder Email')}
          placeholder="builder@email.com"
          disabled={occMissing}
          inputClassName={emailInputClass}
          inputStyle={emailInputStyle}
          testid="pd-builder-email"
        />
      </div>
      <div>
        <span className={labelStyle}>Cell</span>
        <BuilderAutocompleteField
          field="phone"
          label="Builder Phone"
          value={phone}
          onChange={setPhone}
          onSelectBuilder={fillFromBuilder}
          onBlur={() => commit('builder_phone', phone, project.builder_phone, 'Builder Phone')}
          placeholder="(206) 555-0100"
          disabled={occMissing}
          inputClassName={inputClass}
          inputStyle={inputStyle}
          testid="pd-builder-phone"
        />
      </div>
      {/* fix-175: owner LLC address — autofills on pick from the builder
          entity; commits to the project (denormalized cache). */}
      <div>
        <span className={labelStyle}>LLC Address</span>
        <BuilderAutocompleteField
          field="address"
          label="LLC Address"
          value={address}
          onChange={setAddress}
          onSelectBuilder={fillFromBuilder}
          onBlur={() => commit('builder_address', address, project.builder_address, 'LLC Address')}
          placeholder="Owner / LLC address"
          disabled={occMissing}
          inputClassName={inputClass}
          inputStyle={inputStyle}
          testid="pd-builder-address"
        />
      </div>
      {/* fix-175: per-project point-of-contact. Plain inputs (no catalog
          autocomplete) — the contact can differ deal-to-deal. */}
      <div>
        <span className={labelStyle}>Point of Contact</span>
        <input
          type="text"
          value={pocName}
          onChange={(e) => setPocName(e.target.value)}
          onBlur={() => commit('poc_name', pocName, project.poc_name, 'Point of Contact')}
          placeholder="Contact name"
          disabled={occMissing}
          className={inputClass}
          style={inputStyle}
          data-testid="pd-poc-name"
        />
      </div>
      <div>
        <span className={labelStyle}>Contact Email</span>
        <input
          type="email"
          value={pocEmail}
          onChange={(e) => setPocEmail(e.target.value)}
          onBlur={() => commit('poc_email', pocEmail, project.poc_email, 'Contact Email')}
          placeholder="contact@email.com"
          disabled={occMissing}
          className={emailInputClass}
          style={emailInputStyle}
          data-testid="pd-poc-email"
        />
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function CellShell({
  title,
  rightBorder,
  children,
}: {
  title: string;
  rightBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-2.5 ${rightBorder ? 'border-r' : ''}`}
      style={rightBorder ? { borderColor: 'var(--color-border)' } : undefined}
    >
      <div className="text-[10px] font-extrabold text-text uppercase tracking-wider text-center mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function PhaseRow({
  label,
  value,
  dashed,
  title,
}: {
  label: string;
  value: string;
  dashed?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${dashed ? 'pb-1 border-b border-dashed' : ''}`}
      style={dashed ? { borderColor: 'var(--color-border)' } : undefined}
    >
      <span className="text-[9px] text-dim w-12 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-bold text-text" title={title}>
        {value}
      </span>
    </div>
  );
}

function TeamRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] text-dim w-8 flex-shrink-0">{label}</span>
      <span
        className={`text-[10px] font-bold ${value && value !== '—' ? 'text-text' : 'text-dim'}`}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function computeDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const a = new Date(start + 'T12:00:00');
  const b = new Date(end + 'T12:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return '';
  return `${days}d`;
}

/** Format an ISO date as "MMM DD, YYYY" — matches v1's
 * `toLocaleDateString('en-US', {month:'short', day:'numeric',
 * year:'numeric'})` at index.html:3850. */
function formatGoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ============================================================
// fix-22 Mig 3: Site editor — writes zone / lot / alley / parking_type /
// parking_stalls to projects via useUpdateProject. Previously wrote to
// permits via useUpdatePermit on the BP.
// ============================================================

function SiteEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;

  async function commit<K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    if (next === (original ?? null)) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { [field]: next } as Partial<Project>,
      fieldLabel: label,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <SiteTextRow
        label="Zone"
        value={project.zone}
        placeholder="e.g. RSL"
        disabled={occMissing}
        onCommit={(v) => commit('zone', v || null, project.zone, 'Zone')}
      />
      <SiteLotRow project={project} disabled={occMissing} onCommit={commit} />
      {/* fix-122: Number of Lots (1-20 dropdown, blank = unset). Lives in
          Site because a subdivision count is a parcel-level fact, not a
          proposal/scope fact. Users who need >20 can backfill via the
          wizard or admin tools — the CHECK only enforces >= 1. */}
      <SiteSelectRow
        label="Lots"
        value={project.num_lots != null ? String(project.num_lots) : ''}
        options={[
          '',
          ...Array.from({ length: 20 }, (_, i) => String(i + 1)),
        ]}
        disabled={occMissing}
        onCommit={(v) => {
          const next = v === '' ? null : Number(v);
          void commit(
            'num_lots',
            Number.isFinite(next as number) ? (next as number | null) : null,
            project.num_lots,
            'Number of Lots',
          );
        }}
      />
      {/* fix-122: Corner Lot tri-state. Mirrors Alley's Yes/No/blank
          pattern — blank stays a true "user hasn't picked" so historical
          projects don't get silently flipped to a false answer. */}
      <SiteSelectRow
        label="Corner"
        value={
          project.is_corner_lot === true
            ? 'Yes'
            : project.is_corner_lot === false
              ? 'No'
              : ''
        }
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => {
          const next = v === 'Yes' ? true : v === 'No' ? false : null;
          void commit(
            'is_corner_lot',
            next,
            project.is_corner_lot,
            'Corner Lot',
          );
        }}
      />
      {/* fix-148: Closing Date moved to the DD Phase cell (ClosingRow) — it was
          crowding Project Site, and it fits DD Phase thematically. */}
      <SiteSelectRow
        label="Alley"
        value={project.alley ?? ''}
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => commit('alley', v || null, project.alley, 'Alley')}
      />
      <SiteSelectRow
        label="Parking"
        value={project.parking_type ?? ''}
        options={['', 'None', 'Surface', 'Garage', 'Both']}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_type', v || null, project.parking_type, 'Parking Type')
        }
      />
      <SiteNumberRow
        label="Stalls"
        value={project.parking_stalls ?? null}
        disabled={occMissing}
        onCommit={(v) =>
          commit('parking_stalls', v, project.parking_stalls, 'Parking Stalls')
        }
      />
    </div>
  );
}

// fix-122: date input variant of SiteTextRow. Same look-and-feel as the
// neighbouring text/select/number rows; commits on blur with empty → null.
function SiteTextRow({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft.trim())}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      />
    </div>
  );
}

function SiteSelectRow({
  label,
  value,
  options,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === '' ? '—' : opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function SiteNumberRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const n = trimmed === '' ? null : Number(trimmed);
          onCommit(Number.isFinite(n as number) ? (n as number | null) : null);
        }}
        disabled={disabled}
        className="flex-1 min-w-0 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      />
    </div>
  );
}

function SiteLotRow({
  project,
  disabled,
  onCommit,
}: {
  project: Project;
  disabled: boolean;
  onCommit: <K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) => Promise<void>;
}) {
  const [wDraft, setWDraft] = useState<string>(
    project.lot_width != null ? String(project.lot_width) : '',
  );
  const [dDraft, setDDraft] = useState<string>(
    project.lot_depth != null ? String(project.lot_depth) : '',
  );
  const parse = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">Lot</span>
      <input
        type="number"
        min={0}
        value={wDraft}
        placeholder="W"
        onChange={(e) => setWDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_width', parse(wDraft), project.lot_width, 'Lot Width')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-w"
      />
      <span className="text-[9px] text-dim">×</span>
      <input
        type="number"
        min={0}
        value={dDraft}
        placeholder="D"
        onChange={(e) => setDDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_depth', parse(dDraft), project.lot_depth, 'Lot Depth')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-d"
      />
      <span className="text-[9px] text-dim">ft</span>
    </div>
  );
}

// ============================================================
// fix-22 Mig 3: Unit Dimensions editor — unit_types moved permits →
// projects. Writes via useUpdateProject.
// fix-206: parseUnitTypes + resolveUnitTypesForSave now live in
// lib/unitTypeNaming so the Library matrix shares the identical read/write
// shape (one store, two editable views).
// ============================================================

function UnitDimensions({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const types = parseUnitTypes(project.unit_types);
  // fix-205: the project's product types drive the per-row Label (auto when
  // there's exactly one type; a dropdown when several).
  const productTypes = Array.isArray(project.product_types)
    ? project.product_types.filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
    : [];

  // fix-99: OCC auto-recovery moved into useUpdateProject's mutationFn
  // (silent first attempt → refetch → retry once on stale-token OCC,
  // toast only on a real concurrent edit). writeTypes is back to a
  // single mutateAsync call. The trailing .catch swallows any error
  // (the hook's onError already surfaced the right toast) so the
  // `void writeTypes(...)` callers below don't trip an
  // unhandled-promise-rejection — same pattern as DateCell.tryCommit.
  async function writeTypes(next: UnitType[]) {
    if (!project.updated_at) return;
    // fix-205/206: resolve "unnamed" rows on save — a blank label + a single
    // product type persists as that type. Shared helper so a Library save and a
    // Project Overview save produce identical rows.
    const resolved = resolveUnitTypesForSave(next, productTypes);
    await updateMutation
      .mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: { unit_types: resolved },
        fieldLabel: 'Unit Dimensions',
      })
      .catch(() => {
        /* hook's onError already pushed the user-visible message */
      });
  }

  // Compact mode: empty or single unnamed entry
  const isCompact =
    types.length <= 1 && (types.length === 0 || !types[0]?.label);
  if (isCompact) {
    return (
      <UnitDimensionsCompact
        current={types[0]}
        disabled={occMissing}
        onSet={(field, val) => {
          const base = types[0] ?? { label: '', width_ft: null, depth_ft: null, qty: 1 };
          const next: UnitType = { ...base, [field]: val };
          void writeTypes([next]);
        }}
        onExpand={() => {
          // fix-81: route through nextUnitTypeLabel so the seed letters
          // come from the same pool that + Add uses downstream.
          const first: UnitType =
            types.length === 0
              ? {
                  label: nextUnitTypeLabel([]),
                  width_ft: null,
                  depth_ft: null,
                  qty: 1,
                  stories: null,
                }
              : { ...types[0], label: types[0].label || nextUnitTypeLabel([]) };
          const second: UnitType = {
            label: nextUnitTypeLabel([first.label]),
            width_ft: null,
            depth_ft: null,
            qty: 1,
            stories: null,
          };
          void writeTypes([first, second]);
        }}
      />
    );
  }

  return (
    <UnitDimensionsExpanded
      types={types}
      productTypes={productTypes}
      disabled={occMissing}
      onUpdate={(idx, field, val) => {
        const next = types.map((t, i) =>
          i === idx ? { ...t, [field]: val } : t,
        );
        void writeTypes(next);
      }}
      onRemove={(idx) => {
        const next = types.filter((_, i) => i !== idx);
        void writeTypes(next);
      }}
      onAdd={() => {
        const next = [
          ...types,
          {
            label: nextUnitTypeLabel(types.map((t) => t.label)),
            width_ft: null,
            depth_ft: null,
            qty: 1,
            stories: null,
          },
        ];
        void writeTypes(next);
      }}
    />
  );
}

function UnitDimensionsCompact({
  current,
  disabled,
  onSet,
  onExpand,
}: {
  current: UnitType | undefined;
  disabled: boolean;
  onSet: (field: 'width_ft' | 'depth_ft', val: number) => void;
  onExpand: () => void;
}) {
  const [w, setW] = useState<string>(
    current?.width_ft != null ? String(current.width_ft) : '',
  );
  const [d, setD] = useState<string>(
    current?.depth_ft != null ? String(current.depth_ft) : '',
  );
  // fix-98: mirror fix-73's DateCell pattern. useState(prop) anchors to
  // the first render's value; without re-syncing, an OCC rollback or any
  // subsequent prop refresh leaves these inputs showing stale typed
  // values. Sync the local state from the prop on every change EXCEPT
  // while the user has a live unsaved edit (dirty=true). The dirty flag
  // clears on blur after the parent's writeTypes resolves the new value
  // through the prop, so the next prop refresh flows through.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setW(current?.width_ft != null ? String(current.width_ft) : '');
    setD(current?.depth_ft != null ? String(current.depth_ft) : '');
  }, [current?.width_ft, current?.depth_ft]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={w}
          placeholder="W"
          onChange={(e) => {
            dirtyRef.current = true;
            setW(e.target.value);
          }}
          onBlur={() => {
            onSet('width_ft', Number(w) || 0);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-w"
        />
        <span className="text-[9px] text-dim">×</span>
        <input
          type="number"
          min={0}
          value={d}
          placeholder="D"
          onChange={(e) => {
            dirtyRef.current = true;
            setD(e.target.value);
          }}
          onBlur={() => {
            onSet('depth_ft', Number(d) || 0);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-d"
        />
        <span className="text-[9px] text-dim">ft</span>
      </div>
      <button
        type="button"
        onClick={onExpand}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-expand"
      >
        + different sizes
      </button>
    </div>
  );
}

function UnitDimensionsExpanded({
  types,
  productTypes,
  disabled,
  onUpdate,
  onRemove,
  onAdd,
}: {
  types: UnitType[];
  productTypes: string[];
  disabled: boolean;
  onUpdate: (
    idx: number,
    field: keyof UnitType,
    val: string | number | null,
  ) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* fix-205: wider W/D so a decimal (e.g. 147.5) is visible inline; Qty
          narrowed to one digit; new Stories ("Sty") column. */}
      <div className="flex items-center gap-1 text-[8px] text-dim pb-0.5">
        <span style={{ width: 60 }}>Label</span>
        <span className="text-center" style={{ width: 38 }}>W</span>
        <span style={{ width: 6 }} />
        <span className="text-center" style={{ width: 38 }}>D</span>
        <span style={{ width: 6 }} />
        <span className="text-center" style={{ width: 18 }}>Qty</span>
        <span className="text-center" style={{ width: 30 }}>Sty</span>
      </div>
      {types.map((ut, i) => (
        <UnitRow
          key={i}
          row={ut}
          productTypes={productTypes}
          disabled={disabled}
          onChange={(field, val) => onUpdate(i, field, val)}
          onRemove={() => onRemove(i)}
        />
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start mt-0.5 cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-add"
      >
        + Add type
      </button>
    </div>
  );
}

function UnitRow({
  row,
  productTypes,
  disabled,
  onChange,
  onRemove,
}: {
  row: UnitType;
  productTypes: string[];
  disabled: boolean;
  onChange: (field: keyof UnitType, val: string | number | null) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [w, setW] = useState(row.width_ft != null ? String(row.width_ft) : '');
  const [d, setD] = useState(row.depth_ft != null ? String(row.depth_ft) : '');
  const [qty, setQty] = useState(String(row.qty || 1));
  const [stories, setStories] = useState(
    row.stories != null ? String(row.stories) : '',
  );
  // fix-98: dirty-flag prop sync (fix-73 pattern). UnitRow is keyed by
  // array index in the parent, so React reuses the same instance across
  // re-renders when the underlying row data changes (after a save). The
  // useState(row.*) initializer captured first-render values; without
  // re-sync, any prop refresh (OCC rollback, scraper update, sibling
  // edit) leaves the inputs displaying stale typed values. The dirty
  // flag preserves the user's live edit; cleared on blur so the next
  // prop arrival flows through.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setLabel(row.label);
    setW(row.width_ft != null ? String(row.width_ft) : '');
    setD(row.depth_ft != null ? String(row.depth_ft) : '');
    setQty(String(row.qty || 1));
    setStories(row.stories != null ? String(row.stories) : '');
  }, [row.label, row.width_ft, row.depth_ft, row.qty, row.stories]);
  const cellStyle = { borderBottomColor: 'var(--color-border)' } as const;
  const cellClass =
    'text-[9px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50';
  // fix-205 → fix-209 → fix-212: Label is product-type-driven whenever the
  // project has ANY product type. The shown/selected value is the RESOLVED label
  // (resolveUnitLabel): with several types it's the value only if it's a product
  // type (else the "Pick type…" placeholder); with EXACTLY ONE type it's always
  // that type — authoritatively overriding a legacy custom like "Type A".
  // fix-232: the label is DROPDOWN-ONLY — the old free-text fallback (when a
  // project had no product types) is gone, so no ad-hoc/off-registry value can be
  // typed onto a unit row. With no product types there's nothing valid to pick,
  // so the stored label renders READ-ONLY (not blanked — item 3) and the user
  // adds a product type (project field) to enable the picker.
  const hasProductTypes = productTypes.length >= 1;
  const selectValue = resolveUnitLabel(label, productTypes);
  return (
    <div className="flex items-center gap-1">
      {hasProductTypes ? (
        <select
          value={selectValue}
          onChange={(e) => {
            dirtyRef.current = true;
            const v = e.target.value;
            setLabel(v);
            onChange('label', v);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          style={{ ...cellStyle, width: 60 }}
          className={`${cellClass} text-left`}
          data-testid="pd-unit-label-select"
        >
          <option value="">Pick type…</option>
          {productTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <span
          style={{ ...cellStyle, width: 60 }}
          className={`${cellClass} text-left inline-block truncate ${label ? '' : 'text-dim'}`}
          title={
            label
              ? `${label} — add a product type to change`
              : 'Add a product type to label units'
          }
          data-testid="pd-unit-label-readonly"
        >
          {label || '—'}
        </span>
      )}
      <input
        type="number"
        min={0}
        step="0.5"
        value={w}
        placeholder="W"
        onChange={(e) => {
          dirtyRef.current = true;
          setW(e.target.value);
        }}
        onBlur={() => {
          onChange('width_ft', w === '' ? null : Number(w) || 0);
          dirtyRef.current = false;
        }}
        disabled={disabled}
        style={{ ...cellStyle, width: 38 }}
        className={cellClass}
        data-testid="pd-unit-w"
      />
      <span className="text-[8px] text-dim">×</span>
      <input
        type="number"
        min={0}
        step="0.5"
        value={d}
        placeholder="D"
        onChange={(e) => {
          dirtyRef.current = true;
          setD(e.target.value);
        }}
        onBlur={() => {
          onChange('depth_ft', d === '' ? null : Number(d) || 0);
          dirtyRef.current = false;
        }}
        disabled={disabled}
        style={{ ...cellStyle, width: 38 }}
        className={cellClass}
        data-testid="pd-unit-d"
      />
      <span className="text-[8px] text-dim">×</span>
      {/* fix-209: Qty + Sty are single-digit (occasionally 2) — narrow + equal
          (w-7 ≈ 28px). W/D widths are left as-is. */}
      <input
        type="number"
        min={1}
        value={qty}
        placeholder="qty"
        onChange={(e) => {
          dirtyRef.current = true;
          setQty(e.target.value);
        }}
        onBlur={() => {
          onChange('qty', Number(qty) || 1);
          dirtyRef.current = false;
        }}
        disabled={disabled}
        style={cellStyle}
        className={`${cellClass} w-7`}
        data-testid="pd-unit-qty"
      />
      {/* fix-205: Stories ("Sty") — 1–4+, blank = not entered. */}
      <input
        type="number"
        min={1}
        value={stories}
        placeholder="Sty"
        onChange={(e) => {
          dirtyRef.current = true;
          setStories(e.target.value);
        }}
        onBlur={() => {
          const n = stories === '' ? null : Math.max(1, Number(stories) || 0) || null;
          onChange('stories', n);
          dirtyRef.current = false;
        }}
        disabled={disabled}
        style={cellStyle}
        className={`${cellClass} w-7`}
        data-testid="pd-unit-stories"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="bg-transparent border-0 text-dim cursor-pointer text-[12px] leading-none px-0.5 disabled:opacity-50"
        title="Remove type"
      >
        ×
      </button>
    </div>
  );
}
